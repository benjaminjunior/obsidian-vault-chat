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

// NEW: Get recent articles by content type
export async function getRecentArticlesByType(profile = 'public', contentType = 'blog', limit = 5) {
  if (!embedderReady || !table) {
    throw new Error('RAG system not initialized');
  }
  
  console.log(`📅 Fetching ${limit} most recent ${contentType} articles for profile: ${profile}`);
  
  // Generate a generic query embedding
  const genericEmbedding = await generateEmbedding(`recent ${contentType} articles`);
  
  // Query directly for specific content type
  // Note: Use backticks for case-sensitive column names in LanceDB
  // Get a large number to ensure we have enough blog posts
  const allResults = await table
    .search(genericEmbedding)
    .where(`profile = '${profile}' AND \`contentType\` = '${contentType}' AND date != ''`)
    .limit(2000) // Get many more results since blog posts are sparse
    .execute();
  
  console.log(`  Found ${allResults.length} ${contentType} chunks with dates`);
  
  // Group by file
  const fileGroups = {};
  
  allResults.forEach(result => {
    const fileName = result.file;
    if (!fileGroups[fileName]) {
      fileGroups[fileName] = {
        file: fileName,
        date: result.date,
        contentType: result.contentType,
        source: result.source,
        filePath: result.filePath,
        directory: result.directory,
        chunks: []
      };
    }
    fileGroups[fileName].chunks.push(result);
  });
  
  // Sort by date (newest first)
  const sortedArticles = Object.values(fileGroups)
    .filter(group => group.date)
    .sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateB - dateA; // Newest first
    })
    .slice(0, limit);
  
  console.log(`  Returning ${sortedArticles.length} most recent ${contentType} articles:`);
  sortedArticles.forEach((article, i) => {
    console.log(`    ${i + 1}. ${article.file} (${article.date})`);
  });
  
  // Return in standard format
  return sortedArticles.map(article => {
    const firstChunk = article.chunks[0];
    
    return {
      text: firstChunk.text,
      metadata: {
        file: article.file,
        filePath: article.filePath,
        profile: firstChunk.profile,
        directory: article.directory,
        source: article.source,
        contentType: article.contentType,
        date: article.date
      }
    };
  });
}

// NEW: Get recent articles sorted by date (mixed content types)
export async function getRecentArticles(profile = 'public', limit = 5) {
  if (!embedderReady || !table) {
    throw new Error('RAG system not initialized');
  }
  
  console.log(`📅 Fetching ${limit} most recent articles for profile: ${profile}`);
  
  // Generate a generic query embedding to get results
  // We use a neutral query since we're sorting by date, not relevance
  const genericEmbedding = await generateEmbedding("recent articles");
  
  // Get all articles for the profile with dates
  const allResults = await table
    .search(genericEmbedding)
    .where(`profile = '${profile}' AND date != ''`)
    .limit(1000) // Get a large set to sort from
    .execute();
  
  // Group by file to get unique articles
  const fileGroups = {};
  
  allResults.forEach(result => {
    const fileName = result.file;
    if (!fileGroups[fileName]) {
      fileGroups[fileName] = {
        file: fileName,
        date: result.date,
        contentType: result.contentType,
        source: result.source,
        filePath: result.filePath,
        directory: result.directory,
        chunks: []
      };
    }
    fileGroups[fileName].chunks.push(result);
  });
  
  // Convert to array and sort by date (newest first)
  const sortedArticles = Object.values(fileGroups)
    .filter(group => group.date) // Only articles with dates
    .sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateB - dateA; // Newest first
    })
    .slice(0, limit);
  
  console.log(`Found ${sortedArticles.length} recent articles:`);
  sortedArticles.forEach((article, i) => {
    console.log(`  ${i + 1}. ${article.file} (${article.date}) [${article.contentType}]`);
  });
  
  // Return in the same format as search results
  return sortedArticles.map(article => {
    // Use the first chunk's text as a preview
    const firstChunk = article.chunks[0];
    
    return {
      text: firstChunk.text,
      metadata: {
        file: article.file,
        filePath: article.filePath,
        profile: firstChunk.profile,
        directory: article.directory,
        source: article.source,
        contentType: article.contentType,
        date: article.date
      }
    };
  });
}

