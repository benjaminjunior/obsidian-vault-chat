import fs from 'fs/promises';
import path from 'path';
import { getProfileForPath } from '../config/profiles.js';

export async function readVault(vaultPath, profiles = ['public']) {
  const files = [];
  
  console.log(`\n📁 Debug: Starting vault scan...`);
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
            
            // Debug: Show which files are being included
            console.log(`   ✓ Including: ${relPath} (${profile})`);
          } else {
            // Debug: Show which files are being skipped
            console.log(`   ✗ Skipping: ${relPath} (${profile})`);
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
  const contentType = getContentType(filePath);
  
  const metadata = {
    profile: profile,
    filePath: filePath,
    directory: path.dirname(filePath),
    source: null,
    date: null,
    tags: [],
    contentType: contentType
  };
  
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    
    const sourceMatch = frontmatter.match(/source:\s*(.+)/i);
    if (sourceMatch) {
      metadata.source = sourceMatch[1].trim().replace(/["']/g, '');
    }
    
    // Extract date based on content type
    let dateMatch;
    if (contentType === 'blog') {
      // For blog posts, use publishDate
      dateMatch = frontmatter.match(/publishDate:\s*(.+)/i);
    } else if (contentType === 'clippings') {
      // For clippings, use published
      dateMatch = frontmatter.match(/published:\s*(.+)/i);
    }
    
    // Fallback to generic 'date' field
    if (!dateMatch) {
      dateMatch = frontmatter.match(/date:\s*(.+)/i);
    }
    
    if (dateMatch) {
      metadata.date = dateMatch[1].trim().replace(/["']/g, '');
    }
    
    const tagsMatch = frontmatter.match(/tags:\s*\[(.+)\]/i);
    if (tagsMatch) {
      metadata.tags = tagsMatch[1].split(',').map(t => t.trim());
    }
  }
  
  return metadata;
}

function getContentType(filePath) {
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  
  // Check for blog posts
  if (normalizedPath.includes('03-blog/benjamin-mendes/content/posts')) {
    return 'blog';
  }
  
  // Check for clippings (including subdirectories)
  if (normalizedPath.includes('clippings/') || normalizedPath.startsWith('clippings/')) {
    return 'clippings';
  }
  
  return 'other';
}
