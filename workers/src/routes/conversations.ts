/**
 * Conversations routes
 * GET /, GET /:id, POST /, PATCH /:id, DELETE /:id
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { AuthContext } from '../middleware/auth';

// Types for Cloudflare bindings
interface Env {
  DB: D1Database;
  FILES_BUCKET: R2Bucket;
  SESSIONS: KVNamespace;
  JWT_SECRET: string;
}

// Context variables (set by auth middleware)
interface Variables {
  user: AuthContext['user'];
}

// Request schemas
const createConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  endpoint: z.string(),
  model: z.string(),
  systemMessage: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
});

const updateConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  isArchived: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

// Import schema - for importing conversations from JSON
const importConversationSchema = z.object({
  conversations: z.array(z.object({
    title: z.string().optional(),
    endpoint: z.string().optional().default('openai'),
    model: z.string().optional().default('gpt-4'),
    systemMessage: z.string().optional(),
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string(),
      createdAt: z.string().optional(),
    })),
    createdAt: z.string().optional(),
  })),
});

// Fork schema - fork from a specific message
const forkConversationSchema = z.object({
  messageId: z.string(),
  title: z.string().optional(),
  includeSystemMessage: z.boolean().default(true),
});

// Duplicate schema
const duplicateConversationSchema = z.object({
  title: z.string().optional(),
});

const listConversationsSchema = z.object({
  page: z.coerce.number().positive().default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'title']).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// Create router
const conversations = new Hono<{ Bindings: Env; Variables: Variables }>();

// Helper to get user from context
function getUser(c: any): AuthContext['user'] | null {
  return c.get('user') || null;
}

// Helper to generate UUID
function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * GET /
 * List user's conversations with pagination
 */
conversations.get('/', zValidator('query', listConversationsSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const { page, pageSize, search, sortBy, sortOrder } = c.req.valid('query');
  const offset = (page - 1) * pageSize;

  try {
    // Build query - note: our schema uses 'id' as the conversation identifier
    let query = `
      SELECT 
        c.id,
        c.id as conversationId,
        c.title,
        c.endpoint,
        c.model,
        c.created_at as createdAt,
        c.updated_at as updatedAt,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as messageCount
      FROM conversations c
      WHERE c.user_id = ?
    `;
    const params: any[] = [user.id];

    if (search) {
      query += ` AND c.title LIKE ?`;
      params.push(`%${search}%`);
    }

    // Count total
    const countQuery = `SELECT COUNT(*) as total FROM conversations WHERE user_id = ?${search ? ' AND title LIKE ?' : ''}`;
    const countParams = search ? [user.id, `%${search}%`] : [user.id];
    const countResult = await c.env.DB.prepare(countQuery).bind(...countParams).first<{ total: number }>();
    const total = countResult?.total || 0;

    // Add sorting and pagination
    const sortColumn = sortBy === 'createdAt' ? 'created_at' : sortBy === 'updatedAt' ? 'updated_at' : 'title';
    query += ` ORDER BY ${sortColumn} ${sortOrder.toUpperCase()} LIMIT ? OFFSET ?`;
    params.push(pageSize, offset);

    const result = await c.env.DB.prepare(query).bind(...params).all();

    return c.json({
      success: true,
      conversations: result.results || [],
      total,
      page,
      pageSize,
      hasMore: offset + pageSize < total,
    });
  } catch (error) {
    console.error('List conversations error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to fetch conversations' },
    }, 500);
  }
});

/**
 * GET /:id
 * Get a specific conversation
 */
