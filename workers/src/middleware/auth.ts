/**
 * Authentication middleware
 * JWT verification and role-based access control
 */

import { Context, MiddlewareHandler } from 'hono'
import { AuthError, ForbiddenError } from './error'

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
 * User payload extracted from JWT
 */
export interface JWTPayload {
  sub: string // User ID
  email: string
  username: string
  role: 'user' | 'admin'
  iat: number
  exp: number
}

/**
 * User context attached to requests
 */
export interface AuthUser {
  id: string
  email: string
  username: string
  role: 'user' | 'admin'
}

/**
 * Extended context with user information
 */
export interface AuthContext {
  user: AuthUser
}

/**
 * Extended context with optional user information
 */
export interface OptionalAuthContext {
  user: AuthUser | null
}

/**
 * Base64URL decode
 */
function base64UrlDecode(str: string): string {
  // Replace URL-safe characters and add padding
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const decoded = atob(base64 + padding)
  return decoded
}

/**
 * Verify JWT signature using HMAC-SHA256
 * SECURITY: Signature is verified BEFORE parsing the payload to prevent attacks
 */
async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    // Validate token length to prevent DoS
    const MAX_TOKEN_LENGTH = 8192
    if (!token || token.length > MAX_TOKEN_LENGTH) {
      return null
    }

    const parts = token.split('.')
    if (parts.length !== 3) {
      return null
    }

    const [headerB64, payloadB64, signatureB64] = parts

    // SECURITY: Verify signature FIRST before parsing any data
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    const signatureData = base64UrlDecode(signatureB64)
    const signatureBytes = new Uint8Array(signatureData.length)
    for (let i = 0; i < signatureData.length; i++) {
      signatureBytes[i] = signatureData.charCodeAt(i)
    }

    const data = encoder.encode(`${headerB64}.${payloadB64}`)
    const isValid = await crypto.subtle.verify('HMAC', key, signatureBytes, data)

    if (!isValid) {
      return null
    }

    // SECURITY: Only parse payload AFTER signature is verified
    // Validate header algorithm
    const headerJson = base64UrlDecode(headerB64)
    const header = JSON.parse(headerJson) as { alg: string; typ: string }
    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      return null
    }

    // Parse payload (safe now that signature is verified)
    const payloadJson = base64UrlDecode(payloadB64)
    const payload = JSON.parse(payloadJson) as JWTPayload

    // Validate required fields
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.exp !== 'number' ||
      typeof payload.iat !== 'number'
    ) {
      return null
    }

    // Check expiration - exp MUST be present and valid (no conditional check)
    const now = Math.floor(Date.now() / 1000)
    const CLOCK_SKEW_TOLERANCE = 60 // 60 seconds tolerance
    if (payload.exp < now - CLOCK_SKEW_TOLERANCE) {
      return null
    }

    // Validate iat (issued at) is not in the future
    if (payload.iat > now + CLOCK_SKEW_TOLERANCE) {
      return null
    }

    return payload
  } catch {
    return null
  }
}

/**
 * Extract token from Authorization header
 */
function extractToken(c: Context): string | null {
  const authHeader = c.req.header('Authorization')
  if (!authHeader) {
    return null
  }

  const [scheme, token] = authHeader.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null
  }

  return token
}

/**
 * Check if session is valid
 * Note: Sessions are stored in D1 (database), not KV
 * For access tokens, we trust the JWT if it's valid and not expired
 * Session invalidation is handled via refresh token revocation
 */
async function isSessionValid(
  kv: KVNamespace,
  userId: string,
  token: string
): Promise<boolean> {
  // Access tokens are stateless - if the JWT is valid and not expired, we trust it
  // For logout/session invalidation, we rely on:
  // 1. Short access token expiry (15 min)
  // 2. Refresh token revocation in D1
  // 3. Optional: blacklisted tokens in KV for immediate invalidation
  
  try {
    // Check if token is blacklisted (for immediate logout)
    const encoder = new TextEncoder()
    const data = encoder.encode(token)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const tokenHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

    // SECURITY: Use full hash to prevent collision attacks
    const blacklistKey = `blacklist:${tokenHash}`
    const isBlacklisted = await kv.get(blacklistKey)
    
    // If not blacklisted, session is valid
    return isBlacklisted === null
  } catch (error) {
    // SECURITY: Fail closed - if we can't verify session validity, deny the request
    // This prevents potentially revoked tokens from being used if KV is unavailable
    console.error('Session validation failed, denying request for security:', error)
    return false
  }
}

