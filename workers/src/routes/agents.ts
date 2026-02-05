/**
 * Agents routes
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

// Tool schema for agent tools
const toolSchema = z.object({
  type: z.enum(['function', 'code_interpreter', 'retrieval']),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.any()).optional(),
  }).optional(),
});

// Request schemas
const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  instructions: z.string().max(32000),
  model: z.string(),
  endpoint: z.string(),
  tools: z.array(toolSchema).optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  avatar: z.string().url().optional(),
  isPublic: z.boolean().optional(),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  instructions: z.string().max(32000).optional(),
  model: z.string().optional(),
  endpoint: z.string().optional(),
  tools: z.array(toolSchema).optional().nullable(),
  temperature: z.number().min(0).max(2).optional().nullable(),
  topP: z.number().min(0).max(1).optional().nullable(),
  avatar: z.string().url().optional().nullable(),
  isPublic: z.boolean().optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

const listAgentsSchema = z.object({
  page: z.coerce.number().positive().default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  endpoint: z.string().optional(),
  includePublic: z.coerce.boolean().default(false),
});

// Helper functions
function getUser(c: any): AuthContext['user'] | null {
  return c.get('user') || null;
}

function generateUUID(): string {
  return crypto.randomUUID();
}

// Create router
const agents = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /
 * List agents with pagination
 */
agents.get('/', zValidator('query', listAgentsSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const { page, pageSize, search, endpoint, includePublic } = c.req.valid('query');
  const offset = (page - 1) * pageSize;

  try {
    let whereClause = 'WHERE (user_id = ?';
    const params: any[] = [user.id];

    if (includePublic) {
      whereClause += ' OR is_public = 1)';
    } else {
      whereClause += ')';
    }

    if (search) {
      whereClause += ' AND (name LIKE ? OR description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (endpoint) {
      whereClause += ' AND endpoint = ?';
      params.push(endpoint);
    }

    // Count total
    const countQuery = `SELECT COUNT(*) as total FROM agents ${whereClause}`;
    const countResult = await c.env.DB.prepare(countQuery).bind(...params).first<{ total: number }>();
    const total = countResult?.total || 0;

    // Fetch agents
    const query = `
      SELECT 
        id, user_id as userId, name, description, avatar,
        model, endpoint, system_message as instructions,
        tools, model_parameters as modelParameters,
        is_public as isPublic, is_promoted as isPromoted,
        created_at as createdAt, updated_at as updatedAt
      FROM agents
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    params.push(pageSize, offset);

    const result = await c.env.DB.prepare(query).bind(...params).all();

    const agentsList = (result.results || []).map((a: any) => ({
      ...a,
      tools: a.tools ? JSON.parse(a.tools) : null,
      modelParameters: a.modelParameters ? JSON.parse(a.modelParameters) : null,
      isPublic: Boolean(a.isPublic),
      isPromoted: Boolean(a.isPromoted),
    }));

    return c.json({
      success: true,
      agents: agentsList,
      total,
      page,
      pageSize,
      hasMore: offset + pageSize < total,
    });
  } catch (error) {
    console.error('List agents error:', error);
    return c.json({ success: false, error: { message: 'Failed to list agents' } }, 500);
  }
});

/**
 * POST /
 * Create a new agent
 */
agents.post('/', zValidator('json', createAgentSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const data = c.req.valid('json');
  const agentId = generateUUID();
  const now = new Date().toISOString();

  try {
    const modelParameters = {
      temperature: data.temperature,
      topP: data.topP,
    };

    await c.env.DB
      .prepare(`
        INSERT INTO agents (
          id, user_id, name, description, avatar, model, endpoint,
          system_message, tools, model_parameters, is_public,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        agentId,
        user.id,
        data.name,
        data.description ?? null,
        data.avatar ?? null,
        data.model,
        data.endpoint,
        data.instructions,
        data.tools ? JSON.stringify(data.tools) : null,
        JSON.stringify(modelParameters),
        data.isPublic ? 1 : 0,
        now,
        now
      )
      .run();

    return c.json({
      success: true,
      agent: {
        id: agentId,
        userId: user.id,
        name: data.name,
        description: data.description ?? null,
        avatar: data.avatar ?? null,
        model: data.model,
        endpoint: data.endpoint,
        instructions: data.instructions,
        tools: data.tools ?? null,
        temperature: data.temperature ?? null,
        topP: data.topP ?? null,
        isPublic: data.isPublic ?? false,
        createdAt: now,
        updatedAt: now,
      },
    }, 201);
  } catch (error) {
    console.error('Create agent error:', error);
    return c.json({ success: false, error: { message: 'Failed to create agent' } }, 500);
  }
});

