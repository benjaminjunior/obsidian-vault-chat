import fs from 'fs/promises';
import path from 'path';
import { getProfileForPath } from '../config/profiles.js';

export async function readVault(vaultPath, profiles = ['public']) {
  const files = [];
  
  console.log(`\n🔍 Debug: Starting vault scan...`);
  console.log(`   Vault path: ${vaultPath}`);
  console.log(`   Looking for profiles: ${profiles.join(', ')}`);
  
  async function walkDir(dir, relativePath = '') {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        
        const fullPath = path.join(dir, entry.name);
        const relPath = path.join(relativePath, entry.name);
        
        if (entry.isDirectory()) {
          await walkDir(fullPath, relPath);
        } else if (entry.name.endsWith('.md')) {
          const content = await fs.readFile(fullPath, 'utf-8');
          const profile = getProfileForPath(relPath);
          
          if (profiles.includes(profile)) {
            const metadata = extractMetadata(content, relPath, profile);
            files.push({
              path: relPath,
              fullPath: fullPath,
              name: entry.name.replace(/\.md$/, ''),
              content: content,
              metadata: metadata
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dir}:`, error.message);
    }
  }
  
  await walkDir(vaultPath);
  console.log(`\n   Total files found: ${files.length}\n`);
  return files;
}

function extractMetadata(content, filePath, profile) {
  const metadata = {
    profile: profile,
    filePath: filePath,
    directory: path.dirname(filePath),
    source: null,
    date: null,
    tags: [],
    contentType: getContentType(filePath)  // NEW: Detect content type
  };
  
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    
    const sourceMatch = frontmatter.match(/source:\s*(.+)/i);
    if (sourceMatch) {
      metadata.source = sourceMatch[1].trim().replace(/["']/g, '');
    }
    
    const dateMatch = frontmatter.match(/date:\s*(.+)/i);
    if (dateMatch) {
      metadata.date = dateMatch[1].trim();
    }
    
    const tagsMatch = frontmatter.match(/tags:\s*\[(.+)\]/i);
    if (tagsMatch) {
      metadata.tags = tagsMatch[1].split(',').map(t => t.trim());
    }
  }
  
  return metadata;
}

function getContentType(filePath) {
  const lowerPath = filePath.toLowerCase();
  
  // Check for blog posts
  if (lowerPath.includes('03-blog/benjamin-mendes/content/posts')) {
    return 'blog';
  }
  
  // Check for clippings
  if (lowerPath.includes('clippings')) {
    return 'clippings';
  }
  
  // Check for bookmarks
  if (lowerPath.includes('bookmarks')) {
    return 'bookmarks';
  }
  
  return 'other';
}
