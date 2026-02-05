/**
 * Messages routes
 * GET /:conversationId, POST /, PATCH /:id, DELETE /:id
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
const createMessageSchema = z.object({
  conversationId: z.string(),
  parentMessageId: z.string().optional(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  model: z.string().optional(),
  endpoint: z.string().optional(),
});

const updateMessageSchema = z.object({
  content: z.string().optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

const listMessagesSchema = z.object({
  page: z.coerce.number().positive().default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
});

// Branch/regenerate schema
const branchMessageSchema = z.object({
  parentMessageId: z.string(),
  content: z.string(),
  role: z.enum(['user', 'assistant']).default('user'),
});

// Create router
const messages = new Hono<{ Bindings: Env; Variables: Variables }>();

// Helper to get user from context
function getUser(c: any): AuthContext['user'] | null {
  return c.get('user') || null;
}

// Helper to generate UUID
function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * GET /:conversationId
 * List messages in a conversation
 */
messages.get('/:conversationId', zValidator('query', listMessagesSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const conversationId = c.req.param('conversationId');
  const { page, pageSize } = c.req.valid('query');
  const offset = (page - 1) * pageSize;

  try {
    // Verify conversation ownership
    const conversation = await c.env.DB
      .prepare('SELECT id FROM conversations WHERE (id = ? OR conversation_id = ?) AND user_id = ?')
      .bind(conversationId, conversationId, user.id)
      .first();

    if (!conversation) {
      return c.json({
        success: false,
        error: { message: 'Conversation not found' },
      }, 404);
    }

    // Get messages
    const result = await c.env.DB
      .prepare(`
        SELECT 
          id,
          message_id as messageId,
          conversation_id as conversationId,
          parent_message_id as parentMessageId,
          role,
          content,
          model,
          endpoint,
          token_count as tokenCount,
          is_created_by_user as isCreatedByUser,
          created_at as createdAt
        FROM messages 
        WHERE conversation_id = ?
        ORDER BY created_at ASC
        LIMIT ? OFFSET ?
      `)
      .bind(conversationId, pageSize, offset)
      .all();

    // Get total count
    const countResult = await c.env.DB
      .prepare('SELECT COUNT(*) as total FROM messages WHERE conversation_id = ?')
      .bind(conversationId)
      .first<{ total: number }>();

    const total = countResult?.total || 0;

    return c.json({
      success: true,
      messages: result.results || [],
      total,
      page,
      pageSize,
      hasMore: offset + pageSize < total,
    });
  } catch (error) {
    console.error('List messages error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to fetch messages' },
    }, 500);
  }
});

/**
 * POST /
 * Create a new message in a conversation
 */
