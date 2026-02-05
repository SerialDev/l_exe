/**
 * Config routes
 * GET /, GET /endpoints, GET /models
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

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

// Model specification schema
const modelSpecSchema = z.object({
  id: z.string(),
  name: z.string(),
  maxTokens: z.number(),
  contextWindow: z.number(),
  pricing: z.object({
    input: z.number(), // per 1M tokens
    output: z.number(), // per 1M tokens
  }).optional(),
  capabilities: z.object({
    vision: z.boolean().optional(),
    functionCalling: z.boolean().optional(),
    streaming: z.boolean().optional(),
    json: z.boolean().optional(),
  }).optional(),
  deprecated: z.boolean().optional(),
})

// Endpoint configuration schema
const endpointConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  models: z.array(z.string()),
  defaultModel: z.string().optional(),
  features: z.object({
    streaming: z.boolean(),
    vision: z.boolean(),
    functionCalling: z.boolean(),
    codeInterpreter: z.boolean(),
    retrieval: z.boolean(),
  }),
  userProvided: z.boolean(), // user can provide their own API key
})

// Response schemas
const configResponseSchema = z.object({
  appTitle: z.string(),
  appVersion: z.string(),
  serverDomain: z.string().optional(),
  registration: z.boolean(),
  socialLogins: z.object({
    google: z.boolean(),
    github: z.boolean(),
    discord: z.boolean(),
  }),
  emailVerification: z.boolean(),
  checkBalance: z.boolean(),
  endpoints: z.record(endpointConfigSchema),
  defaultEndpoint: z.string(),
  features: z.object({
    presets: z.boolean(),
    agents: z.boolean(),
    files: z.boolean(),
    search: z.boolean(),
    rag: z.boolean(),
    sharing: z.boolean(),
  }),
})

const endpointsResponseSchema = z.object({
  endpoints: z.array(endpointConfigSchema),
})

const modelsResponseSchema = z.object({
  models: z.record(z.array(modelSpecSchema)),
})

// Create router
const config = new Hono<{ Bindings: Env }>()

/**
 * GET /
 * Get application configuration
 */
config.get('/', async (c) => {
  // TODO: Implement full config response
  // 1. Load configuration from environment/D1
  // 2. Check which endpoints are enabled
  // 3. Check feature flags
  // 4. Return public configuration
  
  return c.json({
    success: true,
    data: {
      appTitle: c.env.APP_NAME || 'LibreChat',
      appVersion: '0.0.1',
      registration: true,
      socialLogins: {
        google: false,
        github: false,
        discord: false,
      },
      emailVerification: false,
      checkBalance: false,
      endpoints: {
        openAI: {
          id: 'openAI',
          name: 'OpenAI',
          enabled: true,
          models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
          defaultModel: 'gpt-4o-mini',
          features: {
            streaming: true,
            vision: true,
            functionCalling: true,
            codeInterpreter: false,
            retrieval: false,
          },
          userProvided: true,
        },
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic',
          enabled: true,
          models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
          defaultModel: 'claude-3-5-sonnet-20241022',
          features: {
            streaming: true,
            vision: true,
            functionCalling: true,
            codeInterpreter: false,
            retrieval: false,
          },
          userProvided: true,
        },
        google: {
          id: 'google',
          name: 'Google',
          enabled: true,
          models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'],
          defaultModel: 'gemini-1.5-flash',
          features: {
            streaming: true,
            vision: true,
            functionCalling: true,
            codeInterpreter: false,
            retrieval: false,
          },
          userProvided: true,
        },
      },
      defaultEndpoint: 'openAI',
      features: {
        presets: true,
        agents: true,
        files: true,
        search: true,
        rag: false,
        sharing: false,
      },
    },
  })
})

/**
 * GET /endpoints
 * Get available endpoints configuration
 */
