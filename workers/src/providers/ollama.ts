/**
 * Ollama Provider
 * Supports local Ollama models (Llama, Mistral, CodeLlama, etc.)
 * 
 * Ollama uses OpenAI-compatible API format at /v1/chat/completions
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
  ToolCallDelta,
  FinishReason,
  ContentPart,
  ProviderError,
  ProviderErrorCode,
} from './types';

// =============================================================================
// Ollama API Types (OpenAI-compatible)
// =============================================================================

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[]; // Base64 encoded images for vision models
}

interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number;
    stop?: string[];
    seed?: number;
  };
  format?: 'json';
}

interface OllamaResponse {
  model: string;
  created_at: string;
  message: OllamaMessage;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaStreamResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
}

// =============================================================================
// Ollama Provider Configuration
// =============================================================================

export interface OllamaProviderConfig extends ProviderConfig {
  /** Ollama server URL (e.g., http://localhost:11434) */
  baseUrl?: string;
}

// =============================================================================
// Ollama Provider Implementation
// =============================================================================

export class OllamaProvider extends BaseProvider {
  readonly name = 'ollama';
  
  // Default models - can be dynamically fetched
  readonly models: ModelConfig[] = [
    {
      id: 'llama3.2',
      name: 'Llama 3.2',
      contextWindow: 128000,
      maxOutputTokens: 8192,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    },
    {
      id: 'llama3.2-vision',
      name: 'Llama 3.2 Vision',
      contextWindow: 128000,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsTools: false,
      supportsStreaming: true,
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    },
    {
      id: 'mistral',
      name: 'Mistral 7B',
      contextWindow: 32000,
      maxOutputTokens: 8192,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    },
    {
      id: 'mixtral',
      name: 'Mixtral 8x7B',
      contextWindow: 32000,
      maxOutputTokens: 8192,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    },
    {
      id: 'codellama',
      name: 'Code Llama',
      contextWindow: 16000,
      maxOutputTokens: 8192,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    },
    {
      id: 'deepseek-coder-v2',
      name: 'DeepSeek Coder V2',
      contextWindow: 128000,
      maxOutputTokens: 8192,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    },
    {
      id: 'qwen2.5-coder',
      name: 'Qwen 2.5 Coder',
      contextWindow: 32000,
      maxOutputTokens: 8192,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    },
    {
      id: 'phi3',
      name: 'Phi-3',
      contextWindow: 4096,
      maxOutputTokens: 4096,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    },
    {
      id: 'gemma2',
      name: 'Gemma 2',
      contextWindow: 8192,
      maxOutputTokens: 8192,
      supportsVision: false,
      supportsTools: false,
      supportsStreaming: true,
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    },
  ];

  constructor(config: OllamaProviderConfig) {
    super({
      ...config,
      baseUrl: config.baseUrl || 'http://localhost:11434',
      apiKey: config.apiKey || 'ollama', // Ollama doesn't require API key
    });
  }

  protected getDefaultBaseUrl(): string {
    return 'http://localhost:11434';
  }

  /**
   * Count tokens in messages (estimate)
   */
  async countTokens(messages: ChatMessage[], model?: string): Promise<number> {
    // Simple estimate: ~4 chars per token
    let totalChars = 0;
    for (const msg of messages) {
      const content = typeof msg.content === 'string' 
        ? msg.content 
        : JSON.stringify(msg.content);
      totalChars += content.length;
    }
    return Math.ceil(totalChars / 4);
  }

  /**
   * Convert internal messages to Ollama format
   */
  private toOllamaMessages(messages: ChatMessage[]): OllamaMessage[] {
    return messages.map((msg) => {
      // Handle multimodal content (images)
      if (Array.isArray(msg.content)) {
        const textParts: string[] = [];
        const images: string[] = [];

        for (const part of msg.content as ContentPart[]) {
          if (part.type === 'text') {
            textParts.push(part.text);
          } else if (part.type === 'image' && part.source?.data) {
            images.push(part.source.data); // Base64 data
          }
        }

        return {
          role: msg.role as 'system' | 'user' | 'assistant',
          content: textParts.join('\n'),
          ...(images.length > 0 && { images }),
        };
      }

      return {
        role: msg.role as 'system' | 'user' | 'assistant',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      };
    });
  }

  /**
   * Fetch available models from Ollama server
   */
  async listModels(): Promise<OllamaModel[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }
      const data = await response.json() as { models: OllamaModel[] };
      return data.models || [];
    } catch (error) {
      console.warn('[Ollama] Failed to fetch models:', error);
      return [];
    }
  }

  /**
   * Send a chat completion request (non-streaming)
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const url = `${this.config.baseUrl}/api/chat`;

    const body: OllamaRequest = {
      model: request.model,
      messages: this.toOllamaMessages(request.messages),
      stream: false,
      options: {
        temperature: request.temperature,
        top_p: request.topP,
        top_k: request.topK,
        num_predict: request.maxTokens,
        stop: request.stop,
        seed: request.seed,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(
        `Ollama API error: ${error}`,
        'SERVER_ERROR' as ProviderErrorCode,
        response.status,
        this.name,
        response.status >= 500
      );
    }

    const data = await response.json() as OllamaResponse;

    return {
      id: `ollama-${Date.now()}`,
      model: data.model,
      content: data.message.content,
      finishReason: 'stop' as FinishReason,
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
    };
  }

  /**
   * Send a streaming chat completion request
   */
  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const url = `${this.config.baseUrl}/api/chat`;

    const body: OllamaRequest = {
      model: request.model,
      messages: this.toOllamaMessages(request.messages),
      stream: true,
      options: {
        temperature: request.temperature,
        top_p: request.topP,
        top_k: request.topK,
        num_predict: request.maxTokens,
        stop: request.stop,
        seed: request.seed,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(
        `Ollama API error: ${error}`,
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
    const responseId = `ollama-${Date.now()}`;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const data = JSON.parse(trimmed) as OllamaStreamResponse;

            if (data.message?.content) {
              yield {
                id: responseId,
                model: data.model,
                delta: {
                  content: data.message.content,
                },
                finishReason: null,
              };
            }

            if (data.done) {
              yield {
                id: responseId,
                model: data.model,
                delta: {},
                finishReason: 'stop',
                usage: {
                  promptTokens: data.prompt_eval_count || 0,
                  completionTokens: data.eval_count || 0,
                  totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
                },
              };
            }
          } catch {
            // Skip malformed lines
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer) as OllamaStreamResponse;
          if (data.done) {
            yield {
              id: responseId,
              model: data.model,
              delta: {},
              finishReason: 'stop',
              usage: {
                promptTokens: data.prompt_eval_count || 0,
                completionTokens: data.eval_count || 0,
                totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
              },
            };
          }
        } catch {
          // Ignore
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
