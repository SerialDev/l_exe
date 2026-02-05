/**
 * Admin Routes
 * Manage user subscriptions, allowlist, and system settings
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types';
import { requireAdmin } from '../middleware/subscription';
import { createSubscriptionService, type SubscriptionTier } from '../services/subscription';

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

// All admin routes require admin role
admin.use('/*', requireAdmin());

// =============================================================================
// Schemas
// =============================================================================

const updateTierSchema = z.object({
  userId: z.string(),
  tier: z.enum(['free', 'basic', 'pro', 'admin']),
  reason: z.string().optional(),
  expiresAt: z.string().optional(),
});

const addAllowlistSchema = z.object({
  identifier: z.string().min(1),
  identifierType: z.enum(['email', 'user_id']).default('email'),
  tier: z.enum(['free', 'basic', 'pro', 'admin']).default('pro'),
  allowedProviders: z.array(z.string()).optional(),
  reason: z.string().optional(),
});

const removeAllowlistSchema = z.object({
  identifier: z.string().min(1),
});

// =============================================================================
// User Management
// =============================================================================

/**
 * GET /admin/users
 * List all users with their subscription status
 */
admin.get('/users', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '50');
  const search = c.req.query('search');
  const tier = c.req.query('tier');
  const offset = (page - 1) * limit;

  let query = `
    SELECT 
      u.id, u.email, u.name, u.role, u.created_at as user_created_at,
      s.tier, s.tokens_used, s.requests_used, s.monthly_token_limit,
      s.monthly_request_limit, s.expires_at, s.manually_granted,
      s.created_at as subscription_created_at
    FROM users u
    LEFT JOIN user_subscriptions s ON u.id = s.user_id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (search) {
    query += ` AND (u.email LIKE ? OR u.name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  if (tier) {
    query += ` AND s.tier = ?`;
    params.push(tier);
  }

  query += ` ORDER BY u.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await c.env.DB
    .prepare(query)
    .bind(...params)
    .all<any>();

  // Get total count
  let countQuery = `
    SELECT COUNT(*) as count FROM users u
    LEFT JOIN user_subscriptions s ON u.id = s.user_id
    WHERE 1=1
  `;
  const countParams: any[] = [];

  if (search) {
    countQuery += ` AND (u.email LIKE ? OR u.name LIKE ?)`;
    countParams.push(`%${search}%`, `%${search}%`);
  }

  if (tier) {
    countQuery += ` AND s.tier = ?`;
    countParams.push(tier);
  }

  const countResult = await c.env.DB
    .prepare(countQuery)
    .bind(...countParams)
    .first<{ count: number }>();

  return c.json({
    success: true,
    users: results.map(r => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      createdAt: r.user_created_at,
      subscription: r.tier ? {
        tier: r.tier,
        tokensUsed: r.tokens_used,
        requestsUsed: r.requests_used,
        monthlyTokenLimit: r.monthly_token_limit,
        monthlyRequestLimit: r.monthly_request_limit,
        expiresAt: r.expires_at,
        manuallyGranted: !!r.manually_granted,
      } : null,
    })),
    pagination: {
      page,
      limit,
      total: countResult?.count || 0,
      totalPages: Math.ceil((countResult?.count || 0) / limit),
    },
  });
});

/**
 * GET /admin/users/:userId
 * Get detailed user info including usage stats
 */
admin.get('/users/:userId', async (c) => {
  const userId = c.req.param('userId');

  const user = await c.env.DB
    .prepare(`
      SELECT id, email, name, role, email_verified, created_at, updated_at
      FROM users WHERE id = ?
    `)
    .bind(userId)
    .first<any>();

  if (!user) {
    return c.json({ success: false, error: { message: 'User not found' } }, 404);
  }

  const subscriptionService = createSubscriptionService(c.env);
  const subscription = await subscriptionService.getSubscription(userId);
  const usageStats = await subscriptionService.getUsageStats(userId, 30);

  return c.json({
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified: !!user.email_verified,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    },
    subscription,
    usageStats,
  });
});

/**
 * POST /admin/users/tier
 * Update a user's subscription tier
 */
admin.post('/users/tier', zValidator('json', updateTierSchema), async (c) => {
  const { userId, tier, reason, expiresAt } = c.req.valid('json');
  const adminUser = c.get('user') as { id: string };

  const subscriptionService = createSubscriptionService(c.env);
  
  // Check if user exists
  const user = await c.env.DB
    .prepare('SELECT id FROM users WHERE id = ?')
    .bind(userId)
    .first();

  if (!user) {
    return c.json({ success: false, error: { message: 'User not found' } }, 404);
  }

  // Get or create subscription
  let subscription = await subscriptionService.getSubscription(userId);
  if (!subscription) {
    subscription = await subscriptionService.createSubscription(userId, tier, {
      grantedBy: adminUser.id,
      grantReason: reason,
      expiresAt,
    });
  } else {
    subscription = await subscriptionService.updateTier(userId, tier, {
      grantedBy: adminUser.id,
      grantReason: reason,
      expiresAt,
    });
  }

  return c.json({
    success: true,
    subscription,
    message: `User tier updated to '${tier}'`,
  });
});

// =============================================================================
// Allowlist Management
// =============================================================================

/**
 * GET /admin/allowlist
 * Get all allowlist entries
 */
admin.get('/allowlist', async (c) => {
  const subscriptionService = createSubscriptionService(c.env);
  const allowlist = await subscriptionService.getAllowlist();

  return c.json({
    success: true,
    allowlist,
  });
});

/**
 * POST /admin/allowlist
 * Add entry to allowlist
 */
admin.post('/allowlist', zValidator('json', addAllowlistSchema), async (c) => {
  const data = c.req.valid('json');
  const adminUser = c.get('user') as { id: string };

  const subscriptionService = createSubscriptionService(c.env);
  await subscriptionService.addToAllowlist(data.identifier, data.tier as SubscriptionTier, {
    identifierType: data.identifierType,
    allowedProviders: data.allowedProviders,
    addedBy: adminUser.id,
    reason: data.reason,
  });

  return c.json({
    success: true,
    message: `Added '${data.identifier}' to allowlist with tier '${data.tier}'`,
  });
});

/**
 * DELETE /admin/allowlist
 * Remove entry from allowlist
 */
admin.delete('/allowlist', zValidator('json', removeAllowlistSchema), async (c) => {
  const { identifier } = c.req.valid('json');

  const subscriptionService = createSubscriptionService(c.env);
  await subscriptionService.removeFromAllowlist(identifier);

  return c.json({
    success: true,
    message: `Removed '${identifier}' from allowlist`,
  });
});

// =============================================================================
// Usage & Stats
// =============================================================================

/**
 * GET /admin/stats
 * Get system-wide usage statistics
 */
admin.get('/stats', async (c) => {
  const days = parseInt(c.req.query('days') || '30');
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Total users
  const userCount = await c.env.DB
    .prepare('SELECT COUNT(*) as count FROM users')
    .first<{ count: number }>();

  // Users by tier
  const tierCounts = await c.env.DB
    .prepare(`
      SELECT tier, COUNT(*) as count 
      FROM user_subscriptions 
      GROUP BY tier
    `)
    .all<{ tier: string; count: number }>();

  // Total API usage
  const usageStats = await c.env.DB
    .prepare(`
      SELECT 
        provider,
        SUM(total_tokens) as total_tokens,
        COUNT(*) as total_requests,
        SUM(estimated_cost_microcents) as total_cost_microcents
      FROM api_access_logs
      WHERE created_at >= ? AND success = 1
      GROUP BY provider
    `)
    .bind(since.toISOString())
    .all<any>();

  // Daily usage
  const dailyUsage = await c.env.DB
    .prepare(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as requests,
        SUM(total_tokens) as tokens,
        COUNT(DISTINCT user_id) as active_users
      FROM api_access_logs
      WHERE created_at >= ? AND success = 1
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `)
    .bind(since.toISOString())
    .all<any>();

  return c.json({
    success: true,
    stats: {
      totalUsers: userCount?.count || 0,
      usersByTier: Object.fromEntries(
        tierCounts.results.map(r => [r.tier, r.count])
      ),
      usageByProvider: usageStats.results.map(r => ({
        provider: r.provider,
        totalTokens: r.total_tokens || 0,
        totalRequests: r.total_requests || 0,
        estimatedCostUsd: (r.total_cost_microcents || 0) / 1_000_000,
      })),
      dailyUsage: dailyUsage.results.map(r => ({
        date: r.date,
        requests: r.requests,
        tokens: r.tokens || 0,
        activeUsers: r.active_users,
      })),
    },
  });
});

/**
 * GET /admin/logs
 * Get API access logs
 */
admin.get('/logs', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '100');
  const userId = c.req.query('userId');
  const provider = c.req.query('provider');
  const offset = (page - 1) * limit;

  let query = `
    SELECT 
      l.*, u.email as user_email
    FROM api_access_logs l
    LEFT JOIN users u ON l.user_id = u.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (userId) {
    query += ` AND l.user_id = ?`;
    params.push(userId);
  }

  if (provider) {
    query += ` AND l.provider = ?`;
    params.push(provider);
  }

  query += ` ORDER BY l.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await c.env.DB
    .prepare(query)
    .bind(...params)
    .all<any>();

  return c.json({
    success: true,
    logs: results.map(r => ({
      id: r.id,
      userId: r.user_id,
      userEmail: r.user_email,
      endpoint: r.endpoint,
      provider: r.provider,
      model: r.model,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      totalTokens: r.total_tokens,
      estimatedCostUsd: r.estimated_cost_microcents ? r.estimated_cost_microcents / 1_000_000 : null,
      success: !!r.success,
      errorMessage: r.error_message,
      createdAt: r.created_at,
    })),
    pagination: {
      page,
      limit,
    },
  });
});

export { admin };
export default admin;
