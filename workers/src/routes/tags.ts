/**
 * Tags routes
 * Conversation tags/bookmarks CRUD functionality
 * GET /, POST /, PUT /:tag, DELETE /:tag
 * PUT /convo/:conversationId - Update tags for a conversation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { generateUUID } from '../services/crypto';

// Types for Cloudflare bindings
interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  CACHE: KVNamespace;
  JWT_SECRET: string;
}

// Context variables (set by auth middleware)
interface Variables {
  userId: string;
}

// Database row types
interface TagRow {
  id: string;
  user_id: string;
  tag: string;
  description: string | null;
  position: number;
  count: number;
  created_at: string;
  updated_at: string;
}

interface ConversationRow {
  id: string;
  user_id: string;
  tags: string | null; // JSON array
}

// Request schemas
const createTagSchema = z.object({
  tag: z.string().min(1).max(50),
  description: z.string().max(200).optional(),
  position: z.number().int().min(0).optional(),
});

const updateTagSchema = z.object({
  tag: z.string().min(1).max(50).optional(),
  description: z.string().max(200).optional().nullable(),
  position: z.number().int().min(0).optional(),
});

const updateConvoTagsSchema = z.object({
  tags: z.array(z.string().min(1).max(50)),
});

// Create router
const tags = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /
 * List all tags for the current user
 */
