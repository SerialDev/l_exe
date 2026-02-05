/**
 * Files routes
 * GET /, POST /upload, GET /:id, DELETE /:id, POST /images
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { AuthContext } from '../middleware/auth';
import { createRAGService } from '../services/rag';

// Types for Cloudflare bindings
interface Env {
  DB: D1Database;
  FILES_BUCKET: R2Bucket;
  IMAGES_BUCKET: R2Bucket;
  SESSIONS: KVNamespace;
  JWT_SECRET: string;
  DOMAIN_SERVER: string;
  OPENAI_API_KEY?: string;
}

// Context variables
interface Variables {
  user: AuthContext['user'];
}

// Request schemas
const listFilesSchema = z.object({
  page: z.coerce.number().positive().default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  purpose: z.enum(['attachment', 'avatar', 'export', 'rag']).optional(),
  conversationId: z.string().optional(),
});

// Allowed MIME types
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

// Helper functions
function getUser(c: any): AuthContext['user'] | null {
  return c.get('user') || null;
}

function generateUUID(): string {
  return crypto.randomUUID();
}

function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? `.${parts.pop()?.toLowerCase()}` : '';
}

function generateR2Key(userId: string, purpose: string, filename: string): string {
  const ext = getFileExtension(filename);
  const uniqueId = generateUUID();
  return `${userId}/${purpose}/${uniqueId}${ext}`;
}

// Create router
const files = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /
 * List user's files with pagination
 */
files.get('/', zValidator('query', listFilesSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const { page, pageSize, purpose, conversationId } = c.req.valid('query');
  const offset = (page - 1) * pageSize;

  try {
    let query = `
      SELECT 
        id, user_id as userId, filename, original_name as originalName,
        mime_type as mimeType, size, purpose, r2_key as r2Key,
        conversation_id as conversationId, message_id as messageId,
        width, height, created_at as createdAt
      FROM files
      WHERE user_id = ?
    `;
    const params: any[] = [user.id];

    if (purpose) {
      query += ' AND purpose = ?';
      params.push(purpose);
    }

    if (conversationId) {
      query += ' AND conversation_id = ?';
      params.push(conversationId);
    }

    // Count total
    const countQuery = query.replace(/SELECT[\s\S]+FROM/, 'SELECT COUNT(*) as total FROM');
    const countResult = await c.env.DB.prepare(countQuery).bind(...params).first<{ total: number }>();
    const total = countResult?.total || 0;

    // Add pagination
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(pageSize, offset);

    const result = await c.env.DB.prepare(query).bind(...params).all();

    // Generate URLs for files
    const filesWithUrls = (result.results || []).map((file: any) => ({
      ...file,
      url: `${c.env.DOMAIN_SERVER}/files/${file.r2Key}`,
    }));

    return c.json({
      success: true,
      files: filesWithUrls,
      total,
      page,
      pageSize,
      hasMore: offset + pageSize < total,
    });
  } catch (error) {
    console.error('List files error:', error);
    return c.json({ success: false, error: { message: 'Failed to list files' } }, 500);
  }
});

/**
 * POST /upload
 * Upload a file to R2 storage
 */
