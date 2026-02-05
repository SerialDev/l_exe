/**
 * Groq Provider
 * Ultra-fast inference with LPU technology
 * 
 * Supports: Llama, Mixtral, Gemma models
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
// Groq API Types
// =============================================================================

interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqRequest {
  model: string;
  messages: GroqMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
  stream?: boolean;
}

interface GroqResponse {
  id: string;
  object: string;
  created: number;
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

interface GroqStreamChunk {
  id: string;
  object: string;
  created: number;
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
// Groq Provider
// =============================================================================

export class GroqProvider extends BaseProvider {
  readonly name = 'groq';

  readonly models: ModelConfig[] = [
    {
      id: 'llama-3.3-70b-versatile',
      name: 'Llama 3.3 70B Versatile',
      contextWindow: 128000,
      maxOutputTokens: 32768,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 0.59,
      outputPricePerMillion: 0.79,
    },
    {
      id: 'llama-3.1-8b-instant',
      name: 'Llama 3.1 8B Instant',
      contextWindow: 128000,
      maxOutputTokens: 8192,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 0.05,
      outputPricePerMillion: 0.08,
    },
    {
      id: 'mixtral-8x7b-32768',
      name: 'Mixtral 8x7B',
      contextWindow: 32768,
      maxOutputTokens: 32768,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 0.24,
      outputPricePerMillion: 0.24,
    },
    {
      id: 'gemma2-9b-it',
      name: 'Gemma 2 9B',
      contextWindow: 8192,
      maxOutputTokens: 8192,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
      inputPricePerMillion: 0.20,
      outputPricePerMillion: 0.20,
    },
  ];

  constructor(config: ProviderConfig) {
    super({
      ...config,
      baseUrl: config.baseUrl || 'https://api.groq.com/openai/v1',
    });
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.groq.com/openai/v1';
  }

  async countTokens(messages: ChatMessage[]): Promise<number> {
    // Rough estimate: 4 chars per token
    let totalChars = 0;
    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      totalChars += content.length;
    }
    return Math.ceil(totalChars / 4);
  }

  private toGroqMessages(messages: ChatMessage[]): GroqMessage[] {
    return messages.map((msg) => ({
      role: msg.role as 'system' | 'user' | 'assistant',
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    }));
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body: GroqRequest = {
      model: request.model,
      messages: this.toGroqMessages(request.messages),
      temperature: request.temperature,
      top_p: request.topP,
      max_tokens: request.maxTokens,
      stop: request.stop,
      stream: false,
    };

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(
        `Groq API error: ${error}`,
        'SERVER_ERROR' as ProviderErrorCode,
        response.status,
        this.name,
        response.status >= 500
      );
    }

    const data = await response.json() as GroqResponse;
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
    const body: GroqRequest = {
      model: request.model,
      messages: this.toGroqMessages(request.messages),
      temperature: request.temperature,
      top_p: request.topP,
      max_tokens: request.maxTokens,
      stop: request.stop,
      stream: true,
    };

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(
        `Groq API error: ${error}`,
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
            const chunk = JSON.parse(data) as GroqStreamChunk;
            const choice = chunk.choices[0];

            if (choice.delta.content) {
              yield {
                id: chunk.id,
                model: chunk.model,
                delta: { content: choice.delta.content },
                finishReason: null,
              };
            }

            if (choice.finish_reason) {
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
}
