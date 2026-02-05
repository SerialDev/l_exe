/**
 * Share routes
 * Conversation sharing functionality
 * GET /:shareId, GET /, GET /link/:conversationId
 * POST /:conversationId, PATCH /:shareId, DELETE /:shareId
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { generateUUID } from '../services/crypto'

// Types for Cloudflare bindings
interface Env {
  DB: D1Database
  SESSIONS: KVNamespace
  CACHE: KVNamespace
  JWT_SECRET: string
  ALLOW_SHARED_LINKS?: string
  ALLOW_SHARED_LINKS_PUBLIC?: string
}

// Context variables (set by auth middleware)
interface Variables {
  userId: string
}

// Database row types
interface SharedLinkRow {
  id: string
  user_id: string
  conversation_id: string
  share_id: string
  title: string | null
  is_public: number
  created_at: string
  updated_at: string
}

interface MessageRow {
  id: string
  conversation_id: string
  parent_message_id: string | null
  role: string
  content: string
  model: string | null
  endpoint: string | null
  created_at: string
}

// Request schemas
const createShareSchema = z.object({
  targetMessageId: z.string().optional(),
})

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  pageSize: z.coerce.number().min(1).max(50).default(10),
  isPublic: z.enum(['true', 'false']).optional(),
  sortBy: z.enum(['createdAt', 'title']).default('createdAt'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
})

// Helper to check if feature is enabled
function isEnabled(value: string | undefined): boolean {
  return value === undefined || value === 'true' || value === '1'
}

// Create router
const share = new Hono<{ Bindings: Env; Variables: Variables }>()

/**
 * GET /:shareId
 * Get shared conversation messages (public or authenticated)
 */
share.get('/:shareId', async (c) => {
  const { shareId } = c.req.param()
  const allowPublic = isEnabled(c.env.ALLOW_SHARED_LINKS_PUBLIC)
  
  // Get the shared link
  const sharedLink = await c.env.DB
    .prepare(`
      SELECT sl.*, c.title
      FROM shared_links sl
      JOIN conversations c ON c.id = sl.conversation_id
      WHERE sl.share_id = ?
    `)
    .bind(shareId)
    .first<SharedLinkRow & { title: string | null }>()
  
  if (!sharedLink) {
    return c.json({ success: false, error: 'Shared link not found' }, 404)
  }
  
  // Check if public access is allowed
  if (!allowPublic && !sharedLink.is_public) {
    // Need authentication
    const userId = c.get('userId')
    if (!userId) {
      return c.json({ success: false, error: 'Authentication required' }, 401)
    }
  }
  
  // Get messages for the conversation
  const messages = await c.env.DB
    .prepare(`
      SELECT id, conversation_id, parent_message_id, role, content, model, endpoint, created_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `)
    .bind(sharedLink.conversation_id)
    .all<MessageRow>()
  
  return c.json({
    success: true,
    data: {
      shareId: sharedLink.share_id,
      title: sharedLink.title,
      isPublic: sharedLink.is_public === 1,
      createdAt: sharedLink.created_at,
      messages: messages.results?.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        model: m.model,
        createdAt: m.created_at,
      })) || [],
    },
  })
})

/**
 * GET /
 * List user's shared links
 */
share.get('/', zValidator('query', listQuerySchema), async (c) => {
  const userId = c.get('userId')
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401)
  }
  
  const { cursor, pageSize, isPublic, sortBy, sortDirection, search } = c.req.valid('query')
  
  let query = `
    SELECT sl.*, c.title
    FROM shared_links sl
    JOIN conversations c ON c.id = sl.conversation_id
    WHERE sl.user_id = ?
  `
  const params: (string | number)[] = [userId]
  
  // Filter by public status
  if (isPublic !== undefined) {
    query += ' AND sl.is_public = ?'
    params.push(isPublic === 'true' ? 1 : 0)
  }
  
  // Search filter
  if (search) {
    query += ' AND c.title LIKE ?'
    params.push(`%${search}%`)
  }
  
  // Cursor pagination
  if (cursor) {
    const cursorOp = sortDirection === 'desc' ? '<' : '>'
    query += ` AND sl.${sortBy} ${cursorOp} ?`
    params.push(cursor)
  }
  
  // Order and limit
  query += ` ORDER BY sl.${sortBy} ${sortDirection.toUpperCase()} LIMIT ?`
  params.push(pageSize + 1) // Get one extra to check for more
  
  const results = await c.env.DB
    .prepare(query)
    .bind(...params)
    .all<SharedLinkRow & { title: string | null }>()
  
  const links = results.results || []
  const hasNextPage = links.length > pageSize
  
  if (hasNextPage) {
    links.pop() // Remove extra item
  }
  
  const nextCursor = hasNextPage && links.length > 0
    ? links[links.length - 1][sortBy === 'createdAt' ? 'created_at' : 'title']
    : null
  
  return c.json({
    success: true,
    data: {
      links: links.map(link => ({
        id: link.id,
        shareId: link.share_id,
        conversationId: link.conversation_id,
        title: link.title,
        isPublic: link.is_public === 1,
        createdAt: link.created_at,
        updatedAt: link.updated_at,
      })),
      nextCursor,
      hasNextPage,
    },
  })
})

