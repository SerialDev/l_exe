/**
 * Prompts routes
 * Prompt library management with versioning (prompt groups)
 * GET /, GET /:id, POST /, PUT /:id, DELETE /:id
 * GET /groups, GET /groups/:id, POST /groups, PUT /groups/:id, DELETE /groups/:id
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

// Types for Cloudflare bindings
interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  JWT_SECRET: string;
}

// Context variables (set by auth middleware)
interface Variables {
  userId: string;
}

// Database row types
interface PromptRow {
  id: string;
  group_id: string | null;
  author_id: string;
  prompt: string;
  type: string;
  labels: string | null;
  created_at: string;
}

interface PromptGroupRow {
  id: string;
  name: string;
  author_id: string;
  author_name: string | null;
  category: string | null;
  command: string | null;
  oneliner: string | null;
  project_ids: string | null;
  production_id: string | null;
  number_of_generations: number;
  created_at: string;
  updated_at: string;
}

// Request schemas
const createPromptSchema = z.object({
  prompt: z.string().min(1).max(100000),
  type: z.enum(['text', 'template', 'system']).default('text'),
  labels: z.array(z.string()).optional(),
  groupId: z.string().optional(),
});

const updatePromptSchema = z.object({
  prompt: z.string().min(1).max(100000).optional(),
  type: z.enum(['text', 'template', 'system']).optional(),
  labels: z.array(z.string()).optional(),
});

const createGroupSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().max(100).optional(),
  command: z.string().max(50).optional(),
  oneliner: z.string().max(500).optional(),
  projectIds: z.array(z.string()).optional(),
  initialPrompt: z.string().optional(),
});

const updateGroupSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  category: z.string().max(100).optional().nullable(),
  command: z.string().max(50).optional().nullable(),
  oneliner: z.string().max(500).optional().nullable(),
  projectIds: z.array(z.string()).optional(),
  productionId: z.string().optional().nullable(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().positive().default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  category: z.string().optional(),
  type: z.enum(['text', 'template', 'system']).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'name']).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// Helper to generate UUID
function generateUUID(): string {
  return crypto.randomUUID();
}

// Create router
const prompts = new Hono<{ Bindings: Env; Variables: Variables }>();

// =============================================================================
// Prompt Routes (Individual Prompts/Versions)
// =============================================================================

/**
 * GET /
 * List prompts (all versions, optionally filtered by group)
 */
prompts.get('/', zValidator('query', listQuerySchema.extend({
  groupId: z.string().optional(),
})), async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { page, pageSize, search, type, groupId, sortBy, sortOrder } = c.req.valid('query');
  const offset = (page - 1) * pageSize;

  try {
    let query = `
      SELECT p.*, u.name as author_name
      FROM prompts p
      LEFT JOIN users u ON u.id = p.author_id
      WHERE p.author_id = ?
    `;
    const params: (string | number)[] = [userId];

    if (groupId) {
      query += ' AND p.group_id = ?';
      params.push(groupId);
    }

    if (type) {
      query += ' AND p.type = ?';
      params.push(type);
    }

    if (search) {
      query += ' AND p.prompt LIKE ?';
      params.push(`%${search}%`);
    }

    // Count total
    const countQuery = query.replace('SELECT p.*, u.name as author_name', 'SELECT COUNT(*) as total');
    const countResult = await c.env.DB
      .prepare(countQuery)
      .bind(...params)
      .first<{ total: number }>();
    const total = countResult?.total || 0;

    // Add sorting and pagination
    const sortColumn = sortBy === 'createdAt' ? 'p.created_at' : sortBy === 'name' ? 'p.prompt' : 'p.created_at';
    query += ` ORDER BY ${sortColumn} ${sortOrder.toUpperCase()} LIMIT ? OFFSET ?`;
    params.push(pageSize, offset);

    const results = await c.env.DB
      .prepare(query)
      .bind(...params)
      .all<PromptRow & { author_name: string | null }>();

    return c.json({
      success: true,
      data: {
        prompts: (results.results || []).map(p => ({
          id: p.id,
          groupId: p.group_id,
          authorId: p.author_id,
          authorName: p.author_name,
          prompt: p.prompt,
          type: p.type,
          labels: p.labels ? JSON.parse(p.labels) : [],
          createdAt: p.created_at,
        })),
        total,
        page,
        pageSize,
        hasMore: offset + pageSize < total,
      },
    });
  } catch (error) {
    console.error('List prompts error:', error);
    return c.json({ success: false, error: 'Failed to list prompts' }, 500);
  }
});

