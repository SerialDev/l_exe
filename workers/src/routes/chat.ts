/**
 * Chat routes - Main chat completion API
 * POST /ask - Send message and get AI response
 * POST /ask/stream - Send message and stream AI response (SSE)
 * POST /stop - Stop an in-progress generation
 * POST /continue - Continue an AI response
 * POST /regenerate - Regenerate an AI response
 * POST /edit - Edit a user message and get new response
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { streamSSE } from 'hono/streaming';
import type { AuthContext } from '../middleware/auth';
import { createChatService, type SendMessageRequest } from '../services/chat';
import type { Env } from '../types';

// Context variables
interface Variables {
  user: AuthContext['user'];
}

// =============================================================================
// Request Schemas
// =============================================================================

const askSchema = z.object({
  conversationId: z.string().optional(),
  parentMessageId: z.string().optional(),
  endpoint: z.string().default('openai'),
  model: z.string(),
  text: z.string().min(1).max(100000),
  systemPrompt: z.string().max(50000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().positive().optional(),
  enableRAG: z.boolean().optional(),
  ragFileIds: z.array(z.string()).optional(),
  contextStrategy: z.enum(['discard', 'summarize']).optional(),
  // Agent support
  agentId: z.string().optional(),
  // Temporary chat (not saved)
  temporary: z.boolean().optional(),
  // Files for vision
  files: z.array(z.object({
    file_id: z.string(),
    type: z.enum(['image', 'file']),
  })).optional(),
});

const stopSchema = z.object({
  conversationId: z.string(),
  messageId: z.string(),
});

const continueSchema = z.object({
  conversationId: z.string(),
  messageId: z.string(),
  endpoint: z.string().optional(),
  model: z.string().optional(),
});

const regenerateSchema = z.object({
  conversationId: z.string(),
  messageId: z.string(),
  endpoint: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().positive().optional(),
});

const editSchema = z.object({
  conversationId: z.string(),
  messageId: z.string(),
  text: z.string().min(1).max(100000),
  endpoint: z.string().optional(),
  model: z.string().optional(),
});

// =============================================================================
// Helper Functions
// =============================================================================

function getUser(c: any): AuthContext['user'] | null {
  return c.get('user') || null;
}

async function getAgentConfig(
  db: D1Database,
  agentId: string,
  userId: string
): Promise<{
  instructions: string;
  model: string;
  endpoint: string;
  temperature?: number;
  topP?: number;
} | null> {
  const agent = await db
    .prepare(`
      SELECT system_message, model, endpoint, model_parameters
      FROM agents
      WHERE id = ? AND (user_id = ? OR is_public = 1)
    `)
    .bind(agentId, userId)
    .first<{
      system_message: string;
      model: string;
      endpoint: string;
      model_parameters: string | null;
    }>();

  if (!agent) return null;

  const params = agent.model_parameters ? JSON.parse(agent.model_parameters) : {};

  return {
    instructions: agent.system_message,
    model: agent.model,
    endpoint: agent.endpoint,
    temperature: params.temperature,
    topP: params.topP,
  };
}

// =============================================================================
// Routes
// =============================================================================

const chat = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * POST /ask
 * Send a message and get an AI response (non-streaming)
 */
