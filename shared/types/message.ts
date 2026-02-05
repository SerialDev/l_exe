/**
 * Message-related type definitions
 */

export interface Message {
  id: string;
  messageId: string; // Client-facing ID
  conversationId: string;
  parentMessageId: string | null;
  userId: string;
  role: MessageRole;
  content: string;
  text: string; // Alias for content (LibreChat compatibility)
  isCreatedByUser: boolean;
  model: string | null;
  endpoint: string | null;
  finish_reason: FinishReason | null;
  tokenCount: number | null;
  error: boolean;
  unfinished: boolean;
  cancelled: boolean;
  plugin: string | null; // JSON string for plugin data
  plugins: string | null; // JSON array of plugins used
  files: string | null; // JSON array of file attachments
  createdAt: string;
  updatedAt: string;
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'function' | 'tool';

export type FinishReason = 
  | 'stop'
  | 'length'
  | 'content_filter'
  | 'tool_calls'
  | 'function_call'
  | 'error'
  | 'cancelled';

export interface MessageCreate {
  messageId?: string;
  conversationId: string;
  parentMessageId?: string;
  userId: string;
  role: MessageRole;
  content: string;
  isCreatedByUser: boolean;
  model?: string;
  endpoint?: string;
  plugin?: Record<string, unknown>;
  files?: MessageFile[];
}

export interface MessageUpdate {
  content?: string;
  finish_reason?: FinishReason;
  tokenCount?: number;
  error?: boolean;
  unfinished?: boolean;
  cancelled?: boolean;
  plugin?: Record<string, unknown>;
}

export interface MessageFile {
  file_id: string;
  type: 'image' | 'file';
  filename?: string;
  filepath?: string;
  height?: number;
  width?: number;
}

// Streaming message types
export interface StreamingMessage {
  messageId: string;
  conversationId: string;
  parentMessageId: string;
  text: string;
  sender: string;
  isCreatedByUser: boolean;
  model: string;
  endpoint: string;
  final?: boolean;
  initial?: boolean;
  error?: boolean;
  cancelled?: boolean;
  finish_reason?: FinishReason;
  tokenCount?: number;
  responseMessageId?: string;
  plugin?: Record<string, unknown>;
}

export interface MessageTreeNode {
  id: string;
  messageId: string;
  role: MessageRole;
  content: string;
  children: MessageTreeNode[];
}

// For building conversation history
export interface MessageForHistory {
  role: MessageRole;
  content: string;
  name?: string;
}

// Feedback on messages
export interface MessageFeedback {
  id: string;
  messageId: string;
  userId: string;
  rating: -1 | 0 | 1; // thumbs down, neutral, thumbs up
  comment: string | null;
  createdAt: string;
}