function keywordBoost(text, fileName, query) {
  const textLower = (text + ' ' + fileName).toLowerCase();
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  let boost = 0;
  
  queryWords.forEach(word => {
    // Boost for exact word matches in text or filename
    const regex = new RegExp('\\b' + word + '\\b', 'g');
    const textMatches = (textLower.match(regex) || []).length;
    
    // Much stronger boost for filename matches (title relevance)
    const fileNameLower = fileName.toLowerCase();
    const fileNameMatches = (fileNameLower.match(regex) || []).length;
    
    boost += textMatches * 0.2;        // Text match boost
    boost += fileNameMatches * 0.5;     // Strong filename match boost
  });
  
  // Additional boost if multiple query words appear in filename
  const wordsInFileName = queryWords.filter(word => 
    fileName.toLowerCase().includes(word)
  ).length;
  
  if (wordsInFileName >= 3) {
    boost += 1.0; // Big boost for highly relevant titles
  } else if (wordsInFileName >= 2) {
    boost += 0.5; // Medium boost for somewhat relevant titles
  }
  
  return boost;
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
    sortByDate = false
  } = options;
  
  // Detect if query asks for recent/latest content
  const queryLower = query.toLowerCase();
  const isDateQuery = queryLower.includes('recent') || 
                      queryLower.includes('latest') || 
                      queryLower.includes('newest') ||
                      queryLower.includes('new') ||
                      /\d+\s*(most|top)/.test(queryLower) ||
                      queryLower.match(/last\s+\d+/);
  
  // Detect content type specific queries
  const isClippingsQuery = queryLower.includes('clipping') || 
                           queryLower.includes('saved') ||
                           queryLower.match(/articles?\s+(i'?ve\s+)?(saved|clipped)/);
  const isBlogQuery = queryLower.includes('blog') || 
                      queryLower.includes('wrote') ||
                      queryLower.includes('published') ||
                      queryLower.match(/my\s+blog/) ||
                      queryLower.match(/your\s+blog/);
  
  // NEW: If it's a date + content-type query, use the optimized function
  if (isDateQuery && isBlogQuery) {
    console.log('🎯 Using optimized blog-only recent articles search');
    return await getRecentArticlesByType(profile, 'blog', limit * 4); // Get more for pagination
  }
  
  if (isDateQuery && isClippingsQuery) {
    console.log('🎯 Using optimized clippings-only recent articles search');
    return await getRecentArticlesByType(profile, 'clippings', limit * 4); // Get more for pagination
  }
  
  console.log(`Searching for: "${query}" in profile: ${profile}`);
  if (isDateQuery) {
    console.log('  📅 Date-based query detected - will prioritize recency');
  }
  if (isClippingsQuery) {
    console.log('  📰 Clippings query detected - will FILTER to clippings only');
  }
  if (isBlogQuery) {
    console.log('  ✍️ Blog query detected - will FILTER to blog posts only');
  }
  
  const queryEmbedding = await generateEmbedding(query);
  
  // Get more results for better coverage with low-similarity articles
  const results = await table
    .search(queryEmbedding)
    .where(`profile = '${profile}'`)
    .limit(limit * 10)  // Increased multiplier for better coverage
    .execute();
  
  // Apply keyword boosting to improve relevance
  console.log(`  Applying keyword boosting to ${results.length} results...`);
  results.forEach(result => {
    const boost = keywordBoost(result.text, result.file, query);
    result._originalDistance = result._distance; // Keep original
    result._distance = result._distance - boost; // Lower distance = higher similarity
    result._boost = boost; // Store boost for debugging
  });
  
  // Re-sort by adjusted distance
  results.sort((a, b) => a._distance - b._distance);
  
  // Debug: Show top 10 after boosting
  if (isDateQuery || results.length > 0) {
    console.log(`  Top 10 after keyword boosting:`);
    results.slice(0, 10).forEach((r, i) => {
      console.log(`    ${i+1}. ${r.file} (boost: ${r._boost?.toFixed(2) || 0}, final distance: ${r._distance.toFixed(3)})`);
    });
  }
  
  // Group by file and track content types
  const fileGroups = {};
  
  results.forEach(result => {
    const fileName = result.file;
    if (!fileGroups[fileName]) {
      fileGroups[fileName] = {
        chunks: [],
        contentType: result.contentType,
        source: result.source,
        date: result.date,
        filePath: result.filePath,
        directory: result.directory,
        bestDistance: result._distance,  // Track best (lowest) distance
        bestBoost: result._boost || 0     // Track best boost
      };
    }
    fileGroups[fileName].chunks.push(result);
    
    // Update best distance if this chunk is better
    if (result._distance < fileGroups[fileName].bestDistance) {
      fileGroups[fileName].bestDistance = result._distance;
      fileGroups[fileName].bestBoost = result._boost || 0;
    }
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
        
        // Smart source selection
        const hasSource1 = source1 && source1.trim().length > 0;
        const hasSource2 = source2 && source2.trim().length > 0;
        
        if (hasSource1 && !hasSource2) {
          toRemove.add(file2);
          console.log(`  Dedup: Preferring "${file1}" (has source) over "${file2}" (no source)`);
        } else if (!hasSource1 && hasSource2) {
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
  const diverseChunks = [];
  
  const sortedFiles = fileNames
    .filter(f => !toRemove.has(f))
    .filter(f => {
      // FILTER by content type if query is specific
      const group = fileGroups[f];
      
      if (isClippingsQuery) {
        // Only return clippings
        return group.contentType === 'clippings';
      }
      
      if (isBlogQuery) {
        // Only return blog posts
        return group.contentType === 'blog';
      }
      
      // Otherwise return all
      return true;
    })
    .sort((a, b) => {
      const groupA = fileGroups[a];
      const groupB = fileGroups[b];
      
      // PRIORITY 1: If it's a date-based query, DATE IS KING
      if (isDateQuery || sortByDate) {
        const dateA = groupA.date;
        const dateB = groupB.date;
        
        if (dateA && dateB) {
          const dateObjA = new Date(dateA);
          const dateObjB = new Date(dateB);
          
          // Check if dates are valid
          if (!isNaN(dateObjA.getTime()) && !isNaN(dateObjB.getTime())) {
            const dateDiff = dateObjB - dateObjA; // Newest first
            if (Math.abs(dateDiff) > 0) {
              return dateDiff;
            }
          }
        } else if (dateA && !dateB) {
          return -1; // A has date, B doesn't - A wins
        } else if (!dateA && dateB) {
          return 1; // B has date, A doesn't - B wins
        }
      }
      
      // PRIORITY 2: Sort by boosted distance (relevance)
      const distanceA = groupA.bestDistance;
      const distanceB = groupB.bestDistance;
      
      if (Math.abs(distanceA - distanceB) > 0.1) {
        return distanceA - distanceB; // Lower distance = better match
      }
      
      // PRIORITY 3: If not a date query but dates exist, use them as tiebreaker
      if (!isDateQuery && !sortByDate) {
        const dateA = groupA.date;
        const dateB = groupB.date;
        
        if (dateA && dateB) {
          const dateObjA = new Date(dateA);
          const dateObjB = new Date(dateB);
          
          if (!isNaN(dateObjA.getTime()) && !isNaN(dateObjB.getTime())) {
            return dateObjB - dateObjA; // Newer is better as tiebreaker
          }
        } else if (dateA && !dateB) {
          return -1;
        } else if (!dateA && dateB) {
          return 1;
        }
      }
      
      // PRIORITY 4: Has source?
      const hasSourceA = groupA.source && groupA.source.trim().length > 0;
      const hasSourceB = groupB.source && groupB.source.trim().length > 0;
      
      if (hasSourceA && !hasSourceB) return -1;
      if (!hasSourceA && hasSourceB) return 1;
      
      // PRIORITY 5: Blog content?
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
        date: group.date
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
