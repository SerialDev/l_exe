/**
 * MCP (Model Context Protocol) Server routes
 * Manage MCP server connections and tool execution
 * GET /, GET /:id, POST /, PUT /:id, DELETE /:id
 * POST /:id/connect, POST /:id/tools/:toolName
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

// Types for Cloudflare bindings
interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  CACHE: KVNamespace;
  JWT_SECRET: string;
}

// Context variables (set by auth middleware)
interface Variables {
  userId: string;
}

// Database row types
interface MCPServerRow {
  id: string;
  user_id: string;
  name: string;
  url: string;
  auth_type: string | null;
  metadata: string | null;
  is_public: number;
  created_at: string;
  updated_at: string;
}

// MCP Protocol types
interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

interface MCPCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
}

// Request schemas
const createMCPServerSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  authType: z.enum(['none', 'bearer', 'api_key', 'oauth']).default('none'),
  authToken: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  isPublic: z.boolean().default(false),
});

const updateMCPServerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
  authType: z.enum(['none', 'bearer', 'api_key', 'oauth']).optional(),
  authToken: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  isPublic: z.boolean().optional(),
});

const executeToolSchema = z.object({
  arguments: z.record(z.unknown()).optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().positive().default(1),
  pageSize: z.coerce.number().min(1).max(50).default(20),
  search: z.string().optional(),
  includePublic: z.coerce.boolean().default(true),
});

// Helper to generate UUID
function generateUUID(): string {
  return crypto.randomUUID();
}

// Create router
const mcp = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Helper to make MCP protocol requests
 */
async function mcpRequest(
  serverUrl: string,
  method: string,
  params?: Record<string, unknown>,
  authType?: string,
  authToken?: string
): Promise<unknown> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authType === 'bearer' && authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  } else if (authType === 'api_key' && authToken) {
    headers['X-API-Key'] = authToken;
  }

  const body = {
    jsonrpc: '2.0',
    id: generateUUID(),
    method,
    params: params || {},
  };

  const response = await fetch(serverUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json() as { result?: unknown; error?: { message: string } };
  
  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.result;
}

/**
 * GET /
 * List MCP servers (user's own + public)
 */
mcp.get('/', zValidator('query', listQuerySchema), async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { page, pageSize, search, includePublic } = c.req.valid('query');
  const offset = (page - 1) * pageSize;

  try {
    let query = `
      SELECT * FROM mcp_servers
      WHERE (user_id = ?${includePublic ? ' OR is_public = 1' : ''})
    `;
    const params: (string | number)[] = [userId];

    if (search) {
      query += ' AND name LIKE ?';
      params.push(`%${search}%`);
    }

    // Count total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const countResult = await c.env.DB
      .prepare(countQuery)
      .bind(...params)
      .first<{ total: number }>();
    const total = countResult?.total || 0;

    // Add pagination
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(pageSize, offset);

    const results = await c.env.DB
      .prepare(query)
      .bind(...params)
      .all<MCPServerRow>();

    return c.json({
      success: true,
      data: {
        servers: (results.results || []).map(s => ({
          id: s.id,
          name: s.name,
          url: s.url,
          authType: s.auth_type,
          isPublic: s.is_public === 1,
          isOwner: s.user_id === userId,
          metadata: s.metadata ? JSON.parse(s.metadata) : {},
          createdAt: s.created_at,
          updatedAt: s.updated_at,
        })),
        total,
        page,
        pageSize,
        hasMore: offset + pageSize < total,
      },
    });
  } catch (error) {
    console.error('List MCP servers error:', error);
    return c.json({ success: false, error: 'Failed to list MCP servers' }, 500);
  }
});

/**
 * GET /:id
 * Get MCP server details with tools and resources
 */
