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
    limit = 5
  } = options;
  
  console.log(`Searching for: "${query}" in profile: ${profile}`);
  
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
        
        // Prefer blog over clippings
        if (type1 === 'blog' && type2 === 'clippings') {
          toRemove.add(file2);
          console.log(`  Dedup: Preferring blog "${file1}" over clippings "${file2}"`);
        } else if (type1 === 'clippings' && type2 === 'blog') {
          toRemove.add(file1);
          console.log(`  Dedup: Preferring blog "${file2}" over clippings "${file1}"`);
        }
      }
    }
  }
  
  // Build diverse results: one chunk per file, prioritizing blog content
  const diverseChunks = [];
  
  // Sort files: blog first, then others
  const sortedFiles = fileNames
    .filter(f => !toRemove.has(f))
    .sort((a, b) => {
      const typeA = fileGroups[a].contentType;
      const typeB = fileGroups[b].contentType;
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
        contentType: group.contentType
      },
      similarity: bestChunk._distance ? (1 - bestChunk._distance) : 0
    });
  }
  
  console.log(`Found ${diverseChunks.length} diverse chunks from different sources`);
  console.log(`Content types: ${diverseChunks.map(c => `${c.metadata.file} (${c.metadata.contentType})`).join(', ')}`);
  
  return diverseChunks;
}
