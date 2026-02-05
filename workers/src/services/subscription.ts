/**
 * Subscription Service
 * Manages user access to AI providers and usage tracking
 */

import { nanoid } from 'nanoid';
import type { Env } from '../types';

// =============================================================================
// Types
// =============================================================================

export type SubscriptionTier = 'free' | 'basic' | 'pro' | 'admin';

export interface UserSubscription {
  id: string;
  userId: string;
  tier: SubscriptionTier;
  allowedProviders: string[] | null;
  monthlyTokenLimit: number | null;
  monthlyRequestLimit: number | null;
  tokensUsed: number;
  requestsUsed: number;
  usageResetAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeStatus: string | null;
  manuallyGranted: boolean;
  grantedBy: string | null;
  grantedAt: string | null;
  grantReason: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccessCheckResult {
  allowed: boolean;
  reason?: string;
  tier: SubscriptionTier;
  remainingTokens?: number;
  remainingRequests?: number;
}

export interface UsageLogEntry {
  userId: string;
  endpoint: string;
  provider?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostMicrocents?: number;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  errorMessage?: string;
}

// =============================================================================
// Tier Configuration
// =============================================================================

export const TIER_CONFIG: Record<SubscriptionTier, {
  providers: string[];
  monthlyTokenLimit: number | null;
  monthlyRequestLimit: number | null;
  models: Record<string, string[]>;
}> = {
  free: {
    providers: [],
    monthlyTokenLimit: 0,
    monthlyRequestLimit: 0,
    models: {},
  },
  basic: {
    providers: ['openai'],
    monthlyTokenLimit: 100_000,
    monthlyRequestLimit: 100,
    models: {
      openai: ['gpt-4o-mini', 'gpt-3.5-turbo'],
    },
  },
  pro: {
    providers: ['openai', 'anthropic', 'google', 'groq', 'mistral', 'openrouter'],
    monthlyTokenLimit: 1_000_000,
    monthlyRequestLimit: 1000,
    models: {
      openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'],
      anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
      google: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash-exp'],
      groq: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
      mistral: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'],
      openrouter: ['*'], // All models
    },
  },
  admin: {
    providers: ['openai', 'anthropic', 'google', 'azure', 'ollama', 'groq', 'mistral', 'openrouter'],
    monthlyTokenLimit: null, // Unlimited
    monthlyRequestLimit: null, // Unlimited
    models: {
      '*': ['*'], // All providers, all models
    },
  },
};

// =============================================================================
// Service Class
// =============================================================================

export class SubscriptionService {
  constructor(
    private db: D1Database,
    private env: Env
  ) {}

  /**
   * Get or create a user's subscription
   */
  async getSubscription(userId: string): Promise<UserSubscription | null> {
    const row = await this.db
      .prepare(`
        SELECT * FROM user_subscriptions WHERE user_id = ?
      `)
      .bind(userId)
      .first<any>();

    if (!row) {
      return null;
    }

    return this.mapRow(row);
  }

