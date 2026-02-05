/**
 * Request logging middleware
 * Logs request method, path, duration, and includes request ID for tracing
 */

import { MiddlewareHandler } from 'hono'

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
 * Log entry structure
 */
interface LogEntry {
  timestamp: string
  requestId: string
  method: string
  path: string
  query?: string
  status: number
  duration: number
  ip?: string
  userAgent?: string
  userId?: string
  contentLength?: number
  error?: string
  cf?: {
    colo?: string
    country?: string
    city?: string
    region?: string
    asn?: number
  }
}

/**
 * Logging options
 */
export interface LoggingOptions {
  /** Include query string in logs */
  includeQuery?: boolean
  /** Include user agent in logs */
  includeUserAgent?: boolean
  /** Include Cloudflare geo data */
  includeGeoData?: boolean
  /** Include request body size */
  includeContentLength?: boolean
  /** Skip logging for certain paths */
  skipPaths?: string[]
  /** Custom log handler */
  onLog?: (entry: LogEntry) => void | Promise<void>
  /** Log level filter (only log >= this level) */
  minDuration?: number
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  // Use crypto.randomUUID if available, otherwise generate manually
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  // Fallback: generate a simple unique ID
  const timestamp = Date.now().toString(36)
  const randomPart = Math.random().toString(36).substring(2, 10)
  return `${timestamp}-${randomPart}`
}

/**
 * Get client IP from Cloudflare headers
 */
function getClientIp(headers: Headers): string | undefined {
  return (
    headers.get('CF-Connecting-IP') ||
    headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    undefined
  )
}

/**
 * Extract Cloudflare geo data from request
 */
function getCfData(request: Request): LogEntry['cf'] | undefined {
  // @ts-ignore - CF properties exist on Cloudflare Workers requests
  const cf = (request as any).cf
  if (!cf) return undefined

  return {
    colo: cf.colo as string | undefined,
    country: cf.country as string | undefined,
    city: cf.city as string | undefined,
    region: cf.region as string | undefined,
    asn: cf.asn as number | undefined,
  }
}

/**
 * Format duration for display
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  }
  return `${(ms / 1000).toFixed(2)}s`
}

/**
 * Default log handler - outputs to console
 */
function defaultLogHandler(entry: LogEntry): void {
  const statusEmoji = entry.status >= 500 ? 'ERROR' : entry.status >= 400 ? 'WARN' : 'INFO'
  const durationStr = formatDuration(entry.duration)

  // Structured log for Cloudflare
  console.log(
    JSON.stringify({
      level: statusEmoji,
      ...entry,
    })
  )
}

/**
 * Request logger middleware
 * Logs request details and timing information
 */
export function requestLogger(options: LoggingOptions = {}): MiddlewareHandler<{
  Bindings: Env
  Variables: { requestId: string }
}> {
  const {
    includeQuery = true,
    includeUserAgent = true,
    includeGeoData = true,
    includeContentLength = true,
    skipPaths = ['/health', '/healthz', '/ready', '/favicon.ico'],
    onLog = defaultLogHandler,
    minDuration = 0,
  } = options

  return async (c, next) => {
    const startTime = Date.now()

    // Generate and set request ID
    const requestId = c.req.header('X-Request-ID') || generateRequestId()
    c.set('requestId', requestId)
    c.header('X-Request-ID', requestId)

    // Check if we should skip logging for this path
    const path = c.req.path
    if (skipPaths.some((skip) => path.startsWith(skip))) {
      await next()
      return
    }

    // Get request details before processing
    const method = c.req.method
    const url = new URL(c.req.url)
    const query = includeQuery ? url.search.substring(1) : undefined
    const userAgent = includeUserAgent ? c.req.header('User-Agent') : undefined
    const ip = getClientIp(c.req.raw.headers)
    const cfData = includeGeoData ? getCfData(c.req.raw) : undefined

    let error: string | undefined

    try {
      await next()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      const duration = Date.now() - startTime

      // Only log if duration meets minimum threshold
      if (duration >= minDuration) {
        // Get user ID if available
        const user = (c as any).get('user') as { id: string } | undefined
        const userId = user?.id

        // Get response content length
        const contentLength = includeContentLength
          ? parseInt(c.res.headers.get('Content-Length') || '0', 10) || undefined
          : undefined

        const entry: LogEntry = {
          timestamp: new Date().toISOString(),
          requestId,
          method,
          path,
          ...(query && { query }),
          status: c.res.status,
          duration,
          ...(ip && { ip }),
          ...(userAgent && { userAgent }),
          ...(userId && { userId }),
          ...(contentLength && { contentLength }),
          ...(error && { error }),
          ...(cfData && { cf: cfData }),
        }

        // Call log handler (don't await to avoid blocking response)
        Promise.resolve(onLog(entry)).catch((e) => {
          console.error('Logging error:', e)
        })
      }
    }
  }
}

/**
 * Pre-configured logger for development
 * Includes all details and pretty prints
 */
export const devLogger = requestLogger({
  includeQuery: true,
  includeUserAgent: true,
  includeGeoData: true,
  includeContentLength: true,
  onLog: (entry) => {
    const statusColor =
      entry.status >= 500
        ? '\x1b[31m' // Red
        : entry.status >= 400
          ? '\x1b[33m' // Yellow
          : entry.status >= 300
            ? '\x1b[36m' // Cyan
            : '\x1b[32m' // Green
    const reset = '\x1b[0m'

    console.log(
      `${statusColor}${entry.method}${reset} ${entry.path} ${statusColor}${entry.status}${reset} ${formatDuration(entry.duration)} [${entry.requestId}]`
    )

    if (entry.error) {
      console.error(`  Error: ${entry.error}`)
    }
  },
})

/**
 * Pre-configured logger for production
 * JSON output, minimal overhead
 */
export const productionLogger = requestLogger({
  includeQuery: true,
  includeUserAgent: false,
  includeGeoData: true,
  includeContentLength: true,
  skipPaths: ['/health', '/healthz', '/ready', '/favicon.ico', '/.well-known'],
})

/**
 * Create a logger that sends logs to an external service
 */
export function createExternalLogger(
  endpoint: string,
  headers: Record<string, string> = {}
): MiddlewareHandler<{
  Bindings: Env
  Variables: { requestId: string }
}> {
  return requestLogger({
    onLog: async (entry) => {
      // Send to external logging service (fire and forget)
      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(entry),
      }).catch((e) => {
        console.error('Failed to send log to external service:', e)
      })

      // Also log locally
      defaultLogHandler(entry)
    },
  })
}