files.post('/upload', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  try {
    const formData = await c.req.formData();
    const fileEntry = formData.get('file');
    const purpose = (formData.get('purpose') as string) || 'attachment';
    const conversationId = formData.get('conversationId') as string | null;
    const messageId = formData.get('messageId') as string | null;

    if (!fileEntry || typeof fileEntry === 'string') {
      return c.json({ success: false, error: { message: 'No file provided' } }, 400);
    }
    const file = fileEntry as File;

    // Validate file type
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return c.json({ success: false, error: { message: `File type ${file.type} not allowed` } }, 400);
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return c.json({ success: false, error: { message: 'File too large (max 10MB)' } }, 400);
    }

    const fileId = generateUUID();
    const r2Key = generateR2Key(user.id, purpose, file.name);
    const now = new Date().toISOString();

    // Upload to R2
    const arrayBuffer = await file.arrayBuffer();
    await c.env.FILES_BUCKET.put(r2Key, arrayBuffer, {
      httpMetadata: {
        contentType: file.type,
      },
      customMetadata: {
        userId: user.id,
        originalName: file.name,
        purpose,
      },
    });

    // Save to database
    await c.env.DB
      .prepare(`
        INSERT INTO files (id, user_id, filename, original_name, mime_type, size, purpose, r2_key, conversation_id, message_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        fileId,
        user.id,
        r2Key.split('/').pop(),
        file.name,
        file.type,
        file.size,
        purpose,
        r2Key,
        conversationId,
        messageId,
        now
      )
      .run();

    return c.json({
      success: true,
      file: {
        id: fileId,
        filename: r2Key.split('/').pop(),
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
        purpose,
        url: `${c.env.DOMAIN_SERVER}/files/${r2Key}`,
        createdAt: now,
      },
    }, 201);
  } catch (error) {
    console.error('Upload file error:', error);
    return c.json({ success: false, error: { message: 'Failed to upload file' } }, 500);
  }
});

/**
 * GET /:id
 * Get file metadata
 */
files.get('/:id', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const fileId = c.req.param('id');

  try {
    const file = await c.env.DB
      .prepare(`
        SELECT 
          id, user_id as userId, filename, original_name as originalName,
          mime_type as mimeType, size, purpose, r2_key as r2Key,
          conversation_id as conversationId, width, height, created_at as createdAt
        FROM files
        WHERE id = ? AND user_id = ?
      `)
      .bind(fileId, user.id)
      .first();

    if (!file) {
      return c.json({ success: false, error: { message: 'File not found' } }, 404);
    }

    return c.json({
      success: true,
      file: {
        ...file,
        url: `${c.env.DOMAIN_SERVER}/files/${file.r2Key}`,
      },
    });
  } catch (error) {
    console.error('Get file error:', error);
    return c.json({ success: false, error: { message: 'Failed to get file' } }, 500);
  }
});

/**
 * GET /:id/download
 * Download file content
 */
files.get('/:id/download', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const fileId = c.req.param('id');

  try {
    const file = await c.env.DB
      .prepare('SELECT r2_key, original_name, mime_type FROM files WHERE id = ? AND user_id = ?')
      .bind(fileId, user.id)
      .first<{ r2_key: string; original_name: string; mime_type: string }>();

    if (!file) {
      return c.json({ success: false, error: { message: 'File not found' } }, 404);
    }

    const object = await c.env.FILES_BUCKET.get(file.r2_key);
    if (!object) {
      return c.json({ success: false, error: { message: 'File not found in storage' } }, 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Disposition', `attachment; filename="${file.original_name}"`);
    headers.set('Content-Type', file.mime_type);

    return new Response(object.body, { headers });
  } catch (error) {
    console.error('Download file error:', error);
    return c.json({ success: false, error: { message: 'Failed to download file' } }, 500);
  }
});

/**
 * DELETE /:id
 * Delete a file
 */
files.delete('/:id', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const fileId = c.req.param('id');

  try {
    const file = await c.env.DB
      .prepare('SELECT r2_key FROM files WHERE id = ? AND user_id = ?')
      .bind(fileId, user.id)
      .first<{ r2_key: string }>();

    if (!file) {
      return c.json({ success: false, error: { message: 'File not found' } }, 404);
    }

    // Delete from R2
    await c.env.FILES_BUCKET.delete(file.r2_key);

    // Delete from database (include user_id for tenant isolation defense-in-depth)
    await c.env.DB.prepare('DELETE FROM files WHERE id = ? AND user_id = ?').bind(fileId, user.id).run();

    return c.json({ success: true, message: 'File deleted' });
  } catch (error) {
    console.error('Delete file error:', error);
    return c.json({ success: false, error: { message: 'Failed to delete file' } }, 500);
  }
});

/**
 * POST /images
 * Upload an image to R2
 */
files.post('/images', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  try {
    const formData = await c.req.formData();
    const fileEntry = formData.get('file');
    const purpose = (formData.get('purpose') as string) || 'attachment';

    if (!fileEntry || typeof fileEntry === 'string') {
      return c.json({ success: false, error: { message: 'No image provided' } }, 400);
    }
    const file = fileEntry as File;

    // Validate image type
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return c.json({ success: false, error: { message: `Image type ${file.type} not allowed` } }, 400);
    }

    // Validate file size
    if (file.size > MAX_IMAGE_SIZE) {
      return c.json({ success: false, error: { message: 'Image too large (max 5MB)' } }, 400);
    }

    const fileId = generateUUID();
    const r2Key = generateR2Key(user.id, 'images', file.name);
    const now = new Date().toISOString();

    // Upload to R2 images bucket
    const arrayBuffer = await file.arrayBuffer();
    await c.env.IMAGES_BUCKET.put(r2Key, arrayBuffer, {
      httpMetadata: {
        contentType: file.type,
        cacheControl: 'public, max-age=31536000',
      },
      customMetadata: {
        userId: user.id,
        originalName: file.name,
      },
    });

    // Save to database
    await c.env.DB
      .prepare(`
        INSERT INTO files (id, user_id, filename, original_name, mime_type, size, purpose, r2_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(fileId, user.id, r2Key.split('/').pop(), file.name, file.type, file.size, purpose, r2Key, now)
      .run();

    return c.json({
      success: true,
      image: {
        id: fileId,
        filename: r2Key.split('/').pop(),
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
        url: `${c.env.DOMAIN_SERVER}/images/${r2Key}`,
        createdAt: now,
      },
    }, 201);
  } catch (error) {
    console.error('Upload image error:', error);
    return c.json({ success: false, error: { message: 'Failed to upload image' } }, 500);
  }
});

