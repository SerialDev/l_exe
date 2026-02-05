/**
 * Import/Export API Routes
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createImportExportService, type ExportFormat, type ImportFormat } from '../services/importexport';
import type { AppEnv } from '../types';

const app = new Hono<AppEnv>();

// =============================================================================
// Middleware
// =============================================================================

app.use('*', async (c, next) => {
  const userId = c.get('userId');
  if (!userId) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }
  await next();
});

// =============================================================================
// Import Routes
// =============================================================================

/**
 * POST /import
 * Import conversations from various formats
 */
app.post('/import', async (c) => {
  const userId = c.get('userId');
  const contentType = c.req.header('content-type') || '';
  
  let data: unknown;
  let format = c.req.query('format') as ImportFormat | undefined;

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const fileEntry = formData.get('file');
    
    if (!fileEntry || typeof fileEntry === 'string') {
      throw new HTTPException(400, { message: 'File is required' });
    }

    const file = fileEntry as File;
    const text = await file.text();
    try {
      data = JSON.parse(text);
    } catch {
      throw new HTTPException(400, { message: 'Invalid JSON file' });
    }

    format = (formData.get('format') as ImportFormat) || format;
  } else {
    data = await c.req.json();
  }

  const service = createImportExportService(c.env.DB);
  const result = await service.importBulk(userId, data, format);

  return c.json(result);
});

/**
 * POST /import/detect
 * Detect import format from data
 */
app.post('/import/detect', async (c) => {
  const data = await c.req.json();
  const service = createImportExportService(c.env.DB);
  const format = service.detectFormat(data);

  return c.json({ format });
});

// =============================================================================
// Export Routes
// =============================================================================

/**
 * GET /export/:conversationId
 * Export a single conversation
 */
app.get('/export/:conversationId', async (c) => {
  const userId = c.get('userId');
  const { conversationId } = c.req.param();
  const format = (c.req.query('format') || 'json') as ExportFormat;

  const service = createImportExportService(c.env.DB);

  try {
    const result = await service.exportConversation(conversationId, userId, format);

    return new Response(result.data, {
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Conversation not found') {
      throw new HTTPException(404, { message: 'Conversation not found' });
    }
    throw error;
  }
});

/**
 * POST /export/bulk
 * Export multiple conversations
 */
app.post('/export/bulk', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const { conversationIds } = body;

  if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
    throw new HTTPException(400, { message: 'conversationIds array is required' });
  }

  const service = createImportExportService(c.env.DB);
  const result = await service.exportBulk(conversationIds, userId);

  return new Response(result.data, {
    headers: {
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
    },
  });
});

/**
 * GET /export/all
 * Export all user conversations
 */
app.get('/export/all', async (c) => {
  const userId = c.get('userId');
  const service = createImportExportService(c.env.DB);
  const result = await service.exportAll(userId);

  return new Response(result.data, {
    headers: {
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
    },
  });
});

/**
 * GET /export/formats
 * List available export formats
 */
app.get('/export/formats', async (c) => {
  return c.json({
    formats: [
      { id: 'json', name: 'JSON', extension: '.json', description: 'Full data export' },
      { id: 'markdown', name: 'Markdown', extension: '.md', description: 'Readable markdown format' },
      { id: 'text', name: 'Plain Text', extension: '.txt', description: 'Simple text format' },
      { id: 'html', name: 'HTML', extension: '.html', description: 'Styled HTML page' },
    ],
  });
});

/**
 * GET /import/formats
 * List supported import formats
 */
app.get('/import/formats', async (c) => {
  return c.json({
    formats: [
      { id: 'chatgpt', name: 'ChatGPT', description: 'Export from ChatGPT' },
      { id: 'librechat', name: 'LibreChat', description: 'LibreChat export format' },
      { id: 'chatbot-ui', name: 'Chatbot UI', description: 'Chatbot UI export format' },
      { id: 'json', name: 'Generic JSON', description: 'Generic conversation JSON' },
    ],
  });
});

export { app as importexport };
export default app;
