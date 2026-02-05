/**
 * File Repository
 * Type-safe D1 queries for file metadata management
 * Note: Actual file content is stored in R2, this repository handles metadata only
 */

/**
 * File entity as stored in the database
 */
export interface FileRow {
  id: string;
  user_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size: number;
  r2_key: string;
  purpose: 'attachment' | 'avatar' | 'export' | 'rag';
  created_at: string;
}

/**
 * File entity with normalized field names
 */
export interface FileMetadata {
  id: string;
  userId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  r2Key: string;
  purpose: 'attachment' | 'avatar' | 'export' | 'rag';
  createdAt: string;
}

/**
 * Data required to create a new file record
 */
export interface CreateFileData {
  id: string;
  userId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  r2Key: string;
  purpose?: 'attachment' | 'avatar' | 'export' | 'rag';
}

/**
 * Data that can be updated on a file record
 */
export interface UpdateFileData {
  filename?: string;
  originalName?: string;
  purpose?: 'attachment' | 'avatar' | 'export' | 'rag';
}

/**
 * Options for finding files
 */
export interface FindFilesOptions {
  purpose?: 'attachment' | 'avatar' | 'export' | 'rag';
  mimeTypePrefix?: string;
  limit?: number;
  offset?: number;
}

/**
 * Converts a database row to a FileMetadata entity
 */
function rowToFile(row: FileRow): FileMetadata {
  return {
    id: row.id,
    userId: row.user_id,
    filename: row.filename,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: row.size,
    r2Key: row.r2_key,
    purpose: row.purpose,
    createdAt: row.created_at,
  };
}

/**
 * Find a file by its unique ID
 * @param db - D1 database instance
 * @param id - File ID
 * @returns File metadata or null if not found
 */
export async function findById(db: D1Database, id: string): Promise<FileMetadata | null> {
  const stmt = db.prepare('SELECT * FROM files WHERE id = ?').bind(id);
  const result = await stmt.first<FileRow>();
  return result ? rowToFile(result) : null;
}

/**
 * Find a file by its R2 storage key
 * @param db - D1 database instance
 * @param r2Key - R2 object key
 * @returns File metadata or null if not found
 */
export async function findByR2Key(db: D1Database, r2Key: string): Promise<FileMetadata | null> {
  const stmt = db.prepare('SELECT * FROM files WHERE r2_key = ?').bind(r2Key);
  const result = await stmt.first<FileRow>();
  return result ? rowToFile(result) : null;
}

/**
 * Find all files for a user with optional filtering
 * @param db - D1 database instance
 * @param userId - User ID
 * @param options - Filter and pagination options
 * @returns List of file metadata
 */
