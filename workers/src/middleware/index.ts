/**
 * Middleware exports
 * Re-exports all middleware for convenient importing
 */

// Authentication middleware
export {
  requireAuth,
  optionalAuth,
  requireAdmin,
  requireRole,
  createJWT,
  type JWTPayload,
  type AuthUser,
  type AuthContext,
  type OptionalAuthContext,
} from './auth'

// Rate limiting middleware
export {
  createRateLimiter,
  apiRateLimiter,
  strictRateLimiter,
  authRateLimiter,
  uploadRateLimiter,
  createUserRateLimiter,
  createPathRateLimiter,
  type RateLimitOptions,
} from './rateLimit'

// Validation middleware
export {
  validateBody,
  validateQuery,
  validateParams,
  validateHeaders,
  validate,
  schemas,
} from './validate'

// Error handling middleware
export {
  errorHandler,
  notFoundHandler,
  AppError,
  AuthError,
  ForbiddenError,
  ValidationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ServiceUnavailableError,
} from './error'

// CORS middleware
export {
  corsMiddleware,
  devCors,
  productionCors,
  dynamicCors,
  subdomainCors,
  type CorsOptions,
} from './cors'

// Logging middleware
export {
  requestLogger,
  devLogger,
  productionLogger,
  createExternalLogger,
  type LoggingOptions,
} from './logging'
