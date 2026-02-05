/**
 * Conversation Import/Export Service
 * Supports importing from ChatGPT, LibreChat, and other formats.
 * Supports exporting to JSON, Markdown, and text formats.
 */

import * as conversationsDb from '../db/conversations';
import * as messagesDb from '../db/messages';

// =============================================================================
// Types
// =============================================================================

export type ImportFormat = 'librechat' | 'chatgpt' | 'chatbot-ui' | 'json';
export type ExportFormat = 'json' | 'markdown' | 'text' | 'html';

export interface ImportedConversation {
  title: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: string;
  }>;
  model?: string;
  endpoint?: string;
  createdAt?: string;
  systemMessage?: string;  // Custom instructions / system prompt
}

export interface ExportedConversation {
  id: string;
  title: string;
  model: string;
  endpoint: string;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface ImportResult {
  success: boolean;
  conversationId?: string;
  title?: string;
  error?: string;
  messagesImported: number;
  systemMessage?: string;  // Extracted custom instructions (if any)
}

export interface ExtractedProfile {
  id: string;           // Hash of the profile content
  content: string;      // The full system message / custom instructions
  conversationCount: number;  // How many conversations used this profile
  firstSeen?: string;   // Title of first conversation with this profile
}

export interface BulkImportResult {
  total: number;
  successful: number;
  failed: number;
  withSystemMessage: number;  // Count of conversations with custom instructions
  uniqueProfiles: ExtractedProfile[];  // Deduplicated profiles found
  results: ImportResult[];
}

// =============================================================================
// ChatGPT Export Format
// =============================================================================

interface ChatGPTExport {
  id?: string;
  conversation_id?: string;
  title: string;
  create_time: number;
  update_time: number;
  mapping: Record<string, {
    id: string;
    message?: {
      id: string;
      author: {
        role: 'user' | 'assistant' | 'system' | 'tool';
        name?: string;
      };
      content: {
        content_type: string;
        parts?: Array<string | Record<string, unknown>>;
        text?: string;
        language?: string;
      };
      create_time?: number;
      metadata?: {
        model_slug?: string;
        [key: string]: unknown;
      };
    };
    parent?: string | null;
    children: string[];
  }>;
  current_node?: string;
  default_model_slug?: string;
  is_archived?: boolean;
}

/**
 * Normalize ChatGPT model slug to standard format
 */
function normalizeChatGPTModel(modelSlug: string | null | undefined): string {
  if (!modelSlug) return 'gpt-4';
  
  const slug = modelSlug.toLowerCase();
  
  if (slug.includes('gpt-4o')) return 'gpt-4o';
  if (slug.includes('gpt-4-turbo')) return 'gpt-4-turbo';
  if (slug.includes('gpt-4')) return 'gpt-4';
  if (slug.includes('gpt-3.5')) return 'gpt-3.5-turbo';
  if (slug.includes('o1-preview')) return 'o1-preview';
  if (slug.includes('o1-mini')) return 'o1-mini';
  if (slug === 'auto') return 'gpt-4';
  
  return modelSlug;
}

/**
 * Extract text content from ChatGPT message content
 */
function extractChatGPTContent(content: ChatGPTExport['mapping'][string]['message']['content']): string {
  if (!content) return '';
  
  const { content_type, parts, text, language } = content;
  
  // Simple text content
  if (content_type === 'text' && parts && parts.length > 0) {
    const textParts = parts.filter((p): p is string => typeof p === 'string');
    return textParts.join('\n');
  }
  
  // Multimodal content - extract text parts only
  if (content_type === 'multimodal_text' && parts) {
    const textParts = parts.filter((p): p is string => typeof p === 'string');
    return textParts.join('\n');
  }
  
  // Code content
  if (content_type === 'code' && text) {
    return `\`\`\`${language || ''}\n${text}\n\`\`\``;
  }
  
  // Execution output
  if (content_type === 'execution_output' && text) {
    return `Output:\n${text}`;
  }
  
  // Reasoning/thinking content (o1, o3 models)
  if ((content_type === 'thoughts' || content_type === 'reasoning_recap') && parts) {
    const textParts = parts.filter((p): p is string => typeof p === 'string');
    if (textParts.length > 0) {
      return `<thinking>\n${textParts.join('\n')}\n</thinking>`;
    }
    return '';
  }
  
  // Web browsing results
  if (content_type === 'tether_browsing_display' && parts) {
    const textParts = parts.filter((p): p is string => typeof p === 'string');
    return textParts.join('\n');
  }
  
  // Quoted text from web
  if (content_type === 'tether_quote' && parts) {
    const textParts = parts.filter((p): p is string => typeof p === 'string');
    if (textParts.length > 0) {
      return `> ${textParts.join('\n> ')}`;
    }
    return '';
  }
  
  // Skip system errors (not useful for imported conversations)
  if (content_type === 'system_error') {
    return '';
  }
  
  // Skip user profile context (already captured in conversation metadata)
  if (content_type === 'user_editable_context') {
    return '';
  }
  
  return '';
}

/**
 * Extract system message / custom instructions from ChatGPT export
 */
function extractChatGPTSystemMessage(mapping: ChatGPTExport['mapping']): string | undefined {
  if (!mapping) return undefined;
  
  // Look for user_editable_context which contains custom instructions
  for (const node of Object.values(mapping)) {
    const content = node.message?.content;
    if (content?.content_type === 'user_editable_context') {
      const parts: string[] = [];
      
      // Extract user profile (about_user)
      const userProfile = (content as { user_profile?: string }).user_profile;
      if (userProfile && typeof userProfile === 'string') {
        // Extract the actual content after the boilerplate
        const match = userProfile.match(/User profile:\s*```([^`]+)```/s);
        if (match) {
          parts.push(`[User Profile]\n${match[1].trim()}`);
        }
      }
      
      // Extract user instructions (about_model / how to respond)
      const userInstructions = (content as { user_instructions?: string }).user_instructions;
      if (userInstructions && typeof userInstructions === 'string') {
        // Extract the actual content after the boilerplate
        const match = userInstructions.match(/```([^`]+)```/s);
        if (match) {
          parts.push(`[Custom Instructions]\n${match[1].trim()}`);
        }
      }
      
      if (parts.length > 0) {
        return parts.join('\n\n');
      }
    }
  }
  
  return undefined;
}

/**
 * Parse ChatGPT export - follows current_node path for linear history
 * This correctly handles branching conversations by following the active path
 */
function parseChatGPTExport(data: ChatGPTExport): ImportedConversation & { 
  originalId?: string; 
  isArchived?: boolean;
  model?: string;
  systemMessage?: string;
} {
  const messages: ImportedConversation['messages'] = [];
  const mapping = data.mapping;
  
  // Extract system message / custom instructions
  const systemMessage = extractChatGPTSystemMessage(mapping);
  
  // Use current_node to build linear path (correct for branching conversations)
  if (data.current_node && mapping) {
    // Traverse backwards from current_node to root
    const path: string[] = [];
    let nodeId: string | null | undefined = data.current_node;
    
    while (nodeId) {
      const node = mapping[nodeId];
      if (!node) break;
      path.push(nodeId);
      nodeId = node.parent;
    }
    
    // Reverse to get root-to-current order
    path.reverse();
    
    // Extract messages from path
    for (const nid of path) {
      const node = mapping[nid];
      const msg = node?.message;
      
      if (!msg) continue;
      
      const role = msg.author?.role;
      
      // Only include user and assistant messages
      if (role !== 'user' && role !== 'assistant') continue;
      
      const content = extractChatGPTContent(msg.content);
      if (!content.trim()) continue;
      
      messages.push({
        role: role as 'user' | 'assistant',
        content: content.trim(),
        timestamp: msg.create_time 
          ? new Date(msg.create_time * 1000).toISOString()
          : undefined,
      });
    }
  } else {
    // Fallback: process all nodes (original implementation)
    const processed = new Set<string>();
    
    function processNode(nodeId: string) {
      if (processed.has(nodeId)) return;
      processed.add(nodeId);
      
      const node = mapping[nodeId];
      if (!node) return;
      
      if (node.message && node.message.content) {
        const content = extractChatGPTContent(node.message.content);
        
        if (content.trim() && node.message.author.role !== 'system' && node.message.author.role !== 'tool') {
          messages.push({
            role: node.message.author.role as 'user' | 'assistant',
            content: content.trim(),
            timestamp: node.message.create_time 
              ? new Date(node.message.create_time * 1000).toISOString()
              : undefined,
          });
        }
      }
      
      // Process children in order
      for (const childId of node.children) {
        processNode(childId);
      }
    }
    
    // Find root node and process
    const rootNode = Object.values(mapping).find(n => !n.parent);
    if (rootNode) {
      for (const childId of rootNode.children) {
        processNode(childId);
      }
    }
  }
  
  return {
    title: data.title || 'Imported Conversation',
    messages,
    model: normalizeChatGPTModel(data.default_model_slug),
    createdAt: data.create_time 
      ? new Date(data.create_time * 1000).toISOString()
      : new Date().toISOString(),
    originalId: data.id || data.conversation_id,
    isArchived: data.is_archived,
    systemMessage,
  };
}

// =============================================================================
// LibreChat Export Format
// =============================================================================

interface LibreChatExport {
  conversationId: string;
  title: string;
  endpoint: string;
  model: string;
  messages: Array<{
    messageId: string;
    parentMessageId?: string;
    role: string;
    content: string;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

function parseLibreChatExport(data: LibreChatExport): ImportedConversation {
  return {
    title: data.title,
    messages: data.messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      timestamp: m.createdAt,
    })),
    model: data.model,
    endpoint: data.endpoint,
    createdAt: data.createdAt,
  };
}

