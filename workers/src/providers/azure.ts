/**
 * Azure OpenAI Provider
 * Supports Azure-hosted OpenAI models (GPT-4, GPT-4o, etc.)
 * 
 * Azure OpenAI uses a different URL structure and API version:
 * https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version=2024-02-15-preview
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
// Azure OpenAI API Types (same as OpenAI)
// =============================================================================

interface AzureMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | AzureContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: AzureToolCall[];
}

interface AzureContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

interface AzureToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface AzureRequest {
  messages: AzureMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  tools?: AzureTool[];
  tool_choice?: string | { type: string; function?: { name: string } };
  stream?: boolean;
  user?: string;
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
}

interface AzureTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

interface AzureResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: AzureMessage;
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface AzureStreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// =============================================================================
// Azure OpenAI Provider Configuration
// =============================================================================

export interface AzureProviderConfig extends ProviderConfig {
  /** Azure OpenAI resource endpoint (e.g., https://myresource.openai.azure.com) */
  baseUrl: string;
  /** API version (e.g., 2024-02-15-preview) */
  apiVersion?: string;
  /** Deployment name to model mapping */
  deployments?: Record<string, string>;
}

// =============================================================================
// Azure OpenAI Provider Implementation
// =============================================================================

export class AzureOpenAIProvider extends BaseProvider {
  readonly name = 'azure';
  readonly models: ModelConfig[] = [
    {
      id: 'gpt-4o',
      name: 'GPT-4o (Azure)',
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
      name: 'GPT-4o Mini (Azure)',
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
      name: 'GPT-4 Turbo (Azure)',
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
      name: 'GPT-4 (Azure)',
      contextWindow: 8192,
      maxOutputTokens: 8192,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 30,
      outputPricePerMillion: 60,
    },
    {
      id: 'gpt-35-turbo',
      name: 'GPT-3.5 Turbo (Azure)',
      contextWindow: 16385,
      maxOutputTokens: 4096,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 0.5,
      outputPricePerMillion: 1.5,
    },
  ];

  private apiVersion: string;
  private deployments: Record<string, string>;

  constructor(config: AzureProviderConfig) {
    super(config);
    this.apiVersion = config.apiVersion || '2024-02-15-preview';
    this.deployments = config.deployments || {};
  }