mcp.get('/:id', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { id } = c.req.param();

  try {
    const server = await c.env.DB
      .prepare('SELECT * FROM mcp_servers WHERE id = ? AND (user_id = ? OR is_public = 1)')
      .bind(id, userId)
      .first<MCPServerRow>();

    if (!server) {
      return c.json({ success: false, error: 'MCP server not found' }, 404);
    }

    // Try to get cached tools/resources
    const cacheKey = `mcp:${id}:capabilities`;
    let capabilities = await c.env.CACHE.get(cacheKey, 'json') as {
      tools?: MCPTool[];
      resources?: MCPResource[];
      prompts?: unknown[];
    } | null;

    return c.json({
      success: true,
      data: {
        id: server.id,
        name: server.name,
        url: server.url,
        authType: server.auth_type,
        isPublic: server.is_public === 1,
        isOwner: server.user_id === userId,
        metadata: server.metadata ? JSON.parse(server.metadata) : {},
        capabilities: capabilities || null,
        createdAt: server.created_at,
        updatedAt: server.updated_at,
      },
    });
  } catch (error) {
    console.error('Get MCP server error:', error);
    return c.json({ success: false, error: 'Failed to get MCP server' }, 500);
  }
});

/**
 * POST /
 * Register a new MCP server
 */
mcp.post('/', zValidator('json', createMCPServerSchema), async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { name, url, authType, authToken, metadata, isPublic } = c.req.valid('json');

  try {
    // Check for duplicate URL for this user
    const existing = await c.env.DB
      .prepare('SELECT id FROM mcp_servers WHERE url = ? AND user_id = ?')
      .bind(url, userId)
      .first();

    if (existing) {
      return c.json({ success: false, error: 'MCP server with this URL already registered' }, 409);
    }

    const id = generateUUID();
    const now = new Date().toISOString();

    // Store metadata with encrypted auth token if provided
    const serverMetadata = {
      ...metadata,
      authToken: authToken || undefined, // In production, encrypt this
    };

    await c.env.DB
      .prepare(`
        INSERT INTO mcp_servers (id, user_id, name, url, auth_type, metadata, is_public, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        userId,
        name,
        url,
        authType,
        JSON.stringify(serverMetadata),
        isPublic ? 1 : 0,
        now,
        now
      )
      .run();

    return c.json({
      success: true,
      data: {
        id,
        name,
        url,
        authType,
        isPublic,
        metadata: metadata || {},
        createdAt: now,
        updatedAt: now,
      },
    }, 201);
  } catch (error) {
    console.error('Create MCP server error:', error);
    return c.json({ success: false, error: 'Failed to create MCP server' }, 500);
  }
});

/**
 * PUT /:id
 * Update MCP server configuration
 */
mcp.put('/:id', zValidator('json', updateMCPServerSchema), async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { id } = c.req.param();
  const updates = c.req.valid('json');

  try {
    // Verify ownership
    const existing = await c.env.DB
      .prepare('SELECT * FROM mcp_servers WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<MCPServerRow>();

    if (!existing) {
      return c.json({ success: false, error: 'MCP server not found' }, 404);
    }

    // Build update
    const setClauses: string[] = ['updated_at = ?'];
    const values: (string | number | null)[] = [new Date().toISOString()];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }
    if (updates.url !== undefined) {
      setClauses.push('url = ?');
      values.push(updates.url);
    }
    if (updates.authType !== undefined) {
      setClauses.push('auth_type = ?');
      values.push(updates.authType);
    }
    if (updates.isPublic !== undefined) {
      setClauses.push('is_public = ?');
      values.push(updates.isPublic ? 1 : 0);
    }
    if (updates.metadata !== undefined || updates.authToken !== undefined) {
      const currentMetadata = existing.metadata ? JSON.parse(existing.metadata) : {};
      const newMetadata = {
        ...currentMetadata,
        ...updates.metadata,
        authToken: updates.authToken ?? currentMetadata.authToken,
      };
      setClauses.push('metadata = ?');
      values.push(JSON.stringify(newMetadata));
    }

    values.push(id);

    await c.env.DB
      .prepare(`UPDATE mcp_servers SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    // Clear cached capabilities
    await c.env.CACHE.delete(`mcp:${id}:capabilities`);

    // Fetch updated
    const updated = await c.env.DB
      .prepare('SELECT * FROM mcp_servers WHERE id = ?')
      .bind(id)
      .first<MCPServerRow>();

    const metadata = updated!.metadata ? JSON.parse(updated!.metadata) : {};
    delete metadata.authToken; // Don't return auth token

    return c.json({
      success: true,
      data: {
        id: updated!.id,
        name: updated!.name,
        url: updated!.url,
        authType: updated!.auth_type,
        isPublic: updated!.is_public === 1,
        metadata,
        createdAt: updated!.created_at,
        updatedAt: updated!.updated_at,
      },
    });
  } catch (error) {
    console.error('Update MCP server error:', error);
    return c.json({ success: false, error: 'Failed to update MCP server' }, 500);
  }
});

