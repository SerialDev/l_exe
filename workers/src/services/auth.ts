/**
 * Authentication service for Cloudflare Workers
 * Uses Web Crypto API and jose library for edge-compatible auth
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import {
  generateRandomBytes,
  bufferToHex,
  hexToBuffer,
  timingSafeEqual,
  generateUUID,
} from './crypto';

// Password hashing configuration
// OWASP 2023 recommends 310,000 iterations for PBKDF2-SHA256
// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
const PBKDF2_ITERATIONS = 310000;
const SALT_LENGTH = 32;  // 256 bits - exceeds OWASP minimum of 128 bits
const HASH_LENGTH = 64;  // 512 bits output

// Token expiration times
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

// JWT payload types
export interface AccessTokenPayload extends JWTPayload {
  sub: string;
  type: 'access';
}

export interface RefreshTokenPayload extends JWTPayload {
  sub: string;
  type: 'refresh';
  jti: string;
}

// User registration input
export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
}

// Session data
export interface Session {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: number;
  createdAt: number;
}

// Auth response
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// User type
export interface User {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Hash a password using PBKDF2 with SHA-256
 * Returns format: iterations:salt:hash (all hex encoded)
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = generateRandomBytes(SALT_LENGTH);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_LENGTH * 8
  );

  const saltHex = bufferToHex(salt.buffer as ArrayBuffer);
  const hashHex = bufferToHex(hashBuffer);

  return `${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
}

/**
 * Verify a password against a stored hash
 * Uses timing-safe comparison to prevent timing attacks
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const [iterationsStr, saltHex, expectedHashHex] = storedHash.split(':');

  if (!iterationsStr || !saltHex || !expectedHashHex) {
    return false;
  }

  const iterations = parseInt(iterationsStr, 10);
  if (isNaN(iterations)) {
    return false;
  }

  const encoder = new TextEncoder();
  const salt = hexToBuffer(saltHex);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_LENGTH * 8
  );

  const computedHashHex = bufferToHex(hashBuffer);
  return timingSafeEqual(computedHashHex, expectedHashHex);
}

/**
 * Generate an access token JWT
 */
export async function generateAccessToken(
  userId: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const secretKey = encoder.encode(secret);

  return new SignJWT({ type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(secretKey);
}

/**
 * Generate a refresh token JWT with unique identifier
 */
export async function generateRefreshToken(
  userId: string,
  secret: string
): Promise<{ token: string; jti: string }> {
  const encoder = new TextEncoder();
  const secretKey = encoder.encode(secret);
  const jti = generateUUID();

  const token = await new SignJWT({ type: 'refresh', jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(secretKey);

  return { token, jti };
}

/**
 * Verify and decode a JWT token
 */
export async function verifyToken<T extends JWTPayload>(
  token: string,
  secret: string
): Promise<T | null> {
  try {
    const encoder = new TextEncoder();
    const secretKey = encoder.encode(secret);

    const { payload } = await jwtVerify(token, secretKey);
    return payload as T;
  } catch {
    return null;
  }
}

/**
 * Create a new session in the database
 */
export async function createSession(
  db: D1Database,
  userId: string,
  refreshToken: string
): Promise<Session> {
  const sessionId = generateUUID();
  const now = Date.now();
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 days

  // Hash the refresh token for secure storage
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(refreshToken)
  );
  const refreshTokenHash = bufferToHex(hashBuffer);

  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(sessionId, userId, refreshTokenHash, expiresAt, now)
    .run();

  return {
    id: sessionId,
    userId,
    refreshTokenHash,
    expiresAt,
    createdAt: now,
  };
}

/**
 * Delete a session from the database
 */
export async function deleteSession(
  db: D1Database,
  sessionId: string
): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}

/**
 * Delete all sessions for a user
 */
export async function deleteUserSessions(
  db: D1Database,
  userId: string
): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

/**
 * Validate a refresh token against stored sessions
 */
export async function validateSession(
  db: D1Database,
  userId: string,
  refreshToken: string
): Promise<Session | null> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(refreshToken)
  );
  const refreshTokenHash = bufferToHex(hashBuffer);

  const result = await db
    .prepare(
      `SELECT id, user_id, refresh_token_hash, expires_at, created_at
       FROM sessions
       WHERE user_id = ? AND refresh_token_hash = ? AND expires_at > ?`
    )
    .bind(userId, refreshTokenHash, Date.now())
    .first<{
      id: string;
      user_id: string;
      refresh_token_hash: string;
      expires_at: number;
      created_at: number;
    }>();

  if (!result) {
    return null;
  }

  return {
    id: result.id,
    userId: result.user_id,
    refreshTokenHash: result.refresh_token_hash,
    expiresAt: result.expires_at,
    createdAt: result.created_at,
  };
}

