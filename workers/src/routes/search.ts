/**
 * Web Search API Routes
 * Provides search functionality for AI agents and direct user searches.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { createWebSearchServiceFromEnv, type SearchOptions, type SearchProvider } from '../services/websearch';
import type { AppEnv } from '../types';

const app = new Hono<AppEnv>();

// =============================================================================
// Validation Schemas
// =============================================================================

const searchQuerySchema = z.object({
  query: z.string().min(1).max(500),
  numResults: z.number().int().min(1).max(50).optional(),
  page: z.number().int().min(1).optional(),
  country: z.string().length(2).optional(),
  language: z.string().min(2).max(5).optional(),
  safeSearch: z.boolean().optional(),
  timeRange: z.enum(['day', 'week', 'month', 'year']).optional(),
  includeImages: z.boolean().optional(),
  includeNews: z.boolean().optional(),
  provider: z.enum(['serper', 'searxng', 'brave', 'tavily']).optional(),
});

// =============================================================================
// Middleware
// =============================================================================

/**
 * Ensure search service is available
 */
app.use('*', async (c, next) => {
  const searchService = createWebSearchServiceFromEnv({
    SEARCH_PROVIDER: c.env.SEARCH_PROVIDER,
    SERPER_API_KEY: c.env.SERPER_API_KEY,
    SEARXNG_URL: c.env.SEARXNG_URL,
    BRAVE_SEARCH_API_KEY: c.env.BRAVE_SEARCH_API_KEY,
    TAVILY_API_KEY: c.env.TAVILY_API_KEY,
  });

  if (!searchService) {
    throw new HTTPException(503, {
      message: 'Web search is not configured. Please set up a search provider.',
    });
  }

  c.set('searchService', searchService);
  await next();
});

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /search
 * Perform a web search
 */
app.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = searchQuerySchema.safeParse(body);

  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`,
    });
  }

  const { query, provider: requestedProvider, ...options } = parsed.data;
  
  // If a specific provider is requested and configured, use it
  let searchService = c.get('searchService');
  
  if (requestedProvider) {
    const providerEnvMap: Record<SearchProvider, string | undefined> = {
      serper: c.env.SERPER_API_KEY,
      brave: c.env.BRAVE_SEARCH_API_KEY,
      tavily: c.env.TAVILY_API_KEY,
      searxng: c.env.SEARXNG_URL,
    };

    if (!providerEnvMap[requestedProvider]) {
      throw new HTTPException(400, {
        message: `Requested provider '${requestedProvider}' is not configured.`,
      });
    }

    // Create service with requested provider
    const { createWebSearchService } = await import('../services/websearch');
    searchService = createWebSearchService({
      provider: requestedProvider,
      apiKey: requestedProvider === 'searxng' ? undefined : providerEnvMap[requestedProvider],
      baseUrl: requestedProvider === 'searxng' ? providerEnvMap[requestedProvider] : undefined,
    });
  }

  if (!searchService) {
    throw new HTTPException(503, { message: 'Search service not available' });
  }

  try {
    const results = await searchService.search(query, options as SearchOptions);
    return c.json(results);
  } catch (error) {
    console.error('[Search] Error:', error);
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : 'Search failed',
    });
  }
});

/**
 * GET /search
 * Perform a web search (GET variant for simple queries)
 */
app.get('/', async (c) => {
  const query = c.req.query('q');
  
  if (!query) {
    throw new HTTPException(400, { message: 'Query parameter "q" is required' });
  }

  const searchService = c.get('searchService');
  if (!searchService) {
    throw new HTTPException(503, { message: 'Search service not available' });
  }
  const numResults = parseInt(c.req.query('num') || '10', 10);
  const timeRange = c.req.query('time') as SearchOptions['timeRange'];

  try {
    const results = await searchService.search(query, {
      numResults,
      timeRange,
    });
    return c.json(results);
  } catch (error) {
    console.error('[Search] Error:', error);
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : 'Search failed',
    });
  }
});

/**
 * POST /search/images
 * Search for images
 */
app.post('/images', async (c) => {
  const body = await c.req.json();
  const { query, numResults = 10 } = body;

  if (!query || typeof query !== 'string') {
    throw new HTTPException(400, { message: 'Query is required' });
  }

  const searchService = c.get('searchService');
  if (!searchService) {
    throw new HTTPException(503, { message: 'Search service not available' });
  }

  try {
    const images = await searchService.searchImages(query, { numResults });
    return c.json({ query, images });
  } catch (error) {
    console.error('[Search] Image search error:', error);
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : 'Image search failed',
    });
  }
});

/**
 * POST /search/news
 * Search for news articles
 */
app.post('/news', async (c) => {
  const body = await c.req.json();
  const { query, numResults = 10, timeRange } = body;

  if (!query || typeof query !== 'string') {
    throw new HTTPException(400, { message: 'Query is required' });
  }

  const searchService = c.get('searchService');
  if (!searchService) {
    throw new HTTPException(503, { message: 'Search service not available' });
  }

  try {
    const news = await searchService.searchNews(query, { numResults, timeRange });
    return c.json({ query, news });
  } catch (error) {
    console.error('[Search] News search error:', error);
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : 'News search failed',
    });
  }
});

/**
 * POST /search/answer
 * Get a direct answer to a question
 */
app.post('/answer', async (c) => {
  const body = await c.req.json();
  const { query } = body;

  if (!query || typeof query !== 'string') {
    throw new HTTPException(400, { message: 'Query is required' });
  }

  const searchService = c.get('searchService');
  if (!searchService) {
    throw new HTTPException(503, { message: 'Search service not available' });
  }

  try {
    const answer = await searchService.getAnswer(query);
    return c.json({
      query,
      answer,
      hasAnswer: answer !== null,
    });
  } catch (error) {
    console.error('[Search] Answer error:', error);
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : 'Failed to get answer',
    });
  }
});

/**
 * POST /search/context
 * Get search results formatted as AI context
 */
app.post('/context', async (c) => {
  const body = await c.req.json();
  const { query, numResults = 5 } = body;

  if (!query || typeof query !== 'string') {
    throw new HTTPException(400, { message: 'Query is required' });
  }

  const searchService = c.get('searchService');
  if (!searchService) {
    throw new HTTPException(503, { message: 'Search service not available' });
  }

  try {
    const results = await searchService.search(query, { numResults });
    const context = searchService.formatAsContext(results, numResults);
    return c.json({
      query,
      context,
      results,
    });
  } catch (error) {
    console.error('[Search] Context error:', error);
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : 'Failed to get context',
    });
  }
});

/**
 * GET /search/providers
 * List available search providers
 */
app.get('/providers', async (c) => {
  const providers: Array<{ id: SearchProvider; name: string; configured: boolean }> = [
    {
      id: 'serper',
      name: 'Serper (Google Search)',
      configured: !!c.env.SERPER_API_KEY,
    },
    {
      id: 'searxng',
      name: 'SearXNG (Self-hosted)',
      configured: !!c.env.SEARXNG_URL,
    },
    {
      id: 'brave',
      name: 'Brave Search',
      configured: !!c.env.BRAVE_SEARCH_API_KEY,
    },
    {
      id: 'tavily',
      name: 'Tavily (AI Search)',
      configured: !!c.env.TAVILY_API_KEY,
    },
  ];

  const defaultProvider = c.env.SEARCH_PROVIDER || 'serper';

  return c.json({
    providers,
    default: defaultProvider,
  });
});

export { app as search };
export default app;