/**
 * GET /:id
 * Get a specific prompt
 */
prompts.get('/:id', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { id } = c.req.param();

  try {
    const prompt = await c.env.DB
      .prepare(`
        SELECT p.*, u.name as author_name, pg.name as group_name
        FROM prompts p
        LEFT JOIN users u ON u.id = p.author_id
        LEFT JOIN prompt_groups pg ON pg.id = p.group_id
        WHERE p.id = ? AND p.author_id = ?
      `)
      .bind(id, userId)
      .first<PromptRow & { author_name: string | null; group_name: string | null }>();

    if (!prompt) {
      return c.json({ success: false, error: 'Prompt not found' }, 404);
    }

    return c.json({
      success: true,
      data: {
        id: prompt.id,
        groupId: prompt.group_id,
        groupName: prompt.group_name,
        authorId: prompt.author_id,
        authorName: prompt.author_name,
        prompt: prompt.prompt,
        type: prompt.type,
        labels: prompt.labels ? JSON.parse(prompt.labels) : [],
        createdAt: prompt.created_at,
      },
    });
  } catch (error) {
    console.error('Get prompt error:', error);
    return c.json({ success: false, error: 'Failed to get prompt' }, 500);
  }
});

/**
 * POST /
 * Create a new prompt (optionally in a group)
 */
