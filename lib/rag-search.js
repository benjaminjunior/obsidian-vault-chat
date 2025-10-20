import lancedb from 'vectordb';
import { initEmbeddings, generateEmbedding } from './embeddings.js';
import dotenv from 'dotenv';

dotenv.config();

const DB_PATH = './lancedb';
const TABLE_NAME = 'ben_vault';

let db = null;
let table = null;
let embedderReady = false;

export async function initRAG() {
  console.log('Initializing RAG system...');
  
  await initEmbeddings(process.env.EMBEDDING_MODEL);
  embedderReady = true;
  
  db = await lancedb.connect(DB_PATH);
  table = await db.openTable(TABLE_NAME);
  
  console.log('RAG system ready!');
}

function stringSimilarity(str1, str2) {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  if (longer.length === 0) return 1.0;
  return (longer.length - editDistance(longer, shorter)) / longer.length;
}

function editDistance(s1, s2) {
  s1 = s1.toLowerCase();
  s2 = s2.toLowerCase();
  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

export async function searchVault(query, options = {}) {
  if (!embedderReady || !table) {
    throw new Error('RAG system not initialized');
  }
  
  const {
    profile = 'public',
    limit = 5,
    sortByDate = false  // NEW: option to sort by date
  } = options;
  
  // Detect if query asks for recent/latest content
  const queryLower = query.toLowerCase();
  const isDateQuery = queryLower.includes('recent') || 
                      queryLower.includes('latest') || 
                      queryLower.includes('newest') ||
                      queryLower.includes('new') ||
                      /\d+\s*(most|top)/.test(queryLower) ||
                      queryLower.match(/last\s+\d+/);
  
  console.log(`Searching for: "${query}" in profile: ${profile}`);
  if (isDateQuery) {
    console.log('  📅 Date-based query detected - will prioritize recency');
  }
  
  const queryEmbedding = await generateEmbedding(query);
  
  // Get more results for deduplication
  const results = await table
    .search(queryEmbedding)
    .where(`profile = '${profile}'`)
    .limit(limit * 5)
    .execute();
  
  // Group by file and track content types
  const fileGroups = {};
  
  results.forEach(result => {
    const fileName = result.file;
    if (!fileGroups[fileName]) {
      fileGroups[fileName] = {
        chunks: [],
        contentType: result.contentType,
        source: result.source,
        date: result.date,  // NEW: Store date
        filePath: result.filePath,
        directory: result.directory
      };
    }
    fileGroups[fileName].chunks.push(result);
  });
  
  // Deduplicate: prefer blog over clippings for similar titles
  const fileNames = Object.keys(fileGroups);
  const toRemove = new Set();
  
  for (let i = 0; i < fileNames.length; i++) {
    for (let j = i + 1; j < fileNames.length; j++) {
      const file1 = fileNames[i];
      const file2 = fileNames[j];
      const similarity = stringSimilarity(file1, file2);
      
      // If titles are very similar (>0.8 similarity)
      if (similarity > 0.8) {
        const type1 = fileGroups[file1].contentType;
        const type2 = fileGroups[file2].contentType;
        const source1 = fileGroups[file1].source;
        const source2 = fileGroups[file2].source;
        
        // NEW LOGIC: Smart source selection
        // If one has source and other doesn't, prefer the one WITH source
        const hasSource1 = source1 && source1.trim().length > 0;
        const hasSource2 = source2 && source2.trim().length > 0;
        
        if (hasSource1 && !hasSource2) {
          // File1 has source, file2 doesn't - keep file1, remove file2
          toRemove.add(file2);
          console.log(`  Dedup: Preferring "${file1}" (has source) over "${file2}" (no source)`);
        } else if (!hasSource1 && hasSource2) {
          // File2 has source, file1 doesn't - keep file2, remove file1
          toRemove.add(file1);
          console.log(`  Dedup: Preferring "${file2}" (has source) over "${file1}" (no source)`);
        } else if (hasSource1 && hasSource2) {
          // Both have sources - use original logic (prefer blog)
          if (type1 === 'blog' && type2 !== 'blog') {
            toRemove.add(file2);
            console.log(`  Dedup: Preferring blog "${file1}" over ${type2} "${file2}"`);
          } else if (type1 !== 'blog' && type2 === 'blog') {
            toRemove.add(file1);
            console.log(`  Dedup: Preferring blog "${file2}" over ${type1} "${file1}"`);
          }
        } else {
          // Neither has source - use original logic (prefer blog)
          if (type1 === 'blog' && type2 !== 'blog') {
            toRemove.add(file2);
            console.log(`  Dedup: Preferring blog "${file1}" over ${type2} "${file2}"`);
          } else if (type1 !== 'blog' && type2 === 'blog') {
            toRemove.add(file1);
            console.log(`  Dedup: Preferring blog "${file2}" over ${type1} "${file1}"`);
          }
        }
      }
    }
  }
  
  // Build diverse results: one chunk per file
  // NEW: Sort by source availability first, then by content type, then by date
  const diverseChunks = [];
  
  const sortedFiles = fileNames
    .filter(f => !toRemove.has(f))
    .sort((a, b) => {
      const groupA = fileGroups[a];
      const groupB = fileGroups[b];
      
      // If it's a date-based query, prioritize by date first
      if (isDateQuery || sortByDate) {
        const dateA = groupA.chunks[0].date;
        const dateB = groupB.chunks[0].date;
        
        if (dateA && dateB) {
          // Sort newest first
          return new Date(dateB) - new Date(dateA);
        } else if (dateA && !dateB) {
          return -1; // A has date, B doesn't - prefer A
        } else if (!dateA && dateB) {
          return 1; // B has date, A doesn't - prefer B
        }
        // If neither has date, continue to other criteria
      }
      
      // First priority: Has source?
      const hasSourceA = groupA.source && groupA.source.trim().length > 0;
      const hasSourceB = groupB.source && groupB.source.trim().length > 0;
      
      if (hasSourceA && !hasSourceB) return -1;
      if (!hasSourceA && hasSourceB) return 1;
      
      // Second priority: Blog content?
      const typeA = groupA.contentType;
      const typeB = groupB.contentType;
      
      if (typeA === 'blog' && typeB !== 'blog') return -1;
      if (typeA !== 'blog' && typeB === 'blog') return 1;
      
      return 0;
    });
  
  for (const fileName of sortedFiles) {
    if (diverseChunks.length >= limit) break;
    
    const group = fileGroups[fileName];
    const bestChunk = group.chunks[0]; // First chunk has best score
    
    diverseChunks.push({
      id: bestChunk.id,
      text: bestChunk.text,
      metadata: {
        file: fileName,
        filePath: group.filePath,
        profile: bestChunk.profile,
        directory: group.directory,
        source: group.source,
        contentType: group.contentType,
        date: group.date  // NEW: Include date in metadata
      },
      similarity: bestChunk._distance ? (1 - bestChunk._distance) : 0
    });
  }
  
  console.log(`Found ${diverseChunks.length} diverse chunks from different sources`);
  if (isDateQuery) {
    console.log(`Date-sorted results (newest first):`);
    diverseChunks.forEach(c => {
      const date = c.metadata.date || 'no date';
      console.log(`  - ${c.metadata.file} (${date})`);
    });
  }
  console.log(`Content breakdown: ${diverseChunks.map(c => {
    const hasSource = c.metadata.source && c.metadata.source.trim().length > 0;
    const date = c.metadata.date ? ` ${c.metadata.date}` : '';
    return `${c.metadata.file} (${c.metadata.contentType}${hasSource ? ' ✓' : ' ✗'}${date})`;
  }).join(', ')}`);
  
  return diverseChunks;
}
