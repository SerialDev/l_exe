# L_EXE - LibreChat Clone on Cloudflare Workers

## Project Overview
A full-stack ChatGPT-like application running natively on Cloudflare Workers with D1 database, R2 storage, and KV for sessions. This is a port of [LibreChat](https://github.com/danny-avila/LibreChat) to edge computing.

---

## Reference: LibreChat Routes to Implement

Based on the LibreChat reference implementation, these are ALL the routes/features:

| Route | LibreChat File | Status | Notes |
|-------|---------------|--------|-------|
| `/api/auth/*` | `routes/auth.js` | Partial | Missing 2FA, password reset |
| `/api/user/*` | `routes/user.js` | Partial | Missing email verify, terms |
| `/api/convos/*` | `routes/convos.js` | Done | Missing import/fork/duplicate |
| `/api/messages/*` | `routes/messages.js` | Done | Missing branch, artifact edit |
| `/api/presets/*` | `routes/presets.js` | Done | |
| `/api/files/*` | `routes/files/` | Done | Missing speech/avatar routes |
| `/api/search/*` | `routes/search.js` | Done | Using FTS5 instead of Meilisearch |
| `/api/agents/*` | `routes/agents/` | Partial | Missing chat streaming |
| `/api/share/*` | `routes/share.js` | Not Started | Conversation sharing |
| `/api/tags/*` | `routes/tags.js` | Not Started | Conversation bookmarks/tags |
| `/api/prompts/*` | `routes/prompts.js` | Not Started | Prompts library |
| `/api/balance/*` | `routes/balance.js` | Partial | Returns unlimited |
| `/api/config/*` | `routes/config.js` | Done | |
| `/api/mcp/*` | `routes/mcp.js` | Not Started | MCP server integration |
| `/api/roles/*` | `routes/roles.js` | Not Started | Role-based access control |
| `/api/memories/*` | `routes/memories.js` | Not Started | Long-term memory |
| `/api/assistants/*` | `routes/assistants/` | Not Started | OpenAI Assistants API |

---

## Configuration Files

### `wrangler.toml` (80 lines)
Cloudflare Workers configuration
- [ ] Lines 1-40: Worker name, main entry, compatibility settings, dev settings
  - `name = "l_exe_api"`
  - `main = "workers/src/index.ts"`
  - `compatibility_date`
  - Environment variables: APP_TITLE, DOMAIN_SERVER, DOMAIN_CLIENT
  - Auth flags: ALLOW_REGISTRATION, ALLOW_SOCIAL_LOGIN
- [ ] Lines 41-80: Bindings configuration
  - D1 database binding: `l_exe_db`
  - R2 buckets: FILES_BUCKET, IMAGES_BUCKET
  - KV namespaces: SESSIONS, RATE_LIMIT, CACHE
  - Production/staging environment overrides

### `package.json` (52 lines)
Backend dependencies and scripts
- [ ] Lines 1-52: Project configuration
  - Dependencies: hono, zod, jose, nanoid, @hono/zod-validator
  - Scripts: dev, deploy, db:migrate, db:seed
  - DevDependencies: wrangler, typescript, vitest, @cloudflare/workers-types

### `tsconfig.json` (43 lines)
TypeScript configuration
- [ ] Lines 1-43: Compiler options and path aliases
  - ES2022 target, strict mode
  - Path aliases: @/*, @shared/*, @db/*, @routes/*, @services/*, @middleware/*, @providers/*

---

## Database Migrations

### `migrations/0001_initial_schema.sql` (596 lines)
Complete D1 database schema

#### Users & Auth (Lines 1-80)
- [ ] Lines 1-40: Users table
  - id (TEXT PRIMARY KEY)
  - email (TEXT UNIQUE NOT NULL)
  - username (TEXT UNIQUE)
  - name (TEXT)
  - avatar (TEXT)
  - password_hash (TEXT)
  - role (TEXT DEFAULT 'user')
  - provider (TEXT) - local/google/github/discord
  - provider_id (TEXT)
  - email_verified (INTEGER DEFAULT 0)
  - two_factor_enabled (INTEGER DEFAULT 0)
  - two_factor_secret (TEXT)
  - backup_codes (TEXT) - JSON array
  - created_at, updated_at timestamps
- [ ] Lines 41-80: Sessions table
  - id (TEXT PRIMARY KEY)
  - user_id (TEXT REFERENCES users)
  - refresh_token_hash (TEXT)
  - expires_at (INTEGER)
  - user_agent (TEXT)
  - ip_address (TEXT)
  - Indexes on user_id, expires_at

#### Conversations & Messages (Lines 81-200)
- [ ] Lines 81-120: Conversations table
  - id (TEXT PRIMARY KEY)
  - user_id (TEXT REFERENCES users)
  - title (TEXT)
  - endpoint (TEXT) - openai/anthropic/google
  - model (TEXT)
  - system_message (TEXT)
  - temperature (REAL)
  - max_tokens (INTEGER)
  - is_archived (INTEGER DEFAULT 0)
  - created_at, updated_at timestamps
  - Indexes on user_id, is_archived, updated_at
- [ ] Lines 121-160: Messages table
  - id (TEXT PRIMARY KEY)
  - conversation_id (TEXT REFERENCES conversations)
  - parent_message_id (TEXT)
  - role (TEXT) - user/assistant/system
  - content (TEXT NOT NULL)
  - model (TEXT)
  - endpoint (TEXT)
  - token_count (INTEGER)
  - finish_reason (TEXT)
  - error (INTEGER DEFAULT 0)
  - is_created_by_user (INTEGER)
  - attachments (TEXT) - JSON array
  - created_at timestamp
  - Indexes on conversation_id, parent_message_id
- [ ] Lines 161-200: Message indexes and constraints
  - Foreign key constraints
  - Composite indexes for efficient queries

#### Presets & Agents (Lines 201-320)
- [ ] Lines 201-240: Presets table
  - id (TEXT PRIMARY KEY)
  - user_id (TEXT REFERENCES users)
  - title (TEXT NOT NULL)
  - endpoint (TEXT)
  - model (TEXT)
  - temperature (REAL)
  - max_tokens (INTEGER)
  - system_message (TEXT)
  - top_p (REAL)
  - frequency_penalty (REAL)
  - presence_penalty (REAL)
  - is_default (INTEGER DEFAULT 0)
  - created_at, updated_at timestamps
- [ ] Lines 241-280: Agents table
  - id (TEXT PRIMARY KEY)
  - user_id (TEXT REFERENCES users)
  - name (TEXT NOT NULL)
  - description (TEXT)
  - model (TEXT)
  - endpoint (TEXT)
  - system_message (TEXT)
  - tools (TEXT) - JSON array
  - tool_resources (TEXT) - JSON
  - avatar (TEXT)
  - is_public (INTEGER DEFAULT 0)
  - created_at, updated_at timestamps
- [ ] Lines 281-320: Files table
  - id (TEXT PRIMARY KEY)
  - user_id (TEXT REFERENCES users)
  - conversation_id (TEXT)
  - filename (TEXT NOT NULL)
  - original_name (TEXT)
  - mime_type (TEXT)
  - size (INTEGER)
  - r2_key (TEXT NOT NULL)
  - type (TEXT) - file/image
  - metadata (TEXT) - JSON
  - created_at timestamp

#### Sharing & Tokens (Lines 321-400)
- [ ] Lines 321-360: Shared links table
  - id (TEXT PRIMARY KEY)
  - user_id (TEXT REFERENCES users)
  - conversation_id (TEXT REFERENCES conversations)
  - share_id (TEXT UNIQUE)
  - is_public (INTEGER DEFAULT 1)
  - created_at, updated_at timestamps
- [ ] Lines 361-400: API keys & Transactions tables
  - api_keys: user encrypted API keys for providers
  - transactions: token usage tracking
  - balances: user credit balances

#### Access Control (Lines 401-480)
- [ ] Lines 401-440: ACL tables
  - acl_entries: permission grants
  - access_roles: role definitions
  - groups: user groups
- [ ] Lines 441-480: FTS5 virtual tables
  - messages_fts: Full-text search on message content
  - conversations_fts: Full-text search on conversation titles
  - prompts_fts: Full-text search on prompts

#### Triggers (Lines 481-596)
- [ ] Lines 481-520: FTS sync triggers
  - messages_fts_insert, messages_fts_delete, messages_fts_update
  - conversations_fts_insert, conversations_fts_delete, conversations_fts_update
- [ ] Lines 521-560: Updated_at triggers
  - Automatic timestamp updates on all tables
- [ ] Lines 561-596: Seed data
  - Default access roles
  - Default system prompts

### `migrations/0002_fix_sessions.sql` (19 lines)
- [ ] Lines 1-19: Sessions table fix
  - Recreate sessions table with proper column types
  - refresh_token_hash as TEXT
  - expires_at as INTEGER (Unix timestamp)

---

## Backend - Worker Entry

### `workers/src/index.ts` (342 lines)
Main Hono application entry point

#### Setup & Middleware (Lines 1-120)
- [ ] Lines 1-40: Imports and initialization
  - Import Hono, cors, secureHeaders
  - Import all route modules
  - Import middleware modules
  - Create Hono app with bindings type
- [ ] Lines 41-80: Global middleware
  - Request ID generation (X-Request-Id header)
  - Request timing (X-Response-Time header)
  - Secure headers (CSP, HSTS, X-Frame-Options)
  - CORS configuration for DOMAIN_CLIENT
- [ ] Lines 81-120: Logging and rate limiting
  - devLogger middleware for request/response logging
  - apiRateLimiter: 100 requests/minute
  - authRateLimiter: 5 requests/minute for login/register
  - Health check routes: GET /health, GET /api/health

#### Protected Routes (Lines 121-200)
- [ ] Lines 121-160: Auth middleware application
  - requireAuth on /api/user/*
  - requireAuth on /api/convos/*
  - requireAuth on /api/messages/*
  - requireAuth on /api/presets/*
  - requireAuth on /api/files/*
  - requireAuth on /api/agents/*
  - requireAuth on /api/search/*
- [ ] Lines 161-200: Route mounting
  - Mount auth routes at /api/auth
  - Mount user routes at /api/user
  - Mount conversation routes at /api/convos
  - Mount message routes at /api/messages
  - Mount preset routes at /api/presets
  - Mount file routes at /api/files
  - Mount agent routes at /api/agents
  - Mount search routes at /api/search
  - Mount config routes at /api/config

#### Chat Endpoints (Lines 201-280)
- [ ] Lines 201-240: POST /api/ask/:endpoint
  - Extract user from context
  - Validate request body with Zod
  - Create ChatService instance
  - Call sendMessage() for non-streaming response
  - Return message response JSON
- [ ] Lines 241-280: POST /api/ask/:endpoint/stream
  - Extract user from context
  - Validate request body
  - Create ChatService instance
  - Call sendMessageStream() for SSE response
  - Set Content-Type: text/event-stream
  - Handle connection close/abort

#### Static & Error Handling (Lines 281-342)
- [ ] Lines 281-320: Static file serving
  - GET /images/:key - Serve images from R2
  - GET /files/:key - Serve files from R2
  - POST /api/ask/:endpoint/abort - Abort generation
- [ ] Lines 321-342: Error handling
  - 404 handler for unknown routes
  - Global error handler
  - RateLimitError handling (429)
  - AppError handling (custom status codes)
  - Generic error handling (500)
  - Export default app

### `workers/src/types.ts` (135 lines)
TypeScript type definitions
- [ ] Lines 1-40: Env interface
  - DB: D1Database
  - FILES_BUCKET: R2Bucket
  - IMAGES_BUCKET: R2Bucket
  - SESSIONS: KVNamespace
  - RATE_LIMIT: KVNamespace
  - CACHE: KVNamespace
  - AI?: Ai (Cloudflare AI)
  - VECTORIZE?: VectorizeIndex
- [ ] Lines 41-80: Environment variables
  - JWT_SECRET, JWT_REFRESH_SECRET
  - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
  - GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
  - DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
  - OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY
  - EMAIL_* for transactional emails
- [ ] Lines 81-120: Context types
  - AuthUser interface (id, email, username, role)
  - Variables interface (userId, user)
  - AppContext type combining Env and Variables
- [ ] Lines 121-135: Utility types
  - D1Result<T> for database query results
  - R2ObjectMetadata
  - SessionMetadata
  - RateLimitMetadata

---

## Backend - Services

### `workers/src/services/auth.ts` (531 lines)
Authentication service with Web Crypto API

#### Password Hashing (Lines 1-120)
- [ ] Lines 1-40: Imports and constants
  - Import jose for JWT
  - PBKDF2_ITERATIONS = 100000
  - SALT_LENGTH = 16
  - ACCESS_TOKEN_EXPIRY = 15 * 60 (15 minutes)
  - REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60 (7 days)
- [ ] Lines 41-80: Type definitions
  - AccessTokenPayload: sub, email, username, role, iat, exp
  - RefreshTokenPayload: sub, sessionId, iat, exp
  - RegisterInput: email, password, name, username?
  - LoginResult: accessToken, refreshToken, expiresIn, user
- [ ] Lines 81-120: hashPassword()
  - Generate random salt (16 bytes)
  - Import raw key for PBKDF2
  - Derive key with SHA-256, 100k iterations
  - Return salt:hash as hex string

#### Token Operations (Lines 121-240)
- [ ] Lines 121-160: verifyPassword()
  - Split stored hash into salt:hash
  - Derive key with same parameters
  - Timing-safe comparison
  - Return boolean result
- [ ] Lines 161-200: generateAccessToken()
  - Create payload with user info
  - Sign with HS256 algorithm
  - Set expiration to 15 minutes
  - Return JWT string
- [ ] Lines 201-240: generateRefreshToken()
  - Create session ID
  - Create payload with session reference
  - Sign with HS256 algorithm
  - Set expiration to 7 days
  - Return { token, sessionId }

#### Session Management (Lines 241-360)
- [ ] Lines 241-280: createSession()
  - Hash refresh token for storage
  - Insert into sessions table
  - Set expiration timestamp
  - Store user agent, IP address
- [ ] Lines 281-320: validateSession()
  - Find session by ID
  - Check expiration
  - Verify refresh token hash
  - Return session data or null
- [ ] Lines 321-360: deleteSession(), deleteUserSessions()
  - Delete single session by ID
  - Delete all sessions for user
  - Clean up expired sessions

#### User Operations (Lines 361-531)
- [ ] Lines 361-400: registerUser()
  - Validate email uniqueness
  - Hash password
  - Insert into users table
  - Return user without password
- [ ] Lines 401-440: loginUser()
  - Find user by email
  - Verify password
  - Generate access and refresh tokens
  - Create session
  - Return LoginResult
- [ ] Lines 441-480: refreshAccessToken()
  - Verify refresh token JWT
  - Validate session exists and not expired
  - Generate new access token
  - Optionally rotate refresh token
- [ ] Lines 481-520: logoutUser()
  - Delete session from database
  - Clear session from KV
- [ ] Lines 521-531: getUserById(), updatePassword()
  - Fetch user without password_hash
  - Update password with new hash
  - Invalidate all sessions

### `workers/src/services/chat.ts` (605 lines)
Chat completions with AI providers and streaming

#### Configuration (Lines 1-120)
- [ ] Lines 1-40: Imports and types
  - Import provider classes
  - ChatServiceConfig interface
  - SendMessageRequest interface
- [ ] Lines 41-80: SendMessageResponse type
  - conversationId, messageId
  - parentMessageId, userMessageId
  - text, model, endpoint
  - finish_reason, tokenCount
- [ ] Lines 81-120: StreamCallbacks interface
  - onStart: (data) => void
  - onMessage: (text) => void
  - onError: (error) => void
  - onDone: (response) => void

#### Provider Management (Lines 121-200)
- [ ] Lines 121-160: ChatService class constructor
  - Store DB, env references
  - Initialize provider registry
  - Load user API keys
- [ ] Lines 161-200: getProviderConfig()
  - Map endpoint to provider config
  - OpenAI: api.openai.com
  - Anthropic: api.anthropic.com
  - Google: generativelanguage.googleapis.com
  - Return baseUrl, apiKey, headers

#### Message Handling (Lines 201-320)
- [ ] Lines 201-240: buildConversationHistory()
  - Fetch messages by conversation_id
  - Order by created_at
  - Format for provider (role, content)
  - Apply context window limits
- [ ] Lines 241-280: generateTitle()
  - Use first user message
  - Prompt: "Generate a short title for this conversation"
  - Call provider with low max_tokens
  - Return generated title
- [ ] Lines 281-320: sendMessage() - non-streaming
  - Create or get conversation
  - Save user message to DB
  - Build conversation history
  - Call provider.chat()
  - Save assistant message to DB
  - Update conversation title if first message

#### Streaming (Lines 321-480)
- [ ] Lines 321-360: sendMessageStream() - setup
  - Create TransformStream
  - Get writable stream writer
  - Create conversation if needed
  - Save user message
- [ ] Lines 361-400: sendMessageStream() - processing
  - Build conversation history
  - Create SSE encoder
  - Emit "start" event with IDs
  - Call provider.stream()
- [ ] Lines 401-440: sendMessageStream() - streaming
  - For each chunk from provider:
  - Emit "message" event with text delta
  - Accumulate full response text
  - Handle stream errors
- [ ] Lines 441-480: sendMessageStream() - completion
  - Emit "done" event with full response
  - Save assistant message to DB
  - Update conversation title
  - Close writer

#### Advanced Operations (Lines 481-605)
- [ ] Lines 481-520: abortMessage()
  - Find active generation
  - Call abort controller
  - Save partial response
  - Mark message as unfinished
- [ ] Lines 521-560: regenerateMessage()
  - Find parent message
  - Delete current assistant message
  - Re-send with same history
- [ ] Lines 561-600: editMessage()
  - Update user message content
  - Regenerate from that point
- [ ] Lines 601-605: createChatService() factory

### `workers/src/services/oauth.ts` (522 lines)
OAuth service for Google, GitHub, Discord

#### Types & Constants (Lines 1-80)
- [ ] Lines 1-40: Type definitions
  - OAuthConfig: clientId, clientSecret, redirectUri
  - GoogleUserInfo: id, email, name, picture, verified_email
  - GitHubUserInfo: id, login, email, name, avatar_url
  - DiscordUserInfo: id, username, email, avatar, global_name
  - OAuthTokens: access_token, refresh_token, expires_in
- [ ] Lines 41-80: OAuth URLs
  - Google: accounts.google.com/o/oauth2/v2/auth
  - GitHub: github.com/login/oauth/authorize
  - Discord: discord.com/api/oauth2/authorize

#### Google OAuth (Lines 81-160)
- [ ] Lines 81-120: getGoogleAuthUrl()
  - Build authorization URL
  - Scopes: openid, email, profile
  - State parameter for CSRF
  - access_type: offline for refresh token
- [ ] Lines 121-160: exchangeGoogleCode()
  - POST to token endpoint
  - Exchange code for tokens
  - Handle errors
  - Return OAuthTokens
- [ ] Lines 161-200: getGoogleUserInfo()
  - GET userinfo endpoint
  - Authorization: Bearer token
  - Return GoogleUserInfo

#### GitHub OAuth (Lines 201-280)
- [ ] Lines 201-240: getGitHubAuthUrl()
  - Build authorization URL
  - Scopes: read:user, user:email
  - State parameter
- [ ] Lines 241-280: exchangeGitHubCode()
  - POST to access_token endpoint
  - Accept: application/json
  - Handle error response
  - Return OAuthTokens (no expiry)
- [ ] Lines 281-320: getGitHubUserInfo()
  - GET /user endpoint
  - If email null, GET /user/emails
  - Find primary verified email
  - Return GitHubUserInfo

#### Discord OAuth (Lines 321-400)
- [ ] Lines 321-360: getDiscordAuthUrl()
  - Build authorization URL
  - Scopes: identify, email
  - State parameter
- [ ] Lines 361-400: exchangeDiscordCode()
  - POST to token endpoint
  - Content-Type: application/x-www-form-urlencoded
  - Return OAuthTokens

#### State & User Management (Lines 401-522)
- [ ] Lines 401-440: State management
  - generateOAuthState() - random UUID
  - storeOAuthState() - save to KV with 10min TTL
  - verifyOAuthState() - retrieve and delete (one-time use)
- [ ] Lines 441-480: normalizeOAuthProfile()
  - Convert provider-specific profile to common format
  - Handle avatar URL differences
  - Extract username from email or login
- [ ] Lines 481-522: findOrCreateOAuthUser()
  - Check if user exists by provider_id
  - Check if user exists by email
  - Link accounts if email matches
  - Create new user if not found
  - Return OAuthUser

### `workers/src/services/crypto.ts` (175 lines)
Cryptographic utilities
- [ ] Lines 1-40: Random generation
  - generateRandomBytes(length) - crypto.getRandomValues
  - generateUUID() - crypto.randomUUID
  - generateRandomString(length) - alphanumeric
- [ ] Lines 41-80: Encoding utilities
  - bufferToHex(), hexToBuffer()
  - bufferToBase64(), base64ToBuffer()
- [ ] Lines 81-120: Key derivation
  - deriveKey() - PBKDF2 with configurable iterations
  - importKey() - import raw key material
- [ ] Lines 121-160: Encryption
  - encrypt() - AES-GCM with random IV
  - decrypt() - AES-GCM decryption
- [ ] Lines 161-175: Utilities
  - timingSafeEqual() - constant-time comparison

---

## Backend - Middleware

### `workers/src/middleware/auth.ts` (349 lines)
Authentication middleware

#### JWT Verification (Lines 1-120)
- [ ] Lines 1-40: Types and interfaces
  - JWTPayload: sub, email, username, role, iat, exp
  - AuthUser: id, email, username, name, avatar, role
  - AuthContext: user in context variables
- [ ] Lines 41-80: Helper functions
  - base64UrlDecode() - decode JWT segments
  - extractToken() - parse Authorization header
- [ ] Lines 81-120: verifyJWT()
  - Split token into header.payload.signature
  - Decode header and payload
  - Verify signature with HMAC-SHA256
  - Check expiration
  - Return payload or null

#### Middleware Functions (Lines 121-240)
- [ ] Lines 121-160: requireAuth middleware
  - Extract token from Authorization header
  - Verify JWT signature and expiration
  - Optionally check session in KV
  - Set user in context variables
  - Return 401 if invalid
- [ ] Lines 161-200: optionalAuth middleware
  - Try to extract and verify token
  - Set user if valid, continue if not
  - Don't return errors
- [ ] Lines 201-240: isSessionValid()
  - Check session exists in D1
  - Verify not expired
  - Return boolean

#### Role-Based Access (Lines 241-349)
- [ ] Lines 241-280: requireAdmin middleware
  - Call requireAuth first
  - Check user.role === 'admin'
  - Return 403 if not admin
- [ ] Lines 281-320: requireRole() factory
  - Accept array of allowed roles
  - Return middleware function
  - Check user.role in allowed array
- [ ] Lines 321-349: createJWT() utility
  - For server-side JWT creation
  - Used by token refresh

### `workers/src/middleware/rateLimit.ts` (252 lines)
Rate limiting with KV

#### Core Implementation (Lines 1-120)
- [ ] Lines 1-40: Types
  - RateLimitOptions: limit, window, keyPrefix, keyGenerator
  - RateLimitRecord: count, resetAt
- [ ] Lines 41-80: getClientId()
  - Check CF-Connecting-IP header
  - Fallback to X-Forwarded-For
  - Default to 'unknown'
- [ ] Lines 81-120: createRateLimiter()
  - Sliding window algorithm
  - Store count in KV with TTL
  - Set rate limit headers
  - Return 429 if exceeded

#### Pre-configured Limiters (Lines 121-252)
- [ ] Lines 121-160: Standard limiters
  - apiRateLimiter: 100 req/min
  - strictRateLimiter: 10 req/min
  - authRateLimiter: 5 req/min
- [ ] Lines 161-200: Upload limiters
  - uploadRateLimiter: 10 uploads/hour
  - imageUploadRateLimiter: 20 images/hour
- [ ] Lines 201-252: Custom generators
  - createUserRateLimiter() - per user ID
  - createPathRateLimiter() - per path
  - createCompositeRateLimiter() - combined

### `workers/src/middleware/error.ts` (202 lines)
Error handling
- [ ] Lines 1-40: AppError base class
  - statusCode, code, details properties
  - Custom error message
- [ ] Lines 41-80: Specific error classes
  - AuthError (401)
  - ForbiddenError (403)
  - ValidationError (400)
  - NotFoundError (404)
- [ ] Lines 81-120: More error classes
  - ConflictError (409)
  - RateLimitError (429)
  - ServiceUnavailableError (503)
- [ ] Lines 121-160: createErrorResponse()
  - Standardized JSON error format
  - Include request ID
  - Include timestamp
- [ ] Lines 161-202: errorHandler middleware
  - Catch all errors
  - Log with context
  - Format response
  - notFoundHandler for 404

---

## Backend - Routes

### `workers/src/routes/auth.ts` (600 lines)
Authentication routes

#### Local Auth (Lines 1-200)
- [ ] Lines 1-40: Imports and schemas
  - loginSchema: email, password
  - registerSchema: email, password, confirm_password, name?, username?
  - refreshSchema: refreshToken
- [ ] Lines 41-80: POST /login
  - Validate request body
  - Call loginUser service
  - Return tokens and user
  - Handle invalid credentials
- [ ] Lines 81-120: POST /register
  - Check ALLOW_REGISTRATION
  - Validate request body
  - Call registerUser service
  - Generate tokens
  - Return user data
- [ ] Lines 121-160: POST /logout
  - Extract token from header
  - Delete session
  - Return success
- [ ] Lines 161-200: POST /refresh
  - Validate refresh token
  - Call refreshAccessToken
  - Return new tokens

#### Google OAuth (Lines 201-320)
- [ ] Lines 201-240: GET /google
  - Check Google OAuth configured
  - Generate state
  - Store in KV
  - Redirect to Google auth URL
- [ ] Lines 241-280: GET /google/callback
  - Verify state
  - Exchange code for tokens
  - Get user info
- [ ] Lines 281-320: Google callback continued
  - Find or create user
  - Generate app tokens
  - Create session
  - Redirect to client with tokens

#### GitHub OAuth (Lines 321-440)
- [ ] Lines 321-360: GET /github
  - Check GitHub OAuth configured
  - Generate state
  - Store in KV
  - Redirect to GitHub auth URL
- [ ] Lines 361-400: GET /github/callback
  - Verify state
  - Exchange code for tokens
  - Get user info (including email)
- [ ] Lines 401-440: GitHub callback continued
  - Check email present
  - Find or create user
  - Generate app tokens
  - Redirect to client

#### Discord OAuth (Lines 441-560)
- [ ] Lines 441-480: GET /discord
  - Check Discord OAuth configured
  - Generate state
  - Store in KV
  - Redirect to Discord auth URL
- [ ] Lines 481-520: GET /discord/callback
  - Verify state
  - Exchange code for tokens
  - Get user info
- [ ] Lines 521-560: Discord callback continued
  - Check email present
  - Find or create user
  - Generate app tokens
  - Redirect to client

#### User Info (Lines 561-600)
- [ ] Lines 561-600: GET /me
  - Require auth
  - Fetch user from DB
  - Return user without password

### `workers/src/routes/conversations.ts` (356 lines)
Conversation management

#### List & Get (Lines 1-120)
- [ ] Lines 1-40: Imports and schemas
  - createConversationSchema
  - updateConversationSchema
  - listQuerySchema: page, pageSize, search, isArchived
- [ ] Lines 41-80: GET /
  - Parse query params
  - Build filter (isArchived, search)
  - Cursor-based pagination
  - Sort by updatedAt desc
- [ ] Lines 81-120: GET /:id
  - Validate ownership
  - Return conversation with messages count

#### Create & Update (Lines 121-240)
- [ ] Lines 121-160: POST /
  - Validate request body
  - Generate conversation ID
  - Insert into database
  - Return new conversation
- [ ] Lines 161-200: PATCH /:id
  - Validate ownership
  - Update title, model, endpoint
  - Return updated conversation
- [ ] Lines 201-240: POST /archive
  - Validate ownership
  - Toggle isArchived flag
  - Return updated conversation

#### Delete & Advanced (Lines 241-356)
- [ ] Lines 241-280: DELETE /:id
  - Validate ownership
  - Delete all messages
  - Delete conversation
  - Delete shared links
- [ ] Lines 281-320: DELETE /all
  - Delete all user conversations
  - Delete all messages
  - Delete all shared links
- [ ] Lines 321-356: Future routes (stubs)
  - POST /import - import conversations
  - POST /fork - fork conversation
  - POST /duplicate - duplicate conversation

### `workers/src/routes/messages.ts` (341 lines)
Message management

#### List & Get (Lines 1-120)
- [ ] Lines 1-40: Imports and schemas
  - messageSchema: role, content, attachments
  - querySchema: conversationId, cursor, pageSize
- [ ] Lines 41-80: GET /
  - Search messages with FTS
  - Filter by user
  - Return with conversation info
- [ ] Lines 81-120: GET /:conversationId
  - Validate conversation ownership
  - Fetch all messages
  - Order by created_at

#### Create & Update (Lines 121-240)
- [ ] Lines 121-160: POST /
  - Validate conversation ownership
  - Generate message ID
  - Insert message
  - Update conversation timestamp
- [ ] Lines 161-200: PATCH /:id
  - Validate message ownership
  - Only allow editing user messages
  - Update content
- [ ] Lines 201-240: PUT /:conversationId/:messageId
  - Full message update
  - Recalculate token count

#### Delete & Advanced (Lines 241-341)
- [ ] Lines 241-280: DELETE /:id
  - Validate ownership
  - Delete message
  - Update conversation
- [ ] Lines 281-320: DELETE /:conversationId/:messageId
  - Delete specific message
  - Handle cascade
- [ ] Lines 321-341: Future routes (stubs)
  - POST /branch - branch from agent content
  - POST /artifact/:messageId - edit artifact

### `workers/src/routes/user.ts` (350 lines)
User profile routes

#### Profile (Lines 1-120)
- [ ] Lines 1-40: Imports and schemas
  - updateProfileSchema: name?, username?, avatar?
  - changePasswordSchema: current_password, new_password
  - deleteAccountSchema: password
- [ ] Lines 41-80: GET /
  - Return current user profile
  - Exclude password_hash
- [ ] Lines 81-120: PATCH /
  - Validate request body
  - Check username uniqueness
  - Update user
  - Return updated profile

#### Security (Lines 121-240)
- [ ] Lines 121-160: PATCH /password
  - Verify current password
  - Hash new password
  - Update user
  - Invalidate all sessions
- [ ] Lines 161-200: DELETE /
  - Require password confirmation
  - Delete all user data:
    - Messages
    - Conversations
    - Presets
    - Files (including R2)
    - Sessions
    - User record
- [ ] Lines 201-240: GET /balance
  - Return token balance
  - Currently returns unlimited

#### Future Routes (Lines 241-350)
- [ ] Lines 241-280: Verification routes (stubs)
  - POST /verify - verify email
  - POST /verify/resend - resend verification
- [ ] Lines 281-320: Terms routes (stubs)
  - GET /terms - get terms status
  - POST /terms/accept - accept terms
- [ ] Lines 321-350: Settings routes (stubs)
  - GET /settings - get user settings
  - PATCH /settings - update settings

### `workers/src/routes/presets.ts` (380 lines)
Preset management

#### CRUD Operations (Lines 1-160)
- [ ] Lines 1-40: Imports and schemas
  - presetSchema: title, endpoint, model, temperature, etc.
  - querySchema: page, pageSize
- [ ] Lines 41-80: GET /
  - List user presets
  - Optional pagination
  - Sort by updated_at desc
- [ ] Lines 81-120: GET /:id
  - Get single preset
  - Validate ownership
- [ ] Lines 121-160: POST /
  - Validate request body
  - Generate preset ID
  - Insert preset
  - Return new preset

#### Update & Delete (Lines 161-280)
- [ ] Lines 161-200: PUT /:id
  - Validate ownership
  - Full update of preset
  - Return updated preset
- [ ] Lines 201-240: PATCH /:id
  - Validate ownership
  - Partial update
  - Return updated preset
- [ ] Lines 241-280: DELETE /:id
  - Validate ownership
  - Delete preset

#### Advanced Operations (Lines 281-380)
- [ ] Lines 281-320: POST /delete
  - Batch delete by IDs
  - Validate ownership for all
- [ ] Lines 321-360: POST /:id/default
  - Set preset as default
  - Unset other defaults
- [ ] Lines 361-380: POST /:id/duplicate
  - Copy preset
  - Generate new ID

### `workers/src/routes/agents.ts` (508 lines)
Agent management

#### CRUD Operations (Lines 1-200)
- [ ] Lines 1-40: Imports and schemas
  - agentSchema: name, model, system_message, tools, etc.
  - querySchema: page, pageSize, is_public
- [ ] Lines 41-80: GET /
  - List user agents
  - Include public agents
  - Pagination
- [ ] Lines 81-120: GET /:id
  - Get single agent
  - Check ownership or public
- [ ] Lines 121-160: POST /
  - Validate request body
  - Generate agent ID
  - Insert agent
- [ ] Lines 161-200: PUT /:id
  - Validate ownership
  - Full update
  - Return updated agent

#### Update & Delete (Lines 201-320)
- [ ] Lines 201-240: PATCH /:id
  - Validate ownership
  - Partial update
  - Return updated agent
- [ ] Lines 241-280: DELETE /:id
  - Validate ownership
  - Delete agent
- [ ] Lines 281-320: POST /:id/duplicate
  - Copy agent
  - Generate new ID
  - Set is_public = false

#### Avatar & Tools (Lines 321-440)
- [ ] Lines 321-360: POST /:id/avatar
  - Upload avatar to R2
  - Update agent.avatar
- [ ] Lines 361-400: GET /:id/tools
  - List agent tools
  - Return tool definitions
- [ ] Lines 401-440: PUT /:id/tools
  - Update agent tools
  - Validate tool IDs

#### Future: Agent Chat (Lines 441-508)
- [ ] Lines 441-480: POST /:id/chat (stub)
  - Chat with specific agent
  - Use agent system prompt
  - Use agent tools
- [ ] Lines 481-508: POST /:id/chat/stream (stub)
  - Streaming chat with agent

### `workers/src/routes/files.ts` (426 lines)
File management with R2

#### Upload (Lines 1-120)
- [ ] Lines 1-40: Imports and schemas
  - uploadSchema: file validation
  - MAX_FILE_SIZE = 100MB
  - ALLOWED_TYPES = [...]
- [ ] Lines 41-80: POST /
  - Parse multipart form data
  - Validate file type and size
  - Generate R2 key
  - Upload to R2
- [ ] Lines 81-120: POST /images
  - Image-specific upload
  - Validate image types
  - Optionally resize
  - Upload to IMAGES_BUCKET

#### Retrieve (Lines 121-240)
- [ ] Lines 121-160: GET /
  - List user files
  - Pagination
  - Filter by type
- [ ] Lines 161-200: GET /:id
  - Get file metadata
  - Validate ownership
- [ ] Lines 201-240: GET /:id/download
  - Generate signed URL
  - Or stream from R2
  - Set Content-Disposition

#### Delete & Avatar (Lines 241-360)
- [ ] Lines 241-280: DELETE /:id
  - Validate ownership
  - Delete from R2
  - Delete metadata
- [ ] Lines 281-320: DELETE /batch
  - Batch delete files
  - Validate ownership for all
- [ ] Lines 321-360: POST /images/avatar
  - Upload user avatar
  - Resize to standard size
  - Update user.avatar

#### Conversation Files (Lines 361-426)
- [ ] Lines 361-400: GET /conversation/:conversationId
  - List files for conversation
  - Validate conversation ownership
- [ ] Lines 401-426: POST /conversation/:conversationId
  - Attach file to conversation
  - Update file metadata

### `workers/src/routes/search.ts` (721 lines)
Full-text search with FTS5

#### Main Search (Lines 1-200)
- [ ] Lines 1-40: Imports and schemas
  - searchSchema: q, type, page, pageSize, filters
  - searchResultSchema: type, id, content, highlight, score
- [ ] Lines 41-80: Helper: escapeFTS5Query()
  - Escape special characters
  - Handle phrase matching
- [ ] Lines 81-120: Helper: generateHighlight()
  - Find matching terms
  - Add bold markers
  - Limit snippet length
- [ ] Lines 121-160: GET /
  - Parse and validate query
  - Build FTS5 query
  - Apply filters
- [ ] Lines 161-200: Search execution
  - Search conversations_fts
  - Search messages_fts
  - Combine and rank results

#### Filtering & Results (Lines 201-360)
- [ ] Lines 201-240: Date filtering
  - Filter by startDate, endDate
  - Filter by endpoint
  - Filter by model
- [ ] Lines 241-280: Pagination
  - Calculate offset
  - Get total count
  - Return hasMore flag
- [ ] Lines 281-320: Response formatting
  - Include highlights
  - Include scores
  - Include took time
- [ ] Lines 321-360: Fallback search
  - If FTS5 fails, use LIKE
  - Less efficient but reliable

#### Suggestions & Recent (Lines 361-520)
- [ ] Lines 361-400: GET /enabled
  - Check FTS5 availability
  - Return feature flags
- [ ] Lines 401-440: GET /suggestions
  - Get recent searches from KV
  - Get matching conversation titles
  - Combine and dedupe
- [ ] Lines 441-480: POST /recent
  - Save search to KV
  - Limit to 20 recent
  - 30 day expiration
- [ ] Lines 481-520: GET /recent
  - Retrieve recent searches

#### Clear & Advanced (Lines 521-721)
- [ ] Lines 521-560: DELETE /recent
  - Clear recent searches from KV
- [ ] Lines 561-600: Future: semantic search
  - Use Vectorize for embeddings
  - Hybrid search (FTS + vector)
- [ ] Lines 601-720: Fallback implementation
  - LIKE-based search
  - Manual highlighting
  - Manual scoring

### `workers/src/routes/config.ts` (369 lines)
Application configuration

#### Startup Config (Lines 1-160)
- [ ] Lines 1-40: Imports
  - Environment checks
  - Feature flags
- [ ] Lines 41-80: GET /
  - Build startup configuration
  - Cache in KV
- [ ] Lines 81-120: Config values
  - appTitle
  - socialLogins enabled
  - googleLoginEnabled
  - githubLoginEnabled
  - discordLoginEnabled
- [ ] Lines 121-160: More config
  - emailLoginEnabled
  - registrationEnabled
  - passwordResetEnabled
  - sharedLinksEnabled

#### Endpoints Config (Lines 161-280)
- [ ] Lines 161-200: GET /endpoints
  - Available AI endpoints
  - OpenAI models
  - Anthropic models
  - Google models
- [ ] Lines 201-240: Model specifications
  - Context window sizes
  - Max output tokens
  - Pricing info
- [ ] Lines 241-280: Feature flags
  - presetsEnabled
  - agentsEnabled
  - filesEnabled
  - searchEnabled

#### Dynamic Config (Lines 281-369)
- [ ] Lines 281-320: GET /models
  - List available models
  - Filter by API key availability
- [ ] Lines 321-360: GET /features
  - Runtime feature flags
  - User-specific features
- [ ] Lines 361-369: Export router

---

## Backend - AI Providers

### `workers/src/providers/openai.ts` (684 lines)
OpenAI provider implementation

#### Types (Lines 1-160)
- [ ] Lines 1-40: Message types
  - OpenAIMessage: role, content, name?, tool_calls?
  - OpenAIContentPart: type, text?, image_url?
- [ ] Lines 41-80: Request types
  - OpenAIRequest: model, messages, temperature, etc.
  - OpenAITool: type, function
- [ ] Lines 81-120: Response types
  - OpenAIResponse: id, choices, usage
  - OpenAIChoice: message, finish_reason
- [ ] Lines 121-160: Stream types
  - OpenAIStreamResponse
  - OpenAIStreamChoice

#### Model Configuration (Lines 161-280)
- [ ] Lines 161-200: OpenAIProvider class
  - Model configs map
  - gpt-4o, gpt-4o-mini
- [ ] Lines 201-240: More models
  - gpt-4-turbo, gpt-4
  - o1, o1-mini, o1-preview
  - gpt-3.5-turbo
- [ ] Lines 241-280: Constructor and config
  - getDefaultBaseUrl()
  - getHeaders()

#### API Methods (Lines 281-440)
- [ ] Lines 281-320: chat()
  - Transform request
  - Make HTTP request
  - Transform response
- [ ] Lines 321-360: stream()
  - Transform request
  - Make streaming request
  - Parse SSE events
- [ ] Lines 361-400: countTokens()
  - Approximate tiktoken
  - Per-model tokenizers
- [ ] Lines 401-440: transformRequest()
  - Convert to OpenAI format
  - Handle o1 model differences

#### Message Transformation (Lines 441-560)
- [ ] Lines 441-480: transformMessages()
  - Convert message array
  - Handle system messages
  - Handle tool calls
- [ ] Lines 481-520: transformContent()
  - Handle text content
  - Handle image URLs
  - Handle tool results
- [ ] Lines 521-560: transformResponse()
  - Parse API response
  - Extract content
  - Map finish reason

#### Streaming & Errors (Lines 561-684)
- [ ] Lines 561-600: transformStreamChunk()
  - Parse SSE data
  - Extract delta
  - Handle [DONE]
- [ ] Lines 601-640: mapFinishReason()
  - stop -> stop
  - length -> length
  - tool_calls -> tool_calls
- [ ] Lines 641-684: parseErrorResponse()
  - Handle OpenAI errors
  - Rate limit detection
  - Authentication errors

### `workers/src/providers/anthropic.ts` (731 lines)
Anthropic Claude provider
- [ ] Lines 1-40: Imports and types
- [ ] Lines 41-80: Model configs (claude-3-5-sonnet, claude-3-opus, claude-3-haiku)
- [ ] Lines 81-120: chat() implementation
- [ ] Lines 121-160: stream() implementation
- [ ] Lines 161-200: Request transformation (system message separate)
- [ ] Lines 201-240: Response transformation
- [ ] Lines 241-280: Error handling (Anthropic-specific)
- [ ] Lines 281-320: Token counting
- [ ] Lines 321-360: Tool/function handling
- [ ] Lines 361-400: Streaming chunk parsing
- [ ] Lines 401-440: Extended thinking support (claude-3-5-sonnet)
- [ ] Lines 441-480: Image handling (base64)
- [ ] Lines 481-520: System prompt handling
- [ ] Lines 521-560: Message role mapping
- [ ] Lines 561-600: Rate limit handling
- [ ] Lines 601-640: Error mapping
- [ ] Lines 641-680: Model-specific configs
- [ ] Lines 681-731: Export and factory

### `workers/src/providers/google.ts` (728 lines)
Google Gemini provider
- [ ] Lines 1-40: Imports and types
- [ ] Lines 41-80: Model configs (gemini-1.5-pro, gemini-1.5-flash, gemini-2.0-flash)
- [ ] Lines 81-120: chat() implementation
- [ ] Lines 121-160: stream() implementation
- [ ] Lines 161-200: Request transformation (Gemini format)
- [ ] Lines 201-240: Response transformation
- [ ] Lines 241-280: Error handling
- [ ] Lines 281-320: Safety settings
- [ ] Lines 321-360: Token counting
- [ ] Lines 361-400: Image handling
- [ ] Lines 401-440: System instruction handling
- [ ] Lines 441-480: Multi-turn conversation
- [ ] Lines 481-520: Function calling
- [ ] Lines 521-560: Grounding
- [ ] Lines 561-600: Code execution
- [ ] Lines 601-640: Rate limits
- [ ] Lines 641-680: Model selection
- [ ] Lines 681-728: Export and factory

### `workers/src/providers/base.ts` (500 lines)
Base provider class
- [ ] Lines 1-40: IProvider interface
- [ ] Lines 41-80: ProviderConfig type
- [ ] Lines 81-120: BaseProvider abstract class
- [ ] Lines 121-160: makeRequest() - HTTP with retry
- [ ] Lines 161-200: makeStreamingRequest()
- [ ] Lines 201-240: parseSSEStream()
- [ ] Lines 241-280: RateLimiter class
- [ ] Lines 281-320: Error handling utilities
- [ ] Lines 321-360: Retry logic with backoff
- [ ] Lines 361-400: Request timeout handling
- [ ] Lines 401-440: Response validation
- [ ] Lines 441-480: Header management
- [ ] Lines 481-500: Export base class

### `workers/src/providers/types.ts` (257 lines)
Provider type definitions
- [ ] Lines 1-40: ChatMessage type
- [ ] Lines 41-80: ChatRequest type
- [ ] Lines 81-120: ChatResponse type
- [ ] Lines 121-160: StreamChunk type
- [ ] Lines 161-200: ContentPart types (text, image, tool)
- [ ] Lines 201-240: ProviderError class
- [ ] Lines 241-257: FinishReason, Usage types

---

## Backend - Database Repositories

### `workers/src/db/conversations.ts` (319 lines)
- [ ] Lines 1-40: Types (ConversationRow, Conversation)
- [ ] Lines 41-80: CreateConversationData, UpdateConversationData
- [ ] Lines 81-120: rowToConversation(), findById()
- [ ] Lines 121-160: findByUser() - cursor pagination
- [ ] Lines 161-200: create()
- [ ] Lines 201-240: update()
- [ ] Lines 241-280: deleteConversation(), archive()
- [ ] Lines 281-319: search(), touch(), countByUser()

### `workers/src/db/messages.ts` (377 lines)
- [ ] Lines 1-40: Types (MessageRow, Message)
- [ ] Lines 41-80: CreateMessageData, UpdateMessageData
- [ ] Lines 81-120: rowToMessage(), findById()
- [ ] Lines 121-160: findByConversation()
- [ ] Lines 161-200: findByParent()
- [ ] Lines 201-240: create()
- [ ] Lines 241-280: update()
- [ ] Lines 281-320: deleteMessage(), deleteByConversation()
- [ ] Lines 321-360: search() - FTS5
- [ ] Lines 361-377: getLatest(), countByConversation()

### `workers/src/db/users.ts` (295 lines)
- [ ] Lines 1-40: Types (UserRow, User)
- [ ] Lines 41-80: findById(), findByEmail()
- [ ] Lines 81-120: findByProvider()
- [ ] Lines 121-160: create()
- [ ] Lines 161-200: update()
- [ ] Lines 201-240: delete()
- [ ] Lines 241-280: updatePassword()
- [ ] Lines 281-295: updateAvatar(), getBalance()

### `workers/src/db/sessions.ts` (277 lines)
- [ ] Lines 1-40: Types (SessionRow, Session)
- [ ] Lines 41-80: findById(), findByUserId()
- [ ] Lines 81-120: findByRefreshToken()
- [ ] Lines 121-160: create()
- [ ] Lines 161-200: delete(), deleteByUser()
- [ ] Lines 201-240: deleteExpired()
- [ ] Lines 241-277: updateExpiration()

### `workers/src/db/presets.ts` (389 lines)
- [ ] Lines 1-40: Types (PresetRow, Preset)
- [ ] Lines 41-80: findById(), findByUser()
- [ ] Lines 81-120: create()
- [ ] Lines 121-160: update()
- [ ] Lines 161-200: delete()
- [ ] Lines 201-240: setDefault()
- [ ] Lines 241-280: duplicate()
- [ ] Lines 281-320: findDefault()
- [ ] Lines 321-360: batchDelete()
- [ ] Lines 361-389: count()

### `workers/src/db/files.ts` (346 lines)
- [ ] Lines 1-40: Types (FileRow, File)
- [ ] Lines 41-80: findById(), findByUser()
- [ ] Lines 81-120: findByConversation()
- [ ] Lines 121-160: create()
- [ ] Lines 161-200: delete()
- [ ] Lines 201-240: updateMetadata()
- [ ] Lines 241-280: batchDelete()
- [ ] Lines 281-320: getByR2Key()
- [ ] Lines 321-346: count(), sumSize()

---

## Frontend - Client Application

### `client/src/App.tsx` (122 lines)
- [ ] Lines 1-40: Imports, ChatLayout component
- [ ] Lines 41-80: Router component, auth callback route
- [ ] Lines 81-122: App component, auth check, loading

### `client/src/main.tsx` (10 lines)
- [ ] Lines 1-10: React DOM render, App mount

### `client/src/services/api.ts` (386 lines)
- [ ] Lines 1-40: Token storage, setTokens(), clearTokens()
- [ ] Lines 41-80: fetchWithAuth() - add auth header, handle 401
- [ ] Lines 81-120: login(), register()
- [ ] Lines 121-160: logout(), refreshAccessToken(), getCurrentUser()
- [ ] Lines 161-200: updateProfile(), changePassword(), deleteAccount()
- [ ] Lines 201-240: getConversations(), getConversation(), deleteConversation()
- [ ] Lines 241-280: updateConversationTitle(), getMessages()
- [ ] Lines 281-320: sendMessageStream() - SSE handling
- [ ] Lines 321-360: SSE parsing, callbacks
- [ ] Lines 361-386: sendMessage(), abortMessage()

### `client/src/stores/authStore.ts` (184 lines)
- [ ] Lines 1-40: AuthStore interface, Zustand create
- [ ] Lines 41-80: login(), register() actions
- [ ] Lines 81-120: logout(), checkAuth() actions
- [ ] Lines 121-160: updateProfile(), changePassword()
- [ ] Lines 161-184: deleteAccount(), clearError()

### `client/src/stores/chatStore.ts` (326 lines)
- [ ] Lines 1-40: ChatStore interface
- [ ] Lines 41-80: Initial state, settings
- [ ] Lines 81-120: loadConversations(), selectConversation()
- [ ] Lines 121-160: deleteConversation(), renameConversation()
- [ ] Lines 161-200: sendMessage() - optimistic update
- [ ] Lines 201-240: sendMessage() - SSE callbacks
- [ ] Lines 241-280: sendMessage() - onDone
- [ ] Lines 281-320: stopGeneration()
- [ ] Lines 321-326: setModel(), setEndpoint(), newConversation()

### `client/src/types/index.ts` (159 lines)
- [ ] Lines 1-40: User, AuthState, LoginRequest, RegisterRequest
- [ ] Lines 41-80: Conversation, ConversationListResponse, Message
- [ ] Lines 81-120: SendMessageRequest, SendMessageResponse, SSE types
- [ ] Lines 121-159: Endpoint, ModelOption, AVAILABLE_MODELS, ChatState

---

## Frontend - Components

### `client/src/components/Auth/LoginForm.tsx` (317 lines)
- [ ] Lines 1-40: GoogleIcon, GitHubIcon, DiscordIcon SVGs
- [ ] Lines 41-80: LoginForm state, handlers
- [ ] Lines 81-120: handleSubmit() - login or register
- [ ] Lines 121-160: OAuth handlers (Google, GitHub, Discord)
- [ ] Lines 161-200: OAuth buttons
- [ ] Lines 201-240: Email form fields
- [ ] Lines 241-280: Password fields
- [ ] Lines 281-317: Submit button, mode toggle

### `client/src/components/Auth/OAuthCallback.tsx` (104 lines)
- [ ] Lines 1-40: Imports, OAuthCallback component
- [ ] Lines 41-80: handleCallback() - extract tokens, store, redirect
- [ ] Lines 81-104: Error display, loading spinner

### `client/src/components/Chat/ChatInput.tsx` (95 lines)
- [ ] Lines 1-40: Imports, auto-resize textarea
- [ ] Lines 41-80: handleSubmit(), handleKeyDown()
- [ ] Lines 81-95: Attachment button, textarea, send button

### `client/src/components/Chat/MessageList.tsx` (193 lines)
- [ ] Lines 1-40: MessageBubble component
- [ ] Lines 41-80: Copy to clipboard, avatar
- [ ] Lines 81-120: ReactMarkdown with syntax highlighting
- [ ] Lines 121-160: Code block with copy button
- [ ] Lines 161-193: MessageList, empty state, streaming

### `client/src/components/Chat/ModelSelector.tsx` (110 lines)
- [ ] Lines 1-40: Imports, ModelSelector component
- [ ] Lines 41-80: Dropdown with AVAILABLE_MODELS
- [ ] Lines 81-110: Endpoint grouping, selection handler

### `client/src/components/Sidebar/Sidebar.tsx` (234 lines)
- [ ] Lines 1-40: Imports, Sidebar props
- [ ] Lines 41-80: New chat button
- [ ] Lines 81-120: Conversation list
- [ ] Lines 121-160: Conversation item - title, actions
- [ ] Lines 161-200: Delete confirmation
- [ ] Lines 201-234: User menu, settings link

### `client/src/components/Settings/SettingsModal.tsx` (539 lines)
- [ ] Lines 1-40: Imports, tab definitions
- [ ] Lines 41-80: SettingsModal layout
- [ ] Lines 81-120: ProfileTab - name, username
- [ ] Lines 121-160: ProfileTab - form submission
- [ ] Lines 161-200: ApiKeysTab - OpenAI key
- [ ] Lines 201-240: ApiKeysTab - Anthropic, Google keys
- [ ] Lines 241-280: ApiKeysTab - visibility toggle, save
- [ ] Lines 281-320: SecurityTab - password change form
- [ ] Lines 321-360: SecurityTab - validation, API call
- [ ] Lines 361-400: SecurityTab - OAuth user detection
- [ ] Lines 401-440: Danger zone - delete confirmation
- [ ] Lines 441-480: Delete account - password input
- [ ] Lines 481-520: Delete account - execute
- [ ] Lines 521-539: Export

---

## Status Summary

### Fully Implemented
- [x] Database schema (18 tables + FTS5 + triggers)
- [x] Authentication (email/password, JWT, sessions)
- [x] Google OAuth
- [x] GitHub OAuth
- [x] Discord OAuth
- [x] Chat streaming with SSE
- [x] OpenAI provider
- [x] Anthropic provider
- [x] Google provider
- [x] Conversations CRUD
- [x] Messages CRUD
- [x] User profile management
- [x] Password change
- [x] Account deletion
- [x] Rate limiting
- [x] Error handling
- [x] Frontend chat UI
- [x] File uploads (R2)
- [x] Image uploads (R2)
- [x] Presets CRUD
- [x] Agents CRUD
- [x] Full-text search (FTS5)
- [x] Search suggestions
- [x] Recent searches
- [x] Settings modal wired to backend

### Partially Implemented
- [ ] 2FA (TOTP) - service exists, routes not connected
- [ ] Email verification - needs email service
- [ ] Password reset - needs email service
- [ ] Conversation import/export
- [ ] Conversation fork/duplicate
- [ ] Message branching
- [ ] Artifact editing
- [ ] Agent chat with tools
- [ ] Balance/token tracking

### Not Implemented
- [ ] Shared links (conversation sharing)
- [ ] Tags/bookmarks for conversations
- [ ] Prompts library
- [ ] Prompt groups with permissions
- [ ] MCP server integration
- [ ] Role-based access control
- [ ] Long-term memory
- [ ] OpenAI Assistants API integration
- [ ] RAG with Vectorize
- [ ] Durable Objects for real-time
- [ ] WebSocket support
- [ ] Speech-to-text
- [ ] Text-to-speech
- [ ] Image generation (DALL-E, etc.)
- [ ] Web search tools
- [ ] Code interpreter

---

## Running the Project

```bash
# Backend (port 8787)
cd l_exe_cf && npm run dev

# Frontend (port 3000)
cd l_exe_cf/client && npm run dev

# Apply migrations
npx wrangler d1 migrations apply l_exe_db --local
```

## Testing

```bash
# Register
curl -X POST http://localhost:8787/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123","confirm_password":"testpass123"}'

# Login
curl -X POST http://localhost:8787/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}'

# Chat (with token)
curl -X POST http://localhost:8787/api/ask/openai \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello!","model":"gpt-4o"}'

# Search
curl -X GET "http://localhost:8787/api/search?q=hello" \
  -H "Authorization: Bearer <token>"
```

---

## Environment Variables

```toml
# Required
JWT_SECRET = "your-secret-key"
DOMAIN_CLIENT = "http://localhost:3000"
DOMAIN_SERVER = "http://localhost:8787"

# OAuth (optional)
GOOGLE_CLIENT_ID = ""
GOOGLE_CLIENT_SECRET = ""
GITHUB_CLIENT_ID = ""
GITHUB_CLIENT_SECRET = ""
DISCORD_CLIENT_ID = ""
DISCORD_CLIENT_SECRET = ""

# AI Providers (at least one required)
OPENAI_API_KEY = ""
ANTHROPIC_API_KEY = ""
GOOGLE_AI_API_KEY = ""

# Features
ALLOW_REGISTRATION = "true"
ALLOW_SOCIAL_LOGIN = "true"
```
