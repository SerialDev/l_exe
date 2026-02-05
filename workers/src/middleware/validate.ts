/**
 * Request validation middleware using Zod schemas
 * Provides consistent validation for body, query params, and route params
 */

import { Context, MiddlewareHandler } from 'hono'
import { z, ZodSchema, ZodError } from 'zod'
import { ValidationError } from './error'

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
 * Validation error details
 */
interface ValidationErrorDetail {
  path: string
  message: string
  code?: string
}

/**
 * Format Zod errors into a consistent structure
 */
function formatZodErrors(error: ZodError): ValidationErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }))
}

/**
 * Create a validation error with formatted details
 */
function createValidationError(
  source: 'body' | 'query' | 'params' | 'headers',
  zodError: ZodError
): ValidationError {
  const errors = formatZodErrors(zodError)
  return new ValidationError(`Invalid ${source}`, {
    source,
    errors,
  })
}

/**
 * Validate request body against a Zod schema
 * Attaches validated data to context as 'validatedBody'
 */
export function validateBody<T extends ZodSchema>(
  schema: T
): MiddlewareHandler<{
  Bindings: Env
  Variables: { validatedBody: z.infer<T> }
}> {
  return async (c, next) => {
    let body: unknown

    try {
      // Try to parse JSON body
      const contentType = c.req.header('Content-Type') || ''
      
      if (contentType.includes('application/json')) {
        body = await c.req.json()
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await c.req.parseBody()
        body = Object.fromEntries(
          Object.entries(formData).map(([key, value]) => [key, value])
        )
      } else if (contentType.includes('multipart/form-data')) {
        const formData = await c.req.parseBody()
        body = Object.fromEntries(
          Object.entries(formData).map(([key, value]) => [key, value])
        )
      } else {
        // Try JSON as default
        try {
          body = await c.req.json()
        } catch {
          body = {}
        }
      }
    } catch (error) {
      throw new ValidationError('Invalid request body format', {
        source: 'body',
        errors: [{ path: '', message: 'Could not parse request body' }],
      })
    }

    // Validate against schema
    const result = schema.safeParse(body)

    if (!result.success) {
      throw createValidationError('body', result.error)
    }

    c.set('validatedBody', result.data)
    await next()
  }
}

/**
 * Validate query parameters against a Zod schema
 * Attaches validated data to context as 'validatedQuery'
 */
export function validateQuery<T extends ZodSchema>(
  schema: T
): MiddlewareHandler<{
  Bindings: Env
  Variables: { validatedQuery: z.infer<T> }
}> {
  return async (c, next) => {
    // Get all query parameters
    const query: Record<string, string | string[]> = {}
    const url = new URL(c.req.url)
    
    url.searchParams.forEach((value, key) => {
      const existing = query[key]
      if (existing) {
        // Handle arrays
        if (Array.isArray(existing)) {
          existing.push(value)
        } else {
          query[key] = [existing, value]
        }
      } else {
        query[key] = value
      }
    })

    // Validate against schema
    const result = schema.safeParse(query)

    if (!result.success) {
      throw createValidationError('query', result.error)
    }

    c.set('validatedQuery', result.data)
    await next()
  }
}

/**
 * Validate route parameters against a Zod schema
 * Attaches validated data to context as 'validatedParams'
 */
export function validateParams<T extends ZodSchema>(
  schema: T
): MiddlewareHandler<{
  Bindings: Env
  Variables: { validatedParams: z.infer<T> }
}> {
  return async (c, next) => {
    // Get route parameters
    const params = c.req.param()

    // Validate against schema
    const result = schema.safeParse(params)

    if (!result.success) {
      throw createValidationError('params', result.error)
    }

    c.set('validatedParams', result.data)
    await next()
  }
}

/**
 * Validate request headers against a Zod schema
 * Attaches validated data to context as 'validatedHeaders'
 */
export function validateHeaders<T extends ZodSchema>(
  schema: T
): MiddlewareHandler<{
  Bindings: Env
  Variables: { validatedHeaders: z.infer<T> }
}> {
  return async (c, next) => {
    // Get relevant headers
    const headers: Record<string, string> = {}
    c.req.raw.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })

    // Validate against schema
    const result = schema.safeParse(headers)

    if (!result.success) {
      throw createValidationError('headers', result.error)
    }

    c.set('validatedHeaders', result.data)
    await next()
  }
}

/**
 * Combined validation middleware
 * Validates body, query, and params in one go
 */
export function validate<
  TBody extends ZodSchema = ZodSchema,
  TQuery extends ZodSchema = ZodSchema,
  TParams extends ZodSchema = ZodSchema
>(options: {
  body?: TBody
  query?: TQuery
  params?: TParams
}): MiddlewareHandler<{
  Bindings: Env
  Variables: {
    validatedBody: TBody extends ZodSchema ? z.infer<TBody> : never
    validatedQuery: TQuery extends ZodSchema ? z.infer<TQuery> : never
    validatedParams: TParams extends ZodSchema ? z.infer<TParams> : never
  }
}> {
  return async (c, next) => {
    const errors: ValidationErrorDetail[] = []

    // Validate body
    if (options.body) {
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        body = {}
      }

      const result = options.body.safeParse(body)
      if (!result.success) {
        errors.push(
          ...result.error.issues.map((issue) => ({
            path: `body.${issue.path.join('.')}`,
            message: issue.message,
            code: issue.code,
          }))
        )
      } else {
        c.set('validatedBody', result.data)
      }
    }

    // Validate query
    if (options.query) {
      const query: Record<string, string | string[]> = {}
      const url = new URL(c.req.url)
      
      url.searchParams.forEach((value, key) => {
        const existing = query[key]
        if (existing) {
          if (Array.isArray(existing)) {
            existing.push(value)
          } else {
            query[key] = [existing, value]
          }
        } else {
          query[key] = value
        }
      })

      const result = options.query.safeParse(query)
      if (!result.success) {
        errors.push(
          ...result.error.issues.map((issue) => ({
            path: `query.${issue.path.join('.')}`,
            message: issue.message,
            code: issue.code,
          }))
        )
      } else {
        c.set('validatedQuery', result.data)
      }
    }

    // Validate params
    if (options.params) {
      const params = c.req.param()
      const result = options.params.safeParse(params)
      if (!result.success) {
        errors.push(
          ...result.error.issues.map((issue) => ({
            path: `params.${issue.path.join('.')}`,
            message: issue.message,
            code: issue.code,
          }))
        )
      } else {
        c.set('validatedParams', result.data)
      }
    }

    // If there are errors, throw ValidationError
    if (errors.length > 0) {
      throw new ValidationError('Validation failed', {
        errors,
      })
    }

    await next()
  }
}

/**
 * Common schema helpers
 */
export const schemas = {
  /** UUID v4 validation */
  uuid: z.string().uuid(),

  /** Pagination query params */
  pagination: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),

  /** Sort query params */
  sort: z.object({
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  }),

  /** ID param */
  idParam: z.object({
    id: z.string().uuid(),
  }),

  /** Slug param */
  slugParam: z.object({
    slug: z.string().min(1).max(255),
  }),
}
