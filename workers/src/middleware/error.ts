/**
 * Error handling middleware and custom error classes
 * Provides consistent error response format across the application
 */

import { Context, MiddlewareHandler } from 'hono'
import { StatusCode } from 'hono/utils/http-status'

/**
 * Base application error class
 */
export class AppError extends Error {
  public readonly statusCode: StatusCode
  public readonly code: string
  public readonly details?: Record<string, unknown>

  constructor(
    message: string,
    statusCode: StatusCode = 500,
    code: string = 'INTERNAL_ERROR',
    details?: Record<string, unknown>
  ) {
    super(message)
    this.name = this.constructor.name
    this.statusCode = statusCode
    this.code = code
    this.details = details
    Error.captureStackTrace?.(this, this.constructor)
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
      },
    }
  }
}

/**
 * Authentication error - 401 Unauthorized
 */
export class AuthError extends AppError {
  constructor(message: string = 'Authentication required', details?: Record<string, unknown>) {
    super(message, 401, 'AUTH_ERROR', details)
  }
}

/**
 * Authorization error - 403 Forbidden
 */
export class ForbiddenError extends AppError {
  constructor(message: string = 'Access denied', details?: Record<string, unknown>) {
    super(message, 403, 'FORBIDDEN', details)
  }
}

/**
 * Validation error - 400 Bad Request
 */
export class ValidationError extends AppError {
  constructor(message: string = 'Validation failed', details?: Record<string, unknown>) {
    super(message, 400, 'VALIDATION_ERROR', details)
  }
}

/**
 * Not found error - 404 Not Found
 */
export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found', details?: Record<string, unknown>) {
    super(message, 404, 'NOT_FOUND', details)
  }
}

/**
 * Conflict error - 409 Conflict
 */
export class ConflictError extends AppError {
  constructor(message: string = 'Resource already exists', details?: Record<string, unknown>) {
    super(message, 409, 'CONFLICT', details)
  }
}

/**
 * Rate limit error - 429 Too Many Requests
 */
export class RateLimitError extends AppError {
  public readonly retryAfter: number

  constructor(retryAfter: number, message: string = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED', { retryAfter })
    this.retryAfter = retryAfter
  }
}

/**
 * Service unavailable error - 503 Service Unavailable
 */
export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service temporarily unavailable', details?: Record<string, unknown>) {
    super(message, 503, 'SERVICE_UNAVAILABLE', details)
  }
}

/**
 * Standard error response format
 */
interface ErrorResponse {
  success: false
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
    requestId?: string
  }
}

/**
 * Create a standardized error response
 */
function createErrorResponse(
  error: AppError | Error,
  requestId?: string
): ErrorResponse {
  if (error instanceof AppError) {
    return {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details && { details: error.details }),
        ...(requestId && { requestId }),
      },
    }
  }

  // Generic error
  return {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      ...(requestId && { requestId }),
    },
  }
}

/**
 * Global error handler middleware
 * Catches all errors and returns consistent error responses
 */
export const errorHandler: MiddlewareHandler = async (c, next) => {
  try {
    await next()
  } catch (error) {
    const requestId = c.get('requestId') as string | undefined

    // Log the error (the logging middleware will capture this)
    console.error('Error caught by error handler:', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    if (error instanceof RateLimitError) {
      c.header('Retry-After', String(error.retryAfter))
      return c.json(createErrorResponse(error, requestId), error.statusCode as 400 | 401 | 403 | 404 | 429 | 500 | 503)
    }

    if (error instanceof AppError) {
      return c.json(createErrorResponse(error, requestId), error.statusCode as 400 | 401 | 403 | 404 | 429 | 500 | 503)
    }

    // Handle Zod validation errors
    if (error instanceof Error && error.name === 'ZodError') {
      const zodError = error as unknown as { issues: Array<{ path: string[]; message: string }> }
      const validationError = new ValidationError('Validation failed', {
        errors: zodError.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      })
      return c.json(createErrorResponse(validationError, requestId), 400)
    }

    // Unknown error - return 500
    return c.json(createErrorResponse(error as Error, requestId), 500)
  }
}

/**
 * Not found handler for unmatched routes
 */
export const notFoundHandler = (c: Context) => {
  const requestId = c.get('requestId') as string | undefined
  const error = new NotFoundError(`Route ${c.req.method} ${c.req.path} not found`)
  return c.json(createErrorResponse(error, requestId), 404)
}