messages.post('/', zValidator('json', createMessageSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const data = c.req.valid('json');
  const id = generateUUID();
  const messageId = generateUUID();
  const now = new Date().toISOString();

  try {
    // Verify conversation ownership
    const conversation = await c.env.DB
      .prepare('SELECT id, conversation_id FROM conversations WHERE (id = ? OR conversation_id = ?) AND user_id = ?')
      .bind(data.conversationId, data.conversationId, user.id)
      .first<{ id: string; conversation_id: string }>();

    if (!conversation) {
      return c.json({
        success: false,
        error: { message: 'Conversation not found' },
      }, 404);
    }

    // Insert message
    await c.env.DB
      .prepare(`
        INSERT INTO messages (
          id, message_id, conversation_id, parent_message_id, role, content,
          model, endpoint, is_created_by_user, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        messageId,
        conversation.conversation_id,
        data.parentMessageId || null,
        data.role,
        data.content,
        data.model || null,
        data.endpoint || null,
        data.role === 'user' ? 1 : 0,
        now
      )
      .run();

    // Update conversation timestamp
    await c.env.DB
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .bind(now, conversation.id)
      .run();

    return c.json({
      success: true,
      id,
      messageId,
      conversationId: conversation.conversation_id,
      parentMessageId: data.parentMessageId || null,
      role: data.role,
      content: data.content,
      model: data.model || null,
      endpoint: data.endpoint || null,
      isCreatedByUser: data.role === 'user',
      createdAt: now,
    }, 201);
  } catch (error) {
    console.error('Create message error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to create message' },
    }, 500);
  }
});

/**
 * PATCH /:id
 * Update message content
 */
messages.patch('/:id', zValidator('json', updateMessageSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const messageId = c.req.param('id');
  const updates = c.req.valid('json');

  try {
    // Get message and verify ownership through conversation
    const message = await c.env.DB
      .prepare(`
        SELECT m.id, m.conversation_id, m.role
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.conversation_id
        WHERE (m.id = ? OR m.message_id = ?) AND c.user_id = ?
      `)
      .bind(messageId, messageId, user.id)
      .first<{ id: string; conversation_id: string; role: string }>();

    if (!message) {
      return c.json({
        success: false,
        error: { message: 'Message not found' },
      }, 404);
    }

    // Only allow editing user messages
    if (message.role !== 'user') {
      return c.json({
        success: false,
        error: { message: 'Can only edit user messages' },
      }, 403);
    }

    // Update message
    await c.env.DB
      .prepare('UPDATE messages SET content = ? WHERE id = ?')
      .bind(updates.content, message.id)
      .run();

    // Fetch updated
    const updated = await c.env.DB
      .prepare(`
        SELECT 
          id,
          message_id as messageId,
          conversation_id as conversationId,
          parent_message_id as parentMessageId,
          role,
          content,
          model,
          endpoint,
          created_at as createdAt
        FROM messages WHERE id = ?
      `)
      .bind(message.id)
      .first();

    return c.json({
      success: true,
      ...updated,
    });
  } catch (error) {
    console.error('Update message error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to update message' },
    }, 500);
  }
});

/**
 * DELETE /:id
 * Delete a message
 */
messages.delete('/:id', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const messageId = c.req.param('id');

  try {
    // Get message and verify ownership through conversation
    const message = await c.env.DB
      .prepare(`
        SELECT m.id, m.message_id
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.conversation_id
        WHERE (m.id = ? OR m.message_id = ?) AND c.user_id = ?
      `)
      .bind(messageId, messageId, user.id)
      .first<{ id: string; message_id: string }>();

    if (!message) {
      return c.json({
        success: false,
        error: { message: 'Message not found' },
      }, 404);
    }

    // Delete the message
    await c.env.DB
      .prepare('DELETE FROM messages WHERE id = ?')
      .bind(message.id)
      .run();

    return c.json({
      success: true,
      message: 'Message deleted',
    });
  } catch (error) {
    console.error('Delete message error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to delete message' },
    }, 500);
  }
});

/**
 * POST /:conversationId/branch
 * Create a branch (alternative response) from a parent message
 * This enables regeneration and edit-from-here functionality
 */
messages.post('/:conversationId/branch', zValidator('json', branchMessageSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const conversationId = c.req.param('conversationId');
  const { parentMessageId, content, role } = c.req.valid('json');

  try {
    // Verify conversation ownership
    const conversation = await c.env.DB
      .prepare('SELECT id, conversation_id, model, endpoint FROM conversations WHERE (id = ? OR conversation_id = ?) AND user_id = ?')
      .bind(conversationId, conversationId, user.id)
      .first<{ id: string; conversation_id: string; model: string; endpoint: string }>();

    if (!conversation) {
      return c.json({
        success: false,
        error: { message: 'Conversation not found' },
      }, 404);
    }

    // Verify parent message exists in this conversation
    const parentMessage = await c.env.DB
      .prepare('SELECT id, conversation_id FROM messages WHERE (id = ? OR message_id = ?) AND conversation_id = ?')
      .bind(parentMessageId, parentMessageId, conversation.conversation_id)
      .first<{ id: string; conversation_id: string }>();

    if (!parentMessage) {
      return c.json({
        success: false,
        error: { message: 'Parent message not found in this conversation' },
      }, 404);
    }

    // Create the branch message
    const id = generateUUID();
    const messageId = generateUUID();
    const now = new Date().toISOString();

    await c.env.DB
      .prepare(`
        INSERT INTO messages (
          id, message_id, conversation_id, parent_message_id, role, content,
          model, endpoint, is_created_by_user, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        messageId,
        conversation.conversation_id,
        parentMessageId,
        role,
        content,
        conversation.model,
        conversation.endpoint,
        role === 'user' ? 1 : 0,
        now
      )
      .run();

    // Update conversation timestamp
    await c.env.DB
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .bind(now, conversation.id)
      .run();

    return c.json({
      success: true,
      id,
      messageId,
      conversationId: conversation.conversation_id,
      parentMessageId,
      role,
      content,
      model: conversation.model,
      endpoint: conversation.endpoint,
      isCreatedByUser: role === 'user',
      createdAt: now,
    }, 201);
  } catch (error) {
    console.error('Branch message error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to create branch' },
    }, 500);
  }
});

/**
 * GET /:conversationId/tree
 * Get the message tree structure for a conversation
 * Returns messages organized by parent relationships for branch navigation
 */