chat.post('/ask', zValidator('json', askSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const data = c.req.valid('json');

  try {
    // If using an agent, get agent config
    let systemPrompt = data.systemPrompt;
    let model = data.model;
    let endpoint = data.endpoint;
    let temperature = data.temperature;
    let topP = data.topP;

    if (data.agentId) {
      const agentConfig = await getAgentConfig(c.env.DB, data.agentId, user.id);
      if (!agentConfig) {
        return c.json({ success: false, error: { message: 'Agent not found' } }, 404);
      }
      systemPrompt = agentConfig.instructions;
      model = agentConfig.model;
      endpoint = agentConfig.endpoint;
      temperature = agentConfig.temperature ?? temperature;
      topP = agentConfig.topP ?? topP;
    }

    const chatService = createChatService(c.env, user.id);

    const request: SendMessageRequest = {
      conversationId: data.temporary ? undefined : data.conversationId,
      parentMessageId: data.parentMessageId,
      endpoint,
      model,
      text: data.text,
      systemPrompt,
      temperature,
      topP,
      maxTokens: data.maxTokens,
      enableRAG: data.enableRAG,
      ragFileIds: data.ragFileIds,
      contextStrategy: data.contextStrategy,
      files: data.files as Array<{ file_id: string; type: string }> | undefined,
    };

    const response = await chatService.sendMessage(request);

    // For temporary chats, delete the conversation after response (with tenant isolation)
    if (data.temporary && response.conversationId) {
      await c.env.DB
        .prepare('DELETE FROM messages WHERE conversation_id = ? AND conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)')
        .bind(response.conversationId, user.id)
        .run();
      await c.env.DB
        .prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?')
        .bind(response.conversationId, user.id)
        .run();
      // Return without conversationId for temporary chats
      return c.json({
        success: true,
        ...response,
        conversationId: undefined,
        temporary: true,
      });
    }

    return c.json({
      success: true,
      ...response,
    });
  } catch (error) {
    console.error('Chat ask error:', error);
    const message = error instanceof Error ? error.message : 'Failed to process message';
    return c.json({ success: false, error: { message } }, 500);
  }
});

/**
 * POST /ask/stream
 * Send a message and stream the AI response (SSE)
 */
chat.post('/ask/stream', zValidator('json', askSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const data = c.req.valid('json');

  try {
    // If using an agent, get agent config
    let systemPrompt = data.systemPrompt;
    let model = data.model;
    let endpoint = data.endpoint;
    let temperature = data.temperature;
    let topP = data.topP;

    if (data.agentId) {
      const agentConfig = await getAgentConfig(c.env.DB, data.agentId, user.id);
      if (!agentConfig) {
        return c.json({ success: false, error: { message: 'Agent not found' } }, 404);
      }
      systemPrompt = agentConfig.instructions;
      model = agentConfig.model;
      endpoint = agentConfig.endpoint;
      temperature = agentConfig.temperature ?? temperature;
      topP = agentConfig.topP ?? topP;
    }

    const chatService = createChatService(c.env, user.id);

    // Get the abort signal from the request (for client disconnect detection)
    const signal = c.req.raw.signal;

    const request: SendMessageRequest = {
      conversationId: data.temporary ? undefined : data.conversationId,
      parentMessageId: data.parentMessageId,
      endpoint,
      model,
      text: data.text,
      systemPrompt,
      temperature,
      topP,
      maxTokens: data.maxTokens,
      enableRAG: data.enableRAG,
      ragFileIds: data.ragFileIds,
      contextStrategy: data.contextStrategy,
      files: data.files as Array<{ file_id: string; type: string }> | undefined,
      signal, // Pass the abort signal to detect client disconnects
    };

    const stream = await chatService.sendMessageStream(request);

    // For temporary chats, we need to track the conversationId to delete later
    // This is handled in the stream's done event on the client side

    // Return the stream with proper SSE headers
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('Chat stream error:', error);
    const message = error instanceof Error ? error.message : 'Failed to process message';
    return c.json({ success: false, error: { message } }, 500);
  }
});

/**
 * POST /stop
 * Stop an in-progress generation
 */
chat.post('/stop', zValidator('json', stopSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const { conversationId, messageId } = c.req.valid('json');

  try {
    // Verify ownership
    const conversation = await c.env.DB
      .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
      .bind(conversationId, user.id)
      .first();

    if (!conversation) {
      return c.json({ success: false, error: { message: 'Conversation not found' } }, 404);
    }

    const chatService = createChatService(c.env, user.id);
    const success = await chatService.abortMessage(conversationId, messageId);

    return c.json({ success, message: 'Generation stopped' });
  } catch (error) {
    console.error('Stop generation error:', error);
    return c.json({ success: false, error: { message: 'Failed to stop generation' } }, 500);
  }
});

