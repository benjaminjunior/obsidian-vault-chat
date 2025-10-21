// check-db-columns.js - Diagnostic script to check database schema and data
import lancedb from 'vectordb';
import { initEmbeddings, generateEmbedding } from './lib/embeddings.js';
import dotenv from 'dotenv';

dotenv.config();

const DB_PATH = './lancedb';
const TABLE_NAME = 'ben_vault';

async function checkDatabase() {
  console.log('🔍 Checking LanceDB schema and data...\n');
  
  try {
    // Initialize embeddings
    console.log('Loading embeddings...');
    await initEmbeddings(process.env.EMBEDDING_MODEL);
    
    const db = await lancedb.connect(DB_PATH);
    const table = await db.openTable(TABLE_NAME);
    
    // Get schema
    const schema = await table.schema;
    console.log('📋 Table Schema:');
    console.log(schema);
    console.log('\n');
    
    // Generate a proper embedding
    const embedding = await generateEmbedding("test query");
    
    // Get a few sample records
    console.log('📊 Sample Records (first 5):');
    const samples = await table
      .search(embedding)
      .limit(5)
      .execute();
    
    samples.forEach((record, i) => {
      console.log(`\n--- Record ${i + 1} ---`);
      console.log('File:', record.file);
      console.log('Profile:', record.profile);
      console.log('Content Type:', record.contentType || 'MISSING');
      console.log('Date:', record.date || 'MISSING');
      console.log('Directory:', record.directory);
      console.log('Has vector:', !!record.vector);
    });
    
    // Check for blog posts specifically
    console.log('\n\n🔍 Testing blog-only query...');
    const blogQuery = await table
      .search(embedding)
      .where(`profile = 'public' AND \`contentType\` = 'blog' AND date != ''`)
      .limit(10)
      .execute();
    
    console.log(`Found ${blogQuery.length} blog posts with dates`);
    
    if (blogQuery.length > 0) {
      console.log('\nBlog posts found:');
      blogQuery.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.file} (${r.date})`);
      });
    }
    
    // Check all public records
    console.log('\n\n🔍 Checking all public records...');
    const allPublic = await table
      .search(embedding)
      .where(`profile = 'public'`)
      .limit(100)
      .execute();
    
    console.log(`\nTotal public results: ${allPublic.length}`);
    
    const contentTypes = {};
    const withDates = allPublic.filter(r => r.date && r.date !== '');
    
    allPublic.forEach(r => {
      const type = r.contentType || 'undefined';
      contentTypes[type] = (contentTypes[type] || 0) + 1;
    });
    
    console.log('\nContent Types distribution:');
    Object.entries(contentTypes).forEach(([type, count]) => {
      console.log(`  - ${type}: ${count}`);
    });
    
    console.log(`\nRecords with dates: ${withDates.length}/${allPublic.length}`);
    
    if (withDates.length > 0) {
      console.log('\nSample dates by content type:');
      const byType = {};
      withDates.forEach(r => {
        if (!byType[r.contentType]) byType[r.contentType] = [];
        byType[r.contentType].push(r);
      });
      
      Object.entries(byType).forEach(([type, records]) => {
        console.log(`\n  ${type} (${records.length} with dates):`);
        records.slice(0, 3).forEach(r => {
          console.log(`    - ${r.file}: ${r.date}`);
        });
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkDatabase();