  protected getDefaultBaseUrl(): string {
    return '';  // Azure requires explicit baseUrl
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
   * Get the deployment name for a model
   * Azure requires deployment names which may differ from model IDs
   */
  private getDeploymentName(model: string): string {
    // Check if there's a custom deployment mapping
    if (this.deployments[model]) {
      return this.deployments[model];
    }
    // Default: use model ID as deployment name
    return model;
  }

  /**
   * Build the Azure OpenAI endpoint URL
   */
  private getEndpointUrl(deployment: string): string {
    const baseUrl = this.config.baseUrl!.replace(/\/$/, '');
    return `${baseUrl}/openai/deployments/${deployment}/chat/completions?api-version=${this.apiVersion}`;
  }

  /**
   * Convert internal messages to Azure format
   */
  private toAzureMessages(messages: ChatMessage[]): AzureMessage[] {
    return messages.map((msg) => {
      // Handle multimodal content
      if (msg.content && Array.isArray(msg.content)) {
        const parts: AzureContentPart[] = (msg.content as ContentPart[]).map((part) => {
          if (part.type === 'text') {
            return { type: 'text', text: part.text };
          } else if (part.type === 'image') {
            return {
              type: 'image_url',
              image_url: {
                url: part.source?.data
                  ? `data:${part.source.mediaType};base64,${part.source.data}`
                  : part.source?.url || '',
                detail: 'auto',
              },
            };
          }
          return { type: 'text', text: '' };
        });

        return {
          role: msg.role as 'system' | 'user' | 'assistant' | 'tool',
          content: parts,
        };
      }

      // Handle tool messages
      if (msg.role === 'tool' && msg.toolCallId) {
        return {
          role: 'tool',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          tool_call_id: msg.toolCallId,
        };
      }

      // Handle assistant messages with tool calls
      if (msg.role === 'assistant' && msg.toolCalls) {
        return {
          role: 'assistant',
          content: typeof msg.content === 'string' ? msg.content : null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        };
      }

      return {
        role: msg.role as 'system' | 'user' | 'assistant',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        ...(msg.name && { name: msg.name }),
      };
    });
  }

  /**
   * Convert Azure tool calls to internal format
   */
  private fromAzureToolCalls(toolCalls: AzureToolCall[]): ToolCall[] {
    return toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));
  }

  /**
   * Map Azure finish reason to internal format
   */
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
        return 'stop';
    }
  }

  /**
   * Send a chat completion request (non-streaming)
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const deployment = this.getDeploymentName(request.model);
    const url = this.getEndpointUrl(deployment);

    const body: AzureRequest = {
      messages: this.toAzureMessages(request.messages),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      top_p: request.topP,
      stop: request.stop,
      presence_penalty: request.presencePenalty,
      frequency_penalty: request.frequencyPenalty,
      seed: request.seed,
      stream: false,
    };

    // Add tools if provided
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        },
      }));
      if (request.toolChoice) {
        body.tool_choice = request.toolChoice as string | { type: string; function?: { name: string } };
      }
    }

    const response = await this.makeRequest<AzureResponse>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.config.apiKey,
      },
      body: JSON.stringify(body),
    });

    const choice = response.choices[0];
    const message = choice.message;

    // Extract text content from message
    let textContent = '';
    if (typeof message.content === 'string') {
      textContent = message.content;
    } else if (Array.isArray(message.content)) {
      textContent = message.content
        .filter((part): part is AzureContentPart & { type: 'text' } => part.type === 'text')
        .map(part => part.text || '')
        .join('');
    }

    return {
      id: response.id,
      model: response.model,
      content: textContent,
      finishReason: this.mapFinishReason(choice.finish_reason),
      toolCalls: message.tool_calls ? this.fromAzureToolCalls(message.tool_calls) : undefined,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  /**
   * Send a streaming chat completion request
   */
  async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    const deployment = this.getDeploymentName(request.model);
    const url = this.getEndpointUrl(deployment);

    const body: AzureRequest = {
      messages: this.toAzureMessages(request.messages),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      top_p: request.topP,
      stop: request.stop,
      presence_penalty: request.presencePenalty,
      frequency_penalty: request.frequencyPenalty,
      seed: request.seed,
      stream: true,
    };

    // Add tools if provided
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        },
      }));
      if (request.toolChoice) {
        body.tool_choice = request.toolChoice as string | { type: string; function?: { name: string } };
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.config.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new ProviderError(
        `Azure OpenAI API error: ${error}`,
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
    let responseId = '';
    let responseModel = request.model;
    const toolCallsMap = new Map<number, ToolCall>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.slice(6)) as AzureStreamResponse;
            responseId = data.id;
            responseModel = data.model;

            const choice = data.choices[0];
            if (!choice) continue;

            const delta = choice.delta;

            // Handle content
            if (delta.content) {
              yield {
                id: data.id,
                model: data.model,
                delta: {
                  content: delta.content,
                },
                finishReason: null,
              };
            }

            // Handle tool calls
            if (delta.tool_calls) {
              const toolCallDeltas: ToolCallDelta[] = [];
              for (const tc of delta.tool_calls) {
                const existing = toolCallsMap.get(tc.index);
                if (!existing) {
                  toolCallsMap.set(tc.index, {
                    id: tc.id || '',
                    type: 'function',
                    function: {
                      name: tc.function?.name || '',
                      arguments: tc.function?.arguments || '',
                    },
                  });
                } else {
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name) existing.function.name += tc.function.name;
                  if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
                }
                toolCallDeltas.push({
                  index: tc.index,
                  id: tc.id,
                  type: 'function',
                  function: tc.function,
                });
              }

              yield {
                id: data.id,
                model: data.model,
                delta: {
                  toolCalls: toolCallDeltas,
                },
                finishReason: null,
              };
            }

            // Handle finish
            if (choice.finish_reason) {
              yield {
                id: data.id,
                model: data.model,
                delta: {},
                finishReason: this.mapFinishReason(choice.finish_reason),
                usage: data.usage
                  ? {
                      promptTokens: data.usage.prompt_tokens,
                      completionTokens: data.usage.completion_tokens,
                      totalTokens: data.usage.total_tokens,
                    }
                  : undefined,
              };
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
