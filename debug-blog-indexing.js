import fs from 'fs/promises';
import path from 'path';
import { getProfileForPath } from './config/profiles.js';
import dotenv from 'dotenv';

dotenv.config();

const VAULT_PATH = process.env.VAULT_PATH;
const blogDir = path.join(VAULT_PATH, '03-Blog/benjamin-mendes/content/posts/2025');

async function debugBlogFiles() {
  console.log('🔍 Analyzing 2025 blog posts...\n');
  
  try {
    const entries = await fs.readdir(blogDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.name.endsWith('.md')) continue;
      
      const fullPath = path.join(blogDir, entry.name);
      const relativePath = fullPath.replace(VAULT_PATH + '/', '');
      
      console.log(`\n📄 ${entry.name}`);
      console.log(`   Full path: ${relativePath}`);
      
      // Check profile matching
      const profile = getProfileForPath(relativePath);
      console.log(`   Profile: ${profile} ${profile === 'public' ? '✅' : '❌'}`);
      
      // Check file stats
      const stats = await fs.stat(fullPath);
      console.log(`   Size: ${stats.size} bytes`);
      console.log(`   Modified: ${stats.mtime}`);
      
      // Check if readable
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        console.log(`   Content length: ${content.length} chars`);
        
        // Check frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
          const fm = frontmatterMatch[1];
          const hasPublishDate = /publishDate:/i.test(fm);
          const hasSource = /source:/i.test(fm);
          console.log(`   Has publishDate: ${hasPublishDate ? '✅' : '❌'}`);
          console.log(`   Has source: ${hasSource ? '✅' : '❌'}`);
          
          if (hasPublishDate) {
            const dateMatch = fm.match(/publishDate:\s*(.+)/i);
            console.log(`   Date: ${dateMatch[1].trim()}`);
          }
        } else {
          console.log(`   ⚠️  NO FRONTMATTER FOUND`);
        }
        
      } catch (err) {
        console.log(`   ❌ Error reading file: ${err.message}`);
      }
    }
    
  } catch (err) {
    console.error('Error:', err);
  }
}

debugBlogFiles();