messages.get('/:conversationId/tree', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const conversationId = c.req.param('conversationId');

  try {
    // Verify conversation ownership
    const conversation = await c.env.DB
      .prepare('SELECT id, conversation_id FROM conversations WHERE (id = ? OR conversation_id = ?) AND user_id = ?')
      .bind(conversationId, conversationId, user.id)
      .first<{ id: string; conversation_id: string }>();

    if (!conversation) {
      return c.json({
        success: false,
        error: { message: 'Conversation not found' },
      }, 404);
    }

    // Get all messages with their parent relationships
    const allMessages = await c.env.DB
      .prepare(`
        SELECT 
          id,
          message_id as messageId,
          conversation_id as conversationId,
          parent_message_id as parentMessageId,
          role,
          content,
          model,
          endpoint,
          token_count as tokenCount,
          is_created_by_user as isCreatedByUser,
          created_at as createdAt
        FROM messages 
        WHERE conversation_id = ?
        ORDER BY created_at ASC
      `)
      .bind(conversation.conversation_id)
      .all<{
        id: string;
        messageId: string;
        conversationId: string;
        parentMessageId: string | null;
        role: string;
        content: string;
        model: string | null;
        endpoint: string | null;
        tokenCount: number | null;
        isCreatedByUser: number;
        createdAt: string;
      }>();

    const messageList = allMessages.results || [];

    // Build tree structure - group messages by parent
    const childrenMap = new Map<string | null, typeof messageList>();
    for (const msg of messageList) {
      const parentId = msg.parentMessageId;
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId)!.push(msg);
    }

    // Count siblings for each message
    const siblingsCount = new Map<string, number>();
    const siblingIndex = new Map<string, number>();
    
    for (const [parentId, children] of childrenMap) {
      children.forEach((child, index) => {
        siblingsCount.set(child.id, children.length);
        siblingIndex.set(child.id, index);
      });
    }

    // Enrich messages with branch info
    const enrichedMessages = messageList.map(msg => ({
      ...msg,
      siblings: siblingsCount.get(msg.id) || 1,
      siblingIndex: siblingIndex.get(msg.id) || 0,
      hasChildren: childrenMap.has(msg.id) && (childrenMap.get(msg.id)?.length || 0) > 0,
    }));

    // Get root messages (no parent)
    const rootMessages = childrenMap.get(null) || [];

    return c.json({
      success: true,
      conversationId: conversation.conversation_id,
      messageCount: messageList.length,
      rootCount: rootMessages.length,
      messages: enrichedMessages,
      tree: {
        roots: rootMessages.map(m => m.id),
        children: Object.fromEntries(
          Array.from(childrenMap.entries())
            .filter(([k]) => k !== null)
            .map(([k, v]) => [k, v.map(m => m.id)])
        ),
      },
    });
  } catch (error) {
    console.error('Get message tree error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to get message tree' },
    }, 500);
  }
});

/**
 * GET /:conversationId/siblings/:messageId
 * Get sibling messages (alternatives) for a specific message
 */
messages.get('/:conversationId/siblings/:messageId', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const conversationId = c.req.param('conversationId');
  const messageId = c.req.param('messageId');

  try {
    // Verify conversation ownership
    const conversation = await c.env.DB
      .prepare('SELECT id, conversation_id FROM conversations WHERE (id = ? OR conversation_id = ?) AND user_id = ?')
      .bind(conversationId, conversationId, user.id)
      .first<{ id: string; conversation_id: string }>();

    if (!conversation) {
      return c.json({
        success: false,
        error: { message: 'Conversation not found' },
      }, 404);
    }

    // Get the target message to find its parent
    const targetMessage = await c.env.DB
      .prepare('SELECT id, parent_message_id FROM messages WHERE (id = ? OR message_id = ?) AND conversation_id = ?')
      .bind(messageId, messageId, conversation.conversation_id)
      .first<{ id: string; parent_message_id: string | null }>();

    if (!targetMessage) {
      return c.json({
        success: false,
        error: { message: 'Message not found' },
      }, 404);
    }

    // Get all siblings (messages with the same parent)
    let siblingsQuery: string;
    let siblingsParams: (string | null)[];

    if (targetMessage.parent_message_id) {
      siblingsQuery = `
        SELECT 
          id,
          message_id as messageId,
          parent_message_id as parentMessageId,
          role,
          content,
          model,
          created_at as createdAt
        FROM messages 
        WHERE conversation_id = ? AND parent_message_id = ?
        ORDER BY created_at ASC
      `;
      siblingsParams = [conversation.conversation_id, targetMessage.parent_message_id];
    } else {
      // Root messages (no parent)
      siblingsQuery = `
        SELECT 
          id,
          message_id as messageId,
          parent_message_id as parentMessageId,
          role,
          content,
          model,
          created_at as createdAt
        FROM messages 
        WHERE conversation_id = ? AND parent_message_id IS NULL
        ORDER BY created_at ASC
      `;
      siblingsParams = [conversation.conversation_id];
    }

    const siblings = await c.env.DB
      .prepare(siblingsQuery)
      .bind(...siblingsParams)
      .all<{
        id: string;
        messageId: string;
        parentMessageId: string | null;
        role: string;
        content: string;
        model: string | null;
        createdAt: string;
      }>();

    const siblingsList = siblings.results || [];
    const currentIndex = siblingsList.findIndex(s => s.id === targetMessage.id);

    return c.json({
      success: true,
      messageId: targetMessage.id,
      parentMessageId: targetMessage.parent_message_id,
      currentIndex,
      totalSiblings: siblingsList.length,
      siblings: siblingsList.map((s, idx) => ({
        ...s,
        isCurrent: s.id === targetMessage.id,
        index: idx,
      })),
    });
  } catch (error) {
    console.error('Get siblings error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to get siblings' },
    }, 500);
  }
});

export { messages };
export default messages;
