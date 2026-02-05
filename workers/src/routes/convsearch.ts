/**
 * Conversation Search API Routes
 * Full-text search across conversations and messages
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createConversationSearchService } from '../services/conversationsearch';
import type { AppEnv } from '../types';

const app = new Hono<AppEnv>();

// =============================================================================
// Middleware
// =============================================================================

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
 * GET /convsearch
 * Search conversations and messages
 */
app.get('/', async (c) => {
  const userId = c.get('userId');
  const query = c.req.query('q');
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const searchIn = c.req.query('in')?.split(',') || ['both'];
  const dateFrom = c.req.query('from');
  const dateTo = c.req.query('to');
  const endpoint = c.req.query('endpoint');
  const model = c.req.query('model');

  if (!query) {
    throw new HTTPException(400, { message: 'Query parameter "q" is required' });
  }

  const searchService = createConversationSearchService(c.env.DB);

  const results = await searchService.search({
    query,
    userId,
    limit,
    offset,
    searchIn: searchIn as any,
    dateFrom,
    dateTo,
    endpoint,
    model,
  });

  return c.json(results);
});

/**
 * POST /convsearch
 * Search with POST body (for complex queries)
 */
app.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const { query, limit, offset, searchIn, dateFrom, dateTo, endpoint, model } = body;

  if (!query) {
    throw new HTTPException(400, { message: 'Query is required' });
  }

  const searchService = createConversationSearchService(c.env.DB);

  const results = await searchService.search({
    query,
    userId,
    limit: limit || 20,
    offset: offset || 0,
    searchIn: searchIn || ['both'],
    dateFrom,
    dateTo,
    endpoint,
    model,
  });

  return c.json(results);
});

/**
 * GET /convsearch/suggestions
 * Get search suggestions based on partial query
 */
app.get('/suggestions', async (c) => {
  const userId = c.get('userId');
  const query = c.req.query('q') || '';
  const limit = parseInt(c.req.query('limit') || '5', 10);

  const searchService = createConversationSearchService(c.env.DB);
  const suggestions = await searchService.getSuggestions(userId, query, limit);

  return c.json({ suggestions });
});

/**
 * GET /convsearch/popular
 * Get popular search terms
 */
app.get('/popular', async (c) => {
  const userId = c.get('userId');
  const limit = parseInt(c.req.query('limit') || '10', 10);

  const searchService = createConversationSearchService(c.env.DB);
  const terms = await searchService.getPopularTerms(userId, limit);

  return c.json({ terms });
});

export { app as convsearch };
export default app;
