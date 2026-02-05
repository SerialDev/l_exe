/**
 * OpenRouter Provider
 * Access to 100+ AI models through a single API
 * 
 * Supports: OpenAI, Anthropic, Google, Meta, Mistral, and many more
 */

import { BaseProvider } from './base';
import {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  ProviderConfig,
  ModelConfig,
  FinishReason,
  ProviderError,
  ProviderErrorCode,
} from './types';

// =============================================================================
// OpenRouter Types
// =============================================================================

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
  stream?: boolean;
  transforms?: string[];
}

interface OpenRouterResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenRouterStreamChunk {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

// =============================================================================
// OpenRouter Provider
// =============================================================================

export class OpenRouterProvider extends BaseProvider {
  readonly name = 'openrouter';

  // Popular models available through OpenRouter
  readonly models: ModelConfig[] = [
    // OpenAI
    {
      id: 'openai/gpt-4-turbo',
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
      id: 'openai/gpt-4o',
      name: 'GPT-4o',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 5,
      outputPricePerMillion: 15,
    },
    // Anthropic
    {
      id: 'anthropic/claude-3.5-sonnet',
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
      id: 'anthropic/claude-3-opus',
      name: 'Claude 3 Opus',
      contextWindow: 200000,
      maxOutputTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 15,
      outputPricePerMillion: 75,
    },
    // Google
    {
      id: 'google/gemini-pro-1.5',
      name: 'Gemini Pro 1.5',
      contextWindow: 1000000,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 2.5,
      outputPricePerMillion: 7.5,
    },
    // Meta
    {
      id: 'meta-llama/llama-3.1-405b-instruct',
      name: 'Llama 3.1 405B',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 3,
      outputPricePerMillion: 3,
    },
    {
      id: 'meta-llama/llama-3.1-70b-instruct',
      name: 'Llama 3.1 70B',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 0.35,
      outputPricePerMillion: 0.4,
    },
    // Mistral
    {
      id: 'mistralai/mistral-large',
      name: 'Mistral Large',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 2,
      outputPricePerMillion: 6,
    },
    // DeepSeek
    {
      id: 'deepseek/deepseek-chat',
      name: 'DeepSeek Chat',
      contextWindow: 64000,
      maxOutputTokens: 4096,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
      inputPricePerMillion: 0.14,
      outputPricePerMillion: 0.28,
    },
    // Qwen
    {
      id: 'qwen/qwen-2.5-72b-instruct',
      name: 'Qwen 2.5 72B',
      contextWindow: 32000,
      maxOutputTokens: 4096,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
      inputPricePerMillion: 0.35,
      outputPricePerMillion: 0.4,
    },
  ];

  private siteUrl?: string;
  private siteName?: string;

  constructor(config: ProviderConfig & { siteUrl?: string; siteName?: string }) {
    super({
      ...config,
      baseUrl: config.baseUrl || 'https://openrouter.ai/api/v1',
    });
    this.siteUrl = config.siteUrl;
    this.siteName = config.siteName;
  }

  protected getDefaultBaseUrl(): string {
    return 'https://openrouter.ai/api/v1';
  }

  async countTokens(messages: ChatMessage[]): Promise<number> {
    let totalChars = 0;
    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      totalChars += content.length;
    }
    return Math.ceil(totalChars / 4);
  }

  private toOpenRouterMessages(messages: ChatMessage[]): OpenRouterMessage[] {
    return messages.map((msg) => ({
      role: msg.role as 'system' | 'user' | 'assistant',
      content: typeof msg.content === 'string' ? msg.content : msg.content as any,
    }));
  }

  protected override getHeaders(): Record<string, string> {
    const headers = super.getHeaders();

    if (this.siteUrl) {
      headers['HTTP-Referer'] = this.siteUrl;
    }
    if (this.siteName) {
      headers['X-Title'] = this.siteName;
    }

    return headers;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body: OpenRouterRequest = {
      model: request.model,
      messages: this.toOpenRouterMessages(request.messages),
      temperature: request.temperature,
      top_p: request.topP,
      max_tokens: request.maxTokens,
      stop: request.stop,
      stream: false,
    };

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(
        `OpenRouter API error: ${error}`,
        'SERVER_ERROR' as ProviderErrorCode,
        response.status,
        this.name,
        response.status >= 500
      );
    }

    const data = await response.json() as OpenRouterResponse;
    const choice = data.choices[0];

    return {
      id: data.id,
      model: data.model,
      content: choice.message.content,
      finishReason: choice.finish_reason as FinishReason,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
    };
  }

  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const body: OpenRouterRequest = {
      model: request.model,
      messages: this.toOpenRouterMessages(request.messages),
      temperature: request.temperature,
      top_p: request.topP,
      max_tokens: request.maxTokens,
      stop: request.stop,
      stream: true,
    };

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(
        `OpenRouter API error: ${error}`,
        'SERVER_ERROR' as ProviderErrorCode,
        response.status,
        this.name,
        response.status >= 500
      );
    }

    if (!response.body) {
      throw new ProviderError('No response body', 'SERVER_ERROR' as ProviderErrorCode, 500, this.name, false);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const chunk = JSON.parse(data) as OpenRouterStreamChunk;
            const choice = chunk.choices[0];

            if (choice?.delta?.content) {
              yield {
                id: chunk.id,
                model: chunk.model,
                delta: { content: choice.delta.content },
                finishReason: null,
              };
            }

            if (choice?.finish_reason) {
              yield {
                id: chunk.id,
                model: chunk.model,
                delta: {},
                finishReason: choice.finish_reason as FinishReason,
              };
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Get available models from OpenRouter API
   */
  async getAvailableModels(): Promise<Array<{ id: string; name: string; pricing: any }>> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const data = await response.json() as { data: Array<{ id: string; name: string; pricing: any }> };
      return data.data;
    } catch (error) {
      console.warn('[OpenRouter] Failed to fetch models:', error);
      return [];
    }
  }
}
