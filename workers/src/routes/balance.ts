/**
 * Balance routes
 * Token usage tracking and credit management
 * GET /, GET /transactions, POST /transactions
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

// Types for Cloudflare bindings
interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  JWT_SECRET: string;
  // Token pricing config (optional)
  CHECK_BALANCE?: string;
  DEFAULT_TOKEN_CREDITS?: string;
}

// Context variables (set by auth middleware)
interface Variables {
  userId: string;
}

// Database row types
interface BalanceRow {
  id: string;
  user_id: string;
  token_credits: number;
  auto_refill_enabled: number;
  refill_interval_value: number | null;
  refill_interval_unit: string | null;
  last_refill: string | null;
  refill_amount: number | null;
  created_at: string;
  updated_at: string;
}

interface TransactionRow {
  id: string;
  user_id: string;
  token_type: string;
  model: string | null;
  endpoint: string | null;
  tokens: number;
  token_value: number | null;
  rate: number | null;
  context: string | null;
  created_at: string;
}

// Token pricing per 1K tokens (approximations)
const TOKEN_RATES: Record<string, { prompt: number; completion: number }> = {
  // OpenAI
  'gpt-4': { prompt: 0.03, completion: 0.06 },
  'gpt-4-turbo': { prompt: 0.01, completion: 0.03 },
  'gpt-4o': { prompt: 0.005, completion: 0.015 },
  'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
  'gpt-3.5-turbo': { prompt: 0.0005, completion: 0.0015 },
  // Anthropic
  'claude-3-opus': { prompt: 0.015, completion: 0.075 },
  'claude-3-sonnet': { prompt: 0.003, completion: 0.015 },
  'claude-3-haiku': { prompt: 0.00025, completion: 0.00125 },
  'claude-3.5-sonnet': { prompt: 0.003, completion: 0.015 },
  // Google
  'gemini-pro': { prompt: 0.00025, completion: 0.0005 },
  'gemini-1.5-pro': { prompt: 0.00125, completion: 0.005 },
  'gemini-1.5-flash': { prompt: 0.000075, completion: 0.0003 },
  // Default
  'default': { prompt: 0.001, completion: 0.002 },
};

// Request schemas
const transactionsQuerySchema = z.object({
  page: z.coerce.number().positive().default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  model: z.string().optional(),
  endpoint: z.string().optional(),
  tokenType: z.enum(['prompt', 'completion', 'total']).optional(),
});

const createTransactionSchema = z.object({
  tokenType: z.enum(['prompt', 'completion', 'total']),
  model: z.string(),
  endpoint: z.string(),
  tokens: z.number().positive(),
  context: z.string().optional(),
});

const updateBalanceSchema = z.object({
  tokenCredits: z.number().optional(),
  autoRefillEnabled: z.boolean().optional(),
  refillIntervalValue: z.number().positive().optional(),
  refillIntervalUnit: z.enum(['hour', 'day', 'week', 'month']).optional(),
  refillAmount: z.number().positive().optional(),
});

// Helper to generate UUID
function generateUUID(): string {
  return crypto.randomUUID();
}

// Helper to get token rate
function getTokenRate(model: string, tokenType: 'prompt' | 'completion'): number {
  // Try exact match first
  if (TOKEN_RATES[model]) {
    return TOKEN_RATES[model][tokenType];
  }
  // Try partial match
  for (const [key, rates] of Object.entries(TOKEN_RATES)) {
    if (model.includes(key) || key.includes(model)) {
      return rates[tokenType];
    }
  }
  return TOKEN_RATES['default'][tokenType];
}

// Helper to calculate token value
function calculateTokenValue(tokens: number, model: string, tokenType: 'prompt' | 'completion' | 'total'): number {
  if (tokenType === 'total') {
    // Assume 50/50 split for total
    const promptRate = getTokenRate(model, 'prompt');
    const completionRate = getTokenRate(model, 'completion');
    return (tokens / 2000) * (promptRate + completionRate);
  }
  const rate = getTokenRate(model, tokenType);
  return (tokens / 1000) * rate;
}

// Create router
const balance = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /
 * Get user's current balance
 */