/**
 * POST /:id/index
 * Index a file for RAG (creates embeddings for search)
 */
files.post('/:id/index', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const fileId = c.req.param('id');

  try {
    // Get file metadata
    const file = await c.env.DB
      .prepare(`
        SELECT id, r2_key, original_name, mime_type, size
        FROM files
        WHERE id = ? AND user_id = ?
      `)
      .bind(fileId, user.id)
      .first<{ id: string; r2_key: string; original_name: string; mime_type: string; size: number }>();

    if (!file) {
      return c.json({ success: false, error: { message: 'File not found' } }, 404);
    }

    // Only allow text-based files for RAG
    const textMimeTypes = new Set([
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/json',
      'application/pdf', // Would need PDF parsing in production
    ]);

    if (!textMimeTypes.has(file.mime_type)) {
      return c.json({ 
        success: false, 
        error: { message: `File type ${file.mime_type} cannot be indexed for RAG` } 
      }, 400);
    }

    // Get file content from R2
    const object = await c.env.FILES_BUCKET.get(file.r2_key);
    if (!object) {
      return c.json({ success: false, error: { message: 'File not found in storage' } }, 404);
    }

    const content = await object.text();

    // Create RAG service and index the document
    const ragService = createRAGService(c.env as any);
    const result = await ragService.indexDocument(fileId, content, user.id, {
      filename: file.original_name,
      mimeType: file.mime_type,
      size: file.size,
    });

    return c.json({
      success: true,
      fileId,
      filename: file.original_name,
      chunksCreated: result.chunksCreated,
      totalTokens: result.totalTokens,
      message: `Indexed ${result.chunksCreated} chunks (${result.totalTokens} tokens)`,
    });
  } catch (error) {
    console.error('Index file error:', error);
    return c.json({ success: false, error: { message: 'Failed to index file' } }, 500);
  }
});

/**
 * DELETE /:id/index
 * Remove RAG index for a file
 */
files.delete('/:id/index', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const fileId = c.req.param('id');

  try {
    // Verify file ownership
    const file = await c.env.DB
      .prepare('SELECT id FROM files WHERE id = ? AND user_id = ?')
      .bind(fileId, user.id)
      .first();

    if (!file) {
      return c.json({ success: false, error: { message: 'File not found' } }, 404);
    }

    // Delete chunks (pass userId for tenant isolation)
    const ragService = createRAGService(c.env as any);
    await ragService.deleteFileChunks(fileId, user.id);

    // Update file embedded status (include user_id for tenant isolation defense-in-depth)
    await c.env.DB
      .prepare('UPDATE files SET embedded = 0 WHERE id = ? AND user_id = ?')
      .bind(fileId, user.id)
      .run();

    return c.json({ success: true, message: 'RAG index removed' });
  } catch (error) {
    console.error('Remove index error:', error);
    return c.json({ success: false, error: { message: 'Failed to remove index' } }, 500);
  }
});

/**
 * GET /indexed
 * List files that have been indexed for RAG
 */
files.get('/indexed', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  try {
    const result = await c.env.DB
      .prepare(`
        SELECT 
          f.id,
          f.original_name as originalName,
          f.mime_type as mimeType,
          f.size,
          f.created_at as createdAt,
          COUNT(dc.id) as chunkCount
        FROM files f
        LEFT JOIN document_chunks dc ON f.id = dc.file_id
        WHERE f.user_id = ? AND f.embedded = 1
        GROUP BY f.id
        ORDER BY f.created_at DESC
      `)
      .bind(user.id)
      .all<{
        id: string;
        originalName: string;
        mimeType: string;
        size: number;
        createdAt: string;
        chunkCount: number;
      }>();

    return c.json({
      success: true,
      files: result.results || [],
      total: result.results?.length || 0,
    });
  } catch (error) {
    console.error('List indexed files error:', error);
    return c.json({ success: false, error: { message: 'Failed to list indexed files' } }, 500);
  }
});

/**
 * POST /search
 * Search across indexed documents using RAG
 */
const searchSchema = z.object({
  query: z.string().min(1).max(1000),
  fileIds: z.array(z.string()).optional(),
  limit: z.number().min(1).max(20).default(5),
});

files.post('/search', zValidator('json', searchSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const { query, fileIds, limit } = c.req.valid('json');

  try {
    const ragService = createRAGService(c.env as any);
    const results = await ragService.search(query, user.id, fileIds, limit);

    return c.json({
      success: true,
      query,
      results: results.map(r => ({
        fileId: r.chunk.fileId,
        content: r.chunk.content,
        score: r.score,
        metadata: r.chunk.metadata,
      })),
      total: results.length,
    });
  } catch (error) {
    console.error('Search error:', error);
    return c.json({ success: false, error: { message: 'Failed to search documents' } }, 500);
  }
});

export { files };
export default files;
