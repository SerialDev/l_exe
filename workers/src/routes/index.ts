/**
 * Routes index
 * Combines all routes into a single router
 */

import { Hono } from 'hono'

// Import route modules
import { auth } from './auth'
import { user } from './user'
import { conversations } from './conversations'
import { messages } from './messages'
import { presets } from './presets'
import { files } from './files'
import { agents } from './agents'
import { search } from './search'
import { config } from './config'
import { share } from './share'
import { tags } from './tags'
import { prompts } from './prompts'
import { balance } from './balance'
import { mcp } from './mcp'
import { migrate } from './migrate'
import { chat } from './chat'
import { code } from './code'
import { artifacts } from './artifacts'
import { memory } from './memory'
import { speech } from './speech'
import { images } from './images'
import { importexport } from './importexport'
import { convsearch } from './convsearch'

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

// Context variables (set by auth middleware)
interface Variables {
  userId: string
  user: {
    id: string
    email: string
    username: string
    name: string
    role: 'user' | 'admin'
  }
}

// Create main API router
const api = new Hono<{ Bindings: Env; Variables: Variables }>()

// TODO: Add authentication middleware for protected routes
// import { authMiddleware } from '../middleware/auth'
// api.use('/user/*', authMiddleware)
// api.use('/convos/*', authMiddleware)
// api.use('/messages/*', authMiddleware)
// api.use('/presets/*', authMiddleware)
// api.use('/files/*', authMiddleware)
// api.use('/agents/*', authMiddleware)
// api.use('/search/*', authMiddleware)
// api.use('/share/*', authMiddleware)
// api.use('/tags/*', authMiddleware)
// api.use('/prompts/*', authMiddleware)
// api.use('/balance/*', authMiddleware)
// api.use('/mcp/*', authMiddleware)

// Mount route modules
api.route('/auth', auth)
api.route('/user', user)
api.route('/convos', conversations)
api.route('/messages', messages)
api.route('/presets', presets)
api.route('/files', files)
api.route('/agents', agents)
api.route('/search', search)
api.route('/config', config)
api.route('/share', share)
api.route('/tags', tags)
api.route('/prompts', prompts)
api.route('/balance', balance)
api.route('/mcp', mcp)
api.route('/migrate', migrate)
api.route('/chat', chat)
api.route('/code', code)
api.route('/artifacts', artifacts)
api.route('/memory', memory)
api.route('/speech', speech)
api.route('/images', images)
api.route('/data', importexport)  // Handles both /data/import/* and /data/export/*
api.route('/convsearch', convsearch)

// API health check
api.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
})

// Export individual routes for selective use
export {
  auth,
  user,
  conversations,
  messages,
  presets,
  files,
  agents,
  search,
  config,
  share,
  tags,
  prompts,
  balance,
  mcp,
  migrate,
  chat,
  code,
  artifacts,
  memory,
  speech,
  images,
  importexport,
  convsearch,
}

// Export combined API router
export { api }
export default api
