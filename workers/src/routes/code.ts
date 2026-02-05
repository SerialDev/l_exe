/**
 * Code Interpreter API Routes
 * Provides code execution endpoints for AI agents and users.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
  createCodeInterpreterFromEnv,
  detectLanguage,
  getLanguageInfo,
  type SupportedLanguage,
} from '../services/codeinterpreter';
import type { AppEnv } from '../types';

const app = new Hono<AppEnv>();

// =============================================================================
// Validation Schemas
// =============================================================================

const executeSchema = z.object({
  code: z.string().min(1).max(100000),
  language: z.enum([
    'javascript',
    'typescript',
    'python',
    'python3',
    'bash',
    'shell',
    'html',
    'css',
    'json',
    'sql',
  ]).optional(),
  timeout: z.number().int().min(100).max(60000).optional(),
  stdin: z.string().max(10000).optional(),
  files: z.array(z.object({
    name: z.string(),
    content: z.string(),
  })).optional(),
});

const validateSchema = z.object({
  code: z.string().min(1).max(100000),
  language: z.enum([
    'javascript',
    'typescript',
    'python',
    'python3',
    'bash',
    'shell',
    'html',
    'css',
    'json',
    'sql',
  ]),
});

// =============================================================================
// Middleware
// =============================================================================

/**
 * Initialize code interpreter service
 */
app.use('*', async (c, next) => {
  const interpreter = createCodeInterpreterFromEnv({
    CODE_INTERPRETER_BACKEND: c.env.CODE_INTERPRETER_BACKEND,
    E2B_API_KEY: c.env.E2B_API_KEY,
    JUDGE0_URL: c.env.JUDGE0_URL,
    JUDGE0_API_KEY: c.env.JUDGE0_API_KEY,
  });

  c.set('interpreter', interpreter);
  await next();
});

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /code/execute
 * Execute code in the sandbox
 */
app.post('/execute', async (c) => {
  const body = await c.req.json();
  const parsed = executeSchema.safeParse(body);

  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`,
    });
  }

  const { code, language: requestedLanguage, timeout, stdin, files } = parsed.data;
  const interpreter = c.get('interpreter')!;

  // Auto-detect language if not provided
  let language = requestedLanguage as SupportedLanguage | undefined;
  if (!language) {
    language = detectLanguage(code) || undefined;
    if (!language) {
      throw new HTTPException(400, {
        message: 'Could not detect language. Please specify the language explicitly.',
      });
    }
  }

  // Check if language is supported
  if (!interpreter.isLanguageSupported(language)) {
    const supported = interpreter.getSupportedLanguages();
    throw new HTTPException(400, {
      message: `Language '${language}' is not supported. Supported: ${supported.join(', ')}`,
    });
  }

  try {
    const result = await interpreter.execute({
      language,
      code,
      timeout,
      stdin,
      files: files as Array<{ name: string; content: string }> | undefined,
    });

    return c.json({
      ...result,
      language,
      languageInfo: getLanguageInfo(language),
    });
  } catch (error) {
    console.error('[Code] Execution error:', error);
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : 'Execution failed',
    });
  }
});

/**
 * POST /code/validate
 * Validate code syntax without executing
 */
app.post('/validate', async (c) => {
  const body = await c.req.json();
  const parsed = validateSchema.safeParse(body);

  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`,
    });
  }

  const { code, language } = parsed.data;
  const interpreter = c.get('interpreter')!;

  try {
    const result = await interpreter.validateSyntax(language as SupportedLanguage, code);
    return c.json({
      valid: result.valid,
      error: result.error,
      language,
    });
  } catch (error) {
    console.error('[Code] Validation error:', error);
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : 'Validation failed',
    });
  }
});

/**
 * POST /code/detect
 * Detect language from code
 */
app.post('/detect', async (c) => {
  const body = await c.req.json();
  const { code, filename } = body;

  if (!code && !filename) {
    throw new HTTPException(400, { message: 'Either code or filename is required' });
  }

  const detected = detectLanguage(code || filename);
  
  return c.json({
    language: detected,
    languageInfo: detected ? getLanguageInfo(detected) : null,
    detected: detected !== null,
  });
});

/**
 * GET /code/languages
 * List supported languages
 */
app.get('/languages', async (c) => {
  const interpreter = c.get('interpreter')!;
  const supported = interpreter.getSupportedLanguages();
  
  const languages = supported.map((lang: SupportedLanguage) => ({
    id: lang,
    ...getLanguageInfo(lang),
  }));

  return c.json({
    languages,
    backend: c.env.CODE_INTERPRETER_BACKEND || 'workers',
  });
});

/**
 * GET /code/backends
 * List available backends and their status
 */
app.get('/backends', async (c) => {
  const backends = [
    {
      id: 'workers',
      name: 'Cloudflare Workers',
      description: 'Built-in JavaScript/TypeScript execution',
      configured: true,
      languages: ['javascript', 'typescript'],
    },
    {
      id: 'e2b',
      name: 'E2B',
      description: 'Cloud sandboxes for Python, JavaScript, and more',
      configured: !!c.env.E2B_API_KEY,
      languages: ['javascript', 'typescript', 'python', 'python3'],
    },
    {
      id: 'judge0',
      name: 'Judge0',
      description: 'Self-hosted code execution with 40+ languages',
      configured: !!c.env.JUDGE0_URL,
      languages: ['javascript', 'typescript', 'python', 'python3', 'bash', 'sql'],
    },
  ];

  const currentBackend = c.env.CODE_INTERPRETER_BACKEND || 'workers';

  return c.json({
    backends,
    current: currentBackend,
  });
});

/**
 * POST /code/js
 * Shorthand for executing JavaScript
 */
app.post('/js', async (c) => {
  const body = await c.req.json();
  const { code, timeout } = body;

  if (!code || typeof code !== 'string') {
    throw new HTTPException(400, { message: 'Code is required' });
  }

  const interpreter = c.get('interpreter')!;

  try {
    const result = await interpreter.executeJS(code, { timeout });
    return c.json(result);
  } catch (error) {
    console.error('[Code] JS execution error:', error);
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : 'Execution failed',
    });
  }
});

/**
 * POST /code/python
 * Shorthand for executing Python
 */
app.post('/python', async (c) => {
  const body = await c.req.json();
  const { code, timeout, stdin } = body;

  if (!code || typeof code !== 'string') {
    throw new HTTPException(400, { message: 'Code is required' });
  }

  const interpreter = c.get('interpreter')!;

  if (!interpreter.isLanguageSupported('python3')) {
    throw new HTTPException(400, {
      message: 'Python execution requires E2B or Judge0 backend to be configured',
    });
  }

  try {
    const result = await interpreter.executePython(code, { timeout, stdin });
    return c.json(result);
  } catch (error) {
    console.error('[Code] Python execution error:', error);
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : 'Execution failed',
    });
  }
});

export { app as code };
export default app;