  /**
   * Create a subscription for a new user
   */
  async createSubscription(
    userId: string,
    tier: SubscriptionTier = 'free',
    options?: {
      allowedProviders?: string[];
      grantedBy?: string;
      grantReason?: string;
      expiresAt?: string;
    }
  ): Promise<UserSubscription> {
    const id = nanoid();
    const now = new Date().toISOString();

    await this.db
      .prepare(`
        INSERT INTO user_subscriptions (
          id, user_id, tier, allowed_providers,
          manually_granted, granted_by, granted_at, grant_reason,
          expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        userId,
        tier,
        options?.allowedProviders ? JSON.stringify(options.allowedProviders) : null,
        options?.grantedBy ? 1 : 0,
        options?.grantedBy || null,
        options?.grantedBy ? now : null,
        options?.grantReason || null,
        options?.expiresAt || null,
        now,
        now
      )
      .run();

    return (await this.getSubscription(userId))!;
  }

  /**
   * Update a user's subscription tier
   */
  async updateTier(
    userId: string,
    tier: SubscriptionTier,
    options?: {
      grantedBy?: string;
      grantReason?: string;
      expiresAt?: string;
    }
  ): Promise<UserSubscription | null> {
    const now = new Date().toISOString();

    await this.db
      .prepare(`
        UPDATE user_subscriptions
        SET tier = ?,
            manually_granted = ?,
            granted_by = COALESCE(?, granted_by),
            granted_at = COALESCE(?, granted_at),
            grant_reason = COALESCE(?, grant_reason),
            expires_at = ?,
            updated_at = ?
        WHERE user_id = ?
      `)
      .bind(
        tier,
        options?.grantedBy ? 1 : 0,
        options?.grantedBy || null,
        options?.grantedBy ? now : null,
        options?.grantReason || null,
        options?.expiresAt || null,
        now,
        userId
      )
      .run();

    return this.getSubscription(userId);
  }

  /**
   * Check if a user can access a specific provider/model
   */
  async checkAccess(
    userId: string,
    provider: string,
    model?: string
  ): Promise<AccessCheckResult> {
    // Get subscription
    let subscription = await this.getSubscription(userId);

    // If no subscription, check allowlist and create one
    if (!subscription) {
      const allowlistTier = await this.checkAllowlist(userId);
      subscription = await this.createSubscription(userId, allowlistTier || 'free');
    }

    // Check if subscription expired
    if (subscription.expiresAt && new Date(subscription.expiresAt) < new Date()) {
      return {
        allowed: false,
        reason: 'Subscription has expired',
        tier: subscription.tier,
      };
    }

    const tier = subscription.tier;
    const config = TIER_CONFIG[tier];

    // Check provider access
    const allowedProviders = subscription.allowedProviders || config.providers;
    if (!allowedProviders.includes(provider) && !allowedProviders.includes('*')) {
      return {
        allowed: false,
        reason: `Provider '${provider}' not available on ${tier} tier`,
        tier,
      };
    }

    // Check model access (if specified)
    if (model && tier !== 'admin') {
      const tierModels = config.models[provider] || [];
      if (!tierModels.includes('*') && !tierModels.includes(model)) {
        return {
          allowed: false,
          reason: `Model '${model}' not available on ${tier} tier`,
          tier,
        };
      }
    }

    // Check usage limits
    const tokenLimit = subscription.monthlyTokenLimit ?? config.monthlyTokenLimit;
    const requestLimit = subscription.monthlyRequestLimit ?? config.monthlyRequestLimit;

    // Reset usage if needed
    await this.maybeResetUsage(userId, subscription);

    if (tokenLimit !== null && subscription.tokensUsed >= tokenLimit) {
      return {
        allowed: false,
        reason: 'Monthly token limit reached',
        tier,
        remainingTokens: 0,
        remainingRequests: requestLimit ? requestLimit - subscription.requestsUsed : undefined,
      };
    }

    if (requestLimit !== null && subscription.requestsUsed >= requestLimit) {
      return {
        allowed: false,
        reason: 'Monthly request limit reached',
        tier,
        remainingTokens: tokenLimit ? tokenLimit - subscription.tokensUsed : undefined,
        remainingRequests: 0,
      };
    }

    return {
      allowed: true,
      tier,
      remainingTokens: tokenLimit ? tokenLimit - subscription.tokensUsed : undefined,
      remainingRequests: requestLimit ? requestLimit - subscription.requestsUsed : undefined,
    };
  }

  /**
   * Check allowlist for user's email
   */
  private async checkAllowlist(userId: string): Promise<SubscriptionTier | null> {
    // First check by user_id
    let row = await this.db
      .prepare(`
        SELECT tier FROM access_allowlist 
        WHERE identifier = ? AND identifier_type = 'user_id'
      `)
      .bind(userId)
      .first<{ tier: string }>();

    if (row) {
      return row.tier as SubscriptionTier;
    }

    // Get user's email and check by email
    const user = await this.db
      .prepare(`SELECT email FROM users WHERE id = ?`)
      .bind(userId)
      .first<{ email: string }>();

    if (user?.email) {
      row = await this.db
        .prepare(`
          SELECT tier FROM access_allowlist 
          WHERE identifier = ? AND identifier_type = 'email'
        `)
        .bind(user.email)
        .first<{ tier: string }>();

      if (row) {
        return row.tier as SubscriptionTier;
      }
    }

    // Check env var for admin emails
    const adminEmails = this.env.ADMIN_EMAILS?.split(',').map(e => e.trim().toLowerCase()) || [];
    if (user?.email && adminEmails.includes(user.email.toLowerCase())) {
      return 'admin';
    }

    // Check env var for allowed emails (pro tier)
    const allowedEmails = this.env.ALLOWED_EMAILS?.split(',').map(e => e.trim().toLowerCase()) || [];
    if (user?.email && allowedEmails.includes(user.email.toLowerCase())) {
      return 'pro';
    }

    return null;
  }

  /**
   * Reset usage if month has changed
   */
  private async maybeResetUsage(userId: string, subscription: UserSubscription): Promise<void> {
    const now = new Date();
    const resetAt = subscription.usageResetAt ? new Date(subscription.usageResetAt) : null;

    // Reset on first of month
    if (!resetAt || (now.getMonth() !== resetAt.getMonth() || now.getFullYear() !== resetAt.getFullYear())) {
      await this.db
        .prepare(`
          UPDATE user_subscriptions
          SET tokens_used = 0, requests_used = 0, usage_reset_at = ?, updated_at = ?
          WHERE user_id = ?
        `)
        .bind(now.toISOString(), now.toISOString(), userId)
        .run();

      // Update local copy
      subscription.tokensUsed = 0;
      subscription.requestsUsed = 0;
      subscription.usageResetAt = now.toISOString();
    }
  }

  /**
   * Record usage after a successful API call
   */
  async recordUsage(
    userId: string,
    tokens: number,
    entry?: Partial<UsageLogEntry>
  ): Promise<void> {
    const now = new Date().toISOString();

    // Update subscription usage
    await this.db
      .prepare(`
        UPDATE user_subscriptions
        SET tokens_used = tokens_used + ?,
            requests_used = requests_used + 1,
            updated_at = ?
        WHERE user_id = ?
      `)
      .bind(tokens, now, userId)
      .run();

    // Log the access
    if (entry) {
      await this.db
        .prepare(`
          INSERT INTO api_access_logs (
            id, user_id, endpoint, provider, model,
            prompt_tokens, completion_tokens, total_tokens,
            estimated_cost_microcents, request_id, ip_address, user_agent,
            success, error_message, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          nanoid(),
          userId,
          entry.endpoint || '',
          entry.provider || null,
          entry.model || null,
          entry.promptTokens || null,
          entry.completionTokens || null,
          entry.totalTokens || tokens,
          entry.estimatedCostMicrocents || null,
          entry.requestId || null,
          entry.ipAddress || null,
          entry.userAgent || null,
          entry.success !== false ? 1 : 0,
          entry.errorMessage || null,
          now
        )
        .run();
    }
  }

