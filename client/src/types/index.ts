// User types
export interface User {
  id: string;
  email: string;
  username: string;
  name: string;
  avatar: string | null;
  role: 'user' | 'admin';
  provider?: 'local' | 'google' | 'github' | 'discord';
}

// Auth types
export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  username: string;
  name: string;
  password: string;
  confirm_password: string;
}

export interface AuthResponse {
  token: string;
  refreshToken: string;
  user: User;
}

// Conversation types
export interface Conversation {
  id: string;
  conversationId: string;
  title: string;
  endpoint: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationListResponse {
  conversations: Conversation[];
  pageNumber: number;
  pageSize: number;
  pages: number;
}

// Message types
export interface Message {
  id: string;
  messageId: string;
  conversationId: string;
  parentMessageId: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string | null;
  endpoint: string | null;
  isCreatedByUser: boolean;
  error?: boolean;
  unfinished?: boolean;
  tokenCount?: number;
  createdAt: string;
}

export interface SendMessageRequest {
  conversationId?: string;
  parentMessageId?: string;
  endpoint: string;
  model: string;
  text: string;
  promptPrefix?: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
}

export interface SendMessageResponse {
  conversationId: string;
  messageId: string;
  parentMessageId: string;
  userMessageId: string;
  text: string;
  model: string;
  endpoint: string;
  finish_reason?: string;
  tokenCount?: number;
}

// SSE Event types
export interface StreamStartEvent {
  conversationId: string;
  messageId: string;
  parentMessageId: string;
  model: string;
  endpoint: string;
}

export interface StreamMessageEvent {
  text: string;
  messageId: string;
}

export interface StreamErrorEvent {
  message: string;
}

export interface StreamDoneEvent extends SendMessageResponse {}

// Model/Endpoint types
export type Endpoint = 'openAI' | 'anthropic' | 'google' | 'azure';

export interface ModelOption {
  id: string;
  name: string;
  endpoint: Endpoint;
  contextWindow: number;
  maxOutput: number;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  { id: 'gpt-4o', name: 'GPT-4o', endpoint: 'openAI', contextWindow: 128000, maxOutput: 16384 },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', endpoint: 'openAI', contextWindow: 128000, maxOutput: 16384 },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', endpoint: 'openAI', contextWindow: 128000, maxOutput: 4096 },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', endpoint: 'anthropic', contextWindow: 200000, maxOutput: 8192 },
  { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', endpoint: 'anthropic', contextWindow: 200000, maxOutput: 4096 },
  { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', endpoint: 'anthropic', contextWindow: 200000, maxOutput: 4096 },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', endpoint: 'google', contextWindow: 1000000, maxOutput: 8192 },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', endpoint: 'google', contextWindow: 1000000, maxOutput: 8192 },
];

// Chat state
export interface ChatState {
  conversations: Conversation[];
  currentConversation: Conversation | null;
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingContent: string;
  error: string | null;
}

// Settings
export interface Settings {
  theme: 'light' | 'dark' | 'system';
  defaultModel: string;
  defaultEndpoint: Endpoint;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
}

// File types
export interface UploadedFile {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  purpose: 'attachment' | 'avatar' | 'export' | 'rag';
  url: string;
  createdAt: string;
  width?: number;
  height?: number;
}

export interface FileUploadResponse {
  success: boolean;
  file?: UploadedFile;
  error?: { message: string };
}

// Artifact types
export type ArtifactType = 'react' | 'html' | 'mermaid' | 'svg' | 'markdown' | 'code' | 'chart' | 'table' | 'image';

export interface Artifact {
  id: string;
  conversationId: string;
  messageId: string;
  type: ArtifactType;
  title: string;
  content: string;
  language?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// Extend Message to include files and artifacts
export interface MessageFile {
  id: string;
  url: string;
  name: string;
  type: string;
  size: number;
}

// Extended SendMessageRequest with files
export interface SendMessageRequestWithFiles extends SendMessageRequest {
  files?: string[]; // File IDs to attach
}
