# Obsidian Vault Chat

A RAG (Retrieval-Augmented Generation) powered chat interface for your Obsidian vault. Ask questions about your notes and get AI-powered responses with proper source citations.

## Features

- Semantic search using vector embeddings for accurate retrieval
- Hybrid search combining semantic similarity with keyword boosting
- Date-aware queries that automatically prioritize recent content
- Smart citations with links to source articles
- Progressive disclosure showing 5 results initially with option to see more
- Profile system for separating public and private content
- Powered by Anthropic's Claude Sonnet 4.5
- Automatic re-indexing via cron jobs

## Architecture

The system consists of:
- **Indexer**: Processes Obsidian markdown files, chunks them, and generates embeddings
- **LanceDB**: Vector database storing embeddings and metadata
- **RAG Search**: Hybrid search combining vector similarity and keyword matching
- **Express Backend**: API server handling chat requests
- **Claude AI**: Generates natural language responses with proper citations
- **Web UI**: Simple chat interface

## Prerequisites

- Node.js 18 or higher
- An Obsidian vault
- Anthropic API key (get one at https://console.anthropic.com/)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/obsidian-vault-chat.git
cd obsidian-vault-chat
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp dot_env .env
nano .env
```

Edit the `.env` file with your settings:
```env
ANTHROPIC_API_KEY=your_api_key_here
VAULT_PATH=/path/to/your/obsidian/vault
PORT=3000
USE_RAG=true
DEFAULT_PROFILE=public
MAX_RESULTS=5
MAX_SEARCH_RESULTS=20
EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2
CHUNK_SIZE=500
CHUNK_OVERLAP=50
```

4. Configure profiles in `config/profiles.js`:
```javascript
export const profileConfig = {
  public: {
    name: 'Public Knowledge',
    directories: [
      'clippings',
      '03-Blog/benjamin-mendes/content/posts'
    ],
    // ... system prompt and settings
  }
};
```

5. Index your vault:
```bash
node scripts/index-vault.js
```

This will:
- Read all markdown files from configured directories
- Extract metadata (dates, sources, tags)
- Chunk documents into 500-word pieces with 50-word overlap
- Generate embeddings using the MiniLM model (downloads ~80MB on first run)
- Store vectors in LanceDB

6. Start the server:
```bash
npm start
```

The chat interface will be available at `http://localhost:3000`

## Configuration

### Profile System

Profiles control which content is searchable. Edit `config/profiles.js` to customize:

```javascript
public: {
  directories: [
    'clippings',
    '03-Blog/benjamin-mendes/content/posts'
  ],
  systemPrompt: 'Your custom prompt here...',
  enabled: true
}
```

### Frontmatter Support

The system extracts metadata from markdown frontmatter:

**For blog posts:**
```yaml
---
source: https://your-blog.com/post-url
publishDate: 2024-01-15
tags: [AI, Technology]
---
```

**For clippings:**
```yaml
---
url: https://source-article.com
published: 2024-01-15
tags: [Research]
---
```

Priority: `source` property first, then falls back to `url` property.

### Search Configuration

Adjust search behavior in `.env`:
- `MAX_RESULTS`: Results shown per batch (default: 5)
- `MAX_SEARCH_RESULTS`: Total results found before filtering (default: 20)
- `CHUNK_SIZE`: Words per chunk (default: 500)
- `CHUNK_OVERLAP`: Overlapping words between chunks (default: 50)

## Production Deployment

### Systemd Service (Auto-start on boot)

1. Create service file at `/etc/systemd/system/obsidian-chat.service`:
```ini
[Unit]
Description=Obsidian Vault Chat Service
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/path/to/obsidian-vault-chat
Environment="NODE_ENV=production"
ExecStart=/usr/bin/node backend-server.js
Restart=always
RestartSec=10
StandardOutput=append:/var/log/obsidian-chat/output.log
StandardError=append:/var/log/obsidian-chat/error.log

[Install]
WantedBy=multi-user.target
```

2. Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable obsidian-chat
sudo systemctl start obsidian-chat
```

### Automatic Re-indexing

1. Create re-index script at `/usr/local/bin/reindex-vault.sh`:
```bash
#!/bin/bash
PROJECT_DIR="/path/to/obsidian-vault-chat"
cd "$PROJECT_DIR"
/usr/bin/node scripts/index-vault.js
sudo systemctl restart obsidian-chat
```

2. Make executable:
```bash
sudo chmod +x /usr/local/bin/reindex-vault.sh
```

3. Configure sudoers for passwordless restart:
```bash
sudo visudo
# Add: YOUR_USERNAME ALL=(ALL) NOPASSWD: /bin/systemctl restart obsidian-chat
```

4. Add cron job (twice daily at 6 AM and 6 PM):
```bash
crontab -e
# Add:
0 6 * * * /usr/local/bin/reindex-vault.sh
0 18 * * * /usr/local/bin/reindex-vault.sh
```

## How It Works

### Indexing Process

1. **File Reading**: Scans configured directories for markdown files
2. **Metadata Extraction**: Parses frontmatter for dates, sources, tags
3. **Chunking**: Splits documents into overlapping chunks for better retrieval
4. **Embedding**: Generates vector embeddings using Xenova transformers
5. **Storage**: Stores chunks with metadata in LanceDB

### Search Process

1. **Query Embedding**: Converts user question to vector
2. **Vector Search**: Finds semantically similar chunks using cosine similarity
3. **Keyword Boosting**: Applies bonus scoring for exact keyword matches in titles and content
4. **Deduplication**: Groups chunks by file, preferring blog posts with sources
5. **Date Sorting**: For queries with temporal indicators (recent, latest), prioritizes by date
6. **Diversification**: Returns one chunk per unique article

### Response Generation

1. **Context Building**: Formats top results with source links
2. **Claude Processing**: Sends context + query to Claude with system prompt
3. **Citation Enforcement**: System prompt requires linking every mentioned article
4. **Progressive Disclosure**: Offers to show more if additional results available

## API Endpoints

### POST /api/chat
Chat with your vault.

**Request:**
```json
{
  "message": "What are the latest articles on AI?",
  "conversationHistory": [],
  "sessionId": "session_123"
}
```

**Response:**
```json
{
  "response": "Hey! I've researched some great content...",
  "sourcesUsed": [
    {
      "name": "Article Title",
      "url": "https://source-url.com"
    }
  ],
  "hasMoreResults": true,
  "remainingCount": 15
}
```

### GET /api/health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "rag": "ready",
  "profile": "public",
  "maxResults": 5,
  "maxSearchResults": 20
}
```

## Project Structure

```
obsidian-vault-chat/
├── backend-server.js          # Express API server
├── config/
│   └── profiles.js            # Profile configuration
├── lib/
│   ├── chunker.js            # Text chunking logic
│   ├── embeddings.js         # Embedding generation
│   ├── rag-search.js         # RAG search implementation
│   └── vault-reader.js       # Obsidian vault parser
├── scripts/
│   └── index-vault.js        # Indexing script
├── public/
│   └── index.html            # Chat UI
├── lancedb/                  # Vector database (generated)
├── package.json
└── .env                      # Configuration (not in git)
```

## Useful Commands

**Service Management:**
```bash
sudo systemctl status obsidian-chat
sudo systemctl restart obsidian-chat
sudo journalctl -u obsidian-chat -f
```

**View Logs:**
```bash
tail -f /var/log/obsidian-chat/output.log
tail -f /var/log/obsidian-chat/error.log
tail -f /var/log/obsidian-chat/reindex.log
```

**Manual Re-index:**
```bash
node scripts/index-vault.js
```

## Troubleshooting

**Embeddings not generating:**
- First run downloads ~80MB model
- Check internet connection
- Verify `EMBEDDING_MODEL` in `.env`

**No search results:**
- Verify `VAULT_PATH` points to correct directory
- Check profile configuration in `config/profiles.js`
- Ensure files have been indexed (`lancedb/` directory exists)
- Check file paths match configured directories

**Links not showing:**
- Verify frontmatter has `source` or `url` property
- Re-index after adding sources
- Check logs for metadata extraction

**Service won't start:**
- Check logs: `sudo journalctl -u obsidian-chat -xe`
- Verify paths in service file
- Ensure log directory exists and has correct permissions

## License

MIT

## Credits

Built with:
- [Anthropic Claude](https://www.anthropic.com/) - AI language model
- [LanceDB](https://lancedb.com/) - Vector database
- [Xenova Transformers](https://huggingface.co/Xenova) - Embeddings
- [Express](https://expressjs.com/) - Web framework