/**
 * Require authentication middleware
 * Supports both:
 * 1. Better-auth cookie-based sessions (user attached by session middleware in index.ts)
 * 2. Legacy JWT Bearer token authentication
 * Returns 401 if neither is present/valid
 */
export const requireAuth: MiddlewareHandler<{
  Bindings: Env
  Variables: AuthContext
}> = async (c, next) => {
  // Check if user was already attached by better-auth session middleware
  const existingUser = c.get('user')
  if (existingUser) {
    await next()
    return
  }

  // Fall back to JWT token authentication (for API clients, mobile apps, etc.)
  const token = extractToken(c)

  if (!token) {
    throw new AuthError('Authentication required')
  }

  const payload = await verifyJWT(token, c.env.JWT_SECRET)

  if (!payload) {
    throw new AuthError('Invalid or expired token')
  }

  // Optionally validate session in KV
  const sessionValid = await isSessionValid(c.env.SESSIONS, payload.sub, token)
  if (!sessionValid) {
    throw new AuthError('Session expired or invalidated')
  }

  // Attach user to context
  const user: AuthUser = {
    id: payload.sub,
    email: payload.email,
    username: payload.username,
    role: payload.role,
  }

  c.set('user', user)

  await next()
}

/**
 * Optional authentication middleware
 * Parses JWT if present but doesn't require it
 * Attaches user to context if token is valid, null otherwise
 */
export const optionalAuth: MiddlewareHandler<{
  Bindings: Env
  Variables: OptionalAuthContext
}> = async (c, next) => {
  const token = extractToken(c)

  if (!token) {
    c.set('user', null)
    await next()
    return
  }

  const payload = await verifyJWT(token, c.env.JWT_SECRET)

  if (!payload) {
    c.set('user', null)
    await next()
    return
  }

  // Validate session
  const sessionValid = await isSessionValid(c.env.SESSIONS, payload.sub, token)

  if (!sessionValid) {
    c.set('user', null)
    await next()
    return
  }

  const user: AuthUser = {
    id: payload.sub,
    email: payload.email,
    username: payload.username,
    role: payload.role,
  }

  c.set('user', user)

  await next()
}

/**
 * Require admin role middleware
 * Must be used after requireAuth
 * Returns 403 if user is not an admin
 */
export const requireAdmin: MiddlewareHandler<{
  Bindings: Env
  Variables: AuthContext
}> = async (c, next) => {
  const user = c.get('user')

  if (!user) {
    throw new AuthError('Authentication required')
  }

  if (user.role !== 'admin') {
    throw new ForbiddenError('Admin access required')
  }

  await next()
}

/**
 * Create a middleware that requires specific roles
 */
export function requireRole(
  ...allowedRoles: Array<'user' | 'admin'>
): MiddlewareHandler<{
  Bindings: Env
  Variables: AuthContext
}> {
  return async (c, next) => {
    const user = c.get('user')

    if (!user) {
      throw new AuthError('Authentication required')
    }

    if (!allowedRoles.includes(user.role)) {
      throw new ForbiddenError(`Required role: ${allowedRoles.join(' or ')}`)
    }

    await next()
  }
}

/**
 * Create JWT token (utility function for auth routes)
 */
export async function createJWT(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  secret: string,
  expiresIn: number = 3600 // 1 hour default
): Promise<string> {
  const encoder = new TextEncoder()

  const header = {
    alg: 'HS256',
    typ: 'JWT',
  }

  const now = Math.floor(Date.now() / 1000)
  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + expiresIn,
  }

  // Base64URL encode
  const base64UrlEncode = (obj: object): string => {
    const json = JSON.stringify(obj)
    const base64 = btoa(json)
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  }

  const headerB64 = base64UrlEncode(header)
  const payloadB64 = base64UrlEncode(fullPayload)

  // Create signature
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const data = encoder.encode(`${headerB64}.${payloadB64}`)
  const signature = await crypto.subtle.sign('HMAC', key, data)

  // Convert signature to base64url
  const signatureArray = Array.from(new Uint8Array(signature))
  const signatureB64 = btoa(String.fromCharCode(...signatureArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')

  return `${headerB64}.${payloadB64}.${signatureB64}`
}

/**
 * Alias for requireAuth - for backwards compatibility
 */
export const authMiddleware = requireAuth