tags.get('/', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  try {
    const results = await c.env.DB
      .prepare(`
        SELECT id, tag, description, position, count, created_at, updated_at
        FROM conversation_tags
        WHERE user_id = ?
        ORDER BY position ASC, tag ASC
      `)
      .bind(userId)
      .all<TagRow>();

    return c.json({
      success: true,
      data: (results.results || []).map(row => ({
        id: row.id,
        tag: row.tag,
        description: row.description,
        position: row.position,
        count: row.count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    console.error('Error listing tags:', error);
    return c.json({
      success: false,
      error: 'Failed to list tags',
    }, 500);
  }
});

/**
 * POST /
 * Create a new tag
 */
tags.post('/', zValidator('json', createTagSchema), async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { tag, description, position } = c.req.valid('json');

  try {
    // Check if tag already exists for this user
    const existing = await c.env.DB
      .prepare('SELECT id FROM conversation_tags WHERE user_id = ? AND tag = ?')
      .bind(userId, tag)
      .first();

    if (existing) {
      return c.json({
        success: false,
        error: 'Tag already exists',
      }, 409);
    }

    // Get max position if not provided
    let finalPosition = position;
    if (finalPosition === undefined) {
      const maxPos = await c.env.DB
        .prepare('SELECT MAX(position) as max_pos FROM conversation_tags WHERE user_id = ?')
        .bind(userId)
        .first<{ max_pos: number | null }>();
      finalPosition = (maxPos?.max_pos ?? -1) + 1;
    }

    const id = generateUUID();
    const now = new Date().toISOString();

    await c.env.DB
      .prepare(`
        INSERT INTO conversation_tags (id, user_id, tag, description, position, count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?)
      `)
      .bind(id, userId, tag, description || null, finalPosition, now, now)
      .run();

    return c.json({
      success: true,
      data: {
        id,
        tag,
        description: description || null,
        position: finalPosition,
        count: 0,
        createdAt: now,
        updatedAt: now,
      },
    }, 201);
  } catch (error) {
    console.error('Error creating tag:', error);
    return c.json({
      success: false,
      error: 'Failed to create tag',
    }, 500);
  }
});

/**
 * PUT /:tag
 * Update an existing tag
 */
tags.put('/:tag', zValidator('json', updateTagSchema), async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { tag: tagParam } = c.req.param();
  const updates = c.req.valid('json');

  try {
    // Get existing tag
    const existing = await c.env.DB
      .prepare('SELECT * FROM conversation_tags WHERE user_id = ? AND tag = ?')
      .bind(userId, tagParam)
      .first<TagRow>();

    if (!existing) {
      return c.json({
        success: false,
        error: 'Tag not found',
      }, 404);
    }

    // If renaming, check new name doesn't exist
    if (updates.tag && updates.tag !== tagParam) {
      const duplicate = await c.env.DB
        .prepare('SELECT id FROM conversation_tags WHERE user_id = ? AND tag = ?')
        .bind(userId, updates.tag)
        .first();

      if (duplicate) {
        return c.json({
          success: false,
          error: 'Tag name already exists',
        }, 409);
      }
    }

    // Build update query
    const setClauses: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.tag !== undefined) {
      setClauses.push('tag = ?');
      values.push(updates.tag);
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?');
      values.push(updates.description);
    }
    if (updates.position !== undefined) {
      setClauses.push('position = ?');
      values.push(updates.position);
    }

    if (setClauses.length === 0) {
      return c.json({
        success: true,
        data: {
          id: existing.id,
          tag: existing.tag,
          description: existing.description,
          position: existing.position,
          count: existing.count,
          createdAt: existing.created_at,
          updatedAt: existing.updated_at,
        },
      });
    }

    values.push(existing.id);

    await c.env.DB
      .prepare(`UPDATE conversation_tags SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    // If tag was renamed, update all conversations that use it
    if (updates.tag && updates.tag !== tagParam) {
      // Get all conversations with this tag
      const conversations = await c.env.DB
        .prepare(`
          SELECT id, tags FROM conversations 
          WHERE user_id = ? AND tags LIKE ?
        `)
        .bind(userId, `%"${tagParam}"%`)
        .all<ConversationRow>();

      for (const convo of conversations.results || []) {
        if (convo.tags) {
          const tagsArray: string[] = JSON.parse(convo.tags);
          const newTags = tagsArray.map(t => t === tagParam ? updates.tag! : t);
          await c.env.DB
            .prepare('UPDATE conversations SET tags = ? WHERE id = ?')
            .bind(JSON.stringify(newTags), convo.id)
            .run();
        }
      }
    }

    // Fetch updated tag
    const updated = await c.env.DB
      .prepare('SELECT * FROM conversation_tags WHERE id = ?')
      .bind(existing.id)
      .first<TagRow>();

    return c.json({
      success: true,
      data: {
        id: updated!.id,
        tag: updated!.tag,
        description: updated!.description,
        position: updated!.position,
        count: updated!.count,
        createdAt: updated!.created_at,
        updatedAt: updated!.updated_at,
      },
    });
  } catch (error) {
    console.error('Error updating tag:', error);
    return c.json({
      success: false,
      error: 'Failed to update tag',
    }, 500);
  }
});

/**
 * DELETE /:tag
 * Delete a tag
 */
tags.delete('/:tag', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { tag } = c.req.param();

  try {
    // Check if tag exists
    const existing = await c.env.DB
      .prepare('SELECT id FROM conversation_tags WHERE user_id = ? AND tag = ?')
      .bind(userId, tag)
      .first<TagRow>();

    if (!existing) {
      return c.json({
        success: false,
        error: 'Tag not found',
      }, 404);
    }

    // Delete the tag
    await c.env.DB
      .prepare('DELETE FROM conversation_tags WHERE id = ?')
      .bind(existing.id)
      .run();

    // Remove tag from all conversations
    const conversations = await c.env.DB
      .prepare(`
        SELECT id, tags FROM conversations 
        WHERE user_id = ? AND tags LIKE ?
      `)
      .bind(userId, `%"${tag}"%`)
      .all<ConversationRow>();

    for (const convo of conversations.results || []) {
      if (convo.tags) {
        const tagsArray: string[] = JSON.parse(convo.tags);
        const newTags = tagsArray.filter(t => t !== tag);
        await c.env.DB
          .prepare('UPDATE conversations SET tags = ? WHERE id = ?')
          .bind(JSON.stringify(newTags), convo.id)
          .run();
      }
    }

    return c.json({
      success: true,
      data: { deleted: true, tag },
    });
  } catch (error) {
    console.error('Error deleting tag:', error);
    return c.json({
      success: false,
      error: 'Failed to delete tag',
    }, 500);
  }
});

/**
 * PUT /convo/:conversationId
 * Update tags for a specific conversation
 */
tags.put('/convo/:conversationId', zValidator('json', updateConvoTagsSchema), async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { conversationId } = c.req.param();
  const { tags: newTags } = c.req.valid('json');

  try {
    // Verify conversation ownership
    const conversation = await c.env.DB
      .prepare('SELECT id, tags FROM conversations WHERE id = ? AND user_id = ?')
      .bind(conversationId, userId)
      .first<ConversationRow>();

    if (!conversation) {
      return c.json({
        success: false,
        error: 'Conversation not found',
      }, 404);
    }

    // Get current tags
    const currentTags: string[] = conversation.tags ? JSON.parse(conversation.tags) : [];

    // Calculate added and removed tags
    const addedTags = newTags.filter(t => !currentTags.includes(t));
    const removedTags = currentTags.filter(t => !newTags.includes(t));

    // Update conversation tags
    await c.env.DB
      .prepare('UPDATE conversations SET tags = ? WHERE id = ?')
      .bind(JSON.stringify(newTags), conversationId)
      .run();

    // Update tag counts - decrement for removed tags
    for (const tag of removedTags) {
      await c.env.DB
        .prepare(`
          UPDATE conversation_tags 
          SET count = MAX(0, count - 1) 
          WHERE user_id = ? AND tag = ?
        `)
        .bind(userId, tag)
        .run();
    }

    // Update tag counts - increment for added tags (auto-create if needed)
    for (const tag of addedTags) {
      const existingTag = await c.env.DB
        .prepare('SELECT id, count FROM conversation_tags WHERE user_id = ? AND tag = ?')
        .bind(userId, tag)
        .first<TagRow>();

      if (existingTag) {
        await c.env.DB
          .prepare('UPDATE conversation_tags SET count = count + 1 WHERE id = ?')
          .bind(existingTag.id)
          .run();
      } else {
        // Auto-create the tag
        const maxPos = await c.env.DB
          .prepare('SELECT MAX(position) as max_pos FROM conversation_tags WHERE user_id = ?')
          .bind(userId)
          .first<{ max_pos: number | null }>();
        
        const id = generateUUID();
        const now = new Date().toISOString();
        const position = (maxPos?.max_pos ?? -1) + 1;

        await c.env.DB
          .prepare(`
            INSERT INTO conversation_tags (id, user_id, tag, description, position, count, created_at, updated_at)
            VALUES (?, ?, ?, NULL, ?, 1, ?, ?)
          `)
          .bind(id, userId, tag, position, now, now)
          .run();
      }
    }

    return c.json({
      success: true,
      data: {
        conversationId,
        tags: newTags,
        added: addedTags,
        removed: removedTags,
      },
    });
  } catch (error) {
    console.error('Error updating conversation tags:', error);
    return c.json({
      success: false,
      error: 'Failed to update conversation tags',
    }, 500);
  }
});

/**
 * GET /convo/:conversationId
 * Get tags for a specific conversation
 */
tags.get('/convo/:conversationId', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { conversationId } = c.req.param();

  try {
    // Verify conversation ownership and get tags
    const conversation = await c.env.DB
      .prepare('SELECT id, tags FROM conversations WHERE id = ? AND user_id = ?')
      .bind(conversationId, userId)
      .first<ConversationRow>();

    if (!conversation) {
      return c.json({
        success: false,
        error: 'Conversation not found',
      }, 404);
    }

    const conversationTags: string[] = conversation.tags ? JSON.parse(conversation.tags) : [];

    return c.json({
      success: true,
      data: {
        conversationId,
        tags: conversationTags,
      },
    });
  } catch (error) {
    console.error('Error getting conversation tags:', error);
    return c.json({
      success: false,
      error: 'Failed to get conversation tags',
    }, 500);
  }
});

export { tags };
export default tags;