/**
 * GET /:id
 * Get a specific agent
 */
agents.get('/:id', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const agentId = c.req.param('id');

  try {
    const agent = await c.env.DB
      .prepare(`
        SELECT 
          id, user_id as userId, name, description, avatar,
          model, endpoint, system_message as instructions,
          tools, model_parameters as modelParameters,
          is_public as isPublic, is_promoted as isPromoted,
          created_at as createdAt, updated_at as updatedAt
        FROM agents
        WHERE id = ? AND (user_id = ? OR is_public = 1)
      `)
      .bind(agentId, user.id)
      .first<any>();

    if (!agent) {
      return c.json({ success: false, error: { message: 'Agent not found' } }, 404);
    }

    const modelParameters = agent.modelParameters ? JSON.parse(agent.modelParameters) : {};

    return c.json({
      success: true,
      agent: {
        ...agent,
        tools: agent.tools ? JSON.parse(agent.tools) : null,
        temperature: modelParameters.temperature ?? null,
        topP: modelParameters.topP ?? null,
        isPublic: Boolean(agent.isPublic),
        isPromoted: Boolean(agent.isPromoted),
      },
    });
  } catch (error) {
    console.error('Get agent error:', error);
    return c.json({ success: false, error: { message: 'Failed to get agent' } }, 500);
  }
});

/**
 * PATCH /:id
 * Update agent configuration
 */