/**
 * DELETE /:id
 * Remove an MCP server
 */
mcp.delete('/:id', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { id } = c.req.param();

  try {
    // Verify ownership
    const existing = await c.env.DB
      .prepare('SELECT id FROM mcp_servers WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first();

    if (!existing) {
      return c.json({ success: false, error: 'MCP server not found' }, 404);
    }

    await c.env.DB
      .prepare('DELETE FROM mcp_servers WHERE id = ?')
      .bind(id)
      .run();

    // Clear cached capabilities
    await c.env.CACHE.delete(`mcp:${id}:capabilities`);

    return c.json({
      success: true,
      data: { deleted: true, id },
    });
  } catch (error) {
    console.error('Delete MCP server error:', error);
    return c.json({ success: false, error: 'Failed to delete MCP server' }, 500);
  }
});

/**
 * POST /:id/connect
 * Test connection and fetch capabilities from MCP server
 */
mcp.post('/:id/connect', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { id } = c.req.param();

  try {
    const server = await c.env.DB
      .prepare('SELECT * FROM mcp_servers WHERE id = ? AND (user_id = ? OR is_public = 1)')
      .bind(id, userId)
      .first<MCPServerRow>();

    if (!server) {
      return c.json({ success: false, error: 'MCP server not found' }, 404);
    }

    const metadata = server.metadata ? JSON.parse(server.metadata) : {};
    const authToken = metadata.authToken;

    // Initialize connection
    const initResult = await mcpRequest(
      server.url,
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: { listChanged: true },
        },
        clientInfo: {
          name: 'L_EXE',
          version: '1.0.0',
        },
      },
      server.auth_type || undefined,
      authToken
    ) as {
      protocolVersion: string;
      capabilities: MCPCapabilities;
      serverInfo: { name: string; version: string };
    };

    // Fetch tools if supported
    let tools: MCPTool[] = [];
    if (initResult.capabilities.tools) {
      const toolsResult = await mcpRequest(
        server.url,
        'tools/list',
        {},
        server.auth_type || undefined,
        authToken
      ) as { tools: MCPTool[] };
      tools = toolsResult.tools || [];
    }

    // Fetch resources if supported
    let resources: MCPResource[] = [];
    if (initResult.capabilities.resources) {
      const resourcesResult = await mcpRequest(
        server.url,
        'resources/list',
        {},
        server.auth_type || undefined,
        authToken
      ) as { resources: MCPResource[] };
      resources = resourcesResult.resources || [];
    }

    // Cache capabilities (1 hour)
    const capabilities = {
      serverInfo: initResult.serverInfo,
      protocolVersion: initResult.protocolVersion,
      capabilities: initResult.capabilities,
      tools,
      resources,
    };
    await c.env.CACHE.put(`mcp:${id}:capabilities`, JSON.stringify(capabilities), {
      expirationTtl: 3600,
    });

    return c.json({
      success: true,
      data: {
        connected: true,
        serverInfo: initResult.serverInfo,
        protocolVersion: initResult.protocolVersion,
        capabilities: initResult.capabilities,
        toolCount: tools.length,
        resourceCount: resources.length,
        tools: tools.map(t => ({ name: t.name, description: t.description })),
        resources: resources.map(r => ({ uri: r.uri, name: r.name })),
      },
    });
  } catch (error) {
    console.error('MCP connect error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to connect to MCP server',
      connected: false,
    }, 502);
  }
});

/**
 * GET /:id/tools
 * List available tools from an MCP server
 */
mcp.get('/:id/tools', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { id } = c.req.param();

  try {
    const server = await c.env.DB
      .prepare('SELECT * FROM mcp_servers WHERE id = ? AND (user_id = ? OR is_public = 1)')
      .bind(id, userId)
      .first<MCPServerRow>();

    if (!server) {
      return c.json({ success: false, error: 'MCP server not found' }, 404);
    }

    // Check cache first
    const cacheKey = `mcp:${id}:capabilities`;
    const cached = await c.env.CACHE.get(cacheKey, 'json') as { tools?: MCPTool[] } | null;

    if (cached?.tools) {
      return c.json({
        success: true,
        data: {
          tools: cached.tools,
          cached: true,
        },
      });
    }

    // Fetch from server
    const metadata = server.metadata ? JSON.parse(server.metadata) : {};
    const authToken = metadata.authToken;

    const toolsResult = await mcpRequest(
      server.url,
      'tools/list',
      {},
      server.auth_type || undefined,
      authToken
    ) as { tools: MCPTool[] };

    return c.json({
      success: true,
      data: {
        tools: toolsResult.tools || [],
        cached: false,
      },
    });
  } catch (error) {
    console.error('List MCP tools error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list tools',
    }, 500);
  }
});

