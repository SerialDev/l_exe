/**
 * Base Provider Class
 * Abstract base class for all AI providers
 */

import {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  ProviderConfig,
  ModelConfig,
  IProvider,
  ProviderError,
  ProviderErrorCode,
} from './types';

// =============================================================================
// Rate Limiter
// =============================================================================

interface RateLimitState {
  requestCount: number;
  tokenCount: number;
  windowStart: number;
}

export class RateLimiter {
  private state: RateLimitState = {
    requestCount: 0,
    tokenCount: 0,
    windowStart: Date.now(),
  };

  constructor(
    private readonly requestsPerMinute: number = Infinity,
    private readonly tokensPerMinute: number = Infinity
  ) {}

  async acquire(estimatedTokens: number = 0): Promise<void> {
    const now = Date.now();
    const windowMs = 60000; // 1 minute

    // Reset window if expired
    if (now - this.state.windowStart >= windowMs) {
      this.state = {
        requestCount: 0,
        tokenCount: 0,
        windowStart: now,
      };
    }

    // Check limits
    if (this.state.requestCount >= this.requestsPerMinute) {
      const waitTime = windowMs - (now - this.state.windowStart);
      if (waitTime > 0) {
        await this.sleep(waitTime);
        return this.acquire(estimatedTokens);
      }
    }

    if (this.state.tokenCount + estimatedTokens > this.tokensPerMinute) {
      const waitTime = windowMs - (now - this.state.windowStart);
      if (waitTime > 0) {
        await this.sleep(waitTime);
        return this.acquire(estimatedTokens);
      }
    }

    this.state.requestCount++;
    this.state.tokenCount += estimatedTokens;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Abstract Base Provider
// =============================================================================

export abstract class BaseProvider implements IProvider {
  abstract readonly name: string;
  abstract readonly models: ModelConfig[];

  protected readonly config: Required<ProviderConfig>;
  protected readonly rateLimiter: RateLimiter;

  constructor(config: ProviderConfig) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? this.getDefaultBaseUrl(),
      organization: config.organization ?? '',
      defaultModel: config.defaultModel ?? '',
      timeout: config.timeout ?? 60000,
      maxRetries: config.maxRetries ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      rateLimitRpm: config.rateLimitRpm ?? Infinity,
      rateLimitTpm: config.rateLimitTpm ?? Infinity,
      headers: config.headers ?? {},
    };

    this.rateLimiter = new RateLimiter(
      this.config.rateLimitRpm,
      this.config.rateLimitTpm
    );
  }

  protected abstract getDefaultBaseUrl(): string;

  // ===========================================================================
  // Abstract Methods (must be implemented by subclasses)
  // ===========================================================================

  abstract chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
  abstract stream(request: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamChunk>;
  abstract countTokens(messages: ChatMessage[], model?: string): Promise<number>;

  // ===========================================================================
  // Request Helpers
  // ===========================================================================

  protected async makeRequest<T>(
    endpoint: string,
    body: unknown,
    signal?: AbortSignal
  ): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    
    return this.withRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      // Combine signals
      const combinedSignal = signal 
        ? this.combineAbortSignals(signal, controller.signal)
        : controller.signal;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(body),
          signal: combinedSignal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw await this.handleErrorResponse(response);
        }

