/**
 * L_EXE - LibreChat on Cloudflare Workers
 * Main entry point
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { prettyJSON } from 'hono/pretty-json';

// Import our types
import type { Env, Variables } from './types';

// Import routes
import { api } from './routes';

// Import middleware
import { AppError, RateLimitError } from './middleware/error';
import { devLogger } from './middleware/logging';
import { requireAuth, type AuthContext } from './middleware/auth';
import { apiRateLimiter, authRateLimiter } from './middleware/rateLimit';

// Import services
import { createChatService } from './services/chat';

// Import better-auth
import { createAuth } from './lib/auth';

// Create the main app
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================================
// Global Middleware
// ============================================================================

// Request ID and timing
app.use('*', async (c, next) => {
  c.set('requestId', crypto.randomUUID());
  c.set('startTime', Date.now());
  await next();
});

// Secure headers
app.use('*', secureHeaders());

// CORS - configure based on environment
app.use('*', async (c, next) => {
  const origin = c.env.DOMAIN_CLIENT || '*';
  return cors({
    origin: origin === '*' ? '*' : [origin, c.env.DOMAIN_SERVER],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposeHeaders: ['X-Request-ID', 'X-RateLimit-Remaining'],
    credentials: true,
    maxAge: 86400,
  })(c, next);
});

// Request logging
app.use('*', devLogger);

// Pretty JSON in development
app.use('*', prettyJSON());

// Global rate limiting
app.use('/api/*', apiRateLimiter);

// Stricter rate limiting for auth endpoints (but not for better-auth which has its own)
// app.use('/api/auth/*', authRateLimiter);

// ============================================================================
// Better Auth Handler
// ============================================================================

// Mount better-auth handler for all /api/auth/* routes
app.on(['POST', 'GET'], '/api/auth/*', async (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

// Session middleware - attach user to context for protected routes
app.use('/api/*', async (c, next) => {
  // Skip for auth routes (better-auth handles those)
  if (c.req.path.startsWith('/api/auth/')) {
    return next();
  }
  
  const auth = createAuth(c.env);
  
  // Debug: log cookies
  const cookieHeader = c.req.header('Cookie');
  console.log('[Session Middleware] Cookie header:', cookieHeader);
  
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  console.log('[Session Middleware] Session result:', session ? 'Found' : 'Not found', session?.user?.email || 'N/A');
  
  if (session) {
    const userId = session.user.id;
    const userEmail = session.user.email;
    const userName = session.user.name || userEmail.split('@')[0];
    const userRole = (session.user as any).role || 'user';
    const userAvatar = session.user.image || null;

    // Sync user to legacy 'users' table for FK compatibility
    // This ensures foreign key constraints on conversations, presets, etc. are satisfied
    await ensureLegacyUser(c.env.DB, {
      id: userId,
      email: userEmail,
      name: userName,
      role: userRole,
      avatar: userAvatar,
    });

    // Attach user to context for compatibility with existing routes
    c.set('user', {
      id: userId,
      email: userEmail,
      name: userName,
      username: userEmail.split('@')[0],
      role: userRole,
      avatar: userAvatar,
    });
    
    // Also set userId directly for routes that expect it
    c.set('userId' as any, userId);
  }
  
  await next();
});

/**
 * Ensure user exists in legacy 'users' table for FK compatibility
 * Uses INSERT OR IGNORE to handle race conditions safely
 */
async function ensureLegacyUser(
  db: D1Database,
  user: { id: string; email: string; name: string; role: string; avatar: string | null }
) {
  console.log(`[ensureLegacyUser] Checking user ${user.id} (${user.email})`);
  
  try {
    // First check if user already exists
    const existing = await db
      .prepare('SELECT id FROM users WHERE id = ?')
      .bind(user.id)
      .first();
    
    if (existing) {
      console.log(`[ensureLegacyUser] User ${user.id} already exists in legacy table`);
      return;
    }
    
    console.log(`[ensureLegacyUser] User ${user.id} not found, creating...`);
    
    // Use INSERT OR IGNORE - if user already exists by ID, this is a no-op
    // We use a unique email suffix to avoid email conflicts with old users
    await db
      .prepare(`
        INSERT OR IGNORE INTO users (id, email, username, name, avatar, role, provider, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'local', datetime('now'), datetime('now'))
      `)
      .bind(
        user.id,
        user.email,  // This might conflict if email exists with different ID
        user.email.split('@')[0],
        user.name,
        user.avatar,
        user.role
      )
      .run();
    
    console.log(`[ensureLegacyUser] User ${user.id} created successfully`);
  } catch (e: any) {
    console.error(`[ensureLegacyUser] Error for user ${user.id}:`, e.message);
    
    // If we get a UNIQUE constraint error on email, the user exists with a different ID
    // In this case, we need to create a placeholder entry with a modified email
    if (e.message?.includes('UNIQUE constraint failed: users.email')) {
      try {
        console.log(`[ensureLegacyUser] Email conflict, creating with migrated email...`);
        await db
          .prepare(`
            INSERT OR IGNORE INTO users (id, email, username, name, avatar, role, provider, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'local', datetime('now'), datetime('now'))
          `)
          .bind(
            user.id,
            `${user.id}@migrated.local`,  // Use ID-based email to avoid conflicts
            user.email.split('@')[0],
            user.name,
            user.avatar,
            user.role
          )
          .run();
        console.log(`[ensureLegacyUser] User ${user.id} created with migrated email`);
      } catch (e2: any) {
        console.error('Failed to create legacy user placeholder:', e2.message);
      }
    } else {
      console.warn('ensureLegacyUser error:', e.message);
    }
  }
}

// ============================================================================
// Routes
// ============================================================================