config.get('/endpoints', async (c) => {
  // TODO: Implement endpoints configuration
  // 1. Load enabled endpoints from environment/D1
  // 2. For each endpoint, check if API key is configured or user-provided
  // 3. Return list of available endpoints with their capabilities
  
  return c.json({
    success: true,
    data: {
      endpoints: [
        {
          id: 'openAI',
          name: 'OpenAI',
          enabled: true,
          models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
          defaultModel: 'gpt-4o-mini',
          features: {
            streaming: true,
            vision: true,
            functionCalling: true,
            codeInterpreter: false,
            retrieval: false,
          },
          userProvided: true,
        },
        {
          id: 'anthropic',
          name: 'Anthropic',
          enabled: true,
          models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
          defaultModel: 'claude-3-5-sonnet-20241022',
          features: {
            streaming: true,
            vision: true,
            functionCalling: true,
            codeInterpreter: false,
            retrieval: false,
          },
          userProvided: true,
        },
        {
          id: 'google',
          name: 'Google',
          enabled: true,
          models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'],
          defaultModel: 'gemini-1.5-flash',
          features: {
            streaming: true,
            vision: true,
            functionCalling: true,
            codeInterpreter: false,
            retrieval: false,
          },
          userProvided: true,
        },
      ],
    },
  })
})

/**
 * GET /models
 * Get available models grouped by endpoint
 */
config.get('/models', async (c) => {
  // TODO: Implement models configuration
  // 1. Load model specifications from configuration
  // 2. Group models by endpoint
  // 3. Include pricing and capability information
  // 4. Return models map
  
  return c.json({
    success: true,
    data: {
      models: {
        openAI: [
          {
            id: 'gpt-4o',
            name: 'GPT-4o',
            maxTokens: 16384,
            contextWindow: 128000,
            pricing: { input: 2.50, output: 10.00 },
            capabilities: { vision: true, functionCalling: true, streaming: true, json: true },
          },
          {
            id: 'gpt-4o-mini',
            name: 'GPT-4o Mini',
            maxTokens: 16384,
            contextWindow: 128000,
            pricing: { input: 0.15, output: 0.60 },
            capabilities: { vision: true, functionCalling: true, streaming: true, json: true },
          },
          {
            id: 'gpt-4-turbo',
            name: 'GPT-4 Turbo',
            maxTokens: 4096,
            contextWindow: 128000,
            pricing: { input: 10.00, output: 30.00 },
            capabilities: { vision: true, functionCalling: true, streaming: true, json: true },
          },
          {
            id: 'gpt-3.5-turbo',
            name: 'GPT-3.5 Turbo',
            maxTokens: 4096,
            contextWindow: 16385,
            pricing: { input: 0.50, output: 1.50 },
            capabilities: { vision: false, functionCalling: true, streaming: true, json: true },
          },
        ],
        anthropic: [
          {
            id: 'claude-3-5-sonnet-20241022',
            name: 'Claude 3.5 Sonnet',
            maxTokens: 8192,
            contextWindow: 200000,
            pricing: { input: 3.00, output: 15.00 },
            capabilities: { vision: true, functionCalling: true, streaming: true },
          },
          {
            id: 'claude-3-opus-20240229',
            name: 'Claude 3 Opus',
            maxTokens: 4096,
            contextWindow: 200000,
            pricing: { input: 15.00, output: 75.00 },
            capabilities: { vision: true, functionCalling: true, streaming: true },
          },
          {
            id: 'claude-3-haiku-20240307',
            name: 'Claude 3 Haiku',
            maxTokens: 4096,
            contextWindow: 200000,
            pricing: { input: 0.25, output: 1.25 },
            capabilities: { vision: true, functionCalling: true, streaming: true },
          },
        ],
        google: [
          {
            id: 'gemini-1.5-pro',
            name: 'Gemini 1.5 Pro',
            maxTokens: 8192,
            contextWindow: 2097152,
            pricing: { input: 1.25, output: 5.00 },
            capabilities: { vision: true, functionCalling: true, streaming: true },
          },
          {
            id: 'gemini-1.5-flash',
            name: 'Gemini 1.5 Flash',
            maxTokens: 8192,
            contextWindow: 1048576,
            pricing: { input: 0.075, output: 0.30 },
            capabilities: { vision: true, functionCalling: true, streaming: true },
          },
          {
            id: 'gemini-1.0-pro',
            name: 'Gemini 1.0 Pro',
            maxTokens: 8192,
            contextWindow: 32760,
            pricing: { input: 0.50, output: 1.50 },
            capabilities: { vision: false, functionCalling: true, streaming: true },
          },
        ],
      },
    },
  })
})

/**
 * GET /startup
 * Get startup configuration (called once on app load)
 */
config.get('/startup', async (c) => {
  // TODO: Implement startup configuration
  // Combines config, endpoints, and user info if authenticated
  
  return c.json({
    success: true,
    data: {
      appTitle: c.env.APP_NAME || 'LibreChat',
      appVersion: '0.0.1',
      // Additional startup data
    },
  })
})

export { config }
export default config
