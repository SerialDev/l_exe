/**
 * Artifacts API Routes
 * Manage AI-generated artifacts (React, HTML, Mermaid, etc.)
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
  createArtifactService,
  parseArtifacts,
  validateArtifact,
  stripArtifacts,
  extractTextContent,
  getArtifactSystemPrompt,
  type ArtifactType,
} from '../services/artifacts';
import type { AppEnv } from '../types';

const app = new Hono<AppEnv>();

// =============================================================================
// Validation Schemas
// =============================================================================

const createArtifactSchema = z.object({
  type: z.enum(['react', 'html', 'mermaid', 'svg', 'markdown', 'code', 'chart', 'table', 'image']),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(500000), // 500KB max
  language: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  messageId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
});

const updateArtifactSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(500000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const parseArtifactsSchema = z.object({
  text: z.string().min(1).max(1000000),
});

// =============================================================================
// Middleware
// =============================================================================

/**
 * Require authentication
 */
app.use('*', async (c, next) => {
  const userId = c.get('userId');
  if (!userId) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }
  await next();
});

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /artifacts
 * Create a new artifact
 */
app.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const parsed = createArtifactSchema.safeParse(body);

  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`,
    });
  }

  const service = createArtifactService(c.env.DB);
  const { type, title, content, language, metadata, messageId, conversationId } = parsed.data;
  const artifact = await service.create(userId!, {
    type,
    title,
    content,
    language,
    metadata,
    messageId,
    conversationId,
  });

  return c.json(artifact, 201);
});

/**
 * GET /artifacts
 * List user's artifacts
 */
app.get('/', async (c) => {
  const userId = c.get('userId');
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const conversationId = c.req.query('conversationId');
  const messageId = c.req.query('messageId');
  const type = c.req.query('type') as ArtifactType | undefined;

  const service = createArtifactService(c.env.DB);

  let artifacts;
  if (conversationId) {
    artifacts = await service.listByConversation(conversationId, userId);
  } else if (messageId) {
    artifacts = await service.listByMessage(messageId, userId);
  } else {
    artifacts = await service.listByUser(userId, limit, offset);
  }

  // Filter by type if specified
  if (type) {
    artifacts = artifacts.filter(a => a.type === type);
  }

  return c.json({
    artifacts,
    count: artifacts.length,
  });
});

/**
 * GET /artifacts/:id
 * Get a specific artifact
 */
app.get('/:id', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();

  const service = createArtifactService(c.env.DB);
  const artifact = await service.getById(id, userId);

  if (!artifact) {
    throw new HTTPException(404, { message: 'Artifact not found' });
  }

  return c.json(artifact);
});

/**
 * PUT /artifacts/:id
 * Update an artifact
 */
app.put('/:id', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const body = await c.req.json();
  const parsed = updateArtifactSchema.safeParse(body);

  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`,
    });
  }

  const service = createArtifactService(c.env.DB);
  const artifact = await service.update(id, userId, parsed.data);

  if (!artifact) {
    throw new HTTPException(404, { message: 'Artifact not found' });
  }

  return c.json(artifact);
});

/**
 * DELETE /artifacts/:id
 * Delete an artifact
 */
app.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();

  const service = createArtifactService(c.env.DB);
  const deleted = await service.delete(id, userId);

  if (!deleted) {
    throw new HTTPException(404, { message: 'Artifact not found' });
  }

  return c.json({ success: true });
});

/**
 * GET /artifacts/:id/versions
 * Get version history for an artifact
 */
app.get('/:id/versions', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();

  const service = createArtifactService(c.env.DB);
  const versions = await service.getVersions(id, userId);

  if (versions.length === 0) {
    // Check if artifact exists
    const artifact = await service.getById(id, userId);
    if (!artifact) {
      throw new HTTPException(404, { message: 'Artifact not found' });
    }
  }

  return c.json({ versions });
});

/**
 * POST /artifacts/:id/restore
 * Restore a specific version
 */
app.post('/:id/restore', async (c) => {
  const userId = c.get('userId');
  const { id } = c.req.param();
  const body = await c.req.json();
  const { version } = body;

  if (typeof version !== 'number' || version < 1) {
    throw new HTTPException(400, { message: 'Valid version number is required' });
  }

  const service = createArtifactService(c.env.DB);
  const artifact = await service.restoreVersion(id, version, userId);

  if (!artifact) {
    throw new HTTPException(404, { message: 'Artifact or version not found' });
  }

  return c.json(artifact);
});

/**
 * POST /artifacts/parse
 * Parse artifacts from text (useful for previewing)
 */
app.post('/parse', async (c) => {
  const body = await c.req.json();
  const parsed = parseArtifactsSchema.safeParse(body);

  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`,
    });
  }

  const artifacts = parseArtifacts(parsed.data.text);
  const validatedArtifacts = artifacts.map(artifact => ({
    ...artifact,
    validation: validateArtifact(artifact),
  }));

  return c.json({
    artifacts: validatedArtifacts,
    count: artifacts.length,
    textWithoutArtifacts: extractTextContent(parsed.data.text),
    textWithMarkers: stripArtifacts(parsed.data.text),
  });
});

/**
 * POST /artifacts/validate
 * Validate an artifact's content
 */
app.post('/validate', async (c) => {
  const body = await c.req.json();
  const { type, content, title } = body;

  if (!type || !content) {
    throw new HTTPException(400, { message: 'Type and content are required' });
  }

  const validation = validateArtifact({
    type,
    content,
    title: title || 'Untitled',
  });

  return c.json(validation);
});

/**
 * GET /artifacts/prompt
 * Get system prompt for artifact generation
 */
app.get('/prompt', async (c) => {
  const prompt = getArtifactSystemPrompt();
  return c.json({ prompt });
});

/**
 * GET /artifacts/types
 * List available artifact types
 */
app.get('/types', async (c) => {
  const types = [
    {
      id: 'react',
      name: 'React Component',
      description: 'Interactive React component rendered live',
      supportsLivePreview: true,
    },
    {
      id: 'html',
      name: 'HTML/CSS',
      description: 'HTML content rendered in sandboxed iframe',
      supportsLivePreview: true,
    },
    {
      id: 'mermaid',
      name: 'Mermaid Diagram',
      description: 'Flowcharts, sequence diagrams, and more',
      supportsLivePreview: true,
    },
    {
      id: 'svg',
      name: 'SVG Graphics',
      description: 'Scalable vector graphics',
      supportsLivePreview: true,
    },
    {
      id: 'markdown',
      name: 'Markdown',
      description: 'Formatted markdown document',
      supportsLivePreview: true,
    },
    {
      id: 'code',
      name: 'Code Snippet',
      description: 'Syntax-highlighted code',
      supportsLivePreview: false,
    },
    {
      id: 'chart',
      name: 'Chart',
      description: 'Data visualization with Chart.js',
      supportsLivePreview: true,
    },
    {
      id: 'table',
      name: 'Data Table',
      description: 'Structured data table',
      supportsLivePreview: true,
    },
    {
      id: 'image',
      name: 'Generated Image',
      description: 'AI-generated or referenced image',
      supportsLivePreview: true,
    },
  ];

  return c.json({ types });
});

export { app as artifacts };
export default app;