/**
 * Register a new user
 */
export async function registerUser(
  db: D1Database,
  data: RegisterInput
): Promise<User> {
  // Check if user already exists
  const existingUser = await db
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(data.email.toLowerCase())
    .first();

  if (existingUser) {
    throw new Error('User with this email already exists');
  }

  const userId = generateUUID();
  const passwordHash = await hashPassword(data.password);
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      userId,
      data.email.toLowerCase(),
      data.name || null,
      passwordHash,
      now,
      now
    )
    .run();

  return {
    id: userId,
    email: data.email.toLowerCase(),
    name: data.name || null,
    passwordHash,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Login a user and return auth tokens
 */
export async function loginUser(
  db: D1Database,
  email: string,
  password: string,
  jwtSecret: string
): Promise<AuthTokens & { user: Omit<User, 'passwordHash'> }> {
  // Find user by email
  const user = await db
    .prepare(
      'SELECT id, email, name, password_hash, created_at, updated_at FROM users WHERE email = ?'
    )
    .bind(email.toLowerCase())
    .first<{
      id: string;
      email: string;
      name: string | null;
      password_hash: string;
      created_at: string;
      updated_at: string;
    }>();

  if (!user) {
    throw new Error('Invalid email or password');
  }

  // Verify password
  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) {
    throw new Error('Invalid email or password');
  }

  // Generate tokens
  const accessToken = await generateAccessToken(user.id, jwtSecret);
  const { token: refreshToken } = await generateRefreshToken(user.id, jwtSecret);

  // Create session
  await createSession(db, user.id, refreshToken);

  return {
    accessToken,
    refreshToken,
    expiresIn: 15 * 60, // 15 minutes in seconds
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    },
  };
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
  db: D1Database,
  refreshToken: string,
  jwtSecret: string
): Promise<AuthTokens | null> {
  // Verify refresh token
  const payload = await verifyToken<RefreshTokenPayload>(refreshToken, jwtSecret);
  if (!payload || payload.type !== 'refresh' || !payload.sub) {
    return null;
  }

  // Validate session
  const session = await validateSession(db, payload.sub, refreshToken);
  if (!session) {
    return null;
  }

  // Generate new access token
  const accessToken = await generateAccessToken(payload.sub, jwtSecret);

  // Optionally rotate refresh token (for enhanced security)
  const { token: newRefreshToken } = await generateRefreshToken(
    payload.sub,
    jwtSecret
  );

  // Delete old session and create new one
  await deleteSession(db, session.id);
  await createSession(db, payload.sub, newRefreshToken);

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn: 15 * 60,
  };
}

/**
 * Logout user by invalidating session
 */
export async function logoutUser(
  db: D1Database,
  refreshToken: string,
  jwtSecret: string
): Promise<void> {
  const payload = await verifyToken<RefreshTokenPayload>(refreshToken, jwtSecret);
  if (!payload || !payload.sub) {
    return;
  }

  const session = await validateSession(db, payload.sub, refreshToken);
  if (session) {
    await deleteSession(db, session.id);
  }
}

/**
 * Get user by ID
 */
export async function getUserById(
  db: D1Database,
  userId: string
): Promise<Omit<User, 'passwordHash'> | null> {
  const user = await db
    .prepare(
      'SELECT id, email, name, created_at, updated_at FROM users WHERE id = ?'
    )
    .bind(userId)
    .first<{
      id: string;
      email: string;
      name: string | null;
      created_at: string;
      updated_at: string;
    }>();

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

/**
 * Update user password
 */
export async function updatePassword(
  db: D1Database,
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = await db
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(userId)
    .first<{ password_hash: string }>();

  if (!user) {
    throw new Error('User not found');
  }

  const isValid = await verifyPassword(currentPassword, user.password_hash);
  if (!isValid) {
    throw new Error('Current password is incorrect');
  }

  const newPasswordHash = await hashPassword(newPassword);
  const now = new Date().toISOString();

  await db
    .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .bind(newPasswordHash, now, userId)
    .run();

  // Invalidate all sessions for security
  await deleteUserSessions(db, userId);
}
