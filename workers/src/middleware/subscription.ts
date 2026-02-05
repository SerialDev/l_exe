/**
 * Subscription Middleware
 * Checks if user has access to AI provider APIs based on their subscription tier
 */

import { Context, Next } from 'hono';
import type { Env, Variables } from '../types';
import { createSubscriptionService } from '../services/subscription';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

interface SubscriptionMiddlewareOptions {
  /** Provider to check access for (if not specified, extracted from request) */
  provider?: string;
  /** Allow access even without subscription (for non-AI routes) */
  optional?: boolean;
}

/**
 * Middleware to check subscription access
 * Must be used AFTER requireAuth middleware
 */
export function requireSubscription(options: SubscriptionMiddlewareOptions = {}) {
  return async (c: AppContext, next: Next) => {
    const user = c.get('user') as { id: string } | undefined;
    
    if (!user) {
      return c.json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      }, 401);
    }

    // Get provider from options or request body/params
    let provider = options.provider;
    if (!provider) {
      // Try to get from URL param
      provider = c.req.param('endpoint') || c.req.param('provider');
      
      // Try to get from body
      if (!provider) {
        try {
          const body = await c.req.json();
          provider = body.endpoint || body.provider || 'openai';
          // Re-set the body for downstream handlers (since we consumed it)
          c.set('requestBody', body);
        } catch {
          provider = 'openai';
        }
      }
    }

    // Get model from body if available
    let model: string | undefined;
    try {
      const body = c.get('requestBody') || await c.req.json().catch(() => ({}));
      model = body.model;
      c.set('requestBody', body);
    } catch {
      // Ignore
    }

    const subscriptionService = createSubscriptionService(c.env);
    const accessCheck = await subscriptionService.checkAccess(user.id, provider, model);

    if (!accessCheck.allowed) {
      // If optional, allow through but mark as limited
      if (options.optional) {
        c.set('subscriptionLimited', true);
        c.set('subscriptionTier', accessCheck.tier);
        return next();
      }

      return c.json({
        success: false,
        error: {
          code: 'SUBSCRIPTION_REQUIRED',
          message: accessCheck.reason || 'Subscription required for this feature',
          tier: accessCheck.tier,
          remainingTokens: accessCheck.remainingTokens,
          remainingRequests: accessCheck.remainingRequests,
        },
      }, 403);
    }

    // Store subscription info in context for downstream use
    c.set('subscriptionTier', accessCheck.tier);
    c.set('remainingTokens', accessCheck.remainingTokens);
    c.set('remainingRequests', accessCheck.remainingRequests);

    return next();
  };
}

/**
 * Middleware to check if user is admin
 */
export function requireAdmin() {
  return async (c: AppContext, next: Next) => {
    const user = c.get('user') as { id: string } | undefined;
    
    if (!user) {
      return c.json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      }, 401);
    }

    const subscriptionService = createSubscriptionService(c.env);
    const subscription = await subscriptionService.getSubscription(user.id);

    if (!subscription || subscription.tier !== 'admin') {
      return c.json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Admin access required' },
      }, 403);
    }

    c.set('subscriptionTier', 'admin');
    return next();
  };
}

/**
 * Middleware to record usage after successful API calls
 * Use this after the route handler completes
 */
export function recordUsage() {
  return async (c: AppContext, next: Next) => {
    await next();

    // Only record for successful responses
    if (c.res.status >= 200 && c.res.status < 300) {
      const user = c.get('user') as { id: string } | undefined;
      if (!user) return;

      const usageInfo = c.get('usageInfo') as {
        tokens?: number;
        promptTokens?: number;
        completionTokens?: number;
        provider?: string;
        model?: string;
      } | undefined;

      if (usageInfo?.tokens) {
        const subscriptionService = createSubscriptionService(c.env);
        await subscriptionService.recordUsage(user.id, usageInfo.tokens, {
          endpoint: c.req.path,
          provider: usageInfo.provider,
          model: usageInfo.model,
          promptTokens: usageInfo.promptTokens,
          completionTokens: usageInfo.completionTokens,
          totalTokens: usageInfo.tokens,
          requestId: c.get('requestId'),
          ipAddress: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for'),
          userAgent: c.req.header('user-agent'),
          success: true,
        }).catch(err => {
          console.error('Failed to record usage:', err);
        });
      }
    }
  };
}
