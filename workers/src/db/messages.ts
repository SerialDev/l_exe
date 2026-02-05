/**
 * Message Repository
 * Type-safe D1 queries for message management
 */

/**
 * Message entity as stored in the database
 */
export interface MessageRow {
  id: string;
  conversation_id: string;
  parent_message_id: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string | null;
  endpoint: string | null;
  token_count: number | null;
  finish_reason: string | null;
  attachments: string | null; // JSON array of file references
  is_encrypted: number | null; // 1 if content is E2EE encrypted
  created_at: string;
}

/**
 * Message entity with normalized field names
 */
export interface Message {
  id: string;
  conversationId: string;
  parentMessageId: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string | null;
  endpoint: string | null;
  tokenCount: number | null;
  finishReason: string | null;
  attachments: string | null; // JSON array of file references
  isEncrypted: boolean; // true if content is E2EE encrypted
  createdAt: string;
}

/**
 * Data required to create a new message
 */
export interface CreateMessageData {
  id: string;
  conversationId: string;
  parentMessageId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  endpoint?: string;
  tokenCount?: number;
  finishReason?: string;
  attachments?: string | null; // JSON array of file references
  isEncrypted?: number; // 1 if content is E2EE encrypted
}

/**
 * Data that can be updated on a message
 */
export interface UpdateMessageData {
  content?: string;
  tokenCount?: number;
  finishReason?: string;
}

/**
 * Search result with relevance ranking
 */
export interface MessageSearchResult {
  message: Message;
  conversationId: string;
  rank: number;
}

/**
 * Converts a database row to a Message entity
 */
function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    parentMessageId: row.parent_message_id,
    role: row.role,
    content: row.content,
    model: row.model,
    endpoint: row.endpoint,
    tokenCount: row.token_count,
    finishReason: row.finish_reason,
    attachments: row.attachments,
    isEncrypted: row.is_encrypted === 1,
    createdAt: row.created_at,
  };
}

/**
 * Find a message by ID with user ownership check (via conversation)
 * @param db - D1 database instance
 * @param id - Message ID
 * @param userId - User ID (for ownership verification)
 * @returns Message or null if not found or not owned by user
 */
export async function findByIdForUser(db: D1Database, id: string, userId: string): Promise<Message | null> {
  const stmt = db.prepare(`
    SELECT m.* FROM messages m
    INNER JOIN conversations c ON m.conversation_id = c.id
    WHERE m.id = ? AND c.user_id = ?
  `).bind(id, userId);
  const result = await stmt.first<MessageRow>();
  return result ? rowToMessage(result) : null;
}

/**
 * Find all messages in a conversation, ordered by creation time
 * REQUIRES userId for tenant isolation - verifies conversation ownership
 * @param db - D1 database instance
 * @param conversationId - Conversation ID
 * @param userId - User ID (required for tenant isolation)
 * @returns List of messages in chronological order
 */
export async function findByConversation(
  db: D1Database,
  conversationId: string,
  userId: string
): Promise<Message[]> {
  const stmt = db
    .prepare(`
      SELECT m.* FROM messages m
      INNER JOIN conversations c ON m.conversation_id = c.id
      WHERE m.conversation_id = ? AND c.user_id = ?
      ORDER BY m.created_at ASC
    `)
    .bind(conversationId, userId);
  const result = await stmt.all<MessageRow>();
  return (result.results ?? []).map(rowToMessage);
}

/**
 * Find messages by parent message ID (for branching conversations)
 * REQUIRES userId for tenant isolation - verifies conversation ownership
 * @param db - D1 database instance
 * @param parentMessageId - Parent message ID
 * @param userId - User ID (required for tenant isolation)
 * @returns List of child messages
 */
export async function findByParent(
  db: D1Database,
  parentMessageId: string,
  userId: string
): Promise<Message[]> {
  const stmt = db
    .prepare(`
      SELECT m.* FROM messages m
      INNER JOIN conversations c ON m.conversation_id = c.id
      WHERE m.parent_message_id = ? AND c.user_id = ?
      ORDER BY m.created_at ASC
    `)
    .bind(parentMessageId, userId);
  const result = await stmt.all<MessageRow>();
  return (result.results ?? []).map(rowToMessage);
}