conversations.get('/:id', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const conversationId = c.req.param('id');

  try {
    const conversation = await c.env.DB
      .prepare(`
        SELECT 
          id,
          conversation_id as conversationId,
          user_id as userId,
          title,
          endpoint,
          model,
          system_message as systemMessage,
          temperature,
          max_tokens as maxTokens,
          created_at as createdAt,
          updated_at as updatedAt
        FROM conversations 
        WHERE (id = ? OR conversation_id = ?) AND user_id = ?
      `)
      .bind(conversationId, conversationId, user.id)
      .first();

    if (!conversation) {
      return c.json({
        success: false,
        error: { message: 'Conversation not found' },
      }, 404);
    }

    return c.json({
      success: true,
      ...conversation,
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to fetch conversation' },
    }, 500);
  }
});

/**
 * POST /
 * Create a new conversation
 */
conversations.post('/', zValidator('json', createConversationSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const data = c.req.valid('json');
  const id = generateUUID();
  const conversationId = generateUUID();
  const now = new Date().toISOString();
  const title = data.title || 'New Conversation';

  try {
    await c.env.DB
      .prepare(`
        INSERT INTO conversations (
          id, conversation_id, user_id, title, endpoint, model, 
          system_message, temperature, max_tokens, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        conversationId,
        user.id,
        title,
        data.endpoint,
        data.model,
        data.systemMessage || null,
        data.temperature || 0.7,
        data.maxTokens || null,
        now,
        now
      )
      .run();

    return c.json({
      success: true,
      id,
      conversationId,
      userId: user.id,
      title,
      endpoint: data.endpoint,
      model: data.model,
      systemMessage: data.systemMessage || null,
      temperature: data.temperature || 0.7,
      maxTokens: data.maxTokens || null,
      createdAt: now,
      updatedAt: now,
    }, 201);
  } catch (error) {
    console.error('Create conversation error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to create conversation' },
    }, 500);
  }
});

/**
 * PATCH /:id
 * Update conversation metadata
 */
conversations.patch('/:id', zValidator('json', updateConversationSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const conversationId = c.req.param('id');
  const updates = c.req.valid('json');
  const now = new Date().toISOString();

  try {
    // Verify ownership
    const existing = await c.env.DB
      .prepare('SELECT id FROM conversations WHERE (id = ? OR conversation_id = ?) AND user_id = ?')
      .bind(conversationId, conversationId, user.id)
      .first();

    if (!existing) {
      return c.json({
        success: false,
        error: { message: 'Conversation not found' },
      }, 404);
    }

    // Update
    await c.env.DB
      .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
      .bind(updates.title, now, existing.id)
      .run();

    // Fetch updated
    const updated = await c.env.DB
      .prepare(`
        SELECT 
          id,
          conversation_id as conversationId,
          title,
          endpoint,
          model,
          created_at as createdAt,
          updated_at as updatedAt
        FROM conversations WHERE id = ?
      `)
      .bind(existing.id)
      .first();

    return c.json({
      success: true,
      ...updated,
    });
  } catch (error) {
    console.error('Update conversation error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to update conversation' },
    }, 500);
  }
});

/**
 * DELETE /:id
 * Delete a conversation and its messages
 */
conversations.delete('/:id', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const conversationId = c.req.param('id');

  try {
    // Verify ownership and get conversation_id
    const existing = await c.env.DB
      .prepare('SELECT id, conversation_id FROM conversations WHERE (id = ? OR conversation_id = ?) AND user_id = ?')
      .bind(conversationId, conversationId, user.id)
      .first<{ id: string; conversation_id: string }>();

    if (!existing) {
      return c.json({
        success: false,
        error: { message: 'Conversation not found' },
      }, 404);
    }

    // Delete messages first (foreign key)
    await c.env.DB
      .prepare('DELETE FROM messages WHERE conversation_id = ?')
      .bind(existing.conversation_id)
      .run();

    // Delete conversation
    await c.env.DB
      .prepare('DELETE FROM conversations WHERE id = ?')
      .bind(existing.id)
      .run();

    return c.json({
      success: true,
      message: 'Conversation deleted',
    });
  } catch (error) {
    console.error('Delete conversation error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to delete conversation' },
    }, 500);
  }
});

/**
 * POST /import
 * Import conversations from JSON (LibreChat export format)
 */
conversations.post('/import', zValidator('json', importConversationSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const { conversations: convosToImport } = c.req.valid('json');
  const imported: { id: string; conversationId: string; title: string }[] = [];
  const errors: { index: number; error: string }[] = [];

  try {
    for (let i = 0; i < convosToImport.length; i++) {
      const convo = convosToImport[i];
      
      try {
        const id = generateUUID();
        const conversationId = generateUUID();
        const now = new Date().toISOString();
        const title = convo.title || `Imported Conversation ${i + 1}`;

        // Create conversation
        await c.env.DB
          .prepare(`
            INSERT INTO conversations (
              id, conversation_id, user_id, title, endpoint, model, 
              system_message, temperature, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .bind(
            id,
            conversationId,
            user.id,
            title,
            convo.endpoint || 'openai',
            convo.model || 'gpt-4',
            convo.systemMessage || null,
            0.7,
            convo.createdAt || now,
            now
          )
          .run();

        // Create messages
        let parentMessageId: string | null = null;
        for (const msg of convo.messages) {
          const messageId = generateUUID();
          const msgCreatedAt = msg.createdAt || now;

          await c.env.DB
            .prepare(`
              INSERT INTO messages (
                id, conversation_id, parent_message_id, role, content, 
                model, endpoint, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .bind(
              messageId,
              conversationId,
              parentMessageId,
              msg.role,
              msg.content,
              convo.model || 'gpt-4',
              convo.endpoint || 'openai',
              msgCreatedAt
            )
            .run();

          parentMessageId = messageId;
        }

        imported.push({ id, conversationId, title });
      } catch (err) {
        errors.push({
          index: i,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return c.json({
      success: true,
      imported,
      errors,
      total: convosToImport.length,
      successCount: imported.length,
      errorCount: errors.length,
    });
  } catch (error) {
    console.error('Import conversations error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to import conversations' },
    }, 500);
  }
});

/**
 * POST /:id/fork
 * Fork a conversation from a specific message
 * Creates a new conversation with messages up to and including the specified message
 */
conversations.post('/:id/fork', zValidator('json', forkConversationSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const conversationId = c.req.param('id');
  const { messageId, title, includeSystemMessage } = c.req.valid('json');

  try {
    // Get original conversation
    const original = await c.env.DB
      .prepare(`
        SELECT * FROM conversations 
        WHERE (id = ? OR conversation_id = ?) AND user_id = ?
      `)
      .bind(conversationId, conversationId, user.id)
      .first<{
        id: string;
        conversation_id: string;
        title: string;
        endpoint: string;
        model: string;
        system_message: string | null;
        temperature: number;
        max_tokens: number | null;
      }>();

    if (!original) {
      return c.json({
        success: false,
        error: { message: 'Conversation not found' },
      }, 404);
    }

    // Verify the message exists and belongs to this conversation
    const targetMessage = await c.env.DB
      .prepare('SELECT id, created_at FROM messages WHERE id = ? AND conversation_id = ?')
      .bind(messageId, original.conversation_id)
      .first<{ id: string; created_at: string }>();

    if (!targetMessage) {
      return c.json({
        success: false,
        error: { message: 'Message not found in this conversation' },
      }, 404);
    }

    // Get all messages up to and including the target message
    const messages = await c.env.DB
      .prepare(`
        SELECT id, parent_message_id, role, content, model, endpoint, created_at
        FROM messages 
        WHERE conversation_id = ? AND created_at <= ?
        ORDER BY created_at ASC
      `)
      .bind(original.conversation_id, targetMessage.created_at)
      .all<{
        id: string;
        parent_message_id: string | null;
        role: string;
        content: string;
        model: string | null;
        endpoint: string | null;
        created_at: string;
      }>();

    // Create new conversation
    const newId = generateUUID();
    const newConversationId = generateUUID();
    const now = new Date().toISOString();
    const newTitle = title || `Fork of ${original.title}`;

    await c.env.DB
      .prepare(`
        INSERT INTO conversations (
          id, conversation_id, user_id, title, endpoint, model, 
          system_message, temperature, max_tokens, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        newId,
        newConversationId,
        user.id,
        newTitle,
        original.endpoint,
        original.model,
        includeSystemMessage ? original.system_message : null,
        original.temperature,
        original.max_tokens,
        now,
        now
      )
      .run();

    // Copy messages with new IDs
    const idMap = new Map<string, string>();
    for (const msg of messages.results || []) {
      const newMessageId = generateUUID();
      idMap.set(msg.id, newMessageId);

      const newParentId = msg.parent_message_id 
        ? idMap.get(msg.parent_message_id) || null 
        : null;

      await c.env.DB
        .prepare(`
          INSERT INTO messages (
            id, conversation_id, parent_message_id, role, content, 
            model, endpoint, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          newMessageId,
          newConversationId,
          newParentId,
          msg.role,
          msg.content,
          msg.model,
          msg.endpoint,
          msg.created_at
        )
        .run();
    }

    return c.json({
      success: true,
      id: newId,
      conversationId: newConversationId,
      title: newTitle,
      forkedFrom: {
        conversationId: original.conversation_id,
        messageId,
      },
      messageCount: (messages.results || []).length,
      createdAt: now,
    }, 201);
  } catch (error) {
    console.error('Fork conversation error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to fork conversation' },
    }, 500);
  }
});

/**
 * POST /:id/duplicate
 * Create a complete copy of a conversation
 */
conversations.post('/:id/duplicate', zValidator('json', duplicateConversationSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const conversationId = c.req.param('id');
  const { title } = c.req.valid('json');

  try {
    // Get original conversation
    const original = await c.env.DB
      .prepare(`
        SELECT * FROM conversations 
        WHERE (id = ? OR conversation_id = ?) AND user_id = ?
      `)
      .bind(conversationId, conversationId, user.id)
      .first<{
        id: string;
        conversation_id: string;
        title: string;
        endpoint: string;
        model: string;
        system_message: string | null;
        temperature: number;
        max_tokens: number | null;
        tags: string | null;
      }>();

    if (!original) {
      return c.json({
        success: false,
        error: { message: 'Conversation not found' },
      }, 404);
    }

    // Get all messages
    const messages = await c.env.DB
      .prepare(`
        SELECT id, parent_message_id, role, content, model, endpoint, token_count, created_at
        FROM messages 
        WHERE conversation_id = ?
        ORDER BY created_at ASC
      `)
      .bind(original.conversation_id)
      .all<{
        id: string;
        parent_message_id: string | null;
        role: string;
        content: string;
        model: string | null;
        endpoint: string | null;
        token_count: number | null;
        created_at: string;
      }>();

    // Create new conversation
    const newId = generateUUID();
    const newConversationId = generateUUID();
    const now = new Date().toISOString();
    const newTitle = title || `Copy of ${original.title}`;

    await c.env.DB
      .prepare(`
        INSERT INTO conversations (
          id, conversation_id, user_id, title, endpoint, model, 
          system_message, temperature, max_tokens, tags, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        newId,
        newConversationId,
        user.id,
        newTitle,
        original.endpoint,
        original.model,
        original.system_message,
        original.temperature,
        original.max_tokens,
        original.tags,
        now,
        now
      )
      .run();

    // Copy messages with new IDs
    const idMap = new Map<string, string>();
    for (const msg of messages.results || []) {
      const newMessageId = generateUUID();
      idMap.set(msg.id, newMessageId);

      const newParentId = msg.parent_message_id 
        ? idMap.get(msg.parent_message_id) || null 
        : null;

      await c.env.DB
        .prepare(`
          INSERT INTO messages (
            id, conversation_id, parent_message_id, role, content, 
            model, endpoint, token_count, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          newMessageId,
          newConversationId,
          newParentId,
          msg.role,
          msg.content,
          msg.model,
          msg.endpoint,
          msg.token_count,
          msg.created_at
        )
        .run();
    }

    return c.json({
      success: true,
      id: newId,
      conversationId: newConversationId,
      title: newTitle,
      duplicatedFrom: original.conversation_id,
      messageCount: (messages.results || []).length,
      createdAt: now,
    }, 201);
  } catch (error) {
    console.error('Duplicate conversation error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to duplicate conversation' },
    }, 500);
  }
});

/**
 * POST /:id/archive
 * Archive/unarchive a conversation
 */
conversations.post('/:id/archive', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const conversationId = c.req.param('id');

  try {
    // Get current archive status
    const existing = await c.env.DB
      .prepare(`
        SELECT id, is_archived FROM conversations 
        WHERE (id = ? OR conversation_id = ?) AND user_id = ?
      `)
      .bind(conversationId, conversationId, user.id)
      .first<{ id: string; is_archived: number }>();

    if (!existing) {
      return c.json({
        success: false,
        error: { message: 'Conversation not found' },
      }, 404);
    }

    // Toggle archive status
    const newStatus = existing.is_archived === 1 ? 0 : 1;
    const now = new Date().toISOString();

    await c.env.DB
      .prepare('UPDATE conversations SET is_archived = ?, updated_at = ? WHERE id = ?')
      .bind(newStatus, now, existing.id)
      .run();

    return c.json({
      success: true,
      id: existing.id,
      isArchived: newStatus === 1,
      message: newStatus === 1 ? 'Conversation archived' : 'Conversation unarchived',
    });
  } catch (error) {
    console.error('Archive conversation error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to archive conversation' },
    }, 500);
  }
});

/**
 * POST /:id/pin
 * Pin/unpin a conversation (toggle)
 */
conversations.post('/:id/pin', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const conversationId = c.req.param('id');

  try {
    // Get current pin status
    const existing = await c.env.DB
      .prepare(`
        SELECT id, is_pinned FROM conversations 
        WHERE (id = ? OR conversation_id = ?) AND user_id = ?
      `)
      .bind(conversationId, conversationId, user.id)
      .first<{ id: string; is_pinned: number }>();

    if (!existing) {
      return c.json({
        success: false,
        error: { message: 'Conversation not found' },
      }, 404);
    }

    // Toggle pin status
    const newStatus = existing.is_pinned === 1 ? 0 : 1;
    const now = new Date().toISOString();

    await c.env.DB
      .prepare('UPDATE conversations SET is_pinned = ?, updated_at = ? WHERE id = ?')
      .bind(newStatus, now, existing.id)
      .run();

    return c.json({
      success: true,
      id: existing.id,
      isPinned: newStatus === 1,
      message: newStatus === 1 ? 'Conversation pinned' : 'Conversation unpinned',
    });
  } catch (error) {
    console.error('Pin conversation error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to pin conversation' },
    }, 500);
  }
});

/**
 * GET /pinned
 * List pinned conversations
 */
conversations.get('/pinned', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  try {
    const result = await c.env.DB
      .prepare(`
        SELECT 
          c.id,
          c.id as conversationId,
          c.title,
          c.endpoint,
          c.model,
          c.created_at as createdAt,
          c.updated_at as updatedAt,
          (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as messageCount
        FROM conversations c
        WHERE c.user_id = ? AND c.is_pinned = 1
        ORDER BY c.updated_at DESC
      `)
      .bind(user.id)
      .all();

    return c.json({
      success: true,
      conversations: result.results || [],
      total: result.results?.length || 0,
    });
  } catch (error) {
    console.error('List pinned conversations error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to fetch pinned conversations' },
    }, 500);
  }
});

/**
 * GET /export/:id
 * Export a conversation as JSON
 */
conversations.get('/export/:id', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const conversationId = c.req.param('id');

  try {
    // Get conversation
    const conversation = await c.env.DB
      .prepare(`
        SELECT 
          id, conversation_id, title, endpoint, model, 
          system_message, temperature, max_tokens, tags,
          created_at, updated_at
        FROM conversations 
        WHERE (id = ? OR conversation_id = ?) AND user_id = ?
      `)
      .bind(conversationId, conversationId, user.id)
      .first<{
        id: string;
        conversation_id: string;
        title: string;
        endpoint: string;
        model: string;
        system_message: string | null;
        temperature: number;
        max_tokens: number | null;
        tags: string | null;
        created_at: string;
        updated_at: string;
      }>();

    if (!conversation) {
      return c.json({
        success: false,
        error: { message: 'Conversation not found' },
      }, 404);
    }

    // Get messages
    const messages = await c.env.DB
      .prepare(`
        SELECT id, parent_message_id, role, content, model, endpoint, token_count, created_at
        FROM messages 
        WHERE conversation_id = ?
        ORDER BY created_at ASC
      `)
      .bind(conversation.conversation_id)
      .all<{
        id: string;
        parent_message_id: string | null;
        role: string;
        content: string;
        model: string | null;
        endpoint: string | null;
        token_count: number | null;
        created_at: string;
      }>();

    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      conversation: {
        id: conversation.id,
        conversationId: conversation.conversation_id,
        title: conversation.title,
        endpoint: conversation.endpoint,
        model: conversation.model,
        systemMessage: conversation.system_message,
        temperature: conversation.temperature,
        maxTokens: conversation.max_tokens,
        tags: conversation.tags ? JSON.parse(conversation.tags) : [],
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
      },
      messages: (messages.results || []).map(m => ({
        id: m.id,
        parentMessageId: m.parent_message_id,
        role: m.role,
        content: m.content,
        model: m.model,
        endpoint: m.endpoint,
        tokenCount: m.token_count,
        createdAt: m.created_at,
      })),
    };

    // Set headers for file download
    c.header('Content-Type', 'application/json');
    c.header('Content-Disposition', `attachment; filename="conversation-${conversation.conversation_id}.json"`);

    return c.json(exportData);
  } catch (error) {
    console.error('Export conversation error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to export conversation' },
    }, 500);
  }
});

/**
 * DELETE /
 * Batch delete conversations
 */
conversations.delete('/', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  try {
    const body = await c.req.json<{ conversationIds: string[] }>();
    const { conversationIds } = body;

    if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
      return c.json({
        success: false,
        error: { message: 'conversationIds array is required' },
      }, 400);
    }

    // Limit batch size
    if (conversationIds.length > 100) {
      return c.json({
        success: false,
        error: { message: 'Maximum 100 conversations per batch' },
      }, 400);
    }

    let deleted = 0;
    const errors: { id: string; error: string }[] = [];

    for (const convId of conversationIds) {
      try {
        // Verify ownership
        const existing = await c.env.DB
          .prepare('SELECT id, conversation_id FROM conversations WHERE (id = ? OR conversation_id = ?) AND user_id = ?')
          .bind(convId, convId, user.id)
          .first<{ id: string; conversation_id: string }>();

        if (existing) {
          // Delete messages
          await c.env.DB
            .prepare('DELETE FROM messages WHERE conversation_id = ?')
            .bind(existing.conversation_id)
            .run();

          // Delete conversation
          await c.env.DB
            .prepare('DELETE FROM conversations WHERE id = ?')
            .bind(existing.id)
            .run();

          deleted++;
        }
      } catch (err) {
        errors.push({
          id: convId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return c.json({
      success: true,
      deleted,
      errors,
      total: conversationIds.length,
    });
  } catch (error) {
    console.error('Batch delete conversations error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to delete conversations' },
    }, 500);
  }
});

export { conversations };
export default conversations;
