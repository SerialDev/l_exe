/**
 * AI Provider Types
 * Common types for all AI provider integrations
 */

// =============================================================================
// Message Types
// =============================================================================

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    mediaType?: string;
    data?: string;
    url?: string;
  };
}

export type ContentPart = TextContent | ImageContent;

export interface ChatMessage {
  role: MessageRole;
  content: string | ContentPart[];
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

// =============================================================================
// Tool/Function Calling Types
// =============================================================================

export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export interface Tool {
  type: 'function';
  function: FunctionDefinition;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolChoice {
  type: 'auto' | 'none' | 'required' | 'function';
  function?: {
    name: string;
  };
}

// =============================================================================
// Request Types
// =============================================================================

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  stop?: string[];
  tools?: Tool[];
  toolChoice?: ToolChoice | string;
  stream?: boolean;
  user?: string;
  // Provider-specific options
  presencePenalty?: number;
  frequencyPenalty?: number;
  logitBias?: Record<string, number>;
  seed?: number;
  // Anthropic-specific
  systemPrompt?: string;
  cacheControl?: CacheControlHint[];
  // Google-specific
  safetySettings?: SafetySetting[];
}

// =============================================================================
// Response Types
// =============================================================================

export interface ChatResponse {
  id: string;
  model: string;
  content: string;
  toolCalls?: ToolCall[];
  finishReason: FinishReason;
  usage: UsageStats;
  cached?: boolean;
}

export type FinishReason = 
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'content_filter'
  | 'error'
  | null;

export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}

// =============================================================================
// Streaming Types
// =============================================================================

export interface StreamChunk {
  id: string;
  model: string;
  delta: StreamDelta;
  finishReason: FinishReason;
  usage?: UsageStats;
}

export interface StreamDelta {
  role?: MessageRole;
  content?: string;
  toolCalls?: ToolCallDelta[];
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

// =============================================================================
// Configuration Types
// =============================================================================

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  defaultModel?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  rateLimitRpm?: number;
  rateLimitTpm?: number;
  headers?: Record<string, string>;
}

export interface ModelConfig {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  deprecated?: boolean;
}

// =============================================================================
// Anthropic-specific Types
// =============================================================================

export interface CacheControlHint {
  type: 'ephemeral';
  messageIndex?: number;
  blockIndex?: number;
}

// =============================================================================
// Google-specific Types
// =============================================================================

export type HarmCategory =
  | 'HARM_CATEGORY_HARASSMENT'
  | 'HARM_CATEGORY_HATE_SPEECH'
  | 'HARM_CATEGORY_SEXUALLY_EXPLICIT'
  | 'HARM_CATEGORY_DANGEROUS_CONTENT';

export type HarmBlockThreshold =
  | 'BLOCK_NONE'
  | 'BLOCK_LOW_AND_ABOVE'
  | 'BLOCK_MEDIUM_AND_ABOVE'
  | 'BLOCK_ONLY_HIGH';

export interface SafetySetting {
  category: HarmCategory;
  threshold: HarmBlockThreshold;
}

// =============================================================================
// Error Types
// =============================================================================

export class ProviderError extends Error {
  constructor(
    message: string,
    public code: ProviderErrorCode,
    public statusCode?: number,
    public provider?: string,
    public retryable: boolean = false,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export type ProviderErrorCode =
  | 'INVALID_API_KEY'
  | 'RATE_LIMIT'
  | 'QUOTA_EXCEEDED'
  | 'INVALID_REQUEST'
  | 'MODEL_NOT_FOUND'
  | 'CONTEXT_LENGTH_EXCEEDED'
  | 'CONTENT_FILTERED'
  | 'SERVER_ERROR'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

// =============================================================================
// Provider Interface
// =============================================================================

export interface IProvider {
  readonly name: string;
  readonly models: ModelConfig[];
  
  chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
  stream(request: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamChunk>;
  countTokens(messages: ChatMessage[], model?: string): Promise<number>;
}
