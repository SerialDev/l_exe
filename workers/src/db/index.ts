/**
 * Database Repository Layer
 * Re-exports all repository modules for convenient access
 *
 * @example
 * ```typescript
 * import * as db from './db';
 *
 * // Use repositories
 * const user = await db.users.findById(env.DB, userId);
 * const conversations = await db.conversations.findByUser(env.DB, userId);
 * const messages = await db.messages.findByConversation(env.DB, conversationId);
 * ```
 */

// User repository - authentication and user management
export * as users from './users';

// Conversation repository - chat conversation management
export * as conversations from './conversations';

// Message repository - individual message management
export * as messages from './messages';

// Preset repository - user preset configurations
export * as presets from './presets';

// File repository - file metadata management (R2 objects)
export * as files from './files';

// Session repository - authentication session management
export * as sessions from './sessions';

// Re-export commonly used types
export type { User, CreateUserData, UpdateUserData, UserRow } from './users';
export type {
  Conversation,
  CreateConversationData,
  UpdateConversationData,
  ConversationRow,
  FindConversationsOptions,
  PaginatedConversations,
} from './conversations';
export type {
  Message,
  CreateMessageData,
  UpdateMessageData,
  MessageRow,
  MessageSearchResult,
} from './messages';
export type {
  Preset,
  CreatePresetData,
  UpdatePresetData,
  PresetRow,
} from './presets';
export type {
  FileMetadata,
  CreateFileData,
  UpdateFileData,
  FileRow,
  FindFilesOptions,
} from './files';
export type { Session, CreateSessionData, SessionRow } from './sessions';
