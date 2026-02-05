/**
 * Messages API Routes
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import * as messagesDb from '../db/messages';
import * as conversationsDb from '../db/conversations';
import type { AppEnv } from '../types';

const app = new Hono<AppEnv>();

// All routes require authentication
app.use('*', async (c, next) => {
  const userId = c.get('userId');
  if (!userId) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }
  await next();
});

/**
 * GET /messages/:conversationId
 * Get all messages for a conversation
 */
app.get('/:conversationId', async (c) => {
  const userId = c.get('userId');
  const { conversationId } = c.req.param();

  // Verify conversation belongs to user
  const conversation = await conversationsDb.findById(c.env.DB, conversationId);
  if (!conversation || conversation.userId !== userId) {
    throw new HTTPException(404, { message: 'Conversation not found' });
  }

  const messages = await messagesDb.findByConversation(c.env.DB, conversationId, userId);
  
  return c.json({ messages });
});

/**
 * POST /messages/:conversationId
 * Create a new message
 */
app.post('/:conversationId', async (c) => {
  const userId = c.get('userId');
  const { conversationId } = c.req.param();
  const body = await c.req.json();

  // Verify conversation belongs to user
  const conversation = await conversationsDb.findById(c.env.DB, conversationId);
  if (!conversation || conversation.userId !== userId) {
    throw new HTTPException(404, { message: 'Conversation not found' });
  }

  const message = await messagesDb.create(c.env.DB, {
    id: body.id || crypto.randomUUID(),
    conversationId,
    parentMessageId: body.parentMessageId,
    role: body.role,
    content: body.content,
    isEncrypted: body.isEncrypted ? 1 : 0,
  });

  return c.json({ message });
});

/**
 * PATCH /messages/:messageId/encrypt
 * Update a message's content with encrypted version
 * This is called after the AI response to encrypt the stored content
 */
app.patch('/:messageId/encrypt', async (c) => {
  const userId = c.get('userId');
  const { messageId } = c.req.param();
  const body = await c.req.json<{ encryptedContent: string }>();

  if (!body.encryptedContent) {
    throw new HTTPException(400, { message: 'encryptedContent is required' });
  }

  // Get message and verify ownership through conversation
  const message = await messagesDb.findByIdForUser(c.env.DB, messageId, userId);
  if (!message) {
    throw new HTTPException(404, { message: 'Message not found' });
  }

  // Update with encrypted content
  await c.env.DB
    .prepare('UPDATE messages SET content = ?, is_encrypted = 1, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(body.encryptedContent, messageId)
    .run();

  return c.json({ success: true });
});

/**
 * PATCH /messages/:messageId
 * Update a message (for edits)
 */
app.patch('/:messageId', async (c) => {
  const userId = c.get('userId');
  const { messageId } = c.req.param();
  const body = await c.req.json();

  // Verify message ownership through conversation
  const message = await messagesDb.findByIdForUser(c.env.DB, messageId, userId);
  if (!message) {
    throw new HTTPException(404, { message: 'Message not found' });
  }

  const updates: Record<string, unknown> = {};
  if (body.content !== undefined) updates.content = body.content;
  if (body.isEncrypted !== undefined) updates.is_encrypted = body.isEncrypted ? 1 : 0;

  if (Object.keys(updates).length > 0) {
    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await c.env.DB
      .prepare(`UPDATE messages SET ${setClause}, updated_at = datetime('now') WHERE id = ?`)
      .bind(...Object.values(updates), messageId)
      .run();
  }

  return c.json({ success: true });
});

/**
 * DELETE /messages/:messageId
 * Delete a message
 */
app.delete('/:messageId', async (c) => {
  const userId = c.get('userId');
  const { messageId } = c.req.param();

  // Verify message ownership through conversation
  const message = await messagesDb.findByIdForUser(c.env.DB, messageId, userId);
  if (!message) {
    throw new HTTPException(404, { message: 'Message not found' });
  }

  await messagesDb.deleteMessage(c.env.DB, messageId, userId);

  return c.json({ success: true });
});

export { app as messages };
export default app;
