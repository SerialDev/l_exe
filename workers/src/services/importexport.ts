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
  error?: string;
  messagesImported: number;
}

export interface BulkImportResult {
  total: number;
  successful: number;
  failed: number;
  results: ImportResult[];
}

// =============================================================================
// ChatGPT Export Format
// =============================================================================

interface ChatGPTExport {
  title: string;
  create_time: number;
  update_time: number;
  mapping: Record<string, {
    id: string;
    message?: {
      id: string;
      author: {
        role: 'user' | 'assistant' | 'system';
      };
      content: {
        content_type: string;
        parts?: string[];
        text?: string;
      };
      create_time?: number;
    };
    parent?: string;
    children: string[];
  }>;
  conversation_id?: string;
}

function parseChatGPTExport(data: ChatGPTExport): ImportedConversation {
  const messages: ImportedConversation['messages'] = [];
  
  // Build message tree
  const mapping = data.mapping;
  const processed = new Set<string>();
  
  function processNode(nodeId: string) {
    if (processed.has(nodeId)) return;
    processed.add(nodeId);
    
    const node = mapping[nodeId];
    if (!node) return;
    
    if (node.message && node.message.content) {
      const content = node.message.content.parts?.join('\n') || 
                     node.message.content.text || 
                     '';
      
      if (content.trim() && node.message.author.role !== 'system') {
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
  
  return {
    title: data.title || 'Imported Conversation',
    messages,
    createdAt: data.create_time 
      ? new Date(data.create_time * 1000).toISOString()
      : new Date().toISOString(),
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
    conversation: ImportedConversation
  ): Promise<ImportResult> {
    try {
      // Create conversation
      const conversationId = crypto.randomUUID();
      const conv = await conversationsDb.create(this.db, {
        id: conversationId,
        userId,
        title: conversation.title || 'Imported Conversation',
        model: conversation.model || 'gpt-4o',
        endpoint: conversation.endpoint || 'openai',
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
        messagesImported,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Import failed',
        messagesImported: 0,
      };
    }
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

    for (const conv of conversations) {
      const result = await this.importConversation(userId, conv);
      results.push(result);
    }

    return {
      total: conversations.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
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

    // Get messages
    const messages = await messagesDb.findByConversation(this.db, conversationId);

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

        const messages = await messagesDb.findByConversation(this.db, id);

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
