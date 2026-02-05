# L_EXE - LibreChat on Cloudflare Workers

A full-stack ChatGPT clone running natively on Cloudflare Workers with D1 (SQLite), R2 storage, and KV.

## Architecture

```
l_exe_cf/
├── wrangler.toml          # Cloudflare Workers config
├── package.json           # Dependencies
├── tsconfig.json          # TypeScript config
├── .dev.vars.example      # Environment variables template
├── migrations/            # D1 database migrations
│   └── 0001_initial_schema.sql
├── shared/types/          # Shared TypeScript types
└── workers/src/
    ├── index.ts           # Main Hono app entry point
    ├── types.ts           # Env bindings
    ├── routes/            # API routes
    ├── services/          # Business logic
    ├── db/                # D1 repository layer
    ├── providers/         # AI provider integrations
    └── middleware/        # Auth, rate limiting, etc.
```

## Tech Stack

- **Runtime**: Cloudflare Workers (Edge)
- **Framework**: Hono (Express-like, edge-compatible)
- **Database**: D1 (SQLite) with FTS5 for search
- **Storage**: R2 for files and images
- **Cache**: KV for sessions and rate limiting
- **Auth**: JWT with jose (Web Crypto API)
- **Validation**: Zod
- **AI Providers**: OpenAI, Anthropic, Google (Gemini)

## Prerequisites

- Node.js 18+
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account

## Setup

### 1. Install dependencies

```bash
cd l_exe_cf
npm install
```

### 2. Create Cloudflare resources

```bash
# Login to Cloudflare
wrangler login

# Create D1 database
wrangler d1 create l_exe_db
# Copy the database_id to wrangler.toml

# Create R2 buckets
wrangler r2 bucket create l-exe-files
wrangler r2 bucket create l-exe-images

# Create KV namespaces
wrangler kv:namespace create SESSIONS
wrangler kv:namespace create RATE_LIMIT
# Copy the IDs to wrangler.toml
```

### 3. Update wrangler.toml

Replace placeholder IDs with actual resource IDs from step 2:

```toml
[[d1_databases]]
database_id = "your-actual-database-id"

[[kv_namespaces]]
id = "your-sessions-namespace-id"

[[kv_namespaces]]
id = "your-rate-limit-namespace-id"
```

### 4. Run migrations

```bash
# Local
wrangler d1 migrations apply l_exe_db --local

# Production
wrangler d1 migrations apply l_exe_db
```

### 5. Set secrets

```bash
# Generate secrets
openssl rand -base64 32  # For JWT_SECRET
openssl rand -base64 32  # For JWT_REFRESH_SECRET

# Set secrets
wrangler secret put JWT_SECRET
wrangler secret put JWT_REFRESH_SECRET
wrangler secret put OPENAI_API_KEY       # Optional
wrangler secret put ANTHROPIC_API_KEY    # Optional
wrangler secret put GOOGLE_AI_API_KEY    # Optional
```

### 6. Create .dev.vars for local development

```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your secrets
```

## Development

```bash
# Start local dev server
npm run dev

# Type checking
npm run typecheck

# Run tests
npm test
```

The dev server runs at http://localhost:8787

## API Endpoints

### Auth
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `POST /api/auth/refresh` - Refresh access token

### Chat
- `POST /api/ask/:endpoint` - Send message (non-streaming)
- `POST /api/ask/:endpoint/stream` - Send message (SSE streaming)
- `POST /api/ask/:endpoint/abort` - Abort in-progress message

### Conversations
- `GET /api/convos` - List conversations
- `GET /api/convos/:id` - Get conversation
- `POST /api/convos` - Create conversation
- `PATCH /api/convos/:id` - Update conversation
- `DELETE /api/convos/:id` - Delete conversation

### Messages
- `GET /api/messages/:conversationId` - Get messages
- `POST /api/messages` - Create message
- `DELETE /api/messages/:id` - Delete message

### Files
- `POST /api/files` - Upload file
- `GET /api/files/:id` - Get file
- `DELETE /api/files/:id` - Delete file

### Config
- `GET /api/config` - Get app configuration
- `GET /api/config/models` - Get available models

## Deployment

```bash
# Deploy to production
npm run deploy

# Deploy to staging
npm run deploy:staging
```

## Supported AI Providers

| Provider | Models | Streaming | Vision | Tools |
|----------|--------|-----------|--------|-------|
| OpenAI | GPT-4o, GPT-4, GPT-3.5 | Yes | Yes | Yes |
| Anthropic | Claude 3.5, Claude 3 | Yes | Yes | Yes |
| Google | Gemini 1.5 Pro/Flash | Yes | Yes | Yes |
| Azure OpenAI | GPT-4o, GPT-4 | Yes | Yes | Yes |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| JWT_SECRET | Yes | JWT signing secret (32+ chars) |
| JWT_REFRESH_SECRET | Yes | Refresh token secret (32+ chars) |
| OPENAI_API_KEY | No* | OpenAI API key |
| ANTHROPIC_API_KEY | No* | Anthropic API key |
| GOOGLE_AI_API_KEY | No* | Google AI API key |

*At least one AI provider API key is required for chat functionality.

## License

MIT