// =============================================================================
// Chatbot UI Export Format
// =============================================================================

interface ChatbotUIExport {
  version: number;
  history: Array<{
    id: string;
    name: string;
    messages: Array<{
      role: string;
      content: string;
    }>;
    model: {
      id: string;
    };
    folderId?: string;
  }>;
  folders: Array<{
    id: string;
    name: string;
  }>;
}

function parseChatbotUIExport(data: ChatbotUIExport): ImportedConversation[] {
  return data.history.map(conv => ({
    title: conv.name,
    messages: conv.messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    })),
    model: conv.model?.id,
  }));
}

// =============================================================================
// Export Formatters
// =============================================================================

function formatAsMarkdown(conversation: ExportedConversation): string {
  const lines: string[] = [];
  
  lines.push(`# ${conversation.title}`);
  lines.push('');
  lines.push(`**Model:** ${conversation.model}`);
  lines.push(`**Date:** ${new Date(conversation.createdAt).toLocaleDateString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  
  for (const message of conversation.messages) {
    const roleLabel = message.role === 'user' ? '**User:**' : '**Assistant:**';
    lines.push(roleLabel);
    lines.push('');
    lines.push(message.content);
    lines.push('');
  }
  
  return lines.join('\n');
}

function formatAsText(conversation: ExportedConversation): string {
  const lines: string[] = [];
  
  lines.push(`${conversation.title}`);
  lines.push(`Model: ${conversation.model}`);
  lines.push(`Date: ${new Date(conversation.createdAt).toLocaleDateString()}`);
  lines.push('');
  lines.push('='.repeat(50));
  lines.push('');
  
  for (const message of conversation.messages) {
    const roleLabel = message.role === 'user' ? 'User:' : 'Assistant:';
    lines.push(roleLabel);
    lines.push(message.content);
    lines.push('');
    lines.push('-'.repeat(30));
    lines.push('');
  }
  
  return lines.join('\n');
}

function formatAsHTML(conversation: ExportedConversation): string {
  const escapeHtml = (text: string) => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/\n/g, '<br>');
  };

  const messages = conversation.messages.map(m => `
    <div class="message ${m.role}">
      <div class="role">${m.role === 'user' ? 'User' : 'Assistant'}</div>
      <div class="content">${escapeHtml(m.content)}</div>
      <div class="timestamp">${new Date(m.createdAt).toLocaleString()}</div>
    </div>
  `).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(conversation.title)}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { border-bottom: 1px solid #ccc; padding-bottom: 10px; }
    .meta { color: #666; margin-bottom: 20px; }
    .message { margin: 20px 0; padding: 15px; border-radius: 8px; }
    .message.user { background: #e3f2fd; }
    .message.assistant { background: #f5f5f5; }
    .role { font-weight: bold; margin-bottom: 5px; }
    .content { white-space: pre-wrap; }
    .timestamp { font-size: 12px; color: #999; margin-top: 10px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(conversation.title)}</h1>
  <div class="meta">
    <p><strong>Model:</strong> ${escapeHtml(conversation.model)}</p>
    <p><strong>Date:</strong> ${new Date(conversation.createdAt).toLocaleDateString()}</p>
  </div>
  ${messages}
</body>
</html>`;
}

// =============================================================================
// Import/Export Service Class
// =============================================================================

export class ImportExportService {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Detect import format from data
   */
  detectFormat(data: unknown): ImportFormat {
    if (!data || typeof data !== 'object') {
      return 'json';
    }

    // If it's an array, check the first element
    if (Array.isArray(data)) {
      if (data.length === 0) return 'json';
      return this.detectFormat(data[0]);
    }

    const obj = data as Record<string, unknown>;

    // ChatGPT format has 'mapping' with message tree
    if (obj.mapping && typeof obj.mapping === 'object') {
      return 'chatgpt';
    }

    // LibreChat format has 'conversationId' and 'endpoint'
    if (obj.conversationId && obj.endpoint) {
      return 'librechat';
    }

    // Chatbot UI format has 'history' array
    if (Array.isArray(obj.history)) {
      return 'chatbot-ui';
    }

    return 'json';
  }

  /**
   * Parse imported data based on format
   */
  parseImport(data: unknown, format?: ImportFormat): ImportedConversation[] {
    const detectedFormat = format || this.detectFormat(data);

    switch (detectedFormat) {
      case 'chatgpt':
        // ChatGPT exports can be single or array
        if (Array.isArray(data)) {
          return data.map(d => parseChatGPTExport(d as ChatGPTExport));
        }
        return [parseChatGPTExport(data as ChatGPTExport)];

      case 'librechat':
        if (Array.isArray(data)) {
          return data.map(d => parseLibreChatExport(d as LibreChatExport));
        }
        return [parseLibreChatExport(data as LibreChatExport)];

      case 'chatbot-ui':
        return parseChatbotUIExport(data as ChatbotUIExport);

      case 'json':
      default:
        // Generic JSON format
        if (Array.isArray(data)) {
          return data as ImportedConversation[];
        }
        return [data as ImportedConversation];
    }
  }

  /**
   * Import a single conversation
   */
  async importConversation(
    userId: string,
    conversation: ImportedConversation & { originalId?: string; isArchived?: boolean; systemMessage?: string }
  ): Promise<ImportResult> {
    try {
      // Skip empty conversations
      if (!conversation.messages || conversation.messages.length === 0) {
        return {
          success: false,
          title: conversation.title,
          error: 'No messages in conversation',
          messagesImported: 0,
          systemMessage: conversation.systemMessage,
        };
      }

      // Use original ID if available to prevent duplicates
      const conversationId = conversation.originalId || crypto.randomUUID();
      
      // Check if already imported
      const existing = await this.db
        .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
        .bind(conversationId, userId)
        .first();
      
      if (existing) {
        return {
          success: false,
          title: conversation.title,
          error: 'Conversation already imported',
          messagesImported: 0,
          systemMessage: conversation.systemMessage,
        };
      }

      // Create conversation
      const conv = await conversationsDb.create(this.db, {
        id: conversationId,
        userId,
        title: conversation.title || 'Imported Conversation',
        model: conversation.model || 'gpt-4o',
        endpoint: conversation.endpoint || 'openai',
        isArchived: conversation.isArchived ? 1 : 0,
      });

      // Create messages
      let parentMessageId: string | undefined = undefined;
      let messagesImported = 0;

      for (const msg of conversation.messages) {
        const messageId = crypto.randomUUID();
        const message = await messagesDb.create(this.db, {
          id: messageId,
          conversationId: conv.id,
          parentMessageId,
          role: msg.role,
          content: msg.content,
        });
        parentMessageId = message.id;
        messagesImported++;
      }

      return {
        success: true,
        conversationId: conv.id,
        title: conversation.title,
        messagesImported,
        systemMessage: conversation.systemMessage,
      };
    } catch (error) {
      return {
        success: false,
        title: conversation.title,
        error: error instanceof Error ? error.message : 'Import failed',
        messagesImported: 0,
        systemMessage: conversation.systemMessage,
      };
    }
  }

  /**
   * Simple hash for deduplication
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Import multiple conversations
   */
  async importBulk(
    userId: string,
    data: unknown,
    format?: ImportFormat
  ): Promise<BulkImportResult> {
    const conversations = this.parseImport(data, format);
    const results: ImportResult[] = [];
    
    // Track unique profiles for deduplication
    const profileMap = new Map<string, ExtractedProfile>();

    for (const conv of conversations) {
      // Extract and deduplicate system message before import
      const systemMessage = (conv as { systemMessage?: string }).systemMessage;
      let profileId: string | undefined;
      
      if (systemMessage) {
        profileId = this.hashString(systemMessage);
        
        if (!profileMap.has(profileId)) {
          profileMap.set(profileId, {
            id: profileId,
            content: systemMessage,
            conversationCount: 1,
            firstSeen: conv.title,
          });
        } else {
          const existing = profileMap.get(profileId)!;
          existing.conversationCount++;
        }
      }
      
      // Import conversation (without system message in individual results to save space)
      const result = await this.importConversation(userId, conv);
      
      // Replace full system message with just the profile ID reference
      if (profileId) {
        result.systemMessage = `profile:${profileId}`;
      }
      
      results.push(result);
    }

    // Convert profile map to array, sorted by usage count
    const uniqueProfiles = Array.from(profileMap.values())
      .sort((a, b) => b.conversationCount - a.conversationCount);

    return {
      total: conversations.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      withSystemMessage: results.filter(r => r.systemMessage).length,
      uniqueProfiles,
      results,
    };
  }

  /**
   * Export a conversation
   */
  async exportConversation(
    conversationId: string,
    userId: string,
    format: ExportFormat = 'json'
  ): Promise<{ data: string; contentType: string; filename: string }> {
    // Get conversation
    const conversation = await conversationsDb.findById(this.db, conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new Error('Conversation not found');
    }

    // Get messages (with tenant isolation)
    const messages = await messagesDb.findByConversation(this.db, conversationId, userId);

    const exported: ExportedConversation = {
      id: conversation.id,
      title: conversation.title,
      model: conversation.model,
      endpoint: conversation.endpoint,
      messages: messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };

    const safeTitle = conversation.title.replace(/[^a-z0-9]/gi, '_').slice(0, 50);

    switch (format) {
      case 'markdown':
        return {
          data: formatAsMarkdown(exported),
          contentType: 'text/markdown',
          filename: `${safeTitle}.md`,
        };

      case 'text':
        return {
          data: formatAsText(exported),
          contentType: 'text/plain',
          filename: `${safeTitle}.txt`,
        };

      case 'html':
        return {
          data: formatAsHTML(exported),
          contentType: 'text/html',
          filename: `${safeTitle}.html`,
        };

      case 'json':
      default:
        return {
          data: JSON.stringify(exported, null, 2),
          contentType: 'application/json',
          filename: `${safeTitle}.json`,
        };
    }
  }

  /**
   * Export multiple conversations
   */
  async exportBulk(
    conversationIds: string[],
    userId: string
  ): Promise<{ data: string; contentType: string; filename: string }> {
    const exports: ExportedConversation[] = [];

    for (const id of conversationIds) {
      try {
        const conversation = await conversationsDb.findById(this.db, id);
        if (!conversation || conversation.userId !== userId) continue;

        const messages = await messagesDb.findByConversation(this.db, id, userId);

        exports.push({
          id: conversation.id,
          title: conversation.title,
          model: conversation.model,
          endpoint: conversation.endpoint,
          messages: messages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.createdAt,
          })),
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        });
      } catch {
        // Skip failed conversations
      }
    }

    const date = new Date().toISOString().split('T')[0];
    return {
      data: JSON.stringify(exports, null, 2),
      contentType: 'application/json',
      filename: `conversations_export_${date}.json`,
    };
  }

  /**
   * Export all user conversations
   */
  async exportAll(userId: string): Promise<{ data: string; contentType: string; filename: string }> {
    const result = await conversationsDb.findByUser(this.db, userId, { limit: 1000 });
    const ids = result.conversations.map(c => c.id);
    return this.exportBulk(ids, userId);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createImportExportService(db: D1Database): ImportExportService {
  return new ImportExportService(db);
}
