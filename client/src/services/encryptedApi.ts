/**
 * Encrypted API Wrapper
 * 
 * Handles encryption/decryption of messages transparently.
 * 
 * Flow:
 * 1. User sends message → plaintext to server (for AI)
 * 2. Server stores and sends to AI → response comes back
 * 3. Client encrypts both user message and AI response
 * 4. Client tells server to update storage with encrypted versions
 * 5. When loading history → server sends encrypted → client decrypts
 */

import * as api from './api';
import type { Message, Conversation } from '../types';
import { 
  getCachedMasterKey, 
  encryptMessage, 
  decryptMessage, 
  isEncrypted as checkIsEncrypted 
} from '../lib/encryption';

/**
 * Check if encryption is available (user has set up E2EE)
 */
export function isEncryptionEnabled(): boolean {
  return getCachedMasterKey() !== null;
}

/**
 * Decrypt a single message's content
 */
export async function decryptMessageContent(message: Message): Promise<Message> {
  const key = getCachedMasterKey();
  
  // If no key or message isn't encrypted, return as-is
  if (!key || !message.isEncrypted) {
    return message;
  }
  
  try {
    const decryptedContent = await decryptMessage(message.content, key);
    return { ...message, content: decryptedContent };
  } catch (e) {
    console.warn('Failed to decrypt message:', message.id, e);
    return message; // Return as-is if decryption fails
  }
}

/**
 * Decrypt all messages in an array
 */
export async function decryptMessages(messages: Message[]): Promise<Message[]> {
  const key = getCachedMasterKey();
  if (!key) {
    return messages;
  }
  
  return Promise.all(messages.map(decryptMessageContent));
}

/**
 * Encrypt content and update message in storage
 * Called after AI response is received to encrypt stored content
 */
export async function encryptAndStoreMessage(messageId: string, plaintext: string): Promise<void> {
  const key = getCachedMasterKey();
  if (!key) {
    return; // No encryption enabled, nothing to do
  }
  
  try {
    const encrypted = await encryptMessage(plaintext, key);
    await api.encryptMessageContent(messageId, encrypted);
  } catch (e) {
    console.error('Failed to encrypt message for storage:', messageId, e);
    // Don't throw - message is still stored (just unencrypted)
  }
}

/**
 * Get conversation with decrypted messages
 */
export async function getConversationDecrypted(id: string): Promise<{ conversation: Conversation; messages: Message[] }> {
  const [conversation, messagesRaw] = await Promise.all([
    api.getConversation(id),
    api.getMessages(id),
  ]);
  const messages = await decryptMessages(messagesRaw);
  return { conversation, messages };
}

/**
 * After a message exchange completes, encrypt both messages
 * @param userMessageId - The user's message ID
 * @param userContent - The user's plaintext message
 * @param assistantMessageId - The AI's message ID  
 * @param assistantContent - The AI's plaintext response
 */
export async function encryptConversationMessages(
  userMessageId: string,
  userContent: string,
  assistantMessageId: string,
  assistantContent: string
): Promise<void> {
  if (!isEncryptionEnabled()) {
    return;
  }
  
  // Encrypt both messages in parallel
  await Promise.all([
    encryptAndStoreMessage(userMessageId, userContent),
    encryptAndStoreMessage(assistantMessageId, assistantContent),
  ]);
}

// Re-export types and functions that don't need encryption changes
export type { Message, Conversation };
