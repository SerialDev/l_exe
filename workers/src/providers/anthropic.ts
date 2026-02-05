/**
 * Anthropic Provider
 * Supports Claude 3.x, Claude 4 models
 */

import { BaseProvider } from './base';
import {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  ProviderConfig,
  ModelConfig,
  ToolCall,
  FinishReason,
  ContentPart,
  CacheControlHint,
  ProviderError,
  ProviderErrorCode,
} from './types';

// =============================================================================
// Anthropic API Types
// =============================================================================

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | AnthropicContentBlock[];
  is_error?: boolean;
  cache_control?: { type: 'ephemeral' };
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string | AnthropicSystemBlock[];
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  tools?: AnthropicTool[];
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
  stream?: boolean;
  metadata?: { user_id?: string };
}

interface AnthropicSystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AnthropicStreamEvent {
  type: string;
  message?: AnthropicResponse;
  index?: number;
  content_block?: AnthropicContentBlock;
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: AnthropicUsage;
}

// =============================================================================
// Anthropic Provider Implementation
// =============================================================================

export class AnthropicProvider extends BaseProvider {
  readonly name = 'anthropic';
  
  readonly models: ModelConfig[] = [
    {
      id: 'claude-sonnet-4-20250514',
      name: 'Claude Sonnet 4',
      contextWindow: 200000,
      maxOutputTokens: 64000,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
    },
    {
      id: 'claude-opus-4-20250514',
      name: 'Claude Opus 4',
      contextWindow: 200000,
      maxOutputTokens: 32000,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 15,
      outputPricePerMillion: 75,
    },
    {
      id: 'claude-3-7-sonnet-20250219',
      name: 'Claude 3.7 Sonnet',
      contextWindow: 200000,
      maxOutputTokens: 64000,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
    },
    {
      id: 'claude-3-5-sonnet-20241022',
      name: 'Claude 3.5 Sonnet',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
    },
    {
      id: 'claude-3-5-haiku-20241022',
      name: 'Claude 3.5 Haiku',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 0.8,
      outputPricePerMillion: 4,
    },
    {
      id: 'claude-3-opus-20240229',
      name: 'Claude 3 Opus',
      contextWindow: 200000,
      maxOutputTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 15,
      outputPricePerMillion: 75,
    },
    {
      id: 'claude-3-sonnet-20240229',
      name: 'Claude 3 Sonnet',
      contextWindow: 200000,
      maxOutputTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 3,
      outputPricePerMillion: 15,
    },
    {
      id: 'claude-3-haiku-20240307',
      name: 'Claude 3 Haiku',
      contextWindow: 200000,
      maxOutputTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 0.25,
      outputPricePerMillion: 1.25,
    },
  ];

