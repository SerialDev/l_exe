/**
 * Rate limiting middleware using KV for distributed rate limiting
 * Implements sliding window rate limiting with configurable options
 */

import { Context, MiddlewareHandler } from 'hono'
import { RateLimitError } from './error'

// Import the canonical Env type
import type { Env } from '../types'

/**
 * Rate limiter options
 */
export interface RateLimitOptions {
  /** Maximum number of requests allowed in the window */
  limit: number
  /** Time window in seconds */
  window: number
  /** Key prefix for KV storage */
  keyPrefix: string
  /** Optional function to generate custom key (defaults to IP-based) */
  keyGenerator?: (c: Context) => string
  /** Optional KV namespace name to use (defaults to RATE_LIMIT) */
  kvNamespace?: 'RATE_LIMIT' | 'SESSIONS'
  /** Skip rate limiting for certain conditions */
  skip?: (c: Context) => boolean | Promise<boolean>
  /** Custom handler when rate limit is exceeded */
  onRateLimitExceeded?: (c: Context, retryAfter: number) => Response | Promise<Response>
}

/**
 * Rate limit record stored in KV
 */
interface RateLimitRecord {
  count: number
  resetAt: number
}

/**
 * Get client identifier for rate limiting
 * Uses CF-Connecting-IP header (Cloudflare) or X-Forwarded-For
 */
function getClientId(c: Context): string {
  // Cloudflare provides the real client IP
  const cfIp = c.req.header('CF-Connecting-IP')
  if (cfIp) return cfIp

  // Fallback to X-Forwarded-For
  const forwardedFor = c.req.header('X-Forwarded-For')
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim()
    if (firstIp) return firstIp
  }

  // Last resort: use a hash of the request
  return 'unknown'
}

/**
 * Create a rate limiter middleware with configurable options
 */
export function createRateLimiter(options: RateLimitOptions): MiddlewareHandler<{
  Bindings: Env
}> {
  const {
    limit,
    window,
    keyPrefix,
    keyGenerator,
    kvNamespace = 'RATE_LIMIT',
    skip,
    onRateLimitExceeded,
  } = options

  return async (c, next) => {
    // Check if we should skip rate limiting
    if (skip) {
      const shouldSkip = await skip(c)
      if (shouldSkip) {
        await next()
        return
      }
    }

    // Get KV namespace
    const kv = c.env[kvNamespace]

    // Generate rate limit key
    const identifier = keyGenerator ? keyGenerator(c) : getClientId(c)
    const key = `ratelimit:${keyPrefix}:${identifier}`

    const now = Math.floor(Date.now() / 1000)

    try {
      // Get current rate limit record
      const recordJson = await kv.get(key)
      let record: RateLimitRecord

      if (recordJson) {
        record = JSON.parse(recordJson) as RateLimitRecord

        // Check if window has expired
        if (now >= record.resetAt) {
          // Reset the counter
          record = {
            count: 1,
            resetAt: now + window,
          }
        } else {
          // Increment counter
          record.count += 1
        }
      } else {
        // New record
        record = {
          count: 1,
          resetAt: now + window,
        }
      }

      // Calculate remaining requests and retry after
      const remaining = Math.max(0, limit - record.count)
      const retryAfter = record.resetAt - now

      // Set rate limit headers
      c.header('X-RateLimit-Limit', String(limit))
      c.header('X-RateLimit-Remaining', String(remaining))
      c.header('X-RateLimit-Reset', String(record.resetAt))

      // Check if rate limit exceeded
      if (record.count > limit) {
        c.header('Retry-After', String(retryAfter))

        // Use custom handler if provided
        if (onRateLimitExceeded) {
          return onRateLimitExceeded(c, retryAfter)
        }

        throw new RateLimitError(retryAfter)
      }

      // Update KV with new count
      // TTL is set to window + 1 second to ensure cleanup
      await kv.put(key, JSON.stringify(record), {
        expirationTtl: window + 1,
      })

      await next()
    } catch (error) {
      // If it's already a RateLimitError, rethrow it
      if (error instanceof RateLimitError) {
        throw error
      }

      // Log KV errors but don't block the request (fail open)
      console.error('Rate limit KV error:', error)
      await next()
    }
  }
}

/**
 * Pre-configured rate limiters for common use cases
 */

/**
 * General API rate limiter
 * 100 requests per minute
 */
export const apiRateLimiter = createRateLimiter({
  limit: 100,
  window: 60,
  keyPrefix: 'api',
})

/**
 * Strict rate limiter for sensitive endpoints
 * 10 requests per minute
 */
export const strictRateLimiter = createRateLimiter({
  limit: 10,
  window: 60,
  keyPrefix: 'strict',
})

/**
 * Auth endpoints rate limiter
 * 5 requests per minute to prevent brute force
 */
export const authRateLimiter = createRateLimiter({
  limit: 5,
  window: 60,
  keyPrefix: 'auth',
})

/**
 * Upload rate limiter
 * 10 uploads per hour
 */
export const uploadRateLimiter = createRateLimiter({
  limit: 10,
  window: 3600,
  keyPrefix: 'upload',
})

/**
 * Create a rate limiter that uses authenticated user ID as key
 */
export function createUserRateLimiter(options: Omit<RateLimitOptions, 'keyGenerator'>): MiddlewareHandler<{
  Bindings: Env
}> {
  return createRateLimiter({
    ...options,
    keyGenerator: (c) => {
      const user = c.get('user') as { id: string } | undefined
      if (user?.id) {
        return `user:${user.id}`
      }
      // Fall back to IP-based limiting
      return getClientId(c)
    },
  })
}

/**
 * Create a rate limiter that combines IP and path
 */
export function createPathRateLimiter(options: Omit<RateLimitOptions, 'keyGenerator'>): MiddlewareHandler<{
  Bindings: Env
}> {
  return createRateLimiter({
    ...options,
    keyGenerator: (c) => {
      const ip = getClientId(c)
      const path = c.req.path
      return `${ip}:${path}`
    },
  })
}
