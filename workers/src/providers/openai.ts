/**
 * OpenAI Provider
 * Supports GPT-4, GPT-4o, o1, and other OpenAI models
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
  ProviderError,
} from './types';

// =============================================================================
// OpenAI API Types
// =============================================================================

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  top_p?: number;
  stop?: string[];
  tools?: OpenAITool[];
  tool_choice?: string | { type: string; function?: { name: string } };
  stream?: boolean;
  user?: string;
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Record<string, number>;
  seed?: number;
  stream_options?: { include_usage: boolean };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
}

interface OpenAIChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason: string | null;
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
}

interface OpenAIStreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIStreamChoice[];
  usage?: OpenAIUsage;
}

interface OpenAIStreamChoice {
  index: number;
  delta: {
    role?: string;
    content?: string | null;
    tool_calls?: OpenAIToolCallDelta[];
  };
  finish_reason: string | null;
}

interface OpenAIToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

// =============================================================================
// OpenAI Provider Implementation
// =============================================================================

export class OpenAIProvider extends BaseProvider {
  readonly name = 'openai';
  
  readonly models: ModelConfig[] = [
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      contextWindow: 128000,
      maxOutputTokens: 16384,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 2.5,
      outputPricePerMillion: 10,
    },
    {
      id: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      contextWindow: 128000,
      maxOutputTokens: 16384,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 0.15,
      outputPricePerMillion: 0.6,
    },
    {
      id: 'gpt-4-turbo',
      name: 'GPT-4 Turbo',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 10,
      outputPricePerMillion: 30,
    },
    {
      id: 'gpt-4',
      name: 'GPT-4',
      contextWindow: 8192,
      maxOutputTokens: 4096,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 30,
      outputPricePerMillion: 60,
    },
    {
      id: 'o1',
      name: 'o1',
      contextWindow: 200000,
      maxOutputTokens: 100000,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 15,
      outputPricePerMillion: 60,
    },
    {
      id: 'o1-mini',
      name: 'o1-mini',
      contextWindow: 128000,
      maxOutputTokens: 65536,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 3,
      outputPricePerMillion: 12,
    },
    {
      id: 'o1-preview',
      name: 'o1-preview',
      contextWindow: 128000,
      maxOutputTokens: 32768,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: false,
      inputPricePerMillion: 15,
      outputPricePerMillion: 60,
    },
    {
      id: 'gpt-3.5-turbo',
      name: 'GPT-3.5 Turbo',
      contextWindow: 16385,
      maxOutputTokens: 4096,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 0.5,
      outputPricePerMillion: 1.5,
      deprecated: true,
    },
  ];

  constructor(config: ProviderConfig) {
    super(config);
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.openai.com/v1';
  }

  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
      ...this.config.headers,
    };

    if (this.config.organization) {
      headers['OpenAI-Organization'] = this.config.organization;
    }

    return headers;
  }

  // ===========================================================================
  // Chat Completion
  // ===========================================================================

  async chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const openaiRequest = this.transformRequest(request);
    
    const response = await this.makeRequest<OpenAIResponse>(
      '/chat/completions',
      openaiRequest,
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
    const openaiRequest = this.transformRequest(request);
    openaiRequest.stream = true;
    openaiRequest.stream_options = { include_usage: true };

    const stream = await this.makeStreamingRequest(
      '/chat/completions',
      openaiRequest,
      signal
    );

    const sseStream = this.parseSSEStream(stream);
    const reader = sseStream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        try {
          const chunk = JSON.parse(value) as OpenAIStreamResponse;
          yield this.transformStreamChunk(chunk);
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
    // OpenAI doesn't have a public token counting endpoint
    // Use estimation based on the tiktoken algorithm approximation
    const modelId = model || this.config.defaultModel || 'gpt-4o';
    
    let total = 0;
    
    for (const msg of messages) {
      // Base tokens per message (role + formatting)
      total += 4;
      
      if (typeof msg.content === 'string') {
        total += this.estimateOpenAITokens(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            total += this.estimateOpenAITokens(part.text);
          } else if (part.type === 'image') {
            // Vision tokens depend on image size and detail
            // Low detail: 85 tokens, High detail: 85 + 170 * tiles
            total += 170; // Average estimate
          }
        }
      }
      
      if (msg.name) {
        total += this.estimateOpenAITokens(msg.name) + 1;
      }
    }
    
    // Add priming tokens
    total += 3;
    
    return total;
  }

  private estimateOpenAITokens(text: string): number {
    // Rough approximation of tiktoken cl100k_base encoding
    // Average ~4 characters per token for English text
    // Adjust for common patterns
    let count = 0;
    
    // Split on whitespace and punctuation boundaries
    const words = text.split(/(\s+|[.,!?;:'"()\[\]{}])/);
    
    for (const word of words) {
      if (!word) continue;
      
      if (/^\s+$/.test(word)) {
        // Whitespace is usually part of the next token
        count += 0.25;
      } else if (/^[.,!?;:'"()\[\]{}]$/.test(word)) {
        // Punctuation is usually 1 token
        count += 1;
      } else {
        // Words: estimate based on length
        count += Math.ceil(word.length / 4);
      }
    }
    
    return Math.ceil(count);
  }

  // ===========================================================================
  // Request/Response Transformation
  // ===========================================================================

  private transformRequest(request: ChatRequest): OpenAIRequest {
    const model = this.getModel(request);
    const isO1Model = model.startsWith('o1');
    
    const openaiRequest: OpenAIRequest = {
      model,
      messages: this.transformMessages(request.messages, request.systemPrompt),
    };

    // Handle max tokens differently for o1 models
    if (request.maxTokens) {
      if (isO1Model) {
        openaiRequest.max_completion_tokens = request.maxTokens;
      } else {
        openaiRequest.max_tokens = request.maxTokens;
      }
    }

    // Temperature not supported for o1 models
    if (!isO1Model && request.temperature !== undefined) {
      openaiRequest.temperature = request.temperature;
    }

    if (request.topP !== undefined) {
      openaiRequest.top_p = request.topP;
    }

    if (request.stop) {
      openaiRequest.stop = request.stop;
    }

    if (request.tools && request.tools.length > 0) {
      openaiRequest.tools = request.tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
          strict: tool.function.strict,
        },
      }));

      if (request.toolChoice) {
        if (typeof request.toolChoice === 'string') {
          openaiRequest.tool_choice = request.toolChoice;
        } else {
          openaiRequest.tool_choice = {
            type: request.toolChoice.type,
            function: request.toolChoice.function,
          };
        }
      }
    }

    if (request.user) {
      openaiRequest.user = request.user;
    }

    if (request.presencePenalty !== undefined) {
      openaiRequest.presence_penalty = request.presencePenalty;
    }

    if (request.frequencyPenalty !== undefined) {
      openaiRequest.frequency_penalty = request.frequencyPenalty;
    }

    if (request.logitBias) {
      openaiRequest.logit_bias = request.logitBias;
    }

    if (request.seed !== undefined) {
      openaiRequest.seed = request.seed;
    }

    return openaiRequest;
  }

  private transformMessages(
    messages: ChatMessage[],
    systemPrompt?: string
  ): OpenAIMessage[] {
    const result: OpenAIMessage[] = [];

    // Add system prompt if provided separately
    if (systemPrompt) {
      result.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    for (const msg of messages) {
      const openaiMsg: OpenAIMessage = {
        role: msg.role as OpenAIMessage['role'],
        content: this.transformContent(msg.content),
      };

      if (msg.name) {
        openaiMsg.name = msg.name;
      }

      if (msg.toolCallId) {
        openaiMsg.tool_call_id = msg.toolCallId;
      }

      if (msg.toolCalls) {
        openaiMsg.tool_calls = msg.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
      }

      result.push(openaiMsg);
    }

    return result;
  }

  private transformContent(
    content: string | ContentPart[]
  ): string | OpenAIContentPart[] | null {
    if (typeof content === 'string') {
      return content;
    }

    return content.map(part => {
      if (part.type === 'text') {
        return { type: 'text', text: part.text };
      }

      if (part.type === 'image') {
        let url: string;
        
        if (part.source.type === 'url' && part.source.url) {
          url = part.source.url;
        } else if (part.source.type === 'base64' && part.source.data) {
          const mediaType = part.source.mediaType || 'image/png';
          url = `data:${mediaType};base64,${part.source.data}`;
        } else {
          throw new ProviderError(
            'Invalid image source',
            'INVALID_REQUEST',
            400,
            this.name
          );
        }

        return {
          type: 'image_url',
          image_url: { url, detail: 'auto' as const },
        };
      }

      throw new ProviderError(
        `Unknown content type: ${(part as ContentPart).type}`,
        'INVALID_REQUEST',
        400,
        this.name
      );
    });
  }

  private transformResponse(response: OpenAIResponse): ChatResponse {
    const choice = response.choices[0];
    
    if (!choice) {
      throw new ProviderError(
        'No choices in response',
        'SERVER_ERROR',
        500,
        this.name
      );
    }

    const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map(tc => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));

    return {
      id: response.id,
      model: response.model,
      content: typeof choice.message.content === 'string' 
        ? choice.message.content 
        : '',
      toolCalls,
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
        cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens,
      },
    };
  }

  private transformStreamChunk(chunk: OpenAIStreamResponse): StreamChunk {
    const choice = chunk.choices[0];
    
    return {
      id: chunk.id,
      model: chunk.model,
      delta: {
        role: choice?.delta.role as StreamChunk['delta']['role'],
        content: choice?.delta.content ?? undefined,
        toolCalls: choice?.delta.tool_calls?.map(tc => ({
          index: tc.index,
          id: tc.id,
          type: tc.type,
          function: tc.function,
        })),
      },
      finishReason: choice ? this.mapFinishReason(choice.finish_reason) : null,
      usage: chunk.usage ? {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens,
        cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens,
      } : undefined,
    };
  }

  private mapFinishReason(reason: string | null): FinishReason {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
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
    code: import('./types').ProviderErrorCode;
    message: string;
    retryable: boolean;
    retryAfter?: number;
  } {
    const message = this.extractOpenAIErrorMessage(body);

    // Check for specific OpenAI error types
    if (typeof body === 'object' && body !== null) {
      const error = (body as Record<string, unknown>).error;
      if (typeof error === 'object' && error !== null) {
        const errorObj = error as Record<string, unknown>;
        const type = errorObj.type;
        const code = errorObj.code;

        if (type === 'invalid_request_error') {
          if (code === 'context_length_exceeded') {
            return { code: 'CONTEXT_LENGTH_EXCEEDED', message, retryable: false };
          }
          return { code: 'INVALID_REQUEST', message, retryable: false };
        }

        if (type === 'authentication_error') {
          return { code: 'INVALID_API_KEY', message, retryable: false };
        }

        if (type === 'rate_limit_error') {
          return { code: 'RATE_LIMIT', message, retryable: true, retryAfter: 60 };
        }

        if (type === 'insufficient_quota') {
          return { code: 'QUOTA_EXCEEDED', message, retryable: false };
        }
      }
    }

    return super.parseErrorResponse(status, body);
  }

  private extractOpenAIErrorMessage(body: unknown): string {
    if (typeof body === 'object' && body !== null) {
      const obj = body as Record<string, unknown>;
      if ('error' in obj && typeof obj.error === 'object' && obj.error !== null) {
        const error = obj.error as Record<string, unknown>;
        if ('message' in error && typeof error.message === 'string') {
          return error.message;
        }
      }
    }
    return this.extractErrorMessage(body);
  }
}
