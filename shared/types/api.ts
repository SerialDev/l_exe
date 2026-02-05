/**
 * API request/response type definitions
 */

// Generic API response wrapper
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// Pagination
export interface PaginationParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  pageNumber: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// Chat/Completion requests
export interface ChatRequest {
  conversationId?: string;
  parentMessageId?: string;
  endpoint: string;
  model: string;
  text: string;
  promptPrefix?: string;
  chatGptLabel?: string;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  files?: Array<{
    file_id: string;
    type: string;
  }>;
  tools?: string[];
  agent?: string;
}

export interface ChatResponse {
  conversationId: string;
  messageId: string;
  parentMessageId: string;
  text: string;
  sender: string;
  model: string;
  endpoint: string;
  isCreatedByUser: boolean;
  finish_reason?: string;
  tokenCount?: number;
  error?: boolean;
}

// SSE streaming events
export type StreamEvent = 
  | { type: 'start'; data: StreamStartEvent }
  | { type: 'message'; data: StreamMessageEvent }
  | { type: 'tool'; data: StreamToolEvent }
  | { type: 'error'; data: StreamErrorEvent }
  | { type: 'done'; data: StreamDoneEvent };

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

export interface StreamToolEvent {
  tool: string;
  input: string;
  output?: string;
}

export interface StreamErrorEvent {
  message: string;
  code?: string;
}

export interface StreamDoneEvent {
  messageId: string;
  text: string;
  finish_reason: string;
  tokenCount?: number;
}

// Abort request
export interface AbortRequest {
  conversationId: string;
  messageId: string;
  endpoint: string;
  model: string;
}

// Search
export interface SearchRequest {
  query: string;
  pageNumber?: number;
  pageSize?: number;
}

export interface SearchResult {
  conversationId: string;
  messageId: string;
  title: string;
  text: string;
  createdAt: string;
  score: number;
}

export interface SearchResponse {
  results: SearchResult[];
  pageNumber: number;
  pageSize: number;
  totalCount: number;
}

// Config endpoint responses
export interface StartupConfig {
  appTitle: string;
  socialLogins: string[];
  discordLoginEnabled: boolean;
  facebookLoginEnabled: boolean;
  githubLoginEnabled: boolean;
  googleLoginEnabled: boolean;
  openidLoginEnabled: boolean;
  openidLabel: string;
  openidImageUrl: string;
  serverDomain: string;
  emailLoginEnabled: boolean;
  registrationEnabled: boolean;
  socialLoginEnabled: boolean;
  emailEnabled: boolean;
  checkBalance: boolean;
  showBirthdayIcon: boolean;
  helpAndFaqURL: string;
  interface: InterfaceConfig;
  modelSpecs: ModelSpec[];
}

export interface InterfaceConfig {
  privacyPolicy?: {
    externalUrl?: string;
    openNewTab?: boolean;
  };
  termsOfService?: {
    externalUrl?: string;
    openNewTab?: boolean;
  };
  endpointsMenu?: boolean;
  modelSelect?: boolean;
  parameters?: boolean;
  sidePanel?: boolean;
  presets?: boolean;
}

export interface ModelSpec {
  name: string;
  label: string;
  preset: Record<string, unknown>;
  order: number;
  default: boolean;
}

// Endpoints config
export interface EndpointsConfig {
  [endpoint: string]: EndpointConfig | boolean;
}

export interface EndpointConfig {
  availableModels?: string[];
  userProvide?: boolean;
  userProvideURL?: boolean;
  azure?: boolean;
  plugins?: boolean;
  assistants?: boolean;
}

// Models response
export interface ModelsResponse {
  [endpoint: string]: string[];
}

// Rate limit info
export interface RateLimitInfo {
  remaining: number;
  limit: number;
  reset: number;
}
