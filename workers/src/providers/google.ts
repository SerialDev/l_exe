/**
 * Google Provider
 * Supports Gemini models
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
  SafetySetting,
  HarmCategory,
  HarmBlockThreshold,
  ProviderError,
  ProviderErrorCode,
} from './types';

// =============================================================================
// Google Gemini API Types
// =============================================================================

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  fileData?: {
    mimeType: string;
    fileUri: string;
  };
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

interface GeminiSafetySetting {
  category: string;
  threshold: string;
}

interface GeminiGenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  candidateCount?: number;
}

interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: GeminiContent;
  tools?: GeminiTool[];
  toolConfig?: {
    functionCallingConfig?: {
      mode: 'AUTO' | 'NONE' | 'ANY';
      allowedFunctionNames?: string[];
    };
  };
  safetySettings?: GeminiSafetySetting[];
  generationConfig?: GeminiGenerationConfig;
}

interface GeminiResponse {
  candidates: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  promptFeedback?: {
    blockReason?: string;
    safetyRatings?: GeminiSafetyRating[];
  };
}

interface GeminiCandidate {
  content: GeminiContent;
  finishReason?: string;
  safetyRatings?: GeminiSafetyRating[];
  index: number;
}

interface GeminiSafetyRating {
  category: string;
  probability: string;
  blocked?: boolean;
}

interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  cachedContentTokenCount?: number;
}

interface GeminiStreamResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  promptFeedback?: {
    blockReason?: string;
  };
}

// =============================================================================
// Google Provider Implementation
// =============================================================================

export class GoogleProvider extends BaseProvider {
  readonly name = 'google';
  
  readonly models: ModelConfig[] = [
    {
      id: 'gemini-2.0-flash',
      name: 'Gemini 2.0 Flash',
      contextWindow: 1048576,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 0.075,
      outputPricePerMillion: 0.3,
    },
    {
      id: 'gemini-2.0-flash-lite',
      name: 'Gemini 2.0 Flash Lite',
      contextWindow: 1048576,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 0.01875,
      outputPricePerMillion: 0.075,
    },
    {
      id: 'gemini-1.5-pro',
      name: 'Gemini 1.5 Pro',
      contextWindow: 2097152,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 1.25,
      outputPricePerMillion: 5,
    },
    {
      id: 'gemini-1.5-flash',
      name: 'Gemini 1.5 Flash',
      contextWindow: 1048576,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 0.075,
      outputPricePerMillion: 0.3,
    },
    {
      id: 'gemini-1.5-flash-8b',
      name: 'Gemini 1.5 Flash 8B',
      contextWindow: 1048576,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMillion: 0.0375,
      outputPricePerMillion: 0.15,
    },
    {
      id: 'gemini-1.0-pro',
      name: 'Gemini 1.0 Pro',
      contextWindow: 32760,
      maxOutputTokens: 8192,
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
    return 'https://generativelanguage.googleapis.com/v1beta';
  }

  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };
  }

  private getEndpoint(model: string, stream: boolean = false): string {
    const action = stream ? 'streamGenerateContent' : 'generateContent';
    return `/models/${model}:${action}?key=${this.config.apiKey}`;
  }

  // ===========================================================================
  // Chat Completion
  // ===========================================================================

  async chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const model = this.getModel(request);
    const geminiRequest = this.transformRequest(request);
    
    const response = await this.makeRequest<GeminiResponse>(
      this.getEndpoint(model, false),
      geminiRequest,
      signal
    );

    return this.transformResponse(response, model);
  }

  // ===========================================================================
  // Streaming
  // ===========================================================================

  async *stream(
    request: ChatRequest,
    signal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    const model = this.getModel(request);
    const geminiRequest = this.transformRequest(request);

    const stream = await this.makeStreamingRequest(
      this.getEndpoint(model, true) + '&alt=sse',
      geminiRequest,
      signal
    );

    const sseStream = this.parseSSEStream(stream);
    const reader = sseStream.getReader();

    let chunkIndex = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        try {
          const chunk = JSON.parse(value) as GeminiStreamResponse;
          
          // Check for prompt feedback (content blocked)
          if (chunk.promptFeedback?.blockReason) {
            yield {
              id: `gemini-${chunkIndex++}`,
              model,
              delta: {},
              finishReason: 'content_filter',
            };
            continue;
          }

          if (chunk.candidates && chunk.candidates.length > 0) {
            const candidate = chunk.candidates[0];
            
            yield this.transformStreamChunk(
              candidate,
              model,
              chunkIndex++,
              chunk.usageMetadata
            );
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
    const modelId = model || this.config.defaultModel || 'gemini-1.5-flash';
    
    // Google has a countTokens endpoint
    const geminiContents = this.transformMessages(messages);
    
    try {
      const response = await this.makeRequest<{ totalTokens: number }>(
        `/models/${modelId}:countTokens?key=${this.config.apiKey}`,
        { contents: geminiContents }
      );
      
      return response.totalTokens;
    } catch {
      // Fallback to estimation
      return this.estimateMessagesTokens(messages);
    }
  }

  // ===========================================================================
  // Request/Response Transformation
  // ===========================================================================

  private transformRequest(request: ChatRequest): GeminiRequest {
    const geminiRequest: GeminiRequest = {
      contents: this.transformMessages(request.messages),
    };

    // Handle system prompt
    const systemPrompt = this.extractSystemPrompt(request);
    if (systemPrompt) {
      geminiRequest.systemInstruction = {
        role: 'user',
        parts: [{ text: systemPrompt }],
      };
    }

    // Generation config
    const generationConfig: GeminiGenerationConfig = {};
    
    if (request.temperature !== undefined) {
      generationConfig.temperature = request.temperature;
    }
    
    if (request.topP !== undefined) {
      generationConfig.topP = request.topP;
    }
    
    if (request.topK !== undefined) {
      generationConfig.topK = request.topK;
    }
    
    if (request.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = request.maxTokens;
    }
    
    if (request.stop) {
      generationConfig.stopSequences = request.stop;
    }

    if (Object.keys(generationConfig).length > 0) {
      geminiRequest.generationConfig = generationConfig;
    }

    // Tools
    if (request.tools && request.tools.length > 0) {
      geminiRequest.tools = [{
        functionDeclarations: request.tools.map(tool => ({
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        })),
      }];

      // Tool choice
      if (request.toolChoice) {
        let mode: 'AUTO' | 'NONE' | 'ANY' = 'AUTO';
        let allowedFunctionNames: string[] | undefined;

        if (typeof request.toolChoice === 'string') {
          mode = request.toolChoice === 'none' ? 'NONE' : 
                 request.toolChoice === 'required' ? 'ANY' : 'AUTO';
        } else {
          mode = request.toolChoice.type === 'none' ? 'NONE' :
                 request.toolChoice.type === 'required' ? 'ANY' :
                 request.toolChoice.type === 'function' ? 'ANY' : 'AUTO';
          
          if (request.toolChoice.function?.name) {
            allowedFunctionNames = [request.toolChoice.function.name];
          }
        }

        geminiRequest.toolConfig = {
          functionCallingConfig: {
            mode,
            allowedFunctionNames,
          },
        };
      }
    }

    // Safety settings
    if (request.safetySettings) {
      geminiRequest.safetySettings = request.safetySettings.map(s => ({
        category: s.category,
        threshold: s.threshold,
      }));
    } else {
      // Default to permissive safety settings
      geminiRequest.safetySettings = this.getDefaultSafetySettings();
    }

    return geminiRequest;
  }

  private extractSystemPrompt(request: ChatRequest): string | undefined {
    if (request.systemPrompt) {
      return request.systemPrompt;
    }

    const systemMessages = request.messages.filter(m => m.role === 'system');
    if (systemMessages.length > 0) {
      return systemMessages
        .map(m => typeof m.content === 'string' ? m.content : '')
        .filter(Boolean)
        .join('\n\n');
    }

    return undefined;
  }

  private transformMessages(messages: ChatMessage[]): GeminiContent[] {
    const result: GeminiContent[] = [];
    
    // Filter out system messages (handled separately)
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    for (const msg of nonSystemMessages) {
      const parts = this.transformMessageParts(msg);
      
      if (msg.role === 'tool') {
        // Tool results become function responses
        result.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: msg.name || 'unknown',
              response: { 
                result: typeof msg.content === 'string' 
                  ? msg.content 
                  : JSON.stringify(msg.content) 
              },
            },
          }],
        });
        continue;
      }

      const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';

      // Check if we can merge with previous message of same role
      const lastContent = result[result.length - 1];
      if (lastContent && lastContent.role === role) {
        lastContent.parts.push(...parts);
      } else {
        result.push({ role, parts });
      }
    }

    return this.ensureValidConversation(result);
  }

  private transformMessageParts(msg: ChatMessage): GeminiPart[] {
    const parts: GeminiPart[] = [];

    if (typeof msg.content === 'string') {
      if (msg.content) {
        parts.push({ text: msg.content });
      }
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          parts.push({ text: part.text });
        } else if (part.type === 'image') {
          if (part.source.type === 'base64' && part.source.data) {
            parts.push({
              inlineData: {
                mimeType: part.source.mediaType || 'image/png',
                data: part.source.data,
              },
            });
          } else if (part.source.type === 'url' && part.source.url) {
            // Gemini supports file URIs for Cloud Storage
            // For HTTP URLs, would need to fetch and convert to base64
            throw new ProviderError(
              'Gemini requires base64 encoded images or Cloud Storage URIs.',
              'INVALID_REQUEST',
              400,
              this.name
            );
          }
        }
      }
    }

    // Add function calls for assistant messages
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        parts.push({
          functionCall: {
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments),
          },
        });
      }
    }

    return parts;
  }

  private ensureValidConversation(contents: GeminiContent[]): GeminiContent[] {
    // Gemini requires conversations to start with user and alternate
    if (contents.length === 0) {
      return [{ role: 'user', parts: [{ text: 'Hello.' }] }];
    }

    // Ensure starts with user
    if (contents[0].role === 'model') {
      contents.unshift({ role: 'user', parts: [{ text: 'Hello.' }] });
    }

    return contents;
  }

  private getDefaultSafetySettings(): GeminiSafetySetting[] {
    const categories: HarmCategory[] = [
      'HARM_CATEGORY_HARASSMENT',
      'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'HARM_CATEGORY_DANGEROUS_CONTENT',
    ];

    return categories.map(category => ({
      category,
      threshold: 'BLOCK_ONLY_HIGH' as HarmBlockThreshold,
    }));
  }

  private transformResponse(response: GeminiResponse, model: string): ChatResponse {
    // Check for blocked content
    if (response.promptFeedback?.blockReason) {
      throw new ProviderError(
        `Content blocked: ${response.promptFeedback.blockReason}`,
        'CONTENT_FILTERED',
        400,
        this.name
      );
    }

    if (!response.candidates || response.candidates.length === 0) {
      throw new ProviderError(
        'No candidates in response',
        'SERVER_ERROR',
        500,
        this.name
      );
    }

    const candidate = response.candidates[0];
    let content = '';
    const toolCalls: ToolCall[] = [];
    let toolCallIndex = 0;

    for (const part of candidate.content.parts) {
      if (part.text) {
        content += part.text;
      } else if (part.functionCall) {
        toolCalls.push({
          id: `call_${toolCallIndex++}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args),
          },
        });
      }
    }

    return {
      id: `gemini-${Date.now()}`,
      model,
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: this.mapFinishReason(candidate.finishReason),
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
        cachedTokens: response.usageMetadata?.cachedContentTokenCount,
      },
    };
  }

  private transformStreamChunk(
    candidate: GeminiCandidate,
    model: string,
    index: number,
    usage?: GeminiUsageMetadata
  ): StreamChunk {
    let content = '';
    const toolCalls: StreamChunk['delta']['toolCalls'] = [];

    for (const part of candidate.content.parts) {
      if (part.text) {
        content += part.text;
      } else if (part.functionCall) {
        toolCalls.push({
          index: toolCalls.length,
          id: `call_${toolCalls.length}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args),
          },
        });
      }
    }

    return {
      id: `gemini-${index}`,
      model,
      delta: {
        role: candidate.content.role === 'model' ? 'assistant' : undefined,
        content: content || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      finishReason: this.mapFinishReason(candidate.finishReason),
      usage: usage ? {
        promptTokens: usage.promptTokenCount,
        completionTokens: usage.candidatesTokenCount,
        totalTokens: usage.totalTokenCount,
      } : undefined,
    };
  }

  private mapFinishReason(reason?: string): FinishReason {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
        return 'content_filter';
      case 'TOOL_CALLS':
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
    const message = this.extractGoogleErrorMessage(body);

    // Check for specific Google error codes
    if (typeof body === 'object' && body !== null) {
      const obj = body as Record<string, unknown>;
      const error = obj.error as Record<string, unknown> | undefined;
      
      if (error) {
        const code = error.code;
        const errorStatus = error.status;

        if (code === 403 || errorStatus === 'PERMISSION_DENIED') {
          return { code: 'INVALID_API_KEY', message, retryable: false };
        }

        if (code === 429 || errorStatus === 'RESOURCE_EXHAUSTED') {
          return { code: 'RATE_LIMIT', message, retryable: true, retryAfter: 60 };
        }

        if (errorStatus === 'INVALID_ARGUMENT') {
          if (message.includes('token') || message.includes('context')) {
            return { code: 'CONTEXT_LENGTH_EXCEEDED', message, retryable: false };
          }
          return { code: 'INVALID_REQUEST', message, retryable: false };
        }

        if (code === 404 || errorStatus === 'NOT_FOUND') {
          return { code: 'MODEL_NOT_FOUND', message, retryable: false };
        }
      }
    }

    return super.parseErrorResponse(status, body);
  }

  private extractGoogleErrorMessage(body: unknown): string {
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
