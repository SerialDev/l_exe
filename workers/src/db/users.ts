/**
 * User Repository
 * Type-safe D1 queries for user management
 */

/**
 * User entity as stored in the database
 */
export interface UserRow {
  id: string;
  email: string;
  username: string;
  name: string;
  avatar: string | null;
  password_hash: string | null;
  role: 'user' | 'admin';
  provider: 'local' | 'google' | 'github' | 'discord' | 'openid';
  provider_id: string | null;
  email_verified: number;
  terms_accepted: number;
  created_at: string;
  updated_at: string;
}

/**
 * User entity with normalized field names
 */
export interface User {
  id: string;
  email: string;
  username: string;
  name: string;
  avatar: string | null;
  passwordHash: string | null;
  role: 'user' | 'admin';
  provider: 'local' | 'google' | 'github' | 'discord' | 'openid';
  providerId: string | null;
  emailVerified: boolean;
  termsAccepted: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Data required to create a new user
 */
export interface CreateUserData {
  id: string;
  email: string;
  username: string;
  name: string;
  avatar?: string;
  passwordHash?: string;
  role?: 'user' | 'admin';
  provider?: 'local' | 'google' | 'github' | 'discord' | 'openid';
  providerId?: string;
  emailVerified?: boolean;
  termsAccepted?: boolean;
}

/**
 * Data that can be updated on a user
 */
export interface UpdateUserData {
  email?: string;
  username?: string;
  name?: string;
  avatar?: string;
  role?: 'user' | 'admin';
  emailVerified?: boolean;
  termsAccepted?: boolean;
}

/**
 * Converts a database row to a User entity
 */
function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    name: row.name,
    avatar: row.avatar,
    passwordHash: row.password_hash,
    role: row.role,
    provider: row.provider,
    providerId: row.provider_id,
    emailVerified: row.email_verified === 1,
    termsAccepted: row.terms_accepted === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Find a user by their unique ID
 * @param db - D1 database instance
 * @param id - User ID
 * @returns User or null if not found
 */
export async function findById(db: D1Database, id: string): Promise<User | null> {
  const stmt = db.prepare('SELECT * FROM users WHERE id = ?').bind(id);
  const result = await stmt.first<UserRow>();
  return result ? rowToUser(result) : null;
}

/**
 * Find a user by their email address
 * @param db - D1 database instance
 * @param email - User email
 * @returns User or null if not found
 */
export async function findByEmail(db: D1Database, email: string): Promise<User | null> {
  const stmt = db.prepare('SELECT * FROM users WHERE email = ?').bind(email);
  const result = await stmt.first<UserRow>();
  return result ? rowToUser(result) : null;
}

/**
 * Find a user by their username
 * @param db - D1 database instance
 * @param username - Username
 * @returns User or null if not found
 */
export async function findByUsername(db: D1Database, username: string): Promise<User | null> {
  const stmt = db.prepare('SELECT * FROM users WHERE username = ?').bind(username);
  const result = await stmt.first<UserRow>();
  return result ? rowToUser(result) : null;
}

/**
 * Find a user by OAuth provider credentials
 * @param db - D1 database instance
 * @param provider - OAuth provider name
 * @param providerId - Provider-specific user ID
 * @returns User or null if not found
 */
export async function findByProvider(
  db: D1Database,
  provider: string,
  providerId: string
): Promise<User | null> {
  const stmt = db
    .prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?')
    .bind(provider, providerId);
  const result = await stmt.first<UserRow>();
  return result ? rowToUser(result) : null;
}

/**
 * Create a new user
 * @param db - D1 database instance
 * @param user - User data to insert
 * @returns Created user
 * @throws Error if user creation fails (e.g., duplicate email/username)
 */
export async function create(db: D1Database, user: CreateUserData): Promise<User> {
  const now = new Date().toISOString();
  const stmt = db
    .prepare(
      `INSERT INTO users (id, email, username, name, avatar, password_hash, role, provider, provider_id, email_verified, terms_accepted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      user.id,
      user.email,
      user.username,
      user.name,
      user.avatar ?? null,
      user.passwordHash ?? null,
      user.role ?? 'user',
      user.provider ?? 'local',
      user.providerId ?? null,
      user.emailVerified ? 1 : 0,
      user.termsAccepted ? 1 : 0,
      now,
      now
    );

  await stmt.run();

  const created = await findById(db, user.id);
  if (!created) {
    throw new Error('Failed to create user');
  }
  return created;
}

/**
 * Update an existing user
 * @param db - D1 database instance
 * @param id - User ID
 * @param data - Fields to update
 * @returns Updated user or null if not found
 */
export async function update(
  db: D1Database,
  id: string,
  data: UpdateUserData
): Promise<User | null> {
  const fields: string[] = [];
  const values: (string | number)[] = [];

  if (data.email !== undefined) {
    fields.push('email = ?');
    values.push(data.email);
  }
  if (data.username !== undefined) {
    fields.push('username = ?');
    values.push(data.username);
  }
  if (data.name !== undefined) {
    fields.push('name = ?');
    values.push(data.name);
  }
  if (data.avatar !== undefined) {
    fields.push('avatar = ?');
    values.push(data.avatar);
  }
  if (data.role !== undefined) {
    fields.push('role = ?');
    values.push(data.role);
  }
  if (data.emailVerified !== undefined) {
    fields.push('email_verified = ?');
    values.push(data.emailVerified ? 1 : 0);
  }
  if (data.termsAccepted !== undefined) {
    fields.push('terms_accepted = ?');
    values.push(data.termsAccepted ? 1 : 0);
  }

  if (fields.length === 0) {
    return findById(db, id);
  }

  fields.push("updated_at = datetime('now')");
  values.push(id);

  const stmt = db
    .prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values);

  const result = await stmt.run();
  if (result.meta.changes === 0) {
    return null;
  }

  return findById(db, id);
}

/**
 * Delete a user by ID
 * @param db - D1 database instance
 * @param id - User ID
 * @returns True if deleted, false if not found
 */
export async function deleteUser(db: D1Database, id: string): Promise<boolean> {
  const stmt = db.prepare('DELETE FROM users WHERE id = ?').bind(id);
  const result = await stmt.run();
  return result.meta.changes > 0;
}

/**
 * Update a user's password hash
 * @param db - D1 database instance
 * @param id - User ID
 * @param hash - New password hash
 * @returns True if updated, false if user not found
 */
export async function updatePassword(
  db: D1Database,
  id: string,
  hash: string
): Promise<boolean> {
  const stmt = db
    .prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(hash, id);
  const result = await stmt.run();
  return result.meta.changes > 0;
}

/**
 * Mark a user's email as verified
 * @param db - D1 database instance
 * @param id - User ID
 * @returns True if updated, false if user not found
 */
export async function verifyEmail(db: D1Database, id: string): Promise<boolean> {
  const stmt = db
    .prepare("UPDATE users SET email_verified = 1, updated_at = datetime('now') WHERE id = ?")
    .bind(id);
  const result = await stmt.run();
  return result.meta.changes > 0;
}