/**
 * Create a new message
 * @param db - D1 database instance
 * @param message - Message data to insert
 * @returns Created message
 * @throws Error if creation fails
 */
export async function create(db: D1Database, message: CreateMessageData): Promise<Message> {
  const now = new Date().toISOString();
  const stmt = db
    .prepare(
      `INSERT INTO messages (id, conversation_id, parent_message_id, role, content, model, endpoint, token_count, finish_reason, attachments, is_encrypted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      message.id,
      message.conversationId,
      message.parentMessageId ?? null,
      message.role,
      message.content,
      message.model ?? null,
      message.endpoint ?? null,
      message.tokenCount ?? null,
      message.finishReason ?? null,
      message.attachments ?? null,
      message.isEncrypted ?? 0,
      now
    );

  const result = await stmt.run();
  
  if (!result.success) {
    throw new Error('Failed to create message');
  }

  // Return the message directly from input data instead of re-querying
  // This avoids needing an unprotected findById and is more efficient
  return {
    id: message.id,
    conversationId: message.conversationId,
    parentMessageId: message.parentMessageId ?? null,
    role: message.role,
    content: message.content,
    model: message.model ?? null,
    endpoint: message.endpoint ?? null,
    tokenCount: message.tokenCount ?? null,
    finishReason: message.finishReason ?? null,
    attachments: message.attachments ?? null,
    isEncrypted: message.isEncrypted === 1,
    createdAt: now,
  };
}

/**
 * Update an existing message with user ownership verification via conversation
 * @param db - D1 database instance
 * @param id - Message ID
 * @param userId - User ID (required for tenant isolation)
 * @param data - Fields to update
 * @returns Updated message or null if not found/not owned
 */
export async function update(
  db: D1Database,
  id: string,
  userId: string,
  data: UpdateMessageData
): Promise<Message | null> {
  const fields: string[] = [];
  const values: (string | number)[] = [];

  if (data.content !== undefined) {
    fields.push('content = ?');
    values.push(data.content);
  }
  if (data.tokenCount !== undefined) {
    fields.push('token_count = ?');
    values.push(data.tokenCount);
  }
  if (data.finishReason !== undefined) {
    fields.push('finish_reason = ?');
    values.push(data.finishReason);
  }

  if (fields.length === 0) {
    return findByIdForUser(db, id, userId);
  }

  values.push(id, userId);

  // Update with tenant isolation - join with conversations to verify ownership
  const stmt = db
    .prepare(`UPDATE messages SET ${fields.join(', ')} 
              WHERE id = ? AND conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)`)
    .bind(...values);

  const result = await stmt.run();
  if (result.meta.changes === 0) {
    return null;
  }

  return findByIdForUser(db, id, userId);
}

/**
 * Delete a message by ID with user ownership verification
 * @param db - D1 database instance
 * @param id - Message ID
 * @param userId - User ID (required for tenant isolation)
 * @returns True if deleted, false if not found/not owned
 */
export async function deleteMessage(db: D1Database, id: string, userId: string): Promise<boolean> {
  // Delete with tenant isolation - join with conversations to verify ownership
  const stmt = db.prepare(`DELETE FROM messages 
                           WHERE id = ? AND conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)`)
    .bind(id, userId);
  const result = await stmt.run();
  return result.meta.changes > 0;
}

/**
 * Delete all messages in a conversation with user ownership verification
 * @param db - D1 database instance
 * @param conversationId - Conversation ID
 * @param userId - User ID (required for tenant isolation)
 * @returns Number of messages deleted
 */
export async function deleteByConversation(
  db: D1Database,
  conversationId: string,
  userId: string
): Promise<number> {
  // Delete with tenant isolation - verify conversation belongs to user
  const stmt = db
    .prepare(`DELETE FROM messages 
              WHERE conversation_id = ? AND conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)`)
    .bind(conversationId, userId);
  const result = await stmt.run();
  return result.meta.changes;
}

/**
 * Search messages using FTS5 full-text search
 * @param db - D1 database instance
 * @param userId - User ID (to scope search to user's conversations)
 * @param query - Search query string
 * @returns List of matching messages with relevance ranking
 */
export async function search(
  db: D1Database,
  userId: string,
  query: string
): Promise<MessageSearchResult[]> {
  // Escape FTS5 special characters and format for phrase search
  const sanitizedQuery = query
    .replace(/['"]/g, '')
    .replace(/[-+*()~^]/g, ' ')
    .trim();

  if (!sanitizedQuery) {
    return [];
  }

  // Use FTS5 MATCH syntax with bm25 ranking
  const stmt = db
    .prepare(
      `SELECT m.*, bm25(messages_fts) as rank
       FROM messages m
       INNER JOIN messages_fts ON m.rowid = messages_fts.rowid
       INNER JOIN conversations c ON m.conversation_id = c.id
       WHERE messages_fts MATCH ? AND c.user_id = ?
       ORDER BY rank
       LIMIT 100`
    )
    .bind(sanitizedQuery, userId);

  try {
    const result = await stmt.all<MessageRow & { rank: number }>();
    return (result.results ?? []).map((row) => ({
      message: rowToMessage(row),
      conversationId: row.conversation_id,
      rank: row.rank,
    }));
  } catch {
    // FTS5 might fail on certain queries, fall back to LIKE search
    return searchFallback(db, userId, query);
  }
}

/**
 * Fallback search using LIKE when FTS5 fails
 */
async function searchFallback(
  db: D1Database,
  userId: string,
  query: string
): Promise<MessageSearchResult[]> {
  const sanitized = query.replace(/[%_]/g, '\\$&');
  const pattern = `%${sanitized}%`;

  const stmt = db
    .prepare(
      `SELECT m.*
       FROM messages m
       INNER JOIN conversations c ON m.conversation_id = c.id
       WHERE m.content LIKE ? ESCAPE '\\' AND c.user_id = ?
       ORDER BY m.created_at DESC
       LIMIT 100`
    )
    .bind(pattern, userId);

  const result = await stmt.all<MessageRow>();
  return (result.results ?? []).map((row, index) => ({
    message: rowToMessage(row),
    conversationId: row.conversation_id,
    rank: index,
  }));
}

/**
 * Get the latest message in a conversation
 * REQUIRES userId for tenant isolation - verifies conversation ownership
 * @param db - D1 database instance
 * @param conversationId - Conversation ID
 * @param userId - User ID (required for tenant isolation)
 * @returns Latest message or null if conversation is empty
 */
export async function getLatest(
  db: D1Database,
  conversationId: string,
  userId: string
): Promise<Message | null> {
  const stmt = db
    .prepare(`
      SELECT m.* FROM messages m
      INNER JOIN conversations c ON m.conversation_id = c.id
      WHERE m.conversation_id = ? AND c.user_id = ?
      ORDER BY m.created_at DESC LIMIT 1
    `)
    .bind(conversationId, userId);
  const result = await stmt.first<MessageRow>();
  return result ? rowToMessage(result) : null;
}

/**
 * Count messages in a conversation
 * REQUIRES userId for tenant isolation - verifies conversation ownership
 * @param db - D1 database instance
 * @param conversationId - Conversation ID
 * @param userId - User ID (required for tenant isolation)
 * @returns Total count of messages
 */
export async function countByConversation(
  db: D1Database,
  conversationId: string,
  userId: string
): Promise<number> {
  const stmt = db
    .prepare(`
      SELECT COUNT(*) as count FROM messages m
      INNER JOIN conversations c ON m.conversation_id = c.id
      WHERE m.conversation_id = ? AND c.user_id = ?
    `)
    .bind(conversationId, userId);
  const result = await stmt.first<{ count: number }>();
  return result?.count ?? 0;
}

/**
 * Get total token count for a conversation
 * REQUIRES userId for tenant isolation - verifies conversation ownership
 * @param db - D1 database instance
 * @param conversationId - Conversation ID
 * @param userId - User ID (required for tenant isolation)
 * @returns Total token count (sum of all messages)
 */
export async function getTotalTokens(
  db: D1Database,
  conversationId: string,
  userId: string
): Promise<number> {
  const stmt = db
    .prepare(`
      SELECT COALESCE(SUM(m.token_count), 0) as total FROM messages m
      INNER JOIN conversations c ON m.conversation_id = c.id
      WHERE m.conversation_id = ? AND c.user_id = ?
    `)
    .bind(conversationId, userId);
  const result = await stmt.first<{ total: number }>();
  return result?.total ?? 0;
}
