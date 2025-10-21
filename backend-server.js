// backend-server.js
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import { initRAG, searchVault as ragSearch, getRecentArticles } from './lib/rag-search.js';
import { profileConfig } from './config/profiles.js';

dotenv.config();

const app = express();
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const VAULT_PATH = process.env.VAULT_PATH || '/path/to/obsidian/vault';
const USE_RAG = process.env.USE_RAG === 'true';
const DEFAULT_PROFILE = process.env.DEFAULT_PROFILE || 'public';
const MAX_RESULTS = parseInt(process.env.MAX_RESULTS) || 5;
const MAX_SEARCH_RESULTS = parseInt(process.env.MAX_SEARCH_RESULTS) || 20;

// Store pending results per session
const pendingResults = new Map();

// Initialize RAG on startup
let ragReady = false;
if (USE_RAG) {
  console.log('🚀 Initializing RAG system...');
  initRAG()
    .then(() => {
      ragReady = true;
      console.log('✅ RAG system ready!');
    })
    .catch(error => {
      console.error('❌ Failed to initialize RAG:', error);
      console.log('⚠️  Falling back to keyword search');
    });
}

// Fallback keyword search (original implementation)
async function keywordSearch(query) {
  const allFiles = [];
  
  async function walkDir(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.name === '.obsidian' || entry.name === '.git' || entry.name === '.trash') {
          continue;
        }
        
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await walkDir(fullPath);
        } else if (entry.name.endsWith('.md')) {
          const content = await fs.readFile(fullPath, 'utf-8');
          
          let url = null;
          const urlMatch = content.match(/(?:URL|Source|source|Link|Original):\s*(https?:\/\/[^\s\n]+)/i);
          if (urlMatch) {
            url = urlMatch[1];
          }
          
          if (!url) {
            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (frontmatterMatch) {
              const frontmatter = frontmatterMatch[1];
              const fmUrlMatch = frontmatter.match(/(?:url|source|link):\s*(https?:\/\/[^\s\n"']+)/i);
              if (fmUrlMatch) {
                url = fmUrlMatch[1].trim().replace(/["']/g, '');
              }
            }
          }
          
          allFiles.push({
            path: fullPath.replace(VAULT_PATH, ''),
            name: entry.name,
            content: content,
            url: url
          });
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dir}:`, error.message);
    }
  }
  
  await walkDir(VAULT_PATH);
  
  console.log(`Total files found: ${allFiles.length}`);
  
  const stopWords = ['a', 'an', 'the', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'about', 'any', 'some', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'talk', 'talking', 'tell', 'me', 'you', 'i', 'article', 'articles', 'note', 'notes', 'hi', 'hey', 'hello', 'ben'];
  const queryWords = query.toLowerCase()
    .replace(/[?.,!]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word));

  console.log(`Searching for keywords: ${queryWords.join(', ')}`);

  const scoredFiles = allFiles.map(file => {
    const contentLower = file.content.toLowerCase();
    const nameLower = file.name.toLowerCase();
    
    let score = 0;
    queryWords.forEach(keyword => {
      const contentMatches = (contentLower.match(new RegExp(keyword, 'g')) || []).length;
      const nameMatches = nameLower.includes(keyword) ? 10 : 0;
      score += contentMatches + nameMatches;
    });
    
    return { ...file, score };
  });

  const relevantFiles = scoredFiles
    .filter(file => file.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SEARCH_RESULTS);
  
  console.log(`Found ${relevantFiles.length} relevant files`);
  
  return relevantFiles;
}

// Main search function
async function searchVault(query, profile = DEFAULT_PROFILE) {
  if (USE_RAG && ragReady) {
    try {
      console.log('🔍 Using RAG search');
      return await ragSearch(query, { profile, limit: MAX_SEARCH_RESULTS });
    } catch (error) {
      console.error('❌ RAG search failed:', error);
      console.log('⚠️  Falling back to keyword search');
    }
  }
  
  console.log('🔍 Using keyword search');
  return await keywordSearch(query);
}

// Check if this is a welcome/initial interaction
function isWelcomeMessage(message, conversationHistory) {
  // It's a welcome if conversation is empty and message is short/generic
  if (conversationHistory.length > 0) return false;
  
  const lowerMessage = message.toLowerCase().trim();
  const welcomePatterns = [
    'hi', 'hey', 'hello', 'greetings', 'yo',
    "what's up", "what can you", "what do you",
    'help', 'start', 'begin'
  ];
  
  // Check if message is very short or matches welcome patterns
  const isShort = message.split(/\s+/).length <= 3;
  const matchesPattern = welcomePatterns.some(pattern => 
    lowerMessage.includes(pattern) || lowerMessage === pattern
  );
  
  return isShort && matchesPattern;
}

// Check if user wants more results
function isRequestingMoreResults(message) {
  const lowerMessage = message.toLowerCase().trim();
  const yesPatterns = ['yes', 'yeah', 'yep', 'sure', 'ok', 'show', 'more', 'see them', 'please'];
  const noPatterns = ['no', 'nope', 'nah', "don't", 'not now', 'skip'];
  
  const isYes = yesPatterns.some(pattern => lowerMessage.includes(pattern));
  const isNo = noPatterns.some(pattern => lowerMessage.includes(pattern));
  
  // If message is very short and matches yes/no patterns
  if (lowerMessage.length < 20) {
    if (isYes && !isNo) return 'yes';
    if (isNo && !isYes) return 'no';
  }
  
  return null;
}

app.post('/api/chat', async (req, res) => {
  try {
    const { message, conversationHistory = [], sessionId = 'default' } = req.body;
    
    // Check if this is a welcome message (first interaction)
    if (isWelcomeMessage(message, conversationHistory)) {
      console.log('👋 Welcome message detected - showing recent articles');
      
      if (!ragReady) {
        return res.json({
          response: "Hey! I'm still getting ready - my knowledge base is loading. Give me a moment and try again!",
          sourcesUsed: []
        });
      }
      
      // Get 5 most recent articles
      const recentArticles = await getRecentArticles(DEFAULT_PROFILE, 5);
      
      if (recentArticles.length === 0) {
        return res.json({
          response: "Hey! I'm Ben's AI assistant, but I don't seem to have any articles indexed yet. Once Ben adds some content, I'll be able to share his latest research and writings!",
          sourcesUsed: []
        });
      }
      
      // Build context with recent articles
      let context = 'Here are the 5 most recent articles from your knowledge base:\n\n';
      recentArticles.forEach(article => {
        const cleanName = article.metadata?.file || article.name?.replace(/\.md$/, '') || 'Unknown';
        const contentType = article.metadata?.contentType || 'unknown';
        const source = article.metadata?.source;
        const date = article.metadata?.date || 'no date';
        const text = article.text || article.content;
        
        const truncatedText = text && text.length > 1500 
          ? text.substring(0, 1500) + '\n\n[... content truncated ...]'
          : text;
        
        const sourceInfo = source 
          ? `[Source: ${cleanName}](${source})`
          : `Source: ${cleanName}`;
        
        context += `## ${sourceInfo}\nDate: ${date}\nType: ${contentType}\n${truncatedText}\n\n---\n\n`;
      });
      
      const profile = profileConfig[DEFAULT_PROFILE];
      const systemPrompt = profile?.systemPrompt || profileConfig.public.systemPrompt;
      
      const welcomeSystemPrompt = systemPrompt + `\n\n**WELCOME MODE:**
This is the user's first interaction. You're showing them the 5 most recent articles from your knowledge base.
- Greet them warmly and casually - YOU ARE BEN speaking directly
- Keep it natural and conversational, like you're chatting with someone who just said hi
- Present the recent articles in an engaging numbered list format
- For each article, include the title as a clickable link using the URLs provided in the context
- Add a short teaser or description (1-2 sentences) about what each article covers
- Keep it brief and friendly - don't over-explain who you are
- End with something casual like "What would you like to know more about?" or "What are you interested in?"`;
      
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        messages: [
          { role: 'user', content: `${context}\n\nGreet the user and present these recent articles.` }
        ],
        system: welcomeSystemPrompt
      });
      
      return res.json({
        response: response.content[0].text,
        sourcesUsed: recentArticles.map(article => ({
          name: article.metadata?.file || article.name?.replace(/\.md$/, '') || 'Unknown',
          url: article.metadata?.source || ''
        }))
      });
    }
    
    // Check if user is responding to "see more" prompt
    const hasPending = pendingResults.has(sessionId);
    const moreResultsResponse = isRequestingMoreResults(message);
    
    if (hasPending && moreResultsResponse) {
      const pending = pendingResults.get(sessionId);
      
      if (moreResultsResponse === 'no') {
        // User declined
        pendingResults.delete(sessionId);
        
        const profile = profileConfig[DEFAULT_PROFILE];
        const baseSystemPrompt = profile?.systemPrompt || profileConfig.public.systemPrompt;
        
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 4096,
          messages: [
            ...conversationHistory,
            { role: 'user', content: message }
          ],
          system: baseSystemPrompt + `\n\nThe user just declined to see more articles. Respond casually and ask what else you can help with. Keep it brief and friendly.`
        });
        
        return res.json({
          response: response.content[0].text,
          sourcesUsed: []
        });
      }
      
      if (moreResultsResponse === 'yes') {
        // User wants more - show next batch
        const remainingChunks = pending.remaining;
        const nextBatch = remainingChunks.slice(0, MAX_RESULTS);
        const stillRemaining = remainingChunks.slice(MAX_RESULTS);
        
        // Update or clear pending
        if (stillRemaining.length > 0) {
          pendingResults.set(sessionId, {
            ...pending,
            remaining: stillRemaining
          });
        } else {
          pendingResults.delete(sessionId);
        }
        
        // Build context for next batch
        let context = 'Here are more relevant notes from your knowledge base:\n\n';
        nextBatch.forEach(chunk => {
          const cleanName = chunk.metadata?.file || chunk.name?.replace(/\.md$/, '') || 'Unknown';
          const contentType = chunk.metadata?.contentType || 'unknown';
          let source = chunk.metadata?.source || chunk.url;
          
          // FALLBACK: If blog post has no source, create search link
          if (contentType === 'blog' && (!source || source.trim().length === 0)) {
            const searchQuery = encodeURIComponent(cleanName);
            source = `https://benjamin.mendes.im/search/?q=${searchQuery}`;
          }
          
          const text = chunk.text || chunk.content;
          
          const truncatedText = text && text.length > 3000 
            ? text.substring(0, 3000) + '\n\n[... content truncated ...]'
            : text;
          
          const sourceInfo = source 
            ? `[Source: ${cleanName}](${source})`
            : `Source: ${cleanName}`;
          
          context += `## ${sourceInfo}\n${truncatedText}\n\n---\n\n`;
        });
        
        const hasMore = stillRemaining.length > 0;
        const profile = profileConfig[DEFAULT_PROFILE];
        const baseSystemPrompt = profile?.systemPrompt || profileConfig.public.systemPrompt;
        
        const systemPrompt = baseSystemPrompt + `\n\n**FOLLOW-UP BATCH INSTRUCTIONS:**
You're showing additional articles from the same search. 
${hasMore ? `After presenting these articles, end with: "I still have ${stillRemaining.length} more articles. Want to see them?"` : 'This is the last batch - let them know these are all your findings.'}
Keep the EXACT same formatting style as your previous response - numbered list, no dividers, consistent styling.`;
        
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 4096,
          messages: [
            ...conversationHistory,
            { role: 'user', content: `${context}\n\nShow me these articles.` }
          ],
          system: systemPrompt
        });
        
        return res.json({
          response: response.content[0].text,
          sourcesUsed: nextBatch.map(chunk => ({
            name: chunk.metadata?.file || chunk.name?.replace(/\.md$/, '') || 'Unknown',
            url: chunk.metadata?.source || chunk.url
          })),
          hasMoreResults: hasMore,
          remainingCount: stillRemaining.length
        });
      }
    }
    
    // Regular search
    const allChunks = await searchVault(message, DEFAULT_PROFILE);
    
    // Split into initial and remaining
    const initialChunks = allChunks.slice(0, MAX_RESULTS);
    const remainingChunks = allChunks.slice(MAX_RESULTS);
    
    // Store remaining if there are any
    if (remainingChunks.length > 0) {
      pendingResults.set(sessionId, {
        query: message,
        remaining: remainingChunks,
        timestamp: Date.now()
      });
    }
    
    let context = '';
    if (initialChunks.length > 0) {
      context = 'Here are relevant notes from your knowledge base:\n\n';
      initialChunks.forEach(chunk => {
        const cleanName = chunk.metadata?.file || chunk.name?.replace(/\.md$/, '') || 'Unknown';
        const source = chunk.metadata?.source || chunk.url;
        const text = chunk.text || chunk.content;
        
        const truncatedText = text && text.length > 3000 
          ? text.substring(0, 3000) + '\n\n[... content truncated ...]'
          : text;
        
        const sourceInfo = source 
          ? `[Source: ${cleanName}](${source})`
          : `Source: ${cleanName}`;
        
        context += `## ${sourceInfo}\n${truncatedText}\n\n---\n\n`;
      });
    }
    
    const messages = [
      ...conversationHistory,
      {
        role: 'user',
        content: context 
          ? `${context}\n\nBased on your notes above, someone asks: ${message}`
          : `Someone asks you: ${message}\n\n(Note: You don't have any saved notes about this topic)`
      }
    ];
    
    const profile = profileConfig[DEFAULT_PROFILE];
    let systemPrompt = profile?.systemPrompt || profileConfig.public.systemPrompt;
    
    // Add instruction about more results if they exist
    if (remainingChunks.length > 0) {
      systemPrompt += `\n\nIMPORTANT: After answering, mention that you have ${remainingChunks.length} more articles on this topic. End your response with: "I've researched more articles than these. Would you like to see them?"`;
    }
    
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      messages: messages,
      system: systemPrompt
    });
    
    res.json({
      response: response.content[0].text,
      sourcesUsed: initialChunks.map(chunk => {
        const cleanName = chunk.metadata?.file || chunk.name?.replace(/\.md$/, '') || 'Unknown';
        const contentType = chunk.metadata?.contentType || 'unknown';
        let url = chunk.metadata?.source || chunk.url;
        
        // FALLBACK: If blog post has no source, create search link
        if (contentType === 'blog' && (!url || url.trim().length === 0)) {
          const searchQuery = encodeURIComponent(cleanName);
          url = `https://benjamin.mendes.im/search/?q=${searchQuery}`;
        }
        
        return {
          name: cleanName,
          url: url
        };
      }),
      hasMoreResults: remainingChunks.length > 0,
      remainingCount: remainingChunks.length
    });
    
  } catch (error) {
    console.error('Error:', error);
    
    if (error.status === 429) {
      const resetTime = error.headers?.['anthropic-ratelimit-input-tokens-reset'];
      const waitSeconds = resetTime ? Math.ceil((new Date(resetTime) - new Date()) / 1000) : 60;
      res.status(429).json({ 
        error: `Rate limit exceeded. Please wait ${waitSeconds} seconds and try again.`,
        retryAfter: waitSeconds
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Cleanup old pending results (run periodically)
setInterval(() => {
  const now = Date.now();
  const timeout = 10 * 60 * 1000; // 10 minutes
  
  for (const [sessionId, data] of pendingResults.entries()) {
    if (now - data.timestamp > timeout) {
      pendingResults.delete(sessionId);
    }
  }
}, 60000); // Check every minute

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    rag: USE_RAG ? (ragReady ? 'ready' : 'initializing') : 'disabled',
    profile: DEFAULT_PROFILE,
    maxResults: MAX_RESULTS,
    maxSearchResults: MAX_SEARCH_RESULTS
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📊 RAG: ${USE_RAG ? 'enabled' : 'disabled'}`);
  console.log(`👤 Profile: ${DEFAULT_PROFILE}`);
  console.log(`📢 Max results per batch: ${MAX_RESULTS}`);
  console.log(`🔍 Max search results: ${MAX_SEARCH_RESULTS}`);
  console.log(`\n✨ Ready to chat at http://localhost:${PORT}\n`);
});