  /**
   * Add user to allowlist
   */
  async addToAllowlist(
    identifier: string,
    tier: SubscriptionTier = 'pro',
    options?: {
      identifierType?: 'email' | 'user_id';
      allowedProviders?: string[];
      addedBy?: string;
      reason?: string;
    }
  ): Promise<void> {
    await this.db
      .prepare(`
        INSERT OR REPLACE INTO access_allowlist (
          id, identifier, identifier_type, tier, allowed_providers, added_by, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `)
      .bind(
        nanoid(),
        identifier.toLowerCase(),
        options?.identifierType || 'email',
        tier,
        options?.allowedProviders ? JSON.stringify(options.allowedProviders) : null,
        options?.addedBy || null,
        options?.reason || null
      )
      .run();
  }

  /**
   * Remove user from allowlist
   */
  async removeFromAllowlist(identifier: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM access_allowlist WHERE identifier = ?`)
      .bind(identifier.toLowerCase())
      .run();
  }

  /**
   * Get all allowlist entries
   */
  async getAllowlist(): Promise<Array<{
    identifier: string;
    identifierType: string;
    tier: SubscriptionTier;
    addedBy: string | null;
    reason: string | null;
    createdAt: string;
  }>> {
    const { results } = await this.db
      .prepare(`SELECT * FROM access_allowlist ORDER BY created_at DESC`)
      .all<any>();

    return results.map(row => ({
      identifier: row.identifier,
      identifierType: row.identifier_type,
      tier: row.tier as SubscriptionTier,
      addedBy: row.added_by,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }

  /**
   * Get usage statistics for a user
   */
  async getUsageStats(userId: string, days: number = 30): Promise<{
    totalTokens: number;
    totalRequests: number;
    byProvider: Record<string, { tokens: number; requests: number }>;
    byDay: Array<{ date: string; tokens: number; requests: number }>;
  }> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const { results } = await this.db
      .prepare(`
        SELECT 
          provider,
          DATE(created_at) as date,
          SUM(total_tokens) as tokens,
          COUNT(*) as requests
        FROM api_access_logs
        WHERE user_id = ? AND created_at >= ? AND success = 1
        GROUP BY provider, DATE(created_at)
        ORDER BY date DESC
      `)
      .bind(userId, since.toISOString())
      .all<any>();

    const byProvider: Record<string, { tokens: number; requests: number }> = {};
    const byDayMap: Record<string, { tokens: number; requests: number }> = {};
    let totalTokens = 0;
    let totalRequests = 0;

    for (const row of results) {
      const provider = row.provider || 'unknown';
      const date = row.date;
      const tokens = row.tokens || 0;
      const requests = row.requests || 0;

      totalTokens += tokens;
      totalRequests += requests;

      if (!byProvider[provider]) {
        byProvider[provider] = { tokens: 0, requests: 0 };
      }
      byProvider[provider].tokens += tokens;
      byProvider[provider].requests += requests;

      if (!byDayMap[date]) {
        byDayMap[date] = { tokens: 0, requests: 0 };
      }
      byDayMap[date].tokens += tokens;
      byDayMap[date].requests += requests;
    }

    const byDay = Object.entries(byDayMap)
      .map(([date, stats]) => ({ date, ...stats }))
      .sort((a, b) => b.date.localeCompare(a.date));

    return { totalTokens, totalRequests, byProvider, byDay };
  }

  /**
   * Map database row to UserSubscription
   */
  private mapRow(row: any): UserSubscription {
    return {
      id: row.id,
      userId: row.user_id,
      tier: row.tier as SubscriptionTier,
      allowedProviders: row.allowed_providers ? JSON.parse(row.allowed_providers) : null,
      monthlyTokenLimit: row.monthly_token_limit,
      monthlyRequestLimit: row.monthly_request_limit,
      tokensUsed: row.tokens_used || 0,
      requestsUsed: row.requests_used || 0,
      usageResetAt: row.usage_reset_at,
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
      stripeStatus: row.stripe_status,
      manuallyGranted: !!row.manually_granted,
      grantedBy: row.granted_by,
      grantedAt: row.granted_at,
      grantReason: row.grant_reason,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createSubscriptionService(env: Env): SubscriptionService {
  return new SubscriptionService(env.DB, env);
}
