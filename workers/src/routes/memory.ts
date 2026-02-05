/**
 * Memory API Routes
 * Manage persistent user memories across conversations.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
  createMemoryService,
  getMemorySystemPrompt,
  type MemoryType,
} from '../services/memory';
import type { AppEnv } from '../types';

const app = new Hono<AppEnv>();

// =============================================================================
// Validation Schemas
// =============================================================================

const createMemorySchema = z.object({
  type: z.enum(['fact', 'preference', 'project', 'instruction', 'custom']),
  key: z.string().min(1).max(100),
  value: z.string().min(1).max(10000),
  metadata: z.record(z.unknown()).optional(),
  importance: z.number().min(0).max(1).optional(),
  expiresAt: z.string().datetime().optional(),
});

const updateMemorySchema = z.object({
  value: z.string().min(1).max(10000).optional(),
  metadata: z.record(z.unknown()).optional(),
  importance: z.number().min(0).max(1).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
});

const extractMemoriesSchema = z.object({
  text: z.string().min(1).max(50000),
  conversationId: z.string().uuid().optional(),
});

// =============================================================================
// Middleware
// =============================================================================

/**
 * Require authentication
 */
app.use('*', async (c, next) => {
  const userId = c.get('userId');
  if (!userId) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }
  await next();
});

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /memory
 * Create a new memory
 */
app.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const parsed = createMemorySchema.safeParse(body);

  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`,
    });
  }

  const service = createMemoryService(c.env.DB);
  const { type, key, value, metadata, importance, expiresAt } = parsed.data;
  const memory = await service.create(userId!, {
    type,
    key,
    value,
    metadata,
    importance,
    expiresAt,
    source: 'user',
  });

  return c.json(memory, 201);
});

/**
 * GET /memory
 * List all memories (optionally filtered by type)
 */
app.get('/', async (c) => {
  const userId = c.get('userId');
  const type = c.req.query('type') as MemoryType | undefined;

  const service = createMemoryService(c.env.DB);
  const memories = await service.listByUser(userId, type);

  // Group by type for convenience
  const grouped = {
    facts: memories.filter(m => m.type === 'fact'),
    preferences: memories.filter(m => m.type === 'preference'),
    projects: memories.filter(m => m.type === 'project'),
    instructions: memories.filter(m => m.type === 'instruction'),
    custom: memories.filter(m => m.type === 'custom'),
  };

  return c.json({
    memories,
    grouped,
    count: memories.length,
  });
});

/**
 * GET /memory/context
 * Get memory context formatted for AI
 */
app.get('/context', async (c) => {
  const userId = c.get('userId');
  const maxTokens = parseInt(c.req.query('maxTokens') || '1000', 10);

  const service = createMemoryService(c.env.DB);
  const context = await service.getContext(userId, maxTokens);
  const systemPrompt = getMemorySystemPrompt(context);

  return c.json({
    ...context,
    systemPrompt,
  });
});

/**
 * GET /memory/search
 * Search memories
 */
app.get('/search', async (c) => {
  const userId = c.get('userId');
  const query = c.req.query('q');
  const limit = parseInt(c.req.query('limit') || '10', 10);

  if (!query) {
    throw new HTTPException(400, { message: 'Query parameter "q" is required' });
  }

  const service = createMemoryService(c.env.DB);
  const results = await service.search(userId, query, limit);

  return c.json({
    query,
    results,
    count: results.length,
  });
});

/**
 * GET /memory/:id
 * Get a specific memory
 */
app.get('/:id', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();

  const service = createMemoryService(c.env.DB);
  const memory = await service.getById(id, userId);

  if (!memory) {
    throw new HTTPException(404, { message: 'Memory not found' });
  }

  return c.json(memory);
});

/**
 * PUT /memory/:id
 * Update a memory
 */
app.put('/:id', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const body = await c.req.json();
  const parsed = updateMemorySchema.safeParse(body);

  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`,
    });
  }

  const service = createMemoryService(c.env.DB);
  const memory = await service.update(id, userId, parsed.data);

  if (!memory) {
    throw new HTTPException(404, { message: 'Memory not found' });
  }

  return c.json(memory);
});

/**
 * DELETE /memory/:id
 * Delete a specific memory
 */
app.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();

  const service = createMemoryService(c.env.DB);
  const deleted = await service.delete(id, userId);

  if (!deleted) {
    throw new HTTPException(404, { message: 'Memory not found' });
  }

  return c.json({ success: true });
});

/**
 * DELETE /memory
 * Delete memories (by type or all)
 */
app.delete('/', async (c) => {
  const userId = c.get('userId');
  const type = c.req.query('type') as MemoryType | undefined;
  const confirm = c.req.query('confirm');

  if (!confirm || confirm !== 'true') {
    throw new HTTPException(400, {
      message: 'Add ?confirm=true to confirm deletion',
    });
  }

  const service = createMemoryService(c.env.DB);
  
  let deleted: number;
  if (type) {
    deleted = await service.deleteByType(userId, type);
  } else {
    deleted = await service.clearAll(userId);
  }

  return c.json({
    success: true,
    deleted,
    type: type || 'all',
  });
});

/**
 * POST /memory/extract
 * Extract memories from text
 */
app.post('/extract', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const parsed = extractMemoriesSchema.safeParse(body);

  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`,
    });
  }

  const service = createMemoryService(c.env.DB);
  const extracted = await service.extractFromText(
    userId,
    parsed.data.text,
    parsed.data.conversationId
  );

  return c.json({
    extracted,
    count: extracted.length,
  });
});

/**
 * POST /memory/cleanup
 * Clean up expired memories
 */
app.post('/cleanup', async (c) => {
  // This could be restricted to admins or run as a scheduled task
  const service = createMemoryService(c.env.DB);
  const deleted = await service.cleanupExpired();

  return c.json({
    success: true,
    deleted,
  });
});

/**
 * GET /memory/types
 * List memory types and their descriptions
 */
app.get('/types', async (c) => {
  const types = [
    {
      id: 'fact',
      name: 'User Facts',
      description: 'Personal information like name, location, job',
      examples: ['Name: John', 'Location: San Francisco', 'Job: Software Engineer'],
    },
    {
      id: 'preference',
      name: 'Preferences',
      description: 'User preferences for communication and behavior',
      examples: ['Prefers concise answers', 'Likes code examples', 'Uses TypeScript'],
    },
    {
      id: 'project',
      name: 'Projects',
      description: 'Information about ongoing work or projects',
      examples: ['Working on: E-commerce platform', 'Tech stack: React + Node.js'],
    },
    {
      id: 'instruction',
      name: 'Instructions',
      description: 'Standing instructions to remember',
      examples: ['Always use metric units', 'Include error handling in code'],
    },
    {
      id: 'custom',
      name: 'Custom',
      description: 'User-defined memories',
      examples: ['API key pattern', 'Project deadlines'],
    },
  ];

  return c.json({ types });
});

export { app as memory };
export default app;