export async function findByUser(
  db: D1Database,
  userId: string,
  options: FindFilesOptions = {}
): Promise<FileMetadata[]> {
  const values: (string | number)[] = [userId];
  let whereClause = 'WHERE user_id = ?';

  if (options.purpose) {
    whereClause += ' AND purpose = ?';
    values.push(options.purpose);
  }

  if (options.mimeTypePrefix) {
    whereClause += " AND mime_type LIKE ? ESCAPE '\\'";
    const sanitized = options.mimeTypePrefix.replace(/[%_]/g, '\\$&');
    values.push(`${sanitized}%`);
  }

  const limit = Math.min(options.limit ?? 100, 500);
  const offset = options.offset ?? 0;
  values.push(limit, offset);

  const stmt = db
    .prepare(
      `SELECT * FROM files ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...values);

  const result = await stmt.all<FileRow>();
  return (result.results ?? []).map(rowToFile);
}

/**
 * Find files by multiple IDs
 * @param db - D1 database instance
 * @param ids - Array of file IDs
 * @returns List of found file metadata
 */
export async function findByIds(db: D1Database, ids: string[]): Promise<FileMetadata[]> {
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => '?').join(', ');
  const stmt = db
    .prepare(`SELECT * FROM files WHERE id IN (${placeholders})`)
    .bind(...ids);

  const result = await stmt.all<FileRow>();
  return (result.results ?? []).map(rowToFile);
}

/**
 * Create a new file metadata record
 * @param db - D1 database instance
 * @param file - File data to insert
 * @returns Created file metadata
 * @throws Error if creation fails (e.g., duplicate r2_key)
 */
export async function create(db: D1Database, file: CreateFileData): Promise<FileMetadata> {
  const now = new Date().toISOString();
  const stmt = db
    .prepare(
      `INSERT INTO files (id, user_id, filename, original_name, mime_type, size, r2_key, purpose, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      file.id,
      file.userId,
      file.filename,
      file.originalName,
      file.mimeType,
      file.size,
      file.r2Key,
      file.purpose ?? 'attachment',
      now
    );

  await stmt.run();

  const created = await findById(db, file.id);
  if (!created) {
    throw new Error('Failed to create file record');
  }
  return created;
}

/**
 * Update an existing file record
 * @param db - D1 database instance
 * @param id - File ID
 * @param data - Fields to update
 * @returns Updated file metadata or null if not found
 */
export async function update(
  db: D1Database,
  id: string,
  data: UpdateFileData
): Promise<FileMetadata | null> {
  const fields: string[] = [];
  const values: string[] = [];

  if (data.filename !== undefined) {
    fields.push('filename = ?');
    values.push(data.filename);
  }
  if (data.originalName !== undefined) {
    fields.push('original_name = ?');
    values.push(data.originalName);
  }
  if (data.purpose !== undefined) {
    fields.push('purpose = ?');
    values.push(data.purpose);
  }

  if (fields.length === 0) {
    return findById(db, id);
  }

  values.push(id);

  const stmt = db
    .prepare(`UPDATE files SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values);

  const result = await stmt.run();
  if (result.meta.changes === 0) {
    return null;
  }

  return findById(db, id);
}

/**
 * Delete a file record by ID
 * Note: This only deletes the metadata, the R2 object should be deleted separately
 * @param db - D1 database instance
 * @param id - File ID
 * @returns The deleted file metadata (for R2 cleanup) or null if not found
 */
export async function deleteFile(db: D1Database, id: string): Promise<FileMetadata | null> {
  // Get the file first so we can return it for R2 cleanup
  const file = await findById(db, id);
  if (!file) {
    return null;
  }

  const stmt = db.prepare('DELETE FROM files WHERE id = ?').bind(id);
  await stmt.run();

  return file;
}

/**
 * Delete all files for a user
 * Note: Returns r2Keys for cleanup
 * @param db - D1 database instance
 * @param userId - User ID
 * @returns Array of R2 keys to delete
 */
export async function deleteByUser(db: D1Database, userId: string): Promise<string[]> {
  // Get all r2 keys first for cleanup
  const files = await findByUser(db, userId, { limit: 10000 });
  const r2Keys = files.map((f) => f.r2Key);

  const stmt = db.prepare('DELETE FROM files WHERE user_id = ?').bind(userId);
  await stmt.run();

  return r2Keys;
}

/**
 * Get total storage used by a user
 * @param db - D1 database instance
 * @param userId - User ID
 * @returns Total bytes used
 */
export async function getTotalSize(db: D1Database, userId: string): Promise<number> {
  const stmt = db
    .prepare('SELECT COALESCE(SUM(size), 0) as total FROM files WHERE user_id = ?')
    .bind(userId);
  const result = await stmt.first<{ total: number }>();
  return result?.total ?? 0;
}

/**
 * Count files for a user
 * @param db - D1 database instance
 * @param userId - User ID
 * @param purpose - Optional purpose filter
 * @returns Total count of files
 */
export async function countByUser(
  db: D1Database,
  userId: string,
  purpose?: 'attachment' | 'avatar' | 'export' | 'rag'
): Promise<number> {
  let query = 'SELECT COUNT(*) as count FROM files WHERE user_id = ?';
  const values: string[] = [userId];

  if (purpose) {
    query += ' AND purpose = ?';
    values.push(purpose);
  }

  const stmt = db.prepare(query).bind(...values);
  const result = await stmt.first<{ count: number }>();
  return result?.count ?? 0;
}

/**
 * Check if a user owns a file
 * @param db - D1 database instance
 * @param fileId - File ID
 * @param userId - User ID
 * @returns True if user owns the file
 */
export async function isOwner(
  db: D1Database,
  fileId: string,
  userId: string
): Promise<boolean> {
  const stmt = db
    .prepare('SELECT 1 FROM files WHERE id = ? AND user_id = ?')
    .bind(fileId, userId);
  const result = await stmt.first();
  return result !== null;
}
