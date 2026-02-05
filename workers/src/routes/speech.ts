/**
 * Speech API Routes
 * Speech-to-Text and Text-to-Speech endpoints
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createSpeechServiceFromEnv } from '../services/speech';
import type { AppEnv } from '../types';

const app = new Hono<AppEnv>();

// =============================================================================
// Middleware
// =============================================================================

app.use('*', async (c, next) => {
  const speechService = createSpeechServiceFromEnv({
    STT_PROVIDER: c.env.STT_PROVIDER,
    TTS_PROVIDER: c.env.TTS_PROVIDER,
    OPENAI_API_KEY: c.env.OPENAI_API_KEY,
    AZURE_SPEECH_KEY: c.env.AZURE_SPEECH_KEY,
    AZURE_SPEECH_REGION: c.env.AZURE_SPEECH_REGION,
    ELEVENLABS_API_KEY: c.env.ELEVENLABS_API_KEY,
    DEEPGRAM_API_KEY: c.env.DEEPGRAM_API_KEY,
    DEFAULT_TTS_VOICE: c.env.DEFAULT_TTS_VOICE,
  });

  c.set('speechService', speechService);
  await next();
});

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /speech/transcribe
 * Convert audio to text (STT)
 */
app.post('/transcribe', async (c) => {
  const speechService = c.get('speechService')!;

  if (!speechService.isSTTAvailable()) {
    throw new HTTPException(503, {
      message: 'Speech-to-text is not configured',
    });
  }

  const contentType = c.req.header('content-type') || '';
  let audio: ArrayBuffer;

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const fileEntry = formData.get('audio');
    if (!fileEntry || typeof fileEntry === 'string') {
      throw new HTTPException(400, { message: 'Audio file is required' });
    }
    const file = fileEntry as File;
    audio = await file.arrayBuffer();
  } else {
    audio = await c.req.arrayBuffer();
  }

  if (audio.byteLength === 0) {
    throw new HTTPException(400, { message: 'Audio data is empty' });
  }

  // Parse options from query params or JSON body
  const language = c.req.query('language');
  const prompt = c.req.query('prompt');

  try {
    const result = await speechService.transcribe(audio, {
      language,
      prompt,
    });

    return c.json(result);
  } catch (error) {
    console.error('[Speech] Transcription error:', error);
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : 'Transcription failed',
    });
  }
});

/**
 * POST /speech/synthesize
 * Convert text to audio (TTS)
 */
app.post('/synthesize', async (c) => {
  const speechService = c.get('speechService')!;

  if (!speechService.isTTSAvailable()) {
    throw new HTTPException(503, {
      message: 'Text-to-speech is not configured',
    });
  }

  const body = await c.req.json();
  const { text, voice, speed, format } = body;

  if (!text || typeof text !== 'string') {
    throw new HTTPException(400, { message: 'Text is required' });
  }

  if (text.length > 4096) {
    throw new HTTPException(400, { message: 'Text too long (max 4096 characters)' });
  }

  try {
    const result = await speechService.synthesize(text, {
      voice,
      speed,
      format,
    });

    return new Response(result.audio, {
      headers: {
        'Content-Type': result.contentType,
        'Content-Length': result.audio.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error('[Speech] Synthesis error:', error);
    throw new HTTPException(500, {
      message: error instanceof Error ? error.message : 'Synthesis failed',
    });
  }
});

/**
 * GET /speech/voices
 * List available TTS voices
 */
app.get('/voices', async (c) => {
  const speechService = c.get('speechService')!;
  const voices = speechService.getVoices();

  return c.json({
    voices,
    provider: c.env.TTS_PROVIDER || 'openai',
  });
});

/**
 * GET /speech/status
 * Check speech service availability
 */
app.get('/status', async (c) => {
  const speechService = c.get('speechService')!;

  return c.json({
    stt: {
      available: speechService.isSTTAvailable(),
      provider: c.env.STT_PROVIDER || 'openai',
    },
    tts: {
      available: speechService.isTTSAvailable(),
      provider: c.env.TTS_PROVIDER || 'openai',
    },
  });
});

export { app as speech };
export default app;