/**
 * POST /continue
 * Continue an AI response from where it left off
 */
chat.post('/continue', zValidator('json', continueSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const { conversationId, messageId, endpoint, model } = c.req.valid('json');

  try {
    // Get the message to continue
    const message = await c.env.DB
      .prepare(`
        SELECT m.id, m.content, m.role, m.model, m.endpoint, c.id as conv_id
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.id OR m.conversation_id = c.conversation_id
        WHERE m.id = ? AND c.user_id = ?
      `)
      .bind(messageId, user.id)
      .first<{
        id: string;
        content: string;
        role: string;
        model: string;
        endpoint: string;
        conv_id: string;
      }>();

    if (!message) {
      return c.json({ success: false, error: { message: 'Message not found' } }, 404);
    }

    if (message.role !== 'assistant') {
      return c.json({ success: false, error: { message: 'Can only continue assistant messages' } }, 400);
    }

    // Send a continuation prompt
    const chatService = createChatService(c.env, user.id);
    const response = await chatService.sendMessage({
      conversationId,
      parentMessageId: messageId,
      endpoint: endpoint || message.endpoint,
      model: model || message.model,
      text: 'Please continue your previous response from where you left off.',
      systemPrompt: `Continue your previous response. The previous response ended with: "${message.content.slice(-500)}"`,
    });

    return c.json({
      success: true,
      ...response,
      continuedFrom: messageId,
    });
  } catch (error) {
    console.error('Continue message error:', error);
    return c.json({ success: false, error: { message: 'Failed to continue message' } }, 500);
  }
});

/**
 * POST /regenerate
 * Regenerate an AI response
 */
chat.post('/regenerate', zValidator('json', regenerateSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const { conversationId, messageId, ...options } = c.req.valid('json');

  try {
    const chatService = createChatService(c.env, user.id);
    const response = await chatService.regenerateMessage(conversationId, messageId, options);

    return c.json({
      success: true,
      ...response,
      regeneratedFrom: messageId,
    });
  } catch (error) {
    console.error('Regenerate message error:', error);
    const message = error instanceof Error ? error.message : 'Failed to regenerate message';
    return c.json({ success: false, error: { message } }, 500);
  }
});

/**
 * POST /edit
 * Edit a user message and get a new AI response
 */
chat.post('/edit', zValidator('json', editSchema), async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const { conversationId, messageId, text, ...options } = c.req.valid('json');

  try {
    const chatService = createChatService(c.env, user.id);
    const response = await chatService.editMessage(conversationId, messageId, text, options);

    return c.json({
      success: true,
      ...response,
      editedFrom: messageId,
    });
  } catch (error) {
    console.error('Edit message error:', error);
    const message = error instanceof Error ? error.message : 'Failed to edit message';
    return c.json({ success: false, error: { message } }, 500);
  }
});

/**
 * GET /models
 * Get available models for each endpoint
 */
chat.get('/models', async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  // Return available models based on configured API keys
  const models: Record<string, string[]> = {};

  if (c.env.OPENAI_API_KEY) {
    models['openai'] = [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'gpt-4',
      'gpt-3.5-turbo',
      'o1-preview',
      'o1-mini',
    ];
  }

  if (c.env.ANTHROPIC_API_KEY) {
    models['anthropic'] = [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
    ];
  }

  if (c.env.GOOGLE_AI_API_KEY) {
    models['google'] = [
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-1.5-flash-8b',
      'gemini-2.0-flash-exp',
    ];
  }

  if (c.env.AZURE_OPENAI_API_KEY) {
    models['azure'] = [
      'gpt-4o',
      'gpt-4-turbo',
      'gpt-4',
      'gpt-35-turbo',
    ];
  }

  return c.json({
    success: true,
    models,
    endpoints: Object.keys(models),
  });
});

export { chat };
export default chat;
