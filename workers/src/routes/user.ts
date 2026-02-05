/**
 * User routes
 * GET /, PATCH /, DELETE /, GET /balance, PATCH /password
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { AuthContext } from '../middleware/auth';
import { hashPassword, verifyPassword } from '../services/auth';

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
const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  username: z.string().min(3).max(30).optional(),
  avatar: z.string().url().optional().nullable(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

const updatePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8),
  confirmPassword: z.string().min(8),
}).refine(data => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

// Create router
const user = new Hono<{ Bindings: Env; Variables: Variables }>();

// Helper to get user from context
function getUser(c: any): AuthContext['user'] | null {
  return c.get('user') || null;
}

/**
 * GET /
 * Get current user profile
 * 
 * Note: Queries from better-auth 'user' table (singular)
 */
user.get('/', async (c) => {
  const authUser = getUser(c);
  if (!authUser) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  try {
    // Query from better-auth 'user' table (singular, not 'users')
    const userData = await c.env.DB
      .prepare(`
        SELECT 
          id,
          email,
          name,
          image as avatar,
          role,
          emailVerified,
          createdAt,
          updatedAt
        FROM user WHERE id = ?
      `)
      .bind(authUser.id)
      .first();

    if (!userData) {
      return c.json({
        success: false,
        error: { message: 'User not found' },
      }, 404);
    }

    return c.json({
      success: true,
      user: {
        ...userData,
        username: authUser.username || (userData as any).email?.split('@')[0],
        emailVerified: Boolean((userData as any).emailVerified),
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to fetch user' },
    }, 500);
  }
});

/**
 * PATCH /
 * Update current user profile
 * 
 * Note: Updates better-auth 'user' table (singular)
 */
user.patch('/', zValidator('json', updateUserSchema), async (c) => {
  const authUser = getUser(c);
  if (!authUser) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const updates = c.req.valid('json');
  const now = new Date().toISOString();

  try {
    // Build update query dynamically for better-auth 'user' table
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    // Note: better-auth uses 'image' not 'avatar'
    if (updates.avatar !== undefined) {
      fields.push('image = ?');
      values.push(updates.avatar);
    }

    fields.push('updatedAt = ?');
    values.push(now);
    values.push(authUser.id);

    await c.env.DB
      .prepare(`UPDATE user SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    // Fetch updated user from better-auth 'user' table
    const userData = await c.env.DB
      .prepare(`
        SELECT 
          id, email, name, image as avatar, role,
          emailVerified, createdAt, updatedAt
        FROM user WHERE id = ?
      `)
      .bind(authUser.id)
      .first();

    return c.json({
      success: true,
      user: {
        ...userData,
        username: (userData as any)?.email?.split('@')[0],
        emailVerified: Boolean((userData as any)?.emailVerified),
      },
    });
  } catch (error) {
    console.error('Update user error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to update user' },
    }, 500);
  }
});

/**
 * PATCH /password
 * Update user password
 * 
 * Note: better-auth stores passwords in the 'account' table, not 'user'
 * Use better-auth's changePassword endpoint instead: POST /api/auth/change-password
 */
user.patch('/password', zValidator('json', updatePasswordSchema), async (c) => {
  const authUser = getUser(c);
  if (!authUser) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const { currentPassword, newPassword } = c.req.valid('json');

  try {
    // Get current password from better-auth 'account' table
    const accountData = await c.env.DB
      .prepare('SELECT password, providerId FROM account WHERE userId = ? AND providerId = ?')
      .bind(authUser.id, 'credential')
      .first<{ password: string | null; providerId: string }>();

    if (!accountData) {
      return c.json({
        success: false,
        error: { message: 'No password set for this account. Use better-auth change-password endpoint.' },
      }, 400);
    }

    // Can't change password for OAuth users without existing password
    if (accountData.providerId !== 'credential' || !accountData.password) {
      return c.json({
        success: false,
        error: { message: 'Cannot change password for OAuth accounts' },
      }, 400);
    }

    // Verify current password (better-auth uses format: salt:hash)
    const [salt, hash] = accountData.password.split(':');
    if (salt && hash) {
      const isValid = await verifyPassword(currentPassword, accountData.password);
      if (!isValid) {
        return c.json({
          success: false,
          error: { message: 'Current password is incorrect' },
        }, 400);
      }
    }

    // Hash new password
    const newHash = await hashPassword(newPassword);
    const now = new Date().toISOString();

    // Update password in account table
    await c.env.DB
      .prepare('UPDATE account SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = ?')
      .bind(newHash, now, authUser.id, 'credential')
      .run();

    return c.json({
      success: true,
      message: 'Password updated successfully',
    });
  } catch (error) {
    console.error('Update password error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to update password' },
    }, 500);
  }
});

/**
 * DELETE /
 * Delete current user account
 * 
 * Note: Deletes from better-auth tables (user, session, account)
 * The CASCADE delete on foreign keys handles session/account cleanup
 */
user.delete('/', async (c) => {
  const authUser = getUser(c);
  if (!authUser) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  try {
    // Delete in order: messages -> conversations -> presets -> files -> user
    
    // Get user's conversations
    const convos = await c.env.DB
      .prepare('SELECT conversation_id FROM conversations WHERE user_id = ?')
      .bind(authUser.id)
      .all<{ conversation_id: string }>();

    // Delete all messages in user's conversations
    for (const convo of convos.results || []) {
      await c.env.DB
        .prepare('DELETE FROM messages WHERE conversation_id = ?')
        .bind(convo.conversation_id)
        .run();
    }

    // Delete conversations
    await c.env.DB
      .prepare('DELETE FROM conversations WHERE user_id = ?')
      .bind(authUser.id)
      .run();

    // Delete presets
    await c.env.DB
      .prepare('DELETE FROM presets WHERE user_id = ?')
      .bind(authUser.id)
      .run();

    // Delete from better-auth tables (CASCADE handles session/account)
    await c.env.DB
      .prepare('DELETE FROM user WHERE id = ?')
      .bind(authUser.id)
      .run();

    return c.json({
      success: true,
      message: 'Account deleted successfully',
    });
  } catch (error) {
    console.error('Delete user error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to delete account' },
    }, 500);
  }
});

/**
 * GET /balance
 * Get user's token balance and usage
 */
user.get('/balance', async (c) => {
  const authUser = getUser(c);
  if (!authUser) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  try {
    // For now, return unlimited usage (no billing implemented)
    return c.json({
      success: true,
      balance: {
        balance: -1, // -1 means unlimited
        tokensUsed: 0,
        tokensRemaining: -1,
        plan: 'free',
        expiresAt: null,
      },
    });
  } catch (error) {
    console.error('Get balance error:', error);
    return c.json({
      success: false,
      error: { message: 'Failed to fetch balance' },
    }, 500);
  }
});

export { user };
export default user;
