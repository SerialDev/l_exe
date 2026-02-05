/**
 * Conversation-related type definitions
 */

export interface Conversation {
  id: string;
  conversationId: string; // Client-facing ID (for URL)
  userId: string;
  parentMessageId: string | null;
  title: string;
  endpoint: Endpoint;
  model: string;
  chatGptLabel: string | null;
  promptPrefix: string | null;
  temperature: number | null;
  topP: number | null;
  frequencyPenalty: number | null;
  presencePenalty: number | null;
  maxContextTokens: number | null;
  maxOutputTokens: number | null;
  agentOptions: string | null; // JSON string for agent settings
  tools: string | null; // JSON array of tool IDs
  file_ids: string | null; // JSON array of file IDs
  createdAt: string;
  updatedAt: string;
}

export type Endpoint = 
  | 'openAI'
  | 'azureOpenAI'
  | 'google'
  | 'anthropic'
  | 'bingAI'
  | 'gptPlugins'
  | 'assistants'
  | 'custom';

export interface ConversationCreate {
  conversationId?: string;
  userId: string;
  title?: string;
  endpoint: Endpoint;
  model: string;
  chatGptLabel?: string;
  promptPrefix?: string;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  agentOptions?: Record<string, unknown>;
  tools?: string[];
  file_ids?: string[];
}

export interface ConversationUpdate {
  title?: string;
  endpoint?: Endpoint;
  model?: string;
  chatGptLabel?: string;
  promptPrefix?: string;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  agentOptions?: Record<string, unknown>;
  tools?: string[];
  file_ids?: string[];
}

export interface ConversationWithMessages extends Conversation {
  messages: import('./message').Message[];
}

export interface ConversationListItem {
  id: string;
  conversationId: string;
  title: string;
  endpoint: Endpoint;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationListResponse {
  conversations: ConversationListItem[];
  pageNumber: number;
  pageSize: number;
  pages: number;
}

// Conversation tags/folders
export interface ConversationTag {
  id: string;
  userId: string;
  name: string;
  color: string | null;
  createdAt: string;
}

export interface ConversationTagMapping {
  conversationId: string;
  tagId: string;
}

// Shared conversations
export interface SharedConversation {
  id: string;
  conversationId: string;
  userId: string;
  shareId: string; // Public URL identifier
  title: string;
  isPublic: boolean;
  expiresAt: string | null;
  createdAt: string;
}
