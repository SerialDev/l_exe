/**
 * CORS middleware for Cloudflare Workers
 * Configurable Cross-Origin Resource Sharing
 */

import { Context, MiddlewareHandler } from 'hono'

// Types for Cloudflare bindings
interface Env {
  DB: D1Database
  STORAGE: R2Bucket
  SESSIONS: KVNamespace
  CACHE: KVNamespace
  APP_NAME: string
  ENVIRONMENT: string
  JWT_SECRET: string
  JWT_REFRESH_SECRET: string
  CREDS_KEY: string
  CREDS_IV: string
}

/**
 * CORS configuration options
 */
export interface CorsOptions {
  /** 
   * Allowed origins
   * Can be a string, array of strings, RegExp, or function
   * Use '*' for all origins (not recommended for credentials)
   */
  origin?: string | string[] | RegExp | ((origin: string, c: Context) => string | undefined | null)

  /** 
   * Allowed HTTP methods
   * Default: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE']
   */
  allowMethods?: string[]

  /** 
   * Allowed request headers
   * Default: ['Content-Type', 'Authorization']
   */
  allowHeaders?: string[]

  /** 
   * Headers to expose to the client
   */
  exposeHeaders?: string[]

  /** 
   * Max age for preflight cache in seconds
   * Default: 600 (10 minutes)
   */
  maxAge?: number

  /** 
   * Allow credentials (cookies, authorization headers)
   * Default: true
   */
  credentials?: boolean
}

/**
 * Default CORS options
 */
const defaultOptions: Required<CorsOptions> = {
  origin: '*',
  allowMethods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposeHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'X-Request-ID'],
  maxAge: 600,
  credentials: true,
}

/**
 * Resolve the allowed origin based on the request
 */
function resolveOrigin(
  requestOrigin: string | undefined,
  option: CorsOptions['origin'],
  c: Context
): string | null {
  if (!requestOrigin) {
    return null
  }

  // Wildcard - allow all (but note: can't use with credentials)
  if (option === '*') {
    return '*'
  }

  // String match
  if (typeof option === 'string') {
    return option === requestOrigin ? requestOrigin : null
  }

  // Array of allowed origins
  if (Array.isArray(option)) {
    return option.includes(requestOrigin) ? requestOrigin : null
  }

  // RegExp match
  if (option instanceof RegExp) {
    return option.test(requestOrigin) ? requestOrigin : null
  }

  // Function
  if (typeof option === 'function') {
    return option(requestOrigin, c) || null
  }

  return null
}

/**
 * Set CORS headers on the response
 */
function setCorsHeaders(
  c: Context,
  origin: string | null,
  options: Required<CorsOptions>,
  isPreflight: boolean = false
): void {
  // Always set Vary header for caching
  c.header('Vary', 'Origin')

  if (!origin) {
    return
  }

  // Set Access-Control-Allow-Origin
  c.header('Access-Control-Allow-Origin', origin)

  // Set credentials header
  if (options.credentials && origin !== '*') {
    c.header('Access-Control-Allow-Credentials', 'true')
  }

  // Set exposed headers
  if (options.exposeHeaders.length > 0) {
    c.header('Access-Control-Expose-Headers', options.exposeHeaders.join(', '))
  }

  // Preflight-specific headers
  if (isPreflight) {
    c.header('Access-Control-Allow-Methods', options.allowMethods.join(', '))
    c.header('Access-Control-Allow-Headers', options.allowHeaders.join(', '))

    if (options.maxAge > 0) {
      c.header('Access-Control-Max-Age', String(options.maxAge))
    }
  }
}

/**
 * Create CORS middleware with configurable options
 */
export function corsMiddleware(options: CorsOptions = {}): MiddlewareHandler<{
  Bindings: Env
}> {
  const mergedOptions: Required<CorsOptions> = {
    ...defaultOptions,
    ...options,
  }

  return async (c, next) => {
    const requestOrigin = c.req.header('Origin')
    const allowedOrigin = resolveOrigin(requestOrigin, mergedOptions.origin, c)

    // Handle preflight (OPTIONS) requests
    if (c.req.method === 'OPTIONS') {
      setCorsHeaders(c, allowedOrigin, mergedOptions, true)

      // Return 204 No Content for preflight
      return new Response(null, {
        status: 204,
        headers: c.res.headers,
      })
    }

    // Set CORS headers for actual request
    setCorsHeaders(c, allowedOrigin, mergedOptions, false)

    await next()
  }
}

/**
 * Pre-configured CORS for development (allows all origins)
 */
export const devCors = corsMiddleware({
  origin: '*',
  credentials: false, // Can't use credentials with wildcard
})

/**
 * Pre-configured CORS for production with specific origins
 */
export function productionCors(allowedOrigins: string[]): MiddlewareHandler<{
  Bindings: Env
}> {
  return corsMiddleware({
    origin: allowedOrigins,
    credentials: true,
    maxAge: 86400, // 24 hours
  })
}

/**
 * Dynamic CORS that reads allowed origins from environment
 */
export const dynamicCors: MiddlewareHandler<{
  Bindings: Env & { ALLOWED_ORIGINS?: string }
}> = async (c, next) => {
  const allowedOriginsStr = c.env.ALLOWED_ORIGINS || ''
  const allowedOrigins = allowedOriginsStr
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)

  const middleware = corsMiddleware({
    origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
    credentials: allowedOrigins.length > 0,
  })

  return middleware(c, next)
}

/**
 * CORS for subdomain matching
 * Allows any subdomain of the specified domain
 */
export function subdomainCors(baseDomain: string): MiddlewareHandler<{
  Bindings: Env
}> {
  const pattern = new RegExp(`^https?://([a-z0-9-]+\\.)*${baseDomain.replace('.', '\\.')}$`)

  return corsMiddleware({
    origin: pattern,
    credentials: true,
  })
}
