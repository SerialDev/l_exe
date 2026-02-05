/**
 * Session Repository
 * Type-safe D1 queries for session management
 */

/**
 * Session entity as stored in the database
 */
export interface SessionRow {
  id: string;
  user_id: string;
  refresh_token: string;
  expires_at: string;
  created_at: string;
}

/**
 * Session entity with normalized field names
 */
export interface Session {
  id: string;
  userId: string;
  refreshToken: string;
  expiresAt: string;
  createdAt: string;
}

/**
 * Data required to create a new session
 */
export interface CreateSessionData {
  id: string;
  userId: string;
  refreshToken: string;
  expiresAt: Date | string;
}

/**
 * Converts a database row to a Session entity
 */
function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/**
 * Find a session by its unique ID
 * @param db - D1 database instance
 * @param id - Session ID
 * @returns Session or null if not found
 */
export async function findById(db: D1Database, id: string): Promise<Session | null> {
  const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id);
  const result = await stmt.first<SessionRow>();
  return result ? rowToSession(result) : null;
}

/**
 * Find a session by refresh token
 * @param db - D1 database instance
 * @param refreshToken - Refresh token
 * @returns Session or null if not found or expired
 */
export async function findByToken(
  db: D1Database,
  refreshToken: string
): Promise<Session | null> {
  const stmt = db
    .prepare(
      "SELECT * FROM sessions WHERE refresh_token = ? AND expires_at > datetime('now')"
    )
    .bind(refreshToken);
  const result = await stmt.first<SessionRow>();
  return result ? rowToSession(result) : null;
}

/**
 * Find all sessions for a user
 * @param db - D1 database instance
 * @param userId - User ID
 * @param includeExpired - Whether to include expired sessions (default: false)
 * @returns List of sessions
 */
export async function findByUser(
  db: D1Database,
  userId: string,
  includeExpired = false
): Promise<Session[]> {
  const query = includeExpired
    ? 'SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC'
    : "SELECT * FROM sessions WHERE user_id = ? AND expires_at > datetime('now') ORDER BY created_at DESC";

  const stmt = db.prepare(query).bind(userId);
  const result = await stmt.all<SessionRow>();
  return (result.results ?? []).map(rowToSession);
}

/**
 * Create a new session
 * @param db - D1 database instance
 * @param session - Session data to insert
 * @returns Created session
 * @throws Error if creation fails
 */
export async function create(db: D1Database, session: CreateSessionData): Promise<Session> {
  const now = new Date().toISOString();
  const expiresAt =
    session.expiresAt instanceof Date
      ? session.expiresAt.toISOString()
      : session.expiresAt;

  const stmt = db
    .prepare(
      `INSERT INTO sessions (id, user_id, refresh_token, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(session.id, session.userId, session.refreshToken, expiresAt, now);

  await stmt.run();

  const created = await findById(db, session.id);
  if (!created) {
    throw new Error('Failed to create session');
  }
  return created;
}

/**
 * Delete a session by ID
 * @param db - D1 database instance
 * @param id - Session ID
 * @returns True if deleted, false if not found
 */
export async function deleteSession(db: D1Database, id: string): Promise<boolean> {
  const stmt = db.prepare('DELETE FROM sessions WHERE id = ?').bind(id);
  const result = await stmt.run();
  return result.meta.changes > 0;
}

/**
 * Delete a session by refresh token
 * @param db - D1 database instance
 * @param refreshToken - Refresh token
 * @returns True if deleted, false if not found
 */
export async function deleteByToken(db: D1Database, refreshToken: string): Promise<boolean> {
  const stmt = db.prepare('DELETE FROM sessions WHERE refresh_token = ?').bind(refreshToken);
  const result = await stmt.run();
  return result.meta.changes > 0;
}

/**
 * Delete all sessions for a user (logout from all devices)
 * @param db - D1 database instance
 * @param userId - User ID
 * @returns Number of sessions deleted
 */
export async function deleteByUser(db: D1Database, userId: string): Promise<number> {
  const stmt = db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId);
  const result = await stmt.run();
  return result.meta.changes;
}

/**
 * Delete all expired sessions (cleanup job)
 * @param db - D1 database instance
 * @returns Number of sessions deleted
 */
export async function deleteExpired(db: D1Database): Promise<number> {
  const stmt = db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')");
  const result = await stmt.run();
  return result.meta.changes;
}

/**
 * Extend a session's expiration time
 * @param db - D1 database instance
 * @param id - Session ID
 * @param newExpiresAt - New expiration time
 * @returns True if extended, false if session not found
 */
export async function extend(
  db: D1Database,
  id: string,
  newExpiresAt: Date | string
): Promise<boolean> {
  const expiresAt =
    newExpiresAt instanceof Date ? newExpiresAt.toISOString() : newExpiresAt;

  const stmt = db
    .prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
    .bind(expiresAt, id);
  const result = await stmt.run();
  return result.meta.changes > 0;
}

/**
 * Rotate a session's refresh token
 * @param db - D1 database instance
 * @param id - Session ID
 * @param newRefreshToken - New refresh token
 * @param newExpiresAt - New expiration time
 * @returns Updated session or null if not found
 */
export async function rotateToken(
  db: D1Database,
  id: string,
  newRefreshToken: string,
  newExpiresAt: Date | string
): Promise<Session | null> {
  const expiresAt =
    newExpiresAt instanceof Date ? newExpiresAt.toISOString() : newExpiresAt;

  const stmt = db
    .prepare('UPDATE sessions SET refresh_token = ?, expires_at = ? WHERE id = ?')
    .bind(newRefreshToken, expiresAt, id);
  const result = await stmt.run();

  if (result.meta.changes === 0) {
    return null;
  }

  return findById(db, id);
}

/**
 * Count active sessions for a user
 * @param db - D1 database instance
 * @param userId - User ID
 * @returns Number of active sessions
 */
export async function countByUser(db: D1Database, userId: string): Promise<number> {
  const stmt = db
    .prepare(
      "SELECT COUNT(*) as count FROM sessions WHERE user_id = ? AND expires_at > datetime('now')"
    )
    .bind(userId);
  const result = await stmt.first<{ count: number }>();
  return result?.count ?? 0;
}

/**
 * Check if a session is valid (exists and not expired)
 * @param db - D1 database instance
 * @param id - Session ID
 * @returns True if session is valid
 */
export async function isValid(db: D1Database, id: string): Promise<boolean> {
  const stmt = db
    .prepare(
      "SELECT 1 FROM sessions WHERE id = ? AND expires_at > datetime('now')"
    )
    .bind(id);
  const result = await stmt.first();
  return result !== null;
}

/**
 * Delete sessions older than a certain date (for cleanup)
 * @param db - D1 database instance
 * @param olderThan - Delete sessions created before this date
 * @returns Number of sessions deleted
 */
export async function deleteOlderThan(
  db: D1Database,
  olderThan: Date | string
): Promise<number> {
  const date = olderThan instanceof Date ? olderThan.toISOString() : olderThan;
  const stmt = db.prepare('DELETE FROM sessions WHERE created_at < ?').bind(date);
  const result = await stmt.run();
  return result.meta.changes;
}
