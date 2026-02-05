/**
 * Encryption Key Management Routes
 * 
 * Handles storage and retrieval of user encryption keys.
 * The actual encryption/decryption happens client-side.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
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

interface EncryptionKeyData {
  wrappedKey: string;  // Base64
  keyIv: string;       // Base64
  salt: string;        // Base64
}

/**
 * GET /keys
 * Get the user's wrapped encryption key (if exists)
 */
app.get('/', async (c) => {
  const userId = c.get('userId');
  
  const key = await c.env.DB
    .prepare('SELECT wrapped_key, key_iv, salt, version FROM user_encryption_keys WHERE user_id = ?')
    .bind(userId)
    .first<{ wrapped_key: string; key_iv: string; salt: string; version: number }>();
  
  if (!key) {
    return c.json({ exists: false });
  }
  
  return c.json({
    exists: true,
    wrappedKey: key.wrapped_key,
    keyIv: key.key_iv,
    salt: key.salt,
    version: key.version,
  });
});

/**
 * POST /keys
 * Store a new wrapped encryption key for the user
 * Called during first-time setup or key rotation
 */
app.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<EncryptionKeyData>();
  
  if (!body.wrappedKey || !body.keyIv || !body.salt) {
    throw new HTTPException(400, { message: 'Missing required fields: wrappedKey, keyIv, salt' });
  }
  
  // Check if key already exists
  const existing = await c.env.DB
    .prepare('SELECT id FROM user_encryption_keys WHERE user_id = ?')
    .bind(userId)
    .first();
  
  if (existing) {
    throw new HTTPException(409, { message: 'Encryption key already exists. Use PUT to update.' });
  }
  
  // Insert new key
  await c.env.DB
    .prepare(`
      INSERT INTO user_encryption_keys (user_id, wrapped_key, key_iv, salt, version)
      VALUES (?, ?, ?, ?, 1)
    `)
    .bind(userId, body.wrappedKey, body.keyIv, body.salt)
    .run();
  
  return c.json({ success: true, message: 'Encryption key stored' });
});

/**
 * PUT /keys
 * Update the wrapped encryption key (for password change)
 * The client re-wraps the master key with the new password-derived key
 */
app.put('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<EncryptionKeyData>();
  
  if (!body.wrappedKey || !body.keyIv || !body.salt) {
    throw new HTTPException(400, { message: 'Missing required fields: wrappedKey, keyIv, salt' });
  }
  
  // Update existing key with new version
  const result = await c.env.DB
    .prepare(`
      UPDATE user_encryption_keys 
      SET wrapped_key = ?, key_iv = ?, salt = ?, version = version + 1, updated_at = datetime('now')
      WHERE user_id = ?
    `)
    .bind(body.wrappedKey, body.keyIv, body.salt, userId)
    .run();
  
  if (result.meta.changes === 0) {
    throw new HTTPException(404, { message: 'No encryption key found to update' });
  }
  
  return c.json({ success: true, message: 'Encryption key updated' });
});

/**
 * DELETE /keys
 * Delete the encryption key (WARNING: makes all encrypted data unrecoverable!)
 * This should only be called when the user explicitly wants to reset
 */
app.delete('/', async (c) => {
  const userId = c.get('userId');
  
  await c.env.DB
    .prepare('DELETE FROM user_encryption_keys WHERE user_id = ?')
    .bind(userId)
    .run();
  
  return c.json({ success: true, message: 'Encryption key deleted' });
});

export { app as encryption };
export default app;