  constructor(config: ProviderConfig) {
    super(config);
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.anthropic.com/v1';
  }

  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      ...this.config.headers,
    };
  }

  // ===========================================================================
  // Chat Completion
  // ===========================================================================

  async chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const anthropicRequest = this.transformRequest(request);
    
    const response = await this.makeRequest<AnthropicResponse>(
      '/messages',
      anthropicRequest,
      signal
    );

    return this.transformResponse(response);
  }

  // ===========================================================================
  // Streaming
  // ===========================================================================

  async *stream(
    request: ChatRequest,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const anthropicRequest = this.transformRequest(request);
    anthropicRequest.stream = true;

    const stream = await this.makeStreamingRequest(
      '/messages',
      anthropicRequest,
      signal
    );

    const sseStream = this.parseSSEStream(stream);
    const reader = sseStream.getReader();

    let currentId = '';
    let currentModel = '';
    let toolCallIndex = 0;
    const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        try {
          const event = JSON.parse(value) as AnthropicStreamEvent;
          
          switch (event.type) {
            case 'message_start':
              if (event.message) {
                currentId = event.message.id;
                currentModel = event.message.model;
              }
              break;

            case 'content_block_start':
              if (event.content_block?.type === 'tool_use') {
                const idx = event.index ?? toolCallIndex++;
                toolCalls.set(idx, {
                  id: event.content_block.id ?? '',
                  name: event.content_block.name ?? '',
                  arguments: '',
                });
                
                yield {
                  id: currentId,
                  model: currentModel,
                  delta: {
                    toolCalls: [{
                      index: idx,
                      id: event.content_block.id,
                      type: 'function',
                      function: { name: event.content_block.name },
                    }],
                  },
                  finishReason: null,
                };
              }
              break;

            case 'content_block_delta':
              if (event.delta?.type === 'text_delta') {
                yield {
                  id: currentId,
                  model: currentModel,
                  delta: { content: event.delta.text },
                  finishReason: null,
                };
              } else if (event.delta?.type === 'input_json_delta') {
                const idx = event.index ?? 0;
                const tool = toolCalls.get(idx);
                if (tool && event.delta.partial_json) {
                  tool.arguments += event.delta.partial_json;
                  
                  yield {
                    id: currentId,
                    model: currentModel,
                    delta: {
                      toolCalls: [{
                        index: idx,
                        function: { arguments: event.delta.partial_json },
                      }],
                    },
                    finishReason: null,
                  };
                }
              }
              break;

            case 'message_delta':
              if (event.delta?.stop_reason) {
                yield {
                  id: currentId,
                  model: currentModel,
                  delta: {},
                  finishReason: this.mapFinishReason(event.delta.stop_reason),
                  usage: event.usage ? {
                    promptTokens: 0,
                    completionTokens: event.usage.output_tokens,
                    totalTokens: event.usage.output_tokens,
                  } : undefined,
                };
              }
              break;

            case 'message_stop':
              // Final event, nothing more to do
              break;
          }
        } catch {
          // Skip invalid JSON
          continue;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ===========================================================================
  // Token Counting
  // ===========================================================================

  async countTokens(messages: ChatMessage[], model?: string): Promise<number> {
    // Anthropic has a token counting endpoint, but for Workers compatibility
    // we'll use estimation similar to their tokenizer
    const modelId = model || this.config.defaultModel || 'claude-3-5-sonnet-20241022';
    
    let total = 0;
    
    for (const msg of messages) {
      // Base tokens per message
      total += 4;
      
      if (typeof msg.content === 'string') {
        total += this.estimateAnthropicTokens(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            total += this.estimateAnthropicTokens(part.text);
          } else if (part.type === 'image') {
            // Anthropic charges based on image size
            // Small: ~1,334 tokens, Medium: ~2,000, Large: ~4,000
            total += 2000; // Average estimate
          }
        }
      }
    }
    
    return total;
  }

  private estimateAnthropicTokens(text: string): number {
    // Anthropic uses a similar tokenization to GPT
    // Roughly 4 characters per token for English
    return Math.ceil(text.length / 4);
  }

  // ===========================================================================
  // Request/Response Transformation
  // ===========================================================================

  private transformRequest(request: ChatRequest): AnthropicRequest {
    const model = this.getModel(request);
    const modelConfig = this.getModelConfig(model);
    
    const anthropicRequest: AnthropicRequest = {
      model,
      messages: this.transformMessages(request.messages),
      max_tokens: request.maxTokens ?? modelConfig?.maxOutputTokens ?? 4096,
    };

    // Handle system prompt with optional cache control
    const systemPrompt = this.extractSystemPrompt(request);
    if (systemPrompt) {
      if (request.cacheControl?.some(c => c.messageIndex === -1)) {
        anthropicRequest.system = [{
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        }];
      } else {
        anthropicRequest.system = systemPrompt;
      }
    }

    if (request.temperature !== undefined) {
      anthropicRequest.temperature = request.temperature;
    }

    if (request.topP !== undefined) {
      anthropicRequest.top_p = request.topP;
    }

    if (request.topK !== undefined) {
      anthropicRequest.top_k = request.topK;
    }

    if (request.stop) {
      anthropicRequest.stop_sequences = request.stop;
    }

    if (request.tools && request.tools.length > 0) {
      anthropicRequest.tools = request.tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters ?? { type: 'object', properties: {} },
      }));

      if (request.toolChoice) {
        if (typeof request.toolChoice === 'string') {
          anthropicRequest.tool_choice = { 
            type: request.toolChoice === 'none' ? 'auto' : 
                  request.toolChoice === 'required' ? 'any' : 'auto' 
          };
        } else {
          anthropicRequest.tool_choice = {
            type: (request.toolChoice.type === 'function' ? 'tool' : 
                  request.toolChoice.type === 'required' ? 'any' : 
                  request.toolChoice.type) as 'auto' | 'tool' | 'any',
            name: request.toolChoice.function?.name,
          };
        }
      }
    }

    if (request.user) {
      anthropicRequest.metadata = { user_id: request.user };
    }

    return anthropicRequest;
  }

  private extractSystemPrompt(request: ChatRequest): string | undefined {
    // Check for explicit system prompt
    if (request.systemPrompt) {
      return request.systemPrompt;
    }

    // Extract from messages
    const systemMessages = request.messages.filter(m => m.role === 'system');
    if (systemMessages.length > 0) {
      return systemMessages
        .map(m => typeof m.content === 'string' ? m.content : '')
        .filter(Boolean)
        .join('\n\n');
    }

    return undefined;
  }

  private transformMessages(messages: ChatMessage[]): AnthropicMessage[] {
    const result: AnthropicMessage[] = [];
    
    // Filter out system messages (handled separately)
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    for (const msg of nonSystemMessages) {
      if (msg.role === 'tool') {
        // Tool results need to be combined with previous assistant message
        // or added as user message with tool_result block
        const lastMsg = result[result.length - 1];
        
        const toolResultBlock: AnthropicContentBlock = {
          type: 'tool_result',
          tool_use_id: msg.toolCallId,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        };

        if (lastMsg?.role === 'user') {
          if (typeof lastMsg.content === 'string') {
            lastMsg.content = [
              { type: 'text', text: lastMsg.content },
              toolResultBlock,
            ];
          } else {
            (lastMsg.content as AnthropicContentBlock[]).push(toolResultBlock);
          }
        } else {
          result.push({
            role: 'user',
            content: [toolResultBlock],
          });
        }
        continue;
      }

      const anthropicMsg: AnthropicMessage = {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: this.transformContent(msg.content, msg.toolCalls),
      };

      result.push(anthropicMsg);
    }

    return this.ensureAlternatingRoles(result);
  }

  private transformContent(
    content: string | ContentPart[],
    toolCalls?: ToolCall[]
  ): string | AnthropicContentBlock[] {
    const blocks: AnthropicContentBlock[] = [];

    if (typeof content === 'string') {
      if (!toolCalls || toolCalls.length === 0) {
        return content;
      }
      blocks.push({ type: 'text', text: content });
    } else {
      for (const part of content) {
        if (part.type === 'text') {
          blocks.push({ type: 'text', text: part.text });
        } else if (part.type === 'image') {
          if (part.source.type === 'base64' && part.source.data) {
            blocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: part.source.mediaType || 'image/png',
                data: part.source.data,
              },
            });
          } else if (part.source.type === 'url' && part.source.url) {
            // Anthropic requires base64 for images, would need to fetch URL
            throw new ProviderError(
              'Anthropic requires base64 encoded images. URL images must be converted first.',
              'INVALID_REQUEST',
              400,
              this.name
            );
          }
        }
      }
    }

    // Add tool use blocks
    if (toolCalls) {
      for (const tc of toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        });
      }
    }

    return blocks.length > 0 ? blocks : '';
  }

  private ensureAlternatingRoles(messages: AnthropicMessage[]): AnthropicMessage[] {
    // Anthropic requires strictly alternating user/assistant messages
    const result: AnthropicMessage[] = [];

    for (const msg of messages) {
      const lastMsg = result[result.length - 1];

      if (lastMsg && lastMsg.role === msg.role) {
        // Merge consecutive messages of the same role
        if (typeof lastMsg.content === 'string' && typeof msg.content === 'string') {
          lastMsg.content = lastMsg.content + '\n\n' + msg.content;
        } else {
          const lastBlocks = typeof lastMsg.content === 'string' 
            ? [{ type: 'text' as const, text: lastMsg.content }]
            : lastMsg.content;
          const newBlocks = typeof msg.content === 'string'
            ? [{ type: 'text' as const, text: msg.content }]
            : msg.content;
          lastMsg.content = [...lastBlocks, ...newBlocks];
        }
      } else {
        result.push(msg);
      }
    }

    // Ensure conversation starts with user message
    if (result.length > 0 && result[0].role === 'assistant') {
      result.unshift({ role: 'user', content: 'Hello.' });
    }

    return result;
  }

  private transformResponse(response: AnthropicResponse): ChatResponse {
    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text' && block.text) {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id ?? '',
          type: 'function',
          function: {
            name: block.name ?? '',
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    return {
      id: response.id,
      model: response.model,
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: this.mapFinishReason(response.stop_reason),
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        cachedTokens: response.usage.cache_read_input_tokens,
      },
      cached: (response.usage.cache_read_input_tokens ?? 0) > 0,
    };
  }

  private mapFinishReason(reason: string | null): FinishReason {
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return null;
    }
  }

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  protected parseErrorResponse(
    status: number,
    body: unknown
  ): {
    code: ProviderErrorCode;
    message: string;
    retryable: boolean;
    retryAfter?: number;
  } {
    const message = this.extractAnthropicErrorMessage(body);

    // Check for specific Anthropic error types
    if (typeof body === 'object' && body !== null) {
      const obj = body as Record<string, unknown>;
      const errorType = obj.type || (obj.error as Record<string, unknown>)?.type;

      switch (errorType) {
        case 'authentication_error':
          return { code: 'INVALID_API_KEY', message, retryable: false };
        case 'rate_limit_error':
          return { code: 'RATE_LIMIT', message, retryable: true, retryAfter: 60 };
        case 'overloaded_error':
          return { code: 'SERVER_ERROR', message, retryable: true, retryAfter: 30 };
        case 'invalid_request_error':
          if (message.includes('context') || message.includes('token')) {
            return { code: 'CONTEXT_LENGTH_EXCEEDED', message, retryable: false };
          }
          return { code: 'INVALID_REQUEST', message, retryable: false };
      }
    }

    return super.parseErrorResponse(status, body);
  }

  private extractAnthropicErrorMessage(body: unknown): string {
    if (typeof body === 'object' && body !== null) {
      const obj = body as Record<string, unknown>;
      if ('error' in obj && typeof obj.error === 'object' && obj.error !== null) {
        const error = obj.error as Record<string, unknown>;
        if ('message' in error && typeof error.message === 'string') {
          return error.message;
        }
      }
      if ('message' in obj && typeof obj.message === 'string') {
        return obj.message;
      }
    }
    return this.extractErrorMessage(body);
  }
}
