/**
 * Conversation Repository
 * Type-safe D1 queries for conversation management
 */

/**
 * Conversation entity as stored in the database
 */
export interface ConversationRow {
  id: string;
  user_id: string;
  title: string;
  endpoint: string;
  model: string;
  created_at: string;
  updated_at: string;
}

/**
 * Conversation entity with normalized field names
 */
export interface Conversation {
  id: string;
  userId: string;
  title: string;
  endpoint: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Data required to create a new conversation
 */
export interface CreateConversationData {
  id: string;
  userId: string;
  title?: string;
  endpoint: string;
  model: string;
  isArchived?: number;
}

/**
 * Data that can be updated on a conversation
 */
export interface UpdateConversationData {
  title?: string;
  endpoint?: string;
  model?: string;
}

/**
 * Options for paginated conversation queries
 */
export interface FindConversationsOptions {
  /** Cursor for pagination (conversation ID to start after) */
  cursor?: string;
  /** Maximum number of results to return */
  limit?: number;
  /** Filter by endpoint */
  endpoint?: string;
}

/**
 * Paginated result for conversation queries
 */
export interface PaginatedConversations {
  conversations: Conversation[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Converts a database row to a Conversation entity
 */
function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    endpoint: row.endpoint,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Find a conversation by its unique ID
 * @deprecated Use findByIdForUser instead - this function exists for internal/migration use only
 * SECURITY: userId is now REQUIRED to prevent tenant isolation bypass
 * @param db - D1 database instance
 * @param id - Conversation ID
 * @param userId - User ID (REQUIRED for tenant isolation)
 * @returns Conversation or null if not found
 */
export async function findById(db: D1Database, id: string, userId?: string): Promise<Conversation | null> {
  // SECURITY: If userId is not provided, we must still require tenant isolation
  // This allows the function to work for migrations/internal use but logs a warning
  if (!userId) {
    console.error('[SECURITY VIOLATION] conversations.findById called without userId - use findByIdForUser');
    // Return null instead of allowing access to any conversation
    return null;
  }
  const stmt = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').bind(id, userId);
  const result = await stmt.first<ConversationRow>();
  return result ? rowToConversation(result) : null;
}

/**
 * Find a conversation by ID with mandatory user ownership check
 * Use this for user-facing operations
 * @param db - D1 database instance
 * @param id - Conversation ID
 * @param userId - User ID (required)
 * @returns Conversation or null if not found or not owned by user
 */
export async function findByIdForUser(db: D1Database, id: string, userId: string): Promise<Conversation | null> {
  const stmt = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').bind(id, userId);
  const result = await stmt.first<ConversationRow>();
  return result ? rowToConversation(result) : null;
}

/**
 * Find conversations for a user with cursor-based pagination
 * @param db - D1 database instance
 * @param userId - User ID
 * @param options - Pagination and filter options
 * @returns Paginated list of conversations
 */
export async function findByUser(
  db: D1Database,
  userId: string,
  options: FindConversationsOptions = {}
): Promise<PaginatedConversations> {
  const limit = Math.min(options.limit ?? 20, 100);
  const values: (string | number)[] = [userId];
  let whereClause = 'WHERE user_id = ?';

  if (options.cursor) {
    // Get the updated_at of the cursor conversation for proper pagination
    // SECURITY: Use findByIdForUser to ensure cursor belongs to this user
    const cursorConvo = await findByIdForUser(db, options.cursor, userId);
    if (cursorConvo) {
      whereClause += ' AND (updated_at < ? OR (updated_at = ? AND id < ?))';
      values.push(cursorConvo.updatedAt, cursorConvo.updatedAt, options.cursor);
    }
  }

  if (options.endpoint) {
    whereClause += ' AND endpoint = ?';
    values.push(options.endpoint);
  }

  values.push(limit + 1); // Fetch one extra to check for more

  const stmt = db
    .prepare(
      `SELECT * FROM conversations ${whereClause} ORDER BY updated_at DESC, id DESC LIMIT ?`
    )
    .bind(...values);

  const result = await stmt.all<ConversationRow>();
  const rows = result.results ?? [];

  const hasMore = rows.length > limit;
  const conversations = rows.slice(0, limit).map(rowToConversation);
  const nextCursor = hasMore && conversations.length > 0
    ? conversations[conversations.length - 1].id
    : null;

  return {
    conversations,
    nextCursor,
    hasMore,
  };
}

/**
 * Create a new conversation
 * @param db - D1 database instance
 * @param conversation - Conversation data to insert
 * @returns Created conversation
 * @throws Error if creation fails
 */
export async function create(
  db: D1Database,
  conversation: CreateConversationData
): Promise<Conversation> {
  const now = new Date().toISOString();
  const stmt = db
    .prepare(
      `INSERT INTO conversations (id, user_id, title, endpoint, model, is_archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      conversation.id,
      conversation.userId,
      conversation.title ?? 'New Chat',
      conversation.endpoint,
      conversation.model,
      conversation.isArchived ?? 0,
      now,
      now
    );

  await stmt.run();

  const created = await findById(db, conversation.id);
  if (!created) {
    throw new Error('Failed to create conversation');
  }
  return created;
}

/**
 * Update an existing conversation with ownership check
 * SECURITY: userId is now REQUIRED to prevent tenant isolation bypass
 * @param db - D1 database instance
 * @param id - Conversation ID
 * @param data - Fields to update
 * @param userId - User ID (REQUIRED for tenant isolation)
 * @returns Updated conversation or null if not found or not owned
 * @throws Error if userId is not provided
 */
export async function update(
  db: D1Database,
  id: string,
  data: UpdateConversationData,
  userId: string
): Promise<Conversation | null> {
  // SECURITY: userId is mandatory - throw if not provided
  if (!userId) {
    throw new Error('[SECURITY] conversations.update requires userId for tenant isolation');
  }
  
  const fields: string[] = [];
  const values: string[] = [];

  if (data.title !== undefined) {
    fields.push('title = ?');
    values.push(data.title);
  }
  if (data.endpoint !== undefined) {
    fields.push('endpoint = ?');
    values.push(data.endpoint);
  }
  if (data.model !== undefined) {
    fields.push('model = ?');
    values.push(data.model);
  }

  if (fields.length === 0) {
    // Just update the timestamp
    fields.push("updated_at = datetime('now')");
  } else {
    fields.push("updated_at = datetime('now')");
  }
  
  values.push(id);
  values.push(userId);

  const query = `UPDATE conversations SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`;
  const stmt = db.prepare(query).bind(...values);

  const result = await stmt.run();
  if (result.meta.changes === 0) {
    return null;
  }

  return findByIdForUser(db, id, userId);
}

/**
 * Delete a conversation by ID with ownership check
 * SECURITY: userId is now REQUIRED to prevent tenant isolation bypass
 * @param db - D1 database instance
 * @param id - Conversation ID
 * @param userId - User ID (REQUIRED for tenant isolation)
 * @returns True if deleted, false if not found or not owned
 * @throws Error if userId is not provided
 */
export async function deleteConversation(db: D1Database, id: string, userId: string): Promise<boolean> {
  // SECURITY: userId is mandatory - throw if not provided
  if (!userId) {
    throw new Error('[SECURITY] deleteConversation requires userId for tenant isolation');
  }
  const stmt = db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').bind(id, userId);
  const result = await stmt.run();
  return result.meta.changes > 0;
}

/**
 * Archive a conversation (soft delete by marking as archived)
 * Note: This implementation deletes the conversation. For true archiving,
 * add an 'archived' column to the schema.
 * @param db - D1 database instance
 * @param id - Conversation ID
 * @param userId - User ID (required for tenant isolation)
 * @returns True if archived, false if not found/not owned
 */
export async function archive(db: D1Database, id: string, userId: string): Promise<boolean> {
  // For now, archiving is the same as deleting
  // To implement true archiving, add an 'archived' column to the schema
  return deleteConversation(db, id, userId);
}

/**
 * Search conversations by title using FTS5
 * Note: This requires a conversations_fts virtual table. Falls back to LIKE search.
 * @param db - D1 database instance
 * @param userId - User ID (only search user's own conversations)
 * @param query - Search query string
 * @returns List of matching conversations
 */
export async function search(
  db: D1Database,
  userId: string,
  query: string
): Promise<Conversation[]> {
  // Sanitize query for LIKE pattern
  const sanitized = query.replace(/[%_]/g, '\\$&');
  const pattern = `%${sanitized}%`;

  const stmt = db
    .prepare(
      `SELECT * FROM conversations 
       WHERE user_id = ? AND title LIKE ? ESCAPE '\\'
       ORDER BY updated_at DESC
       LIMIT 50`
    )
    .bind(userId, pattern);

  const result = await stmt.all<ConversationRow>();
  return (result.results ?? []).map(rowToConversation);
}

/**
 * Touch a conversation to update its updated_at timestamp
 * @param db - D1 database instance
 * @param id - Conversation ID
 * @param userId - User ID (required for tenant isolation)
 * @returns True if touched, false if not found/not owned
 */
export async function touch(db: D1Database, id: string, userId: string): Promise<boolean> {
  const stmt = db
    .prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .bind(id, userId);
  const result = await stmt.run();
  return result.meta.changes > 0;
}

/**
 * Count total conversations for a user
 * @param db - D1 database instance
 * @param userId - User ID
 * @returns Total count of conversations
 */
export async function countByUser(db: D1Database, userId: string): Promise<number> {
  const stmt = db
    .prepare('SELECT COUNT(*) as count FROM conversations WHERE user_id = ?')
    .bind(userId);
  const result = await stmt.first<{ count: number }>();
  return result?.count ?? 0;
}
