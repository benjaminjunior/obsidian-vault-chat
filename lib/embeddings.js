import { pipeline } from '@xenova/transformers';

let embedder = null;

export async function initEmbeddings(modelName = 'Xenova/all-MiniLM-L6-v2') {
  console.log('Loading embedding model...');
  console.log('This will download ~80MB on first run...');
  
  embedder = await pipeline('feature-extraction', modelName);
  
  console.log('Embedding model loaded successfully!');
  return embedder;
}

export async function generateEmbedding(text) {
  if (!embedder) {
    throw new Error('Embedder not initialized. Call initEmbeddings() first.');
  }
  
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

export async function generateEmbeddings(texts, onProgress = null) {
  const embeddings = [];
  
  for (let i = 0; i < texts.length; i++) {
    const embedding = await generateEmbedding(texts[i]);
    embeddings.push(embedding);
    
    if (onProgress) {
      onProgress(i + 1, texts.length);
    }
  }
  
  return embeddings;
}
