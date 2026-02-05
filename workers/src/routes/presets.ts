/**
 * Presets routes
 * GET /, POST /, GET /:id, PATCH /:id, DELETE /:id
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { AuthContext } from '../middleware/auth';

// Types for Cloudflare bindings
interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  JWT_SECRET: string;
}

// Context variables
interface Variables {
  user: AuthContext['user'];
}

// Request schemas
const createPresetSchema = z.object({
  title: z.string().min(1).max(200),
  endpoint: z.string(),
  model: z.string(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().positive().optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  systemMessage: z.string().optional(),
  isDefault: z.boolean().optional(),
});

const updatePresetSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  endpoint: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional().nullable(),
  topP: z.number().min(0).max(1).optional().nullable(),
  maxTokens: z.number().positive().optional().nullable(),
  frequencyPenalty: z.number().min(-2).max(2).optional().nullable(),
  presencePenalty: z.number().min(-2).max(2).optional().nullable(),
  systemMessage: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

const listPresetsSchema = z.object({
  endpoint: z.string().optional(),
});

// Helper functions
function getUser(c: any): AuthContext['user'] | null {
  return c.get('user') || null;
}

function generateUUID(): string {
  return crypto.randomUUID();
}

// Create router
const presets = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /
 * List user's presets
 */
presets.get('/', zValidator('query', listPresetsSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const { endpoint } = c.req.valid('query');

  try {
    let query = `
      SELECT 
        id, user_id as userId, title, endpoint, model,
        temperature, top_p as topP, max_tokens as maxTokens,
        frequency_penalty as frequencyPenalty, presence_penalty as presencePenalty,
        system_message as systemMessage, is_default as isDefault,
        display_order as displayOrder, created_at as createdAt, updated_at as updatedAt
      FROM presets
      WHERE user_id = ?
    `;
    const params: any[] = [user.id];

    if (endpoint) {
      query += ' AND endpoint = ?';
      params.push(endpoint);
    }

    query += ' ORDER BY display_order ASC, created_at DESC';

    const result = await c.env.DB.prepare(query).bind(...params).all();

    return c.json({
      success: true,
      presets: (result.results || []).map((p: any) => ({
        ...p,
        isDefault: Boolean(p.isDefault),
      })),
    });
  } catch (error) {
    console.error('List presets error:', error);
    return c.json({ success: false, error: { message: 'Failed to list presets' } }, 500);
  }
});

/**
 * POST /
 * Create a new preset
 */
