export function chunkText(text, chunkSize = 500, overlap = 50) {
  // Remove frontmatter
  const contentWithoutFrontmatter = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  
  // Split by paragraphs first
  const paragraphs = contentWithoutFrontmatter
    .split(/\n\n+/)
    .filter(p => p.trim().length > 0);
  
  const chunks = [];
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/);
    
    // If paragraph is too long, split it
    if (words.length > chunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      
      for (let i = 0; i < words.length; i += chunkSize - overlap) {
        const chunk = words.slice(i, i + chunkSize).join(' ');
        chunks.push(chunk.trim());
      }
    } else {
      // Add paragraph to current chunk
      const testChunk = currentChunk + '\n\n' + paragraph;
      const testWords = testChunk.split(/\s+/).length;
      
      if (testWords > chunkSize && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = paragraph;
      } else {
        currentChunk = testChunk;
      }
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks.filter(chunk => chunk.length > 50);
}
