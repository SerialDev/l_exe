/**
 * Mistral AI Provider
 * Supports Mistral's API for their family of models
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
// Mistral API Types
// =============================================================================

interface MistralMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface MistralRequest {
  model: string;
  messages: MistralMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  safe_prompt?: boolean;
}

interface MistralResponse {
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

interface MistralStreamChunk {
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
// Mistral Provider
// =============================================================================

export class MistralProvider extends BaseProvider {
  readonly name = 'mistral';

  readonly models: ModelConfig[] = [
    {
      id: 'mistral-large-latest',
      name: 'Mistral Large',
      contextWindow: 128000,
      maxOutputTokens: 8192,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 2.0,
      outputPricePerMillion: 6.0,
    },
    {
      id: 'mistral-medium-latest',
      name: 'Mistral Medium',
      contextWindow: 32000,
      maxOutputTokens: 8192,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 2.7,
      outputPricePerMillion: 8.1,
    },
    {
      id: 'mistral-small-latest',
      name: 'Mistral Small',
      contextWindow: 32000,
      maxOutputTokens: 8192,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 0.2,
      outputPricePerMillion: 0.6,
    },
    {
      id: 'open-mistral-7b',
      name: 'Mistral 7B',
      contextWindow: 32000,
      maxOutputTokens: 8192,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
      inputPricePerMillion: 0.25,
      outputPricePerMillion: 0.25,
    },
    {
      id: 'open-mixtral-8x7b',
      name: 'Mixtral 8x7B',
      contextWindow: 32000,
      maxOutputTokens: 8192,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
      inputPricePerMillion: 0.7,
      outputPricePerMillion: 0.7,
    },
    {
      id: 'open-mixtral-8x22b',
      name: 'Mixtral 8x22B',
      contextWindow: 64000,
      maxOutputTokens: 8192,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 2.0,
      outputPricePerMillion: 6.0,
    },
    {
      id: 'codestral-latest',
      name: 'Codestral',
      contextWindow: 32000,
      maxOutputTokens: 8192,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
      inputPricePerMillion: 0.2,
      outputPricePerMillion: 0.6,
    },
  ];

  constructor(config: ProviderConfig) {
    super({
      ...config,
      baseUrl: config.baseUrl || 'https://api.mistral.ai/v1',
    });
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.mistral.ai/v1';
  }

  async countTokens(messages: ChatMessage[]): Promise<number> {
    let totalChars = 0;
    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      totalChars += content.length;
    }
    return Math.ceil(totalChars / 4);
  }

  private toMistralMessages(messages: ChatMessage[]): MistralMessage[] {
    return messages.map((msg) => ({
      role: msg.role as 'system' | 'user' | 'assistant',
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    }));
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body: MistralRequest = {
      model: request.model,
      messages: this.toMistralMessages(request.messages),
      temperature: request.temperature,
      top_p: request.topP,
      max_tokens: request.maxTokens,
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
        `Mistral API error: ${error}`,
        'SERVER_ERROR' as ProviderErrorCode,
        response.status,
        this.name,
        response.status >= 500
      );
    }

    const data = await response.json() as MistralResponse;
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
    const body: MistralRequest = {
      model: request.model,
      messages: this.toMistralMessages(request.messages),
      temperature: request.temperature,
      top_p: request.topP,
      max_tokens: request.maxTokens,
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
        `Mistral API error: ${error}`,
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
            const chunk = JSON.parse(data) as MistralStreamChunk;
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
}