        return response.json() as Promise<T>;
      } catch (error) {
        clearTimeout(timeoutId);
        throw this.normalizeError(error);
      }
    });
  }

  protected async makeStreamingRequest(
    endpoint: string,
    body: unknown,
    signal?: AbortSignal
  ): Promise<ReadableStream<Uint8Array>> {
    const url = `${this.config.baseUrl}${endpoint}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    const combinedSignal = signal 
      ? this.combineAbortSignals(signal, controller.signal)
      : controller.signal;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal: combinedSignal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw await this.handleErrorResponse(response);
      }

      if (!response.body) {
        throw new ProviderError(
          'No response body for streaming request',
          'SERVER_ERROR',
          500,
          this.name
        );
      }

      return response.body;
    } catch (error) {
      clearTimeout(timeoutId);
      throw this.normalizeError(error);
    }
  }

  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };
  }

  // ===========================================================================
  // Retry Logic
  // ===========================================================================

  protected async withRetry<T>(
    operation: () => Promise<T>,
    retries: number = this.config.maxRetries
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await this.rateLimiter.acquire();
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (error instanceof ProviderError) {
          // Don't retry non-retryable errors
          if (!error.retryable) {
            throw error;
          }
          
          // Use retry-after if provided
          if (error.retryAfter && attempt < retries) {
            await this.sleep(error.retryAfter * 1000);
            continue;
          }
        }

        // Exponential backoff
        if (attempt < retries) {
          const delay = this.config.retryDelay * Math.pow(2, attempt);
          await this.sleep(delay);
        }
      }
    }

    throw lastError ?? new Error('Unknown error during retry');
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  protected async handleErrorResponse(response: Response): Promise<ProviderError> {
    let errorBody: unknown;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = await response.text();
    }

    const { code, message, retryable, retryAfter } = this.parseErrorResponse(
      response.status,
      errorBody
    );

    return new ProviderError(
      message,
      code,
      response.status,
      this.name,
      retryable,
      retryAfter
    );
  }

  protected parseErrorResponse(
    status: number,
    body: unknown
  ): {
    code: ProviderErrorCode;
    message: string;
    retryable: boolean;
    retryAfter?: number;
  } {
    // Default error parsing - override in subclasses for provider-specific handling
    const message = this.extractErrorMessage(body);

    switch (status) {
      case 400:
        return { code: 'INVALID_REQUEST', message, retryable: false };
      case 401:
        return { code: 'INVALID_API_KEY', message, retryable: false };
      case 403:
        return { code: 'INVALID_API_KEY', message, retryable: false };
      case 404:
        return { code: 'MODEL_NOT_FOUND', message, retryable: false };
      case 429:
        return { code: 'RATE_LIMIT', message, retryable: true, retryAfter: 60 };
      case 500:
      case 502:
      case 503:
        return { code: 'SERVER_ERROR', message, retryable: true };
      default:
        return { code: 'UNKNOWN', message, retryable: false };
    }
  }

  protected extractErrorMessage(body: unknown): string {
    if (typeof body === 'string') {
      return body;
    }
    if (typeof body === 'object' && body !== null) {
      const obj = body as Record<string, unknown>;
      if ('error' in obj) {
        const error = obj.error;
        if (typeof error === 'string') return error;
        if (typeof error === 'object' && error !== null) {
          const errorObj = error as Record<string, unknown>;
          if ('message' in errorObj && typeof errorObj.message === 'string') {
            return errorObj.message;
          }
        }
      }
      if ('message' in obj && typeof obj.message === 'string') {
        return obj.message;
      }
    }
    return 'Unknown error';
  }

  protected normalizeError(error: unknown): ProviderError {
    if (error instanceof ProviderError) {
      return error;
    }

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return new ProviderError(
          'Request was aborted',
          'TIMEOUT',
          undefined,
          this.name,
          false
        );
      }

      return new ProviderError(
        error.message,
        'NETWORK_ERROR',
        undefined,
        this.name,
        true
      );
    }

    return new ProviderError(
      String(error),
      'UNKNOWN',
      undefined,
      this.name,
      false
    );
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  protected combineAbortSignals(
    signal1: AbortSignal,
    signal2: AbortSignal
  ): AbortSignal {
    const controller = new AbortController();
    
    const abort = () => controller.abort();
    
    signal1.addEventListener('abort', abort);
    signal2.addEventListener('abort', abort);
    
    if (signal1.aborted || signal2.aborted) {
      controller.abort();
    }
    
    return controller.signal;
  }

  protected getModel(request: ChatRequest): string {
    return request.model || this.config.defaultModel;
  }

  protected getModelConfig(modelId: string): ModelConfig | undefined {
    return this.models.find(m => m.id === modelId);
  }

  // ===========================================================================
  // SSE Parsing Helper
  // ===========================================================================

  protected parseSSEStream(
    stream: ReadableStream<Uint8Array>
  ): ReadableStream<string> {
    const decoder = new TextDecoder();
    let buffer = '';

    return new ReadableStream<string>({
      async start(controller) {
        const reader = stream.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
              // Process any remaining buffer
              if (buffer.trim()) {
                const lines = buffer.split('\n');
                for (const line of lines) {
                  if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data && data !== '[DONE]') {
                      controller.enqueue(data);
                    }
                  }
                }
              }
              controller.close();
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            
            // Keep the last incomplete line in the buffer
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data && data !== '[DONE]') {
                  controller.enqueue(data);
                }
              }
            }
          }
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      },
    });
  }

  // ===========================================================================
  // Token Estimation (basic, override for provider-specific counting)
  // ===========================================================================

  protected estimateTokens(text: string): number {
    // Basic estimation: ~4 characters per token for English
    // This is a rough approximation and should be overridden for accuracy
    return Math.ceil(text.length / 4);
  }

  protected estimateMessagesTokens(messages: ChatMessage[]): number {
    let total = 0;
    
    for (const msg of messages) {
      // Message overhead (role, formatting)
      total += 4;
      
      if (typeof msg.content === 'string') {
        total += this.estimateTokens(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            total += this.estimateTokens(part.text);
          } else if (part.type === 'image') {
            // Images typically use a fixed token count
            total += 85; // Low-res estimate
          }
        }
      }

      if (msg.name) {
        total += this.estimateTokens(msg.name);
      }
    }

    return total;
  }
}