prompts.post('/', zValidator('json', createPromptSchema), async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { prompt, type, labels, groupId } = c.req.valid('json');

  try {
    // If groupId provided, verify ownership
    if (groupId) {
      const group = await c.env.DB
        .prepare('SELECT id FROM prompt_groups WHERE id = ? AND author_id = ?')
        .bind(groupId, userId)
        .first();

      if (!group) {
        return c.json({ success: false, error: 'Prompt group not found' }, 404);
      }
    }

    const id = generateUUID();
    const now = new Date().toISOString();

    await c.env.DB
      .prepare(`
        INSERT INTO prompts (id, group_id, author_id, prompt, type, labels, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        groupId || null,
        userId,
        prompt,
        type,
        labels ? JSON.stringify(labels) : null,
        now
      )
      .run();

    // If this is part of a group, increment generation count (with tenant isolation)
    if (groupId) {
      await c.env.DB
        .prepare('UPDATE prompt_groups SET number_of_generations = number_of_generations + 1 WHERE id = ? AND author_id = ?')
        .bind(groupId, userId)
        .run();
    }

    return c.json({
      success: true,
      data: {
        id,
        groupId: groupId || null,
        authorId: userId,
        prompt,
        type,
        labels: labels || [],
        createdAt: now,
      },
    }, 201);
  } catch (error) {
    console.error('Create prompt error:', error);
    return c.json({ success: false, error: 'Failed to create prompt' }, 500);
  }
});

/**
 * PUT /:id
 * Update a prompt
 */
prompts.put('/:id', zValidator('json', updatePromptSchema), async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { id } = c.req.param();
  const updates = c.req.valid('json');

  try {
    // Verify ownership
    const existing = await c.env.DB
      .prepare('SELECT * FROM prompts WHERE id = ? AND author_id = ?')
      .bind(id, userId)
      .first<PromptRow>();

    if (!existing) {
      return c.json({ success: false, error: 'Prompt not found' }, 404);
    }

    // Build update
    const setClauses: string[] = [];
    const values: (string | null)[] = [];

    if (updates.prompt !== undefined) {
      setClauses.push('prompt = ?');
      values.push(updates.prompt);
    }
    if (updates.type !== undefined) {
      setClauses.push('type = ?');
      values.push(updates.type);
    }
    if (updates.labels !== undefined) {
      setClauses.push('labels = ?');
      values.push(JSON.stringify(updates.labels));
    }

    if (setClauses.length === 0) {
      return c.json({
        success: true,
        data: {
          id: existing.id,
          groupId: existing.group_id,
          prompt: existing.prompt,
          type: existing.type,
          labels: existing.labels ? JSON.parse(existing.labels) : [],
          createdAt: existing.created_at,
        },
      });
    }

    values.push(id);
    values.push(userId);

    await c.env.DB
      .prepare(`UPDATE prompts SET ${setClauses.join(', ')} WHERE id = ? AND author_id = ?`)
      .bind(...values)
      .run();

    // Fetch updated (with tenant isolation)
    const updated = await c.env.DB
      .prepare('SELECT * FROM prompts WHERE id = ? AND author_id = ?')
      .bind(id, userId)
      .first<PromptRow>();

    return c.json({
      success: true,
      data: {
        id: updated!.id,
        groupId: updated!.group_id,
        prompt: updated!.prompt,
        type: updated!.type,
        labels: updated!.labels ? JSON.parse(updated!.labels) : [],
        createdAt: updated!.created_at,
      },
    });
  } catch (error) {
    console.error('Update prompt error:', error);
    return c.json({ success: false, error: 'Failed to update prompt' }, 500);
  }
});

/**
 * DELETE /:id
 * Delete a prompt
 */
prompts.delete('/:id', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { id } = c.req.param();

  try {
    // Get prompt to check group
    const existing = await c.env.DB
      .prepare('SELECT id, group_id FROM prompts WHERE id = ? AND author_id = ?')
      .bind(id, userId)
      .first<{ id: string; group_id: string | null }>();

    if (!existing) {
      return c.json({ success: false, error: 'Prompt not found' }, 404);
    }

    // Delete
    await c.env.DB
      .prepare('DELETE FROM prompts WHERE id = ? AND author_id = ?')
      .bind(id, userId)
      .run();

    // If this was part of a group, decrement count and clear production_id if needed
    if (existing.group_id) {
      await c.env.DB
        .prepare(`
          UPDATE prompt_groups 
          SET number_of_generations = MAX(0, number_of_generations - 1),
              production_id = CASE WHEN production_id = ? THEN NULL ELSE production_id END
          WHERE id = ? AND author_id = ?
        `)
        .bind(id, existing.group_id, userId)
        .run();
    }

    return c.json({
      success: true,
      data: { deleted: true, id },
    });
  } catch (error) {
    console.error('Delete prompt error:', error);
    return c.json({ success: false, error: 'Failed to delete prompt' }, 500);
  }
});

// =============================================================================
// Prompt Group Routes
// =============================================================================

/**
 * GET /groups
 * List prompt groups
 */
prompts.get('/groups', zValidator('query', listQuerySchema), async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { page, pageSize, search, category, sortBy, sortOrder } = c.req.valid('query');
  const offset = (page - 1) * pageSize;

  try {
    let query = `
      SELECT pg.*, 
        (SELECT COUNT(*) FROM prompts WHERE group_id = pg.id) as prompt_count,
        (SELECT prompt FROM prompts WHERE id = pg.production_id) as production_prompt
      FROM prompt_groups pg
      WHERE pg.author_id = ?
    `;
    const params: (string | number)[] = [userId];

    if (category) {
      query += ' AND pg.category = ?';
      params.push(category);
    }

    if (search) {
      query += ' AND (pg.name LIKE ? OR pg.oneliner LIKE ? OR pg.command LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Count total
    const countQuery = query.replace(
      /SELECT pg\.\*, .* FROM prompt_groups pg/,
      'SELECT COUNT(*) as total FROM prompt_groups pg'
    );
    const countResult = await c.env.DB
      .prepare(countQuery)
      .bind(...params)
      .first<{ total: number }>();
    const total = countResult?.total || 0;

    // Add sorting and pagination
    const sortColumn = sortBy === 'createdAt' ? 'pg.created_at' : sortBy === 'name' ? 'pg.name' : 'pg.updated_at';
    query += ` ORDER BY ${sortColumn} ${sortOrder.toUpperCase()} LIMIT ? OFFSET ?`;
    params.push(pageSize, offset);

    const results = await c.env.DB
      .prepare(query)
      .bind(...params)
      .all<PromptGroupRow & { prompt_count: number; production_prompt: string | null }>();

    return c.json({
      success: true,
      data: {
        groups: (results.results || []).map(g => ({
          id: g.id,
          name: g.name,
          authorId: g.author_id,
          authorName: g.author_name,
          category: g.category,
          command: g.command,
          oneliner: g.oneliner,
          projectIds: g.project_ids ? JSON.parse(g.project_ids) : [],
          productionId: g.production_id,
          productionPrompt: g.production_prompt,
          promptCount: g.prompt_count,
          numberOfGenerations: g.number_of_generations,
          createdAt: g.created_at,
          updatedAt: g.updated_at,
        })),
        total,
        page,
        pageSize,
        hasMore: offset + pageSize < total,
      },
    });
  } catch (error) {
    console.error('List prompt groups error:', error);
    return c.json({ success: false, error: 'Failed to list prompt groups' }, 500);
  }
});

/**
 * GET /groups/:id
 * Get a prompt group with all its prompts
 */
prompts.get('/groups/:id', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { id } = c.req.param();

  try {
    const group = await c.env.DB
      .prepare('SELECT * FROM prompt_groups WHERE id = ? AND author_id = ?')
      .bind(id, userId)
      .first<PromptGroupRow>();

    if (!group) {
      return c.json({ success: false, error: 'Prompt group not found' }, 404);
    }

    // Get all prompts in this group
    const promptsResult = await c.env.DB
      .prepare('SELECT * FROM prompts WHERE group_id = ? ORDER BY created_at DESC')
      .bind(id)
      .all<PromptRow>();

    return c.json({
      success: true,
      data: {
        id: group.id,
        name: group.name,
        authorId: group.author_id,
        authorName: group.author_name,
        category: group.category,
        command: group.command,
        oneliner: group.oneliner,
        projectIds: group.project_ids ? JSON.parse(group.project_ids) : [],
        productionId: group.production_id,
        numberOfGenerations: group.number_of_generations,
        createdAt: group.created_at,
        updatedAt: group.updated_at,
        prompts: (promptsResult.results || []).map(p => ({
          id: p.id,
          prompt: p.prompt,
          type: p.type,
          labels: p.labels ? JSON.parse(p.labels) : [],
          createdAt: p.created_at,
          isProduction: p.id === group.production_id,
        })),
      },
    });
  } catch (error) {
    console.error('Get prompt group error:', error);
    return c.json({ success: false, error: 'Failed to get prompt group' }, 500);
  }
});

/**
 * POST /groups
 * Create a new prompt group
 */
prompts.post('/groups', zValidator('json', createGroupSchema), async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { name, category, command, oneliner, projectIds, initialPrompt } = c.req.valid('json');

  try {
    // Check for duplicate command if provided
    if (command) {
      const existing = await c.env.DB
        .prepare('SELECT id FROM prompt_groups WHERE command = ? AND author_id = ?')
        .bind(command, userId)
        .first();

      if (existing) {
        return c.json({ success: false, error: 'Command already in use' }, 409);
      }
    }

    // Get user name
    const user = await c.env.DB
      .prepare('SELECT name, username FROM users WHERE id = ?')
      .bind(userId)
      .first<{ name: string | null; username: string }>();

    const id = generateUUID();
    const now = new Date().toISOString();
    let productionId: string | null = null;

    // Create initial prompt if provided
    if (initialPrompt) {
      productionId = generateUUID();
      await c.env.DB
        .prepare(`
          INSERT INTO prompts (id, group_id, author_id, prompt, type, created_at)
          VALUES (?, ?, ?, ?, 'text', ?)
        `)
        .bind(productionId, id, userId, initialPrompt, now)
        .run();
    }

    await c.env.DB
      .prepare(`
        INSERT INTO prompt_groups (
          id, name, author_id, author_name, category, command, oneliner,
          project_ids, production_id, number_of_generations, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        name,
        userId,
        user?.name || user?.username || null,
        category || null,
        command || null,
        oneliner || null,
        projectIds ? JSON.stringify(projectIds) : null,
        productionId,
        initialPrompt ? 1 : 0,
        now,
        now
      )
      .run();

    return c.json({
      success: true,
      data: {
        id,
        name,
        authorId: userId,
        authorName: user?.name || user?.username || null,
        category: category || null,
        command: command || null,
        oneliner: oneliner || null,
        projectIds: projectIds || [],
        productionId,
        numberOfGenerations: initialPrompt ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      },
    }, 201);
  } catch (error) {
    console.error('Create prompt group error:', error);
    return c.json({ success: false, error: 'Failed to create prompt group' }, 500);
  }
});