/**
 * POST /:id/tools/:toolName
 * Execute a tool on the MCP server
 */
mcp.post('/:id/tools/:toolName', zValidator('json', executeToolSchema), async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { id, toolName } = c.req.param();
  const { arguments: toolArgs } = c.req.valid('json');

  try {
    const server = await c.env.DB
      .prepare('SELECT * FROM mcp_servers WHERE id = ? AND (user_id = ? OR is_public = 1)')
      .bind(id, userId)
      .first<MCPServerRow>();

    if (!server) {
      return c.json({ success: false, error: 'MCP server not found' }, 404);
    }

    const metadata = server.metadata ? JSON.parse(server.metadata) : {};
    const authToken = metadata.authToken;

    // Execute tool
    const result = await mcpRequest(
      server.url,
      'tools/call',
      {
        name: toolName,
        arguments: toolArgs || {},
      },
      server.auth_type || undefined,
      authToken
    ) as { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> };

    // Record tool call in database
    const toolCallId = generateUUID();
    const now = new Date().toISOString();

    await c.env.DB
      .prepare(`
        INSERT INTO tool_calls (id, user_id, conversation_id, message_id, tool_name, tool_input, tool_output, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        toolCallId,
        userId,
        '', // No conversation context for direct calls
        '', // No message context
        `${server.name}:${toolName}`,
        JSON.stringify(toolArgs || {}),
        JSON.stringify(result),
        now
      )
      .run();

    return c.json({
      success: true,
      data: {
        toolName,
        serverId: id,
        serverName: server.name,
        result: result.content,
        toolCallId,
        executedAt: now,
      },
    });
  } catch (error) {
    console.error('Execute MCP tool error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to execute tool',
    }, 500);
  }
});

/**
 * GET /:id/resources
 * List available resources from an MCP server
 */
mcp.get('/:id/resources', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { id } = c.req.param();

  try {
    const server = await c.env.DB
      .prepare('SELECT * FROM mcp_servers WHERE id = ? AND (user_id = ? OR is_public = 1)')
      .bind(id, userId)
      .first<MCPServerRow>();

    if (!server) {
      return c.json({ success: false, error: 'MCP server not found' }, 404);
    }

    const metadata = server.metadata ? JSON.parse(server.metadata) : {};
    const authToken = metadata.authToken;

    const resourcesResult = await mcpRequest(
      server.url,
      'resources/list',
      {},
      server.auth_type || undefined,
      authToken
    ) as { resources: MCPResource[] };

    return c.json({
      success: true,
      data: {
        resources: resourcesResult.resources || [],
      },
    });
  } catch (error) {
    console.error('List MCP resources error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list resources',
    }, 500);
  }
});

/**
 * GET /:id/resources/:uri
 * Read a specific resource from an MCP server
 */
mcp.get('/:id/resources/:uri', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const { id, uri } = c.req.param();
  const decodedUri = decodeURIComponent(uri);

  try {
    const server = await c.env.DB
      .prepare('SELECT * FROM mcp_servers WHERE id = ? AND (user_id = ? OR is_public = 1)')
      .bind(id, userId)
      .first<MCPServerRow>();

    if (!server) {
      return c.json({ success: false, error: 'MCP server not found' }, 404);
    }

    const metadata = server.metadata ? JSON.parse(server.metadata) : {};
    const authToken = metadata.authToken;

    const resourceResult = await mcpRequest(
      server.url,
      'resources/read',
      { uri: decodedUri },
      server.auth_type || undefined,
      authToken
    ) as { contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> };

    return c.json({
      success: true,
      data: {
        uri: decodedUri,
        contents: resourceResult.contents || [],
      },
    });
  } catch (error) {
    console.error('Read MCP resource error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read resource',
    }, 500);
  }
});

export { mcp };
export default mcp;