balance.get('/', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const checkBalance = c.env.CHECK_BALANCE !== 'false';

  try {
    // Get or create balance record
    let balanceRecord = await c.env.DB
      .prepare('SELECT * FROM balances WHERE user_id = ?')
      .bind(userId)
      .first<BalanceRow>();

    if (!balanceRecord) {
      // Create default balance
      const id = generateUUID();
      const now = new Date().toISOString();
      const defaultCredits = parseFloat(c.env.DEFAULT_TOKEN_CREDITS || '1000000');

      await c.env.DB
        .prepare(`
          INSERT INTO balances (id, user_id, token_credits, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        .bind(id, userId, defaultCredits, now, now)
        .run();

      balanceRecord = {
        id,
        user_id: userId,
        token_credits: defaultCredits,
        auto_refill_enabled: 0,
        refill_interval_value: null,
        refill_interval_unit: null,
        last_refill: null,
        refill_amount: null,
        created_at: now,
        updated_at: now,
      };
    }

    // Check if auto-refill is due
    if (balanceRecord.auto_refill_enabled === 1 && balanceRecord.refill_interval_value && balanceRecord.refill_amount) {
      const shouldRefill = checkAutoRefill(balanceRecord);
      if (shouldRefill) {
        const now = new Date().toISOString();
        const newCredits = balanceRecord.token_credits + balanceRecord.refill_amount;
        
        await c.env.DB
          .prepare('UPDATE balances SET token_credits = ?, last_refill = ?, updated_at = ? WHERE id = ? AND user_id = ?')
          .bind(newCredits, now, now, balanceRecord.id, userId)
          .run();

        balanceRecord.token_credits = newCredits;
        balanceRecord.last_refill = now;
      }
    }

    // Get usage stats (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const stats = await c.env.DB
      .prepare(`
        SELECT 
          SUM(tokens) as total_tokens,
          SUM(token_value) as total_value,
          COUNT(*) as transaction_count
        FROM transactions
        WHERE user_id = ? AND created_at >= ?
      `)
      .bind(userId, thirtyDaysAgo)
      .first<{ total_tokens: number; total_value: number; transaction_count: number }>();

    return c.json({
      success: true,
      data: {
        balance: balanceRecord.token_credits,
        checkBalance, // Whether balance checking is enabled
        autoRefill: {
          enabled: balanceRecord.auto_refill_enabled === 1,
          intervalValue: balanceRecord.refill_interval_value,
          intervalUnit: balanceRecord.refill_interval_unit,
          amount: balanceRecord.refill_amount,
          lastRefill: balanceRecord.last_refill,
        },
        usage: {
          period: '30 days',
          totalTokens: stats?.total_tokens || 0,
          totalValue: stats?.total_value || 0,
          transactionCount: stats?.transaction_count || 0,
        },
        updatedAt: balanceRecord.updated_at,
      },
    });
  } catch (error) {
    console.error('Get balance error:', error);
    return c.json({ success: false, error: 'Failed to get balance' }, 500);
  }
});

/**
 * GET /transactions
 * List user's token transactions
 */
balance.get('/transactions', zValidator('query', transactionsQuerySchema), async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { page, pageSize, startDate, endDate, model, endpoint, tokenType } = c.req.valid('query');
  const offset = (page - 1) * pageSize;

  try {
    let query = 'SELECT * FROM transactions WHERE user_id = ?';
    const params: (string | number)[] = [userId];

    if (startDate) {
      query += ' AND created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND created_at <= ?';
      params.push(endDate);
    }
    if (model) {
      query += ' AND model = ?';
      params.push(model);
    }
    if (endpoint) {
      query += ' AND endpoint = ?';
      params.push(endpoint);
    }
    if (tokenType) {
      query += ' AND token_type = ?';
      params.push(tokenType);
    }

    // Count total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const countResult = await c.env.DB
      .prepare(countQuery)
      .bind(...params)
      .first<{ total: number }>();
    const total = countResult?.total || 0;

    // Add pagination
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(pageSize, offset);

    const results = await c.env.DB
      .prepare(query)
      .bind(...params)
      .all<TransactionRow>();

    return c.json({
      success: true,
      data: {
        transactions: (results.results || []).map(t => ({
          id: t.id,
          tokenType: t.token_type,
          model: t.model,
          endpoint: t.endpoint,
          tokens: t.tokens,
          tokenValue: t.token_value,
          rate: t.rate,
          context: t.context,
          createdAt: t.created_at,
        })),
        total,
        page,
        pageSize,
        hasMore: offset + pageSize < total,
      },
    });
  } catch (error) {
    console.error('List transactions error:', error);
    return c.json({ success: false, error: 'Failed to list transactions' }, 500);
  }
});

/**
 * POST /transactions
 * Record a token usage transaction (typically called by chat service)
 */
balance.post('/transactions', zValidator('json', createTransactionSchema), async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { tokenType, model, endpoint, tokens, context } = c.req.valid('json');
  const checkBalance = c.env.CHECK_BALANCE !== 'false';

  try {
    // Calculate token value
    const rate = getTokenRate(model, tokenType === 'total' ? 'prompt' : tokenType);
    const tokenValue = calculateTokenValue(tokens, model, tokenType);

    // Get current balance
    let balanceRecord = await c.env.DB
      .prepare('SELECT * FROM balances WHERE user_id = ?')
      .bind(userId)
      .first<BalanceRow>();

    if (!balanceRecord) {
      // Create default balance
      const id = generateUUID();
      const now = new Date().toISOString();
      const defaultCredits = parseFloat(c.env.DEFAULT_TOKEN_CREDITS || '1000000');

      await c.env.DB
        .prepare(`
          INSERT INTO balances (id, user_id, token_credits, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        .bind(id, userId, defaultCredits, now, now)
        .run();

      balanceRecord = {
        id,
        user_id: userId,
        token_credits: defaultCredits,
        auto_refill_enabled: 0,
        refill_interval_value: null,
        refill_interval_unit: null,
        last_refill: null,
        refill_amount: null,
        created_at: now,
        updated_at: now,
      };
    }

    // Check if user has enough balance (if checking is enabled)
    if (checkBalance && balanceRecord.token_credits < tokens) {
      return c.json({
        success: false,
        error: 'Insufficient token credits',
        data: {
          required: tokens,
          available: balanceRecord.token_credits,
        },
      }, 402);
    }

    // Create transaction
    const transactionId = generateUUID();
    const now = new Date().toISOString();

    await c.env.DB
      .prepare(`
        INSERT INTO transactions (id, user_id, token_type, model, endpoint, tokens, token_value, rate, context, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(transactionId, userId, tokenType, model, endpoint, tokens, tokenValue, rate, context || null, now)
      .run();

    // Deduct from balance
    const newBalance = balanceRecord.token_credits - tokens;
    await c.env.DB
      .prepare('UPDATE balances SET token_credits = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(newBalance, now, balanceRecord.id, userId)
      .run();

    return c.json({
      success: true,
      data: {
        transactionId,
        tokens,
        tokenValue,
        rate,
        previousBalance: balanceRecord.token_credits,
        newBalance,
        createdAt: now,
      },
    }, 201);
  } catch (error) {
    console.error('Create transaction error:', error);
    return c.json({ success: false, error: 'Failed to record transaction' }, 500);
  }
});

/**
 * PUT /
 * Update balance settings (admin or self)
 */
balance.put('/', zValidator('json', updateBalanceSchema), async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const updates = c.req.valid('json');

  try {
    // Get current balance
    let balanceRecord = await c.env.DB
      .prepare('SELECT * FROM balances WHERE user_id = ?')
      .bind(userId)
      .first<BalanceRow>();

    if (!balanceRecord) {
      // Create default balance first
      const id = generateUUID();
      const now = new Date().toISOString();
      const defaultCredits = parseFloat(c.env.DEFAULT_TOKEN_CREDITS || '1000000');

      await c.env.DB
        .prepare(`
          INSERT INTO balances (id, user_id, token_credits, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        .bind(id, userId, defaultCredits, now, now)
        .run();

      balanceRecord = await c.env.DB
        .prepare('SELECT * FROM balances WHERE user_id = ?')
        .bind(userId)
        .first<BalanceRow>();
    }

    // Build update
    const setClauses: string[] = ['updated_at = ?'];
    const values: (string | number | null)[] = [new Date().toISOString()];

    if (updates.tokenCredits !== undefined) {
      setClauses.push('token_credits = ?');
      values.push(updates.tokenCredits);
    }
    if (updates.autoRefillEnabled !== undefined) {
      setClauses.push('auto_refill_enabled = ?');
      values.push(updates.autoRefillEnabled ? 1 : 0);
    }
    if (updates.refillIntervalValue !== undefined) {
      setClauses.push('refill_interval_value = ?');
      values.push(updates.refillIntervalValue);
    }
    if (updates.refillIntervalUnit !== undefined) {
      setClauses.push('refill_interval_unit = ?');
      values.push(updates.refillIntervalUnit);
    }
    if (updates.refillAmount !== undefined) {
      setClauses.push('refill_amount = ?');
      values.push(updates.refillAmount);
    }

    values.push(balanceRecord!.id);
    values.push(userId);

    await c.env.DB
      .prepare(`UPDATE balances SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`)
      .bind(...values)
      .run();

    // Fetch updated (with tenant isolation)
    const updated = await c.env.DB
      .prepare('SELECT * FROM balances WHERE id = ? AND user_id = ?')
      .bind(balanceRecord!.id, userId)
      .first<BalanceRow>();

    return c.json({
      success: true,
      data: {
        balance: updated!.token_credits,
        autoRefill: {
          enabled: updated!.auto_refill_enabled === 1,
          intervalValue: updated!.refill_interval_value,
          intervalUnit: updated!.refill_interval_unit,
          amount: updated!.refill_amount,
          lastRefill: updated!.last_refill,
        },
        updatedAt: updated!.updated_at,
      },
    });
  } catch (error) {
    console.error('Update balance error:', error);
    return c.json({ success: false, error: 'Failed to update balance' }, 500);
  }
});

/**
 * GET /stats
 * Get detailed usage statistics
 */
balance.get('/stats', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const period = c.req.query('period') || '30d';
  
  // Parse period
  let startDate: Date;
  const now = new Date();
  switch (period) {
    case '7d':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case '90d':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  try {
    // Total stats
    const totalStats = await c.env.DB
      .prepare(`
        SELECT 
          SUM(tokens) as total_tokens,
          SUM(token_value) as total_value,
          COUNT(*) as total_transactions,
          AVG(tokens) as avg_tokens_per_request
        FROM transactions
        WHERE user_id = ? AND created_at >= ?
      `)
      .bind(userId, startDate.toISOString())
      .first<{
        total_tokens: number;
        total_value: number;
        total_transactions: number;
        avg_tokens_per_request: number;
      }>();

    // By model
    const byModel = await c.env.DB
      .prepare(`
        SELECT 
          model,
          SUM(tokens) as tokens,
          SUM(token_value) as value,
          COUNT(*) as requests
        FROM transactions
        WHERE user_id = ? AND created_at >= ?
        GROUP BY model
        ORDER BY tokens DESC
      `)
      .bind(userId, startDate.toISOString())
      .all<{ model: string; tokens: number; value: number; requests: number }>();

    // By endpoint
    const byEndpoint = await c.env.DB
      .prepare(`
        SELECT 
          endpoint,
          SUM(tokens) as tokens,
          SUM(token_value) as value,
          COUNT(*) as requests
        FROM transactions
        WHERE user_id = ? AND created_at >= ?
        GROUP BY endpoint
        ORDER BY tokens DESC
      `)
      .bind(userId, startDate.toISOString())
      .all<{ endpoint: string; tokens: number; value: number; requests: number }>();

    // Daily breakdown (last 7 days)
    const dailyStats = await c.env.DB
      .prepare(`
        SELECT 
          DATE(created_at) as date,
          SUM(tokens) as tokens,
          SUM(token_value) as value,
          COUNT(*) as requests
        FROM transactions
        WHERE user_id = ? AND created_at >= ?
        GROUP BY DATE(created_at)
        ORDER BY date DESC
        LIMIT 7
      `)
      .bind(userId, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .all<{ date: string; tokens: number; value: number; requests: number }>();

    return c.json({
      success: true,
      data: {
        period,
        startDate: startDate.toISOString(),
        endDate: now.toISOString(),
        totals: {
          tokens: totalStats?.total_tokens || 0,
          value: totalStats?.total_value || 0,
          transactions: totalStats?.total_transactions || 0,
          avgTokensPerRequest: totalStats?.avg_tokens_per_request || 0,
        },
        byModel: byModel.results || [],
        byEndpoint: byEndpoint.results || [],
        daily: dailyStats.results || [],
      },
    });
  } catch (error) {
    console.error('Get stats error:', error);
    return c.json({ success: false, error: 'Failed to get stats' }, 500);
  }
});

// Helper to check if auto-refill is due
function checkAutoRefill(balance: BalanceRow): boolean {
  if (!balance.last_refill || !balance.refill_interval_value || !balance.refill_interval_unit) {
    return true; // First refill
  }

  const lastRefill = new Date(balance.last_refill);
  const now = new Date();
  let intervalMs: number;

  switch (balance.refill_interval_unit) {
    case 'hour':
      intervalMs = balance.refill_interval_value * 60 * 60 * 1000;
      break;
    case 'day':
      intervalMs = balance.refill_interval_value * 24 * 60 * 60 * 1000;
      break;
    case 'week':
      intervalMs = balance.refill_interval_value * 7 * 24 * 60 * 60 * 1000;
      break;
    case 'month':
      intervalMs = balance.refill_interval_value * 30 * 24 * 60 * 60 * 1000;
      break;
    default:
      intervalMs = 24 * 60 * 60 * 1000; // Default to 1 day
  }

  return now.getTime() - lastRefill.getTime() >= intervalMs;
}

export { balance };
export default balance;