/**
 * PUT /groups/:id
 * Update a prompt group
 */
prompts.put('/groups/:id', zValidator('json', updateGroupSchema), async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { id } = c.req.param();
  const updates = c.req.valid('json');

  try {
    // Verify ownership
    const existing = await c.env.DB
      .prepare('SELECT * FROM prompt_groups WHERE id = ? AND author_id = ?')
      .bind(id, userId)
      .first<PromptGroupRow>();

    if (!existing) {
      return c.json({ success: false, error: 'Prompt group not found' }, 404);
    }

    // Check for duplicate command if updating
    if (updates.command && updates.command !== existing.command) {
      const duplicate = await c.env.DB
        .prepare('SELECT id FROM prompt_groups WHERE command = ? AND author_id = ? AND id != ?')
        .bind(updates.command, userId, id)
        .first();

      if (duplicate) {
        return c.json({ success: false, error: 'Command already in use' }, 409);
      }
    }

    // Verify productionId belongs to this group
    if (updates.productionId) {
      const prompt = await c.env.DB
        .prepare('SELECT id FROM prompts WHERE id = ? AND group_id = ?')
        .bind(updates.productionId, id)
        .first();

      if (!prompt) {
        return c.json({ success: false, error: 'Production prompt not found in this group' }, 400);
      }
    }

    // Build update
    const setClauses: string[] = ['updated_at = ?'];
    const values: (string | null)[] = [new Date().toISOString()];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }
    if (updates.category !== undefined) {
      setClauses.push('category = ?');
      values.push(updates.category);
    }
    if (updates.command !== undefined) {
      setClauses.push('command = ?');
      values.push(updates.command);
    }
    if (updates.oneliner !== undefined) {
      setClauses.push('oneliner = ?');
      values.push(updates.oneliner);
    }
    if (updates.projectIds !== undefined) {
      setClauses.push('project_ids = ?');
      values.push(JSON.stringify(updates.projectIds));
    }
    if (updates.productionId !== undefined) {
      setClauses.push('production_id = ?');
      values.push(updates.productionId);
    }

    values.push(id);
    values.push(userId);

    await c.env.DB
      .prepare(`UPDATE prompt_groups SET ${setClauses.join(', ')} WHERE id = ? AND author_id = ?`)
      .bind(...values)
      .run();

    // Fetch updated (with tenant isolation)
    const updated = await c.env.DB
      .prepare('SELECT * FROM prompt_groups WHERE id = ? AND author_id = ?')
      .bind(id, userId)
      .first<PromptGroupRow>();

    return c.json({
      success: true,
      data: {
        id: updated!.id,
        name: updated!.name,
        authorId: updated!.author_id,
        authorName: updated!.author_name,
        category: updated!.category,
        command: updated!.command,
        oneliner: updated!.oneliner,
        projectIds: updated!.project_ids ? JSON.parse(updated!.project_ids) : [],
        productionId: updated!.production_id,
        numberOfGenerations: updated!.number_of_generations,
        createdAt: updated!.created_at,
        updatedAt: updated!.updated_at,
      },
    });
  } catch (error) {
    console.error('Update prompt group error:', error);
    return c.json({ success: false, error: 'Failed to update prompt group' }, 500);
  }
});

