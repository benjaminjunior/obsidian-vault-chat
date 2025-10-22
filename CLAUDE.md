# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **Obsidian Vault Chat** - a RAG (Retrieval-Augmented Generation) powered chatbot that provides an AI interface to an Obsidian vault. The system indexes markdown notes using embeddings and enables semantic search with Claude AI to answer questions based on vault contents.

**Key Features:**
- Vector database indexing of Obsidian vault using LanceDB
- Semantic search with local embedding models (@xenova/transformers)
- Profile-based content filtering (public vs personal notes)
- Progressive result disclosure (batch-based results)
- Smart deduplication and content prioritization
- Date-aware sorting for "recent" queries
- Systemd service integration for production deployment

## Architecture

### Request Flow
1. User sends chat message → Express API (`/api/chat`)
2. Query embeddings generated using local transformer model
3. LanceDB vector search retrieves relevant chunks
4. Results filtered by profile, deduplicated, and sorted
5. Context + query sent to Claude API with profile-specific system prompt
6. Response returned with source citations

### Key Components

**Backend (backend-server.js)**
- Express server handling chat API and static file serving
- Manages conversation state and pending results
- Handles welcome messages, progressive disclosure, and rate limiting
- Integrates RAG search with fallback to keyword search

**RAG System (lib/rag-search.js)**
- Core search logic with semantic + keyword hybrid ranking
- Smart deduplication preferring blog posts over clippings
- Date-based sorting for temporal queries
- Profile filtering and content type detection
- Keyword boosting for title matches

**Indexing (scripts/index-vault.js)**
- Reads vault files filtered by profile
- Chunks markdown content with overlap
- Generates embeddings for each chunk
- Stores in LanceDB with metadata (date, source, contentType, etc.)

**Vault Reader (lib/vault-reader.js)**
- Recursively scans Obsidian vault directory
- Extracts frontmatter metadata (source, date, tags)
- Classifies content type (blog, clippings, other)
- Filters by profile configuration

**Profile System (config/profiles.js)**
- Defines content boundaries (public vs personal)
- Custom system prompts per profile
- Directory-based filtering logic
- Profile detection from file paths

**Chunking (lib/chunker.js)**
- Paragraph-aware text chunking
- Configurable chunk size and overlap
- Preserves semantic boundaries

**Embeddings (lib/embeddings.js)**
- Uses @xenova/transformers for local embeddings
- Model: Xenova/all-MiniLM-L6-v2 (downloads ~80MB on first run)
- Mean pooling + normalization

## Development Commands

### Start the server
```bash
npm start
# Runs: node backend-server.js
# Server runs on port 3000 by default (configurable via PORT env var)
```

### Re-index the vault
```bash
node scripts/index-vault.js
# This must be run after:
# - Adding/removing markdown files
# - Updating frontmatter metadata
# - Changing profile configurations
# Note: Re-indexing drops and recreates the entire vector database
```

### Production: Re-index with service restart
```bash
./reindex-vault.sh
# Runs index-vault.js and restarts systemd service
# Requires: sudo privileges for systemctl restart
# Logs to: /var/log/obsidian-chat/reindex.log
```


## Configuration (.env)

**Required:**
- `ANTHROPIC_API_KEY` - Claude API key
- `VAULT_PATH` - Absolute path to Obsidian vault directory

**Optional:**
- `PORT` (default: 3000) - Server port
- `USE_RAG` (default: false) - Enable vector search vs keyword search
- `DEFAULT_PROFILE` (default: 'public') - Profile for filtering content
- `EMBEDDING_MODEL` (default: 'Xenova/all-MiniLM-L6-v2') - Transformer model
- `CHUNK_SIZE` (default: 500) - Words per chunk
- `CHUNK_OVERLAP` (default: 50) - Overlap between chunks
- `MAX_RESULTS` (default: 5) - Results per batch
- `MAX_SEARCH_RESULTS` (default: 20) - Total results to retrieve

## Important Implementation Details

### Profile System
The profile system controls which vault directories are accessible:
- **public**: `clippings/` and `03-Blog/benjamin-mendes/content/posts/`
- **personal**: `02-Personal/`, `01-BRPX/` (disabled by default)

Profile detection happens in `config/profiles.js:getProfileForPath()` using directory path matching. Each profile has its own system prompt defining the AI's persona and response style.

### Content Type Detection
Files are automatically classified as:
- **blog**: Files in `03-blog/benjamin-mendes/content/posts/`
- **clippings**: Files in `clippings/` directory (and subdirectories)
- **other**: Everything else

Content type affects:
- Search result deduplication (blogs preferred over clippings)
- Source URL fallback (blog posts without URLs get search links)
- System prompt instructions (mentions "my blog" for blog content)

### Metadata Extraction
Frontmatter is parsed for:
- `source` or `url` → Used for citation links
- `publishDate` (blog) or `published` (clippings) → Used for date sorting
- `tags` → Stored but not currently used in search

### Search Ranking Algorithm
Results are ranked by (in priority order):
1. **Date** (if query contains "recent"/"latest"/"newest") - newest first
2. **Keyword boosting** - title matches heavily weighted
3. **Semantic similarity** - vector distance from query
4. **Source availability** - prefer articles with URLs
5. **Content type** - prefer blog over clippings

### Progressive Disclosure
When search returns more than `MAX_RESULTS`:
- Initial batch shown immediately
- Remaining stored in `pendingResults` map (session-based)
- User prompted "Would you like to see more?"
- Follow-up batches served on user confirmation
- Timeout: 10 minutes of inactivity clears pending results

### Systemd Service
The application runs as a systemd service in production:
- Service file: `/etc/systemd/system/obsidian-chat.service`
- Management: `sudo systemctl {start|stop|restart|status} obsidian-chat`
- Auto-restart on failure
- Runs as user `bjunior`

## Common Development Workflows

### Adding a new profile
1. Edit `config/profiles.js`
2. Add profile configuration with directories and systemPrompt
3. Re-run indexing: `node scripts/index-vault.js`
4. Update `.env` to set `DEFAULT_PROFILE` if needed

### Changing chunk size or embedding model
1. Update `.env` variables (`CHUNK_SIZE`, `CHUNK_OVERLAP`, `EMBEDDING_MODEL`)
2. Delete `lancedb/` directory to clear existing index
3. Re-run indexing: `node scripts/index-vault.js`
4. Note: Changing embedding models requires re-downloading on first run

### Modifying search behavior
- **Keyword boosting**: Edit `lib/rag-search.js:keywordBoost()`
- **Content type detection**: Edit query patterns in `lib/rag-search.js:searchVault()`
- **Sorting priority**: Modify comparison logic in `lib/rag-search.js:searchVault()` sort function
- **Deduplication**: Adjust similarity threshold in `lib/rag-search.js` (currently 0.8)

### Updating system prompts
Edit `config/profiles.js` - changes take effect immediately (no re-indexing needed)

### Debugging search results
Search logs show:
- Query classification (date-based, blog-specific, clippings-specific)
- Top 10 results after keyword boosting
- Deduplication decisions
- Final content breakdown with types and sources
- consider @/var/log/obsidian-chat as main location for the log files