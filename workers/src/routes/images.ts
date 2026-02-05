/**
 * Image Generation API Routes
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { createImageGenServiceFromEnv } from '../services/imagegen';
import type { AppEnv } from '../types';

const app = new Hono<AppEnv>();

// =============================================================================
// Validation Schemas
// =============================================================================

const generateSchema = z.object({
  prompt: z.string().min(1).max(4000),
  negativePrompt: z.string().max(4000).optional(),
  size: z.enum(['256x256', '512x512', '1024x1024', '1024x1792', '1792x1024']).optional(),
  quality: z.enum(['standard', 'hd']).optional(),
  style: z.enum(['vivid', 'natural']).optional(),
  n: z.number().int().min(1).max(4).optional(),
  model: z.string().optional(),
  seed: z.number().int().optional(),
  steps: z.number().int().min(1).max(150).optional(),
  cfgScale: z.number().min(0).max(35).optional(),
  responseFormat: z.enum(['url', 'b64_json']).optional(),
});

const editSchema = z.object({
  prompt: z.string().min(1).max(1000),
  size: z.enum(['256x256', '512x512', '1024x1024']).optional(),
  n: z.number().int().min(1).max(4).optional(),
});

// =============================================================================
// Middleware
// =============================================================================

app.use('*', async (c, next) => {
  const imageService = createImageGenServiceFromEnv({
    IMAGE_GEN_PROVIDER: c.env.IMAGE_GEN_PROVIDER,
    OPENAI_API_KEY: c.env.OPENAI_API_KEY,
    STABILITY_API_KEY: c.env.STABILITY_API_KEY,
    REPLICATE_API_KEY: c.env.REPLICATE_API_KEY,
    AI: c.env.AI,
  });

  c.set('imageService', imageService);
  await next();
});

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /images/generate
 * Generate images from text prompt
 */
app.post('/generate', async (c) => {
  const body = await c.req.json();
  const parsed = generateSchema.safeParse(body);

  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`,
    });
  }

  const imageService = c.get('imageService');
  if (!imageService) {
    throw new HTTPException(503, { message: 'Image generation service not available' });
  }

  try {
    const { prompt, ...options } = parsed.data;
    const result = await imageService.generate({ prompt, ...options });
    return c.json(result);
  } catch (error) {
    console.error('[Images] Generation error:', error);
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : 'Image generation failed',
    });
  }
});

/**
 * POST /images/edit
 * Edit an existing image (OpenAI only)
 */
app.post('/edit', async (c) => {
  const contentType = c.req.header('content-type') || '';
  
  if (!contentType.includes('multipart/form-data')) {
    throw new HTTPException(400, { message: 'Multipart form data required' });
  }

  const formData = await c.req.formData();
  const imageEntry = formData.get('image');
  const maskEntry = formData.get('mask');
  const prompt = formData.get('prompt') as string;
  const size = formData.get('size') as string;
  const n = formData.get('n') as string;

  if (!imageEntry || typeof imageEntry === 'string') {
    throw new HTTPException(400, { message: 'Image file is required' });
  }
  if (!prompt) {
    throw new HTTPException(400, { message: 'Prompt is required' });
  }

  const imageService = c.get('imageService');
  if (!imageService) {
    throw new HTTPException(503, { message: 'Image generation service not available' });
  }

  const image = imageEntry as File;
  const maskBuffer = maskEntry && typeof maskEntry !== 'string' ? await (maskEntry as File).arrayBuffer() : undefined;

  try {
    const result = await imageService.edit({
      image: await image.arrayBuffer(),
      mask: maskBuffer,
      prompt,
      size: size as any,
      n: n ? parseInt(n, 10) : 1,
    });
    return c.json(result);
  } catch (error) {
    console.error('[Images] Edit error:', error);
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : 'Image editing failed',
    });
  }
});

/**
 * POST /images/variations
 * Create variations of an image (OpenAI only)
 */
app.post('/variations', async (c) => {
  const contentType = c.req.header('content-type') || '';
  
  if (!contentType.includes('multipart/form-data')) {
    throw new HTTPException(400, { message: 'Multipart form data required' });
  }

  const formData = await c.req.formData();
  const imageEntry = formData.get('image');
  const size = formData.get('size') as string;
  const n = formData.get('n') as string;

  if (!imageEntry || typeof imageEntry === 'string') {
    throw new HTTPException(400, { message: 'Image file is required' });
  }

  const imageService = c.get('imageService');
  if (!imageService) {
    throw new HTTPException(503, { message: 'Image generation service not available' });
  }

  const image = imageEntry as File;

  try {
    const result = await imageService.variations({
      image: await image.arrayBuffer(),
      size: size as any,
      n: n ? parseInt(n, 10) : 1,
    });
    return c.json(result);
  } catch (error) {
    console.error('[Images] Variations error:', error);
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : 'Image variations failed',
    });
  }
});

/**
 * GET /images/models
 * List available models
 */
app.get('/models', async (c) => {
  const imageService = c.get('imageService');
  if (!imageService) {
    throw new HTTPException(503, { message: 'Image generation service not available' });
  }
  const models = imageService.getModels();
  const sizes = imageService.getSizes();

  return c.json({
    models,
    sizes,
    provider: c.env.IMAGE_GEN_PROVIDER || 'openai',
  });
});

export { app as images };
export default app;