/**
 * DELETE /groups/:id
 * Delete a prompt group and all its prompts
 */
prompts.delete('/groups/:id', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { id } = c.req.param();

  try {
    // Verify ownership
    const existing = await c.env.DB
      .prepare('SELECT id FROM prompt_groups WHERE id = ? AND author_id = ?')
      .bind(id, userId)
      .first();

    if (!existing) {
      return c.json({ success: false, error: 'Prompt group not found' }, 404);
    }

    // Delete all prompts in the group first (owned by this user)
    await c.env.DB
      .prepare('DELETE FROM prompts WHERE group_id = ? AND author_id = ?')
      .bind(id, userId)
      .run();

    // Delete the group
    await c.env.DB
      .prepare('DELETE FROM prompt_groups WHERE id = ? AND author_id = ?')
      .bind(id, userId)
      .run();

    return c.json({
      success: true,
      data: { deleted: true, id },
    });
  } catch (error) {
    console.error('Delete prompt group error:', error);
    return c.json({ success: false, error: 'Failed to delete prompt group' }, 500);
  }
});

/**
 * GET /categories
 * List unique categories
 */
prompts.get('/categories', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  try {
    const results = await c.env.DB
      .prepare(`
        SELECT DISTINCT category, COUNT(*) as count
        FROM prompt_groups
        WHERE author_id = ? AND category IS NOT NULL
        GROUP BY category
        ORDER BY count DESC
      `)
      .bind(userId)
      .all<{ category: string; count: number }>();

    return c.json({
      success: true,
      data: {
        categories: (results.results || []).map(r => ({
          name: r.category,
          count: r.count,
        })),
      },
    });
  } catch (error) {
    console.error('List categories error:', error);
    return c.json({ success: false, error: 'Failed to list categories' }, 500);
  }
});

export { prompts };
export default prompts;