/**
 * GET /link/:conversationId
 * Get existing share link for a conversation
 */
share.get('/link/:conversationId', async (c) => {
  const userId = c.get('userId')
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401)
  }
  
  const { conversationId } = c.req.param()
  
  // Verify conversation ownership
  const conversation = await c.env.DB
    .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
    .bind(conversationId, userId)
    .first()
  
  if (!conversation) {
    return c.json({ success: false, error: 'Conversation not found' }, 404)
  }
  
  // Get existing share link
  const sharedLink = await c.env.DB
    .prepare('SELECT * FROM shared_links WHERE conversation_id = ? AND user_id = ?')
    .bind(conversationId, userId)
    .first<SharedLinkRow>()
  
  return c.json({
    success: true,
    data: {
      exists: !!sharedLink,
      shareId: sharedLink?.share_id || null,
      conversationId,
    },
  })
})

/**
 * POST /:conversationId
 * Create a new share link for a conversation
 */
share.post('/:conversationId', zValidator('json', createShareSchema), async (c) => {
  const userId = c.get('userId')
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401)
  }
  
  if (!isEnabled(c.env.ALLOW_SHARED_LINKS)) {
    return c.json({ success: false, error: 'Sharing is disabled' }, 403)
  }
  
  const { conversationId } = c.req.param()
  const { targetMessageId } = c.req.valid('json')
  
  // Verify conversation ownership
  const conversation = await c.env.DB
    .prepare('SELECT id, title FROM conversations WHERE id = ? AND user_id = ?')
    .bind(conversationId, userId)
    .first<{ id: string; title: string | null }>()
  
  if (!conversation) {
    return c.json({ success: false, error: 'Conversation not found' }, 404)
  }
  
  // Check if share link already exists
  const existing = await c.env.DB
    .prepare('SELECT * FROM shared_links WHERE conversation_id = ? AND user_id = ?')
    .bind(conversationId, userId)
    .first<SharedLinkRow>()
  
  if (existing) {
    // Update existing link
    const now = new Date().toISOString()
    await c.env.DB
      .prepare('UPDATE shared_links SET updated_at = ? WHERE id = ?')
      .bind(now, existing.id)
      .run()
    
    return c.json({
      success: true,
      data: {
        id: existing.id,
        shareId: existing.share_id,
        conversationId,
        title: conversation.title,
        isPublic: existing.is_public === 1,
        createdAt: existing.created_at,
        updatedAt: now,
      },
    })
  }
  
  // Create new share link
  const id = generateUUID()
  const shareId = generateUUID().replace(/-/g, '').slice(0, 16) // Short share ID
  const now = new Date().toISOString()
  
  await c.env.DB
    .prepare(`
      INSERT INTO shared_links (id, user_id, conversation_id, share_id, is_public, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(id, userId, conversationId, shareId, 1, now, now)
    .run()
  
  return c.json({
    success: true,
    data: {
      id,
      shareId,
      conversationId,
      title: conversation.title,
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    },
  }, 201)
})

/**
 * PATCH /:shareId
 * Update share link (toggle public/private)
 */
share.patch('/:shareId', async (c) => {
  const userId = c.get('userId')
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401)
  }
  
  const { shareId } = c.req.param()
  
  // Get existing share link
  const sharedLink = await c.env.DB
    .prepare('SELECT * FROM shared_links WHERE share_id = ? AND user_id = ?')
    .bind(shareId, userId)
    .first<SharedLinkRow>()
  
  if (!sharedLink) {
    return c.json({ success: false, error: 'Share link not found' }, 404)
  }
  
  // Toggle public status
  const newIsPublic = sharedLink.is_public === 1 ? 0 : 1
  const now = new Date().toISOString()
  
  await c.env.DB
    .prepare('UPDATE shared_links SET is_public = ?, updated_at = ? WHERE id = ?')
    .bind(newIsPublic, now, sharedLink.id)
    .run()
  
  return c.json({
    success: true,
    data: {
      id: sharedLink.id,
      shareId: sharedLink.share_id,
      conversationId: sharedLink.conversation_id,
      isPublic: newIsPublic === 1,
      updatedAt: now,
    },
  })
})

/**
 * DELETE /:shareId
 * Delete a share link
 */
share.delete('/:shareId', async (c) => {
  const userId = c.get('userId')
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401)
  }
  
  const { shareId } = c.req.param()
  
  // Verify ownership and delete
  const result = await c.env.DB
    .prepare('DELETE FROM shared_links WHERE share_id = ? AND user_id = ?')
    .bind(shareId, userId)
    .run()
  
  if (!result.meta.changes || result.meta.changes === 0) {
    return c.json({ success: false, error: 'Share link not found' }, 404)
  }
  
  return c.json({
    success: true,
    data: { deleted: true, shareId },
  })
})

export { share }
export default share