// Health check (no auth required)
app.get('/', (c) => {
  return c.json({
    name: c.env.APP_TITLE || 'L_EXE',
    version: '1.0.0',
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    requestId: c.get('requestId'),
  });
});

// ============================================================================
// Protected Routes (require authentication)
// IMPORTANT: Middleware must be registered BEFORE routes are mounted
// ============================================================================

app.use('/api/user/*', requireAuth);
app.use('/api/convos/*', requireAuth);
app.use('/api/messages/*', requireAuth);
app.use('/api/presets/*', requireAuth);
app.use('/api/files/*', requireAuth);
app.use('/api/agents/*', requireAuth);
app.use('/api/search/*', requireAuth);
app.use('/api/tags/*', requireAuth);
app.use('/api/prompts/*', requireAuth);
app.use('/api/balance/*', requireAuth);
app.use('/api/mcp/*', requireAuth);
// Additional protected routes (added for proper tenancy)
app.use('/api/chat/*', requireAuth);
app.use('/api/code/*', requireAuth);
app.use('/api/artifacts/*', requireAuth);
app.use('/api/memory/*', requireAuth);
app.use('/api/speech/*', requireAuth);
app.use('/api/images/*', requireAuth);
app.use('/api/data/*', requireAuth);
app.use('/api/convsearch/*', requireAuth);

// API routes (mounted AFTER auth middleware)
app.route('/api', api);

// ============================================================================
// Chat/Streaming Endpoint
// ============================================================================

app.post('/api/ask/:endpoint', requireAuth, async (c) => {
  const endpoint = c.req.param('endpoint');
  const body = await c.req.json();
  const user = (c as any).get('user') as AuthContext['user'];
  
  if (!user) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'User not authenticated' } }, 401);
  }
  
  try {
    const chatService = createChatService(c.env, user.id);
    
    const response = await chatService.sendMessage({
      conversationId: body.conversationId,
      parentMessageId: body.parentMessageId,
      endpoint,
      model: body.model || 'gpt-4o',
      text: body.text,
      systemPrompt: body.promptPrefix || body.systemPrompt,
      temperature: body.temperature,
      topP: body.topP,
      maxTokens: body.maxOutputTokens,
    });
    
    return c.json({
      success: true,
      ...response,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Chat error:', errorMessage);
    return c.json({
      success: false,
      error: {
        code: 'CHAT_ERROR',
        message: errorMessage,
      },
    }, 500);
  }
});

// SSE streaming endpoint
app.post('/api/ask/:endpoint/stream', requireAuth, async (c) => {
  const endpoint = c.req.param('endpoint');
  const body = await c.req.json();
  const user = (c as any).get('user') as AuthContext['user'];
  
  if (!user) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'User not authenticated' } }, 401);
  }
  
  try {
    const chatService = createChatService(c.env, user.id);
    
    // Get the abort signal from the request (for client disconnect detection)
    const signal = c.req.raw.signal;
    
    const stream = await chatService.sendMessageStream({
      conversationId: body.conversationId,
      parentMessageId: body.parentMessageId,
      endpoint,
      model: body.model || 'gpt-4o',
      text: body.text,
      systemPrompt: body.promptPrefix || body.systemPrompt,
      temperature: body.temperature,
      topP: body.topP,
      maxTokens: body.maxOutputTokens,
      signal, // Pass the abort signal to detect client disconnects
    });
    
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Request-ID': c.get('requestId'),
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('Stream error:', errorMessage);
    console.error('Stream error stack:', errorStack);
    console.error('User ID:', user.id);
    
    // Return error as SSE event
    const encoder = new TextEncoder();
    const errorStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: errorMessage })}\n\n`));
        controller.close();
      },
    });
    
    return new Response(errorStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Request-ID': c.get('requestId'),
      },
    });
  }
});

// Abort request endpoint
app.post('/api/ask/:endpoint/abort', requireAuth, async (c) => {
  const body = await c.req.json();
  const user = (c as any).get('user') as AuthContext['user'];
  
  if (!user) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'User not authenticated' } }, 401);
  }
  
  try {
    const chatService = createChatService(c.env, user.id);
    
    await chatService.abortMessage(body.conversationId, body.messageId);
    
    return c.json({
      success: true,
      messageId: body.messageId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      success: false,
      error: {
        code: 'ABORT_ERROR',
        message: errorMessage,
      },
    }, 500);
  }
});

// ============================================================================
// Static file serving (for avatars and images)
// ============================================================================

app.get('/images/:key', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.IMAGES_BUCKET.get(key);
  
  if (!object) {
    return c.notFound();
  }
  
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000');
  
  return new Response(object.body, { headers });
});

app.get('/files/:key', requireAuth, async (c) => {
  const key = c.req.param('key');
  const object = await c.env.FILES_BUCKET.get(key);
  
  if (!object) {
    return c.notFound();
  }
  
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  
  return new Response(object.body, { headers });
});

// ============================================================================
// Error Handling
// ============================================================================

// 404 handler
app.notFound((c) => {
  return c.json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found',
      requestId: c.get('requestId'),
    },
  }, 404);
});

// Global error handler
app.onError((err, c) => {
  const requestId = c.get('requestId');
  
  console.error('Error caught by error handler:', {
    requestId,
    error: err.message,
    stack: err.stack,
  });

  if (err instanceof RateLimitError) {
    c.header('Retry-After', String(err.retryAfter));
    return c.json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: err.message,
        requestId,
      },
    }, 429);
  }

  if (err instanceof AppError) {
    return c.json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
      },
    }, err.statusCode as 400 | 401 | 403 | 404 | 409 | 500 | 503);
  }

  // Generic error
  return c.json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId,
    },
  }, 500);
});

// ============================================================================
// Export
// ============================================================================

export default app;

// Export type for use in other modules
export type { Env, Variables } from './types';
