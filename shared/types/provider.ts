/**
 * AI Provider type definitions
 */

// Provider credentials stored in D1
export interface ProviderCredential {
  id: string;
  userId: string | null; // null for system-level
  provider: ProviderName;
  name: string;
  apiKey: string; // Encrypted
  baseUrl: string | null;
  organizationId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ProviderName = 
  | 'openai'
  | 'azure'
  | 'anthropic'
  | 'google'
  | 'mistral'
  | 'cohere'
  | 'ollama'
  | 'custom';

// Provider configuration
export interface ProviderConfig {
  name: ProviderName;
  displayName: string;
  baseUrl: string;
  apiVersion?: string;
  models: ModelConfig[];
  defaultModel: string;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  maxContextTokens: number;
}

export interface ModelConfig {
  id: string;
  name: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  supportsVision: boolean;
  supportsTools: boolean;
  deprecated?: boolean;
}

// OpenAI-specific types
export interface OpenAIConfig extends ProviderConfig {
  name: 'openai';
  organizationId?: string;
}

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[];
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: OpenAITool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  response_format?: { type: 'text' | 'json_object' };
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAIChatResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: OpenAIChatMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Anthropic-specific types
export interface AnthropicConfig extends ProviderConfig {
  name: 'anthropic';
  apiVersion: string;
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

export interface AnthropicChatRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: AnthropicTool[];
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicChatResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Google-specific types
export interface GoogleConfig extends ProviderConfig {
  name: 'google';
}

export interface GoogleContent {
  role: 'user' | 'model';
  parts: GooglePart[];
}

export interface GooglePart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
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

export interface GoogleChatRequest {
  contents: GoogleContent[];
  systemInstruction?: { parts: [{ text: string }] };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
  };
  tools?: GoogleTool[];
}

export interface GoogleTool {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

export interface GoogleChatResponse {
  candidates: Array<{
    content: GoogleContent;
    finishReason: string;
  }>;
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

// Common streaming chunk type
export interface StreamChunk {
  content: string;
  finish_reason?: string;
  tool_calls?: OpenAIToolCall[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}