agents.patch('/:id', zValidator('json', updateAgentSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const agentId = c.req.param('id');
  const updates = c.req.valid('json');
  const now = new Date().toISOString();

  try {
    // Verify ownership
    const existing = await c.env.DB
      .prepare('SELECT id, model_parameters FROM agents WHERE id = ? AND user_id = ?')
      .bind(agentId, user.id)
      .first<{ id: string; model_parameters: string }>();

    if (!existing) {
      return c.json({ success: false, error: { message: 'Agent not found' } }, 404);
    }

    // Build update query dynamically
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.avatar !== undefined) {
      fields.push('avatar = ?');
      values.push(updates.avatar);
    }
    if (updates.model !== undefined) {
      fields.push('model = ?');
      values.push(updates.model);
    }
    if (updates.endpoint !== undefined) {
      fields.push('endpoint = ?');
      values.push(updates.endpoint);
    }
    if (updates.instructions !== undefined) {
      fields.push('system_message = ?');
      values.push(updates.instructions);
    }
    if (updates.tools !== undefined) {
      fields.push('tools = ?');
      values.push(updates.tools ? JSON.stringify(updates.tools) : null);
    }
    if (updates.isPublic !== undefined) {
      fields.push('is_public = ?');
      values.push(updates.isPublic ? 1 : 0);
    }

    // Handle model parameters
    if (updates.temperature !== undefined || updates.topP !== undefined) {
      const existingParams = existing.model_parameters ? JSON.parse(existing.model_parameters) : {};
      const newParams = {
        ...existingParams,
        ...(updates.temperature !== undefined && { temperature: updates.temperature }),
        ...(updates.topP !== undefined && { topP: updates.topP }),
      };
      fields.push('model_parameters = ?');
      values.push(JSON.stringify(newParams));
    }

    fields.push('updated_at = ?');
    values.push(now);
    values.push(agentId);
    values.push(user.id);

    await c.env.DB
      .prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`)
      .bind(...values)
      .run();

    // Fetch updated agent
    const agent = await c.env.DB
      .prepare(`
        SELECT 
          id, user_id as userId, name, description, avatar,
          model, endpoint, system_message as instructions,
          tools, model_parameters as modelParameters,
          is_public as isPublic, created_at as createdAt, updated_at as updatedAt
        FROM agents WHERE id = ? AND user_id = ?
      `)
      .bind(agentId, user.id)
      .first<any>();

    const modelParameters = agent.modelParameters ? JSON.parse(agent.modelParameters) : {};

    return c.json({
      success: true,
      agent: {
        ...agent,
        tools: agent.tools ? JSON.parse(agent.tools) : null,
        temperature: modelParameters.temperature ?? null,
        topP: modelParameters.topP ?? null,
        isPublic: Boolean(agent.isPublic),
      },
    });
  } catch (error) {
    console.error('Update agent error:', error);
    return c.json({ success: false, error: { message: 'Failed to update agent' } }, 500);
  }
});

/**
 * DELETE /:id
 * Delete an agent
 */
agents.delete('/:id', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const agentId = c.req.param('id');

  try {
    const existing = await c.env.DB
      .prepare('SELECT id FROM agents WHERE id = ? AND user_id = ?')
      .bind(agentId, user.id)
      .first();

    if (!existing) {
      return c.json({ success: false, error: { message: 'Agent not found' } }, 404);
    }

    await c.env.DB.prepare('DELETE FROM agents WHERE id = ? AND user_id = ?').bind(agentId, user.id).run();

    return c.json({ success: true, message: 'Agent deleted' });
  } catch (error) {
    console.error('Delete agent error:', error);
    return c.json({ success: false, error: { message: 'Failed to delete agent' } }, 500);
  }
});

/**
 * POST /:id/duplicate
 * Duplicate an agent
 */
agents.post('/:id/duplicate', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const agentId = c.req.param('id');

  try {
    // Fetch original agent
    const original = await c.env.DB
      .prepare(`
        SELECT name, description, avatar, model, endpoint, system_message,
               tools, model_parameters, is_public
        FROM agents
        WHERE id = ? AND (user_id = ? OR is_public = 1)
      `)
      .bind(agentId, user.id)
      .first<any>();

    if (!original) {
      return c.json({ success: false, error: { message: 'Agent not found' } }, 404);
    }

    const newAgentId = generateUUID();
    const now = new Date().toISOString();

    await c.env.DB
      .prepare(`
        INSERT INTO agents (
          id, user_id, name, description, avatar, model, endpoint,
          system_message, tools, model_parameters, is_public,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        newAgentId,
        user.id,
        `${original.name} (Copy)`,
        original.description,
        original.avatar,
        original.model,
        original.endpoint,
        original.system_message,
        original.tools,
        original.model_parameters,
        0, // Not public by default
        now,
        now
      )
      .run();

    const modelParameters = original.model_parameters ? JSON.parse(original.model_parameters) : {};

    return c.json({
      success: true,
      agent: {
        id: newAgentId,
        userId: user.id,
        name: `${original.name} (Copy)`,
        description: original.description,
        avatar: original.avatar,
        model: original.model,
        endpoint: original.endpoint,
        instructions: original.system_message,
        tools: original.tools ? JSON.parse(original.tools) : null,
        temperature: modelParameters.temperature ?? null,
        topP: modelParameters.topP ?? null,
        isPublic: false,
        createdAt: now,
        updatedAt: now,
      },
    }, 201);
  } catch (error) {
    console.error('Duplicate agent error:', error);
    return c.json({ success: false, error: { message: 'Failed to duplicate agent' } }, 500);
  }
});

export { agents };
export default agents;