presets.post('/', zValidator('json', createPresetSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const data = c.req.valid('json');
  const presetId = generateUUID();
  const now = new Date().toISOString();

  try {
    // If setting as default, unset existing defaults for this endpoint
    if (data.isDefault) {
      await c.env.DB
        .prepare('UPDATE presets SET is_default = 0 WHERE user_id = ? AND endpoint = ?')
        .bind(user.id, data.endpoint)
        .run();
    }

    await c.env.DB
      .prepare(`
        INSERT INTO presets (
          id, user_id, title, endpoint, model, temperature, top_p, max_tokens,
          frequency_penalty, presence_penalty, system_message, is_default,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        presetId,
        user.id,
        data.title,
        data.endpoint,
        data.model,
        data.temperature ?? null,
        data.topP ?? null,
        data.maxTokens ?? null,
        data.frequencyPenalty ?? null,
        data.presencePenalty ?? null,
        data.systemMessage ?? null,
        data.isDefault ? 1 : 0,
        now,
        now
      )
      .run();

    return c.json({
      success: true,
      preset: {
        id: presetId,
        userId: user.id,
        title: data.title,
        endpoint: data.endpoint,
        model: data.model,
        temperature: data.temperature ?? null,
        topP: data.topP ?? null,
        maxTokens: data.maxTokens ?? null,
        frequencyPenalty: data.frequencyPenalty ?? null,
        presencePenalty: data.presencePenalty ?? null,
        systemMessage: data.systemMessage ?? null,
        isDefault: data.isDefault ?? false,
        createdAt: now,
        updatedAt: now,
      },
    }, 201);
  } catch (error) {
    console.error('Create preset error:', error);
    return c.json({ success: false, error: { message: 'Failed to create preset' } }, 500);
  }
});

/**
 * GET /:id
 * Get a specific preset
 */
presets.get('/:id', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const presetId = c.req.param('id');

  try {
    const preset = await c.env.DB
      .prepare(`
        SELECT 
          id, user_id as userId, title, endpoint, model,
          temperature, top_p as topP, max_tokens as maxTokens,
          frequency_penalty as frequencyPenalty, presence_penalty as presencePenalty,
          system_message as systemMessage, is_default as isDefault,
          created_at as createdAt, updated_at as updatedAt
        FROM presets
        WHERE id = ? AND user_id = ?
      `)
      .bind(presetId, user.id)
      .first();

    if (!preset) {
      return c.json({ success: false, error: { message: 'Preset not found' } }, 404);
    }

    return c.json({
      success: true,
      preset: {
        ...preset,
        isDefault: Boolean(preset.isDefault),
      },
    });
  } catch (error) {
    console.error('Get preset error:', error);
    return c.json({ success: false, error: { message: 'Failed to get preset' } }, 500);
  }
});

/**
 * PATCH /:id
 * Update preset configuration
 */
presets.patch('/:id', zValidator('json', updatePresetSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const presetId = c.req.param('id');
  const updates = c.req.valid('json');
  const now = new Date().toISOString();

  try {
    // Verify ownership
    const existing = await c.env.DB
      .prepare('SELECT id, endpoint FROM presets WHERE id = ? AND user_id = ?')
      .bind(presetId, user.id)
      .first<{ id: string; endpoint: string }>();

    if (!existing) {
      return c.json({ success: false, error: { message: 'Preset not found' } }, 404);
    }

    // If setting as default, unset existing defaults
    const targetEndpoint = updates.endpoint || existing.endpoint;
    if (updates.isDefault) {
      await c.env.DB
        .prepare('UPDATE presets SET is_default = 0 WHERE user_id = ? AND endpoint = ? AND id != ?')
        .bind(user.id, targetEndpoint, presetId)
        .run();
    }

    // Build update query dynamically
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.endpoint !== undefined) {
      fields.push('endpoint = ?');
      values.push(updates.endpoint);
    }
    if (updates.model !== undefined) {
      fields.push('model = ?');
      values.push(updates.model);
    }
    if (updates.temperature !== undefined) {
      fields.push('temperature = ?');
      values.push(updates.temperature);
    }
    if (updates.topP !== undefined) {
      fields.push('top_p = ?');
      values.push(updates.topP);
    }
    if (updates.maxTokens !== undefined) {
      fields.push('max_tokens = ?');
      values.push(updates.maxTokens);
    }
    if (updates.frequencyPenalty !== undefined) {
      fields.push('frequency_penalty = ?');
      values.push(updates.frequencyPenalty);
    }
    if (updates.presencePenalty !== undefined) {
      fields.push('presence_penalty = ?');
      values.push(updates.presencePenalty);
    }
    if (updates.systemMessage !== undefined) {
      fields.push('system_message = ?');
      values.push(updates.systemMessage);
    }
    if (updates.isDefault !== undefined) {
      fields.push('is_default = ?');
      values.push(updates.isDefault ? 1 : 0);
    }

    fields.push('updated_at = ?');
    values.push(now);
    values.push(presetId);
    values.push(user.id);

    await c.env.DB
      .prepare(`UPDATE presets SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`)
      .bind(...values)
      .run();

    // Fetch updated preset
    const preset = await c.env.DB
      .prepare(`
        SELECT 
          id, user_id as userId, title, endpoint, model,
          temperature, top_p as topP, max_tokens as maxTokens,
          frequency_penalty as frequencyPenalty, presence_penalty as presencePenalty,
          system_message as systemMessage, is_default as isDefault,
          created_at as createdAt, updated_at as updatedAt
        FROM presets WHERE id = ? AND user_id = ?
      `)
      .bind(presetId, user.id)
      .first();

    return c.json({
      success: true,
      preset: {
        ...preset,
        isDefault: Boolean(preset?.isDefault),
      },
    });
  } catch (error) {
    console.error('Update preset error:', error);
    return c.json({ success: false, error: { message: 'Failed to update preset' } }, 500);
  }
});

/**
 * DELETE /:id
 * Delete a preset
 */
presets.delete('/:id', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const presetId = c.req.param('id');

  try {
    const existing = await c.env.DB
      .prepare('SELECT id FROM presets WHERE id = ? AND user_id = ?')
      .bind(presetId, user.id)
      .first();

    if (!existing) {
      return c.json({ success: false, error: { message: 'Preset not found' } }, 404);
    }

    await c.env.DB.prepare('DELETE FROM presets WHERE id = ? AND user_id = ?').bind(presetId, user.id).run();

    return c.json({ success: true, message: 'Preset deleted' });
  } catch (error) {
    console.error('Delete preset error:', error);
    return c.json({ success: false, error: { message: 'Failed to delete preset' } }, 500);
  }
});

export { presets };
export default presets;
