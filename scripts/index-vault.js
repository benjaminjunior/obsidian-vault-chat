import lancedb from 'vectordb';
import { readVault } from '../lib/vault-reader.js';
import { chunkText } from '../lib/chunker.js';
import { initEmbeddings, generateEmbedding } from '../lib/embeddings.js';
import dotenv from 'dotenv';

dotenv.config();

const VAULT_PATH = process.env.VAULT_PATH;
const DB_PATH = './lancedb';
const TABLE_NAME = 'ben_vault';
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE) || 500;
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP) || 50;

async function indexVault() {
  console.log('🚀 Starting vault indexing...\n');
  
  console.log('📦 Loading embedding model...');
  await initEmbeddings(process.env.EMBEDDING_MODEL);
  
  console.log('🔗 Connecting to LanceDB...');
  const db = await lancedb.connect(DB_PATH);
  
  console.log(`\n📖 Reading vault from: ${VAULT_PATH}`);
  console.log('📂 Processing profiles: public');
  const files = await readVault(VAULT_PATH, ['public']);
  
  if (files.length === 0) {
    console.error('\n❌ No files found!');
    process.exit(1);
  }
  
  console.log(`✓ Found ${files.length} files\n`);
  
  const allData = [];
  let processedFiles = 0;
  
  for (const file of files) {
    processedFiles++;
    console.log(`[${processedFiles}/${files.length}] Processing: ${file.name} (${file.metadata.contentType})`);
    
    const chunks = chunkText(file.content, CHUNK_SIZE, CHUNK_OVERLAP);
    console.log(`  ├─ Created ${chunks.length} chunks`);
    console.log(`  ├─ Generating embeddings...`);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await generateEmbedding(chunk);
      
      allData.push({
        id: `${file.name}_chunk_${i}`,
        text: chunk,
        vector: embedding,
        file: file.name,
        filePath: file.metadata.filePath,
        profile: file.metadata.profile,
        directory: file.metadata.directory,
        source: file.metadata.source || '',
        contentType: file.metadata.contentType,  // NEW
        chunkIndex: i,
        totalChunks: chunks.length
      });
    }
    
    console.log(`  └─ Indexed ${chunks.length} chunks\n`);
  }
  
  console.log('💾 Creating LanceDB table...');
  
  try {
    await db.dropTable(TABLE_NAME);
  } catch (e) {
    // Table doesn't exist, that's fine
  }
  
  await db.createTable(TABLE_NAME, allData);
  
  console.log('\n✅ Indexing complete!');
  console.log(`📊 Statistics:`);
  console.log(`   - Files processed: ${processedFiles}`);
  console.log(`   - Total chunks: ${allData.length}`);
  console.log(`   - Average chunks per file: ${(allData.length / processedFiles).toFixed(1)}`);
  console.log(`\n💾 Vector database location: ${DB_PATH}`);
}

indexVault().catch(error => {
  console.error('❌ Error during indexing:', error);
  process.exit(1);
});
