/**
 * Conversation Search Service
 * Full-text search across conversations and messages.
 * 
 * Uses SQLite FTS5 for efficient text search on D1.
 */

import * as conversationsDb from '../db/conversations';
import * as messagesDb from '../db/messages';

// =============================================================================
// Types
// =============================================================================

export interface SearchResult {
  type: 'conversation' | 'message';
  conversationId: string;
  conversationTitle: string;
  messageId?: string;
  content: string;
  snippet: string;
  role?: string;
  score: number;
  createdAt: string;
  highlights: string[];
}

export interface SearchOptions {
  query: string;
  userId: string;
  limit?: number;
  offset?: number;
  searchIn?: ('titles' | 'messages' | 'both')[];
  dateFrom?: string;
  dateTo?: string;
  endpoint?: string;
  model?: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  total: number;
  hasMore: boolean;
}

// =============================================================================
// Search Helpers
// =============================================================================

/**
 * Escape special FTS5 characters
 */
function escapeFTS5Query(query: string): string {
  // Escape special characters and wrap in quotes for phrase search
  return query
    .replace(/"/g, '""')
    .split(/\s+/)
    .filter(term => term.length > 0)
    .map(term => `"${term}"`)
    .join(' OR ');
}

/**
 * Generate snippet with highlights
 */
function generateSnippet(content: string, query: string, maxLength: number = 200): { snippet: string; highlights: string[] } {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const contentLower = content.toLowerCase();
  const highlights: string[] = [];
  
  // Find the best position to start the snippet
  let bestPos = 0;
  let bestScore = 0;
  
  for (const term of terms) {
    const pos = contentLower.indexOf(term);
    if (pos !== -1) {
      // Score based on how early the match is
      const score = 1 / (pos + 1);
      if (score > bestScore) {
        bestScore = score;
        bestPos = Math.max(0, pos - 50);
      }
      highlights.push(term);
    }
  }
  
  // Extract snippet
  let snippet = content.slice(bestPos, bestPos + maxLength);
  
  // Add ellipsis if needed
  if (bestPos > 0) snippet = '...' + snippet;
  if (bestPos + maxLength < content.length) snippet += '...';
  
  return { snippet, highlights };
}

/**
 * Calculate relevance score
 */
function calculateScore(content: string, query: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  const contentLower = content.toLowerCase();
  
  let score = 0;
  for (const term of terms) {
    // Count occurrences
    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = content.match(regex);
    if (matches) {
      score += matches.length;
      // Bonus for exact word match
      const wordRegex = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      const wordMatches = content.match(wordRegex);
      if (wordMatches) {
        score += wordMatches.length * 2;
      }
    }
  }
  
  // Normalize by content length
  score = score / Math.sqrt(content.length);
  
  return score;
}

// =============================================================================
// Conversation Search Service
// =============================================================================

export class ConversationSearchService {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Search conversations and messages
   */
  async search(options: SearchOptions): Promise<SearchResponse> {
    const {
      query,
      userId,
      limit = 20,
      offset = 0,
      searchIn = ['both'],
      dateFrom,
      dateTo,
      endpoint,
      model,
    } = options;

    if (!query.trim()) {
      return { query, results: [], total: 0, hasMore: false };
    }

    const results: SearchResult[] = [];
    const searchTitles = searchIn.includes('titles') || searchIn.includes('both');
    const searchMessages = searchIn.includes('messages') || searchIn.includes('both');

    // Search conversation titles
    if (searchTitles) {
      const titleResults = await this.searchConversationTitles(
        query, userId, dateFrom, dateTo, endpoint, model
      );
      results.push(...titleResults);
    }

    // Search message content
    if (searchMessages) {
      const messageResults = await this.searchMessages(
        query, userId, dateFrom, dateTo, endpoint, model
      );
      results.push(...messageResults);
    }

    // Sort by score and apply pagination
    results.sort((a, b) => b.score - a.score);
    const total = results.length;
    const paginatedResults = results.slice(offset, offset + limit);

    return {
      query,
      results: paginatedResults,
      total,
      hasMore: offset + limit < total,
    };
  }

  /**
   * Search conversation titles
   */
  private async searchConversationTitles(
    query: string,
    userId: string,
    dateFrom?: string,
    dateTo?: string,
    endpoint?: string,
    model?: string
  ): Promise<SearchResult[]> {
    let sql = `
      SELECT id, title, endpoint, model, created_at
      FROM conversations
      WHERE user_id = ? AND title LIKE ?
    `;
    const params: unknown[] = [userId, `%${query}%`];

    if (dateFrom) {
      sql += ' AND created_at >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += ' AND created_at <= ?';
      params.push(dateTo);
    }
    if (endpoint) {
      sql += ' AND endpoint = ?';
      params.push(endpoint);
    }
    if (model) {
      sql += ' AND model = ?';
      params.push(model);
    }

    sql += ' ORDER BY created_at DESC LIMIT 100';

    const conversations = await this.db
      .prepare(sql)
      .bind(...params)
      .all<any>();

    return conversations.results.map(conv => {
      const { snippet, highlights } = generateSnippet(conv.title, query, 100);
      return {
        type: 'conversation' as const,
        conversationId: conv.id,
        conversationTitle: conv.title,
        content: conv.title,
        snippet,
        score: calculateScore(conv.title, query) * 1.5, // Boost title matches
        createdAt: conv.created_at,
        highlights,
      };
    });
  }

  /**
   * Search message content
   */
  private async searchMessages(
    query: string,
    userId: string,
    dateFrom?: string,
    dateTo?: string,
    endpoint?: string,
    model?: string
  ): Promise<SearchResult[]> {
    let sql = `
      SELECT m.id, m.conversation_id, m.content, m.role, m.created_at,
             c.title as conversation_title
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.user_id = ? AND m.content LIKE ?
    `;
    const params: unknown[] = [userId, `%${query}%`];

    if (dateFrom) {
      sql += ' AND m.created_at >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += ' AND m.created_at <= ?';
      params.push(dateTo);
    }
    if (endpoint) {
      sql += ' AND c.endpoint = ?';
      params.push(endpoint);
    }
    if (model) {
      sql += ' AND c.model = ?';
      params.push(model);
    }

    sql += ' ORDER BY m.created_at DESC LIMIT 200';

    const messages = await this.db
      .prepare(sql)
      .bind(...params)
      .all<any>();

    return messages.results.map(msg => {
      const { snippet, highlights } = generateSnippet(msg.content, query, 200);
      return {
        type: 'message' as const,
        conversationId: msg.conversation_id,
        conversationTitle: msg.conversation_title,
        messageId: msg.id,
        content: msg.content,
        snippet,
        role: msg.role,
        score: calculateScore(msg.content, query),
        createdAt: msg.created_at,
        highlights,
      };
    });
  }

  /**
   * Get search suggestions based on recent conversations
   */
  async getSuggestions(userId: string, partialQuery: string, limit: number = 5): Promise<string[]> {
    if (partialQuery.length < 2) return [];

    // Get recent conversation titles matching the partial query
    const results = await this.db
      .prepare(`
        SELECT DISTINCT title
        FROM conversations
        WHERE user_id = ? AND title LIKE ?
        ORDER BY updated_at DESC
        LIMIT ?
      `)
      .bind(userId, `%${partialQuery}%`, limit)
      .all<any>();

    return results.results.map(r => r.title);
  }

  /**
   * Get popular search terms (for autocomplete)
   */
  async getPopularTerms(userId: string, limit: number = 10): Promise<string[]> {
    // Extract common words from recent conversations
    const conversations = await this.db
      .prepare(`
        SELECT title FROM conversations
        WHERE user_id = ?
        ORDER BY updated_at DESC
        LIMIT 50
      `)
      .bind(userId)
      .all<any>();

    const wordCounts = new Map<string, number>();
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'from', 'in', 'on', 'at', 'for', 'of', 'and', 'or', 'but']);

    for (const conv of conversations.results) {
      const words = conv.title.toLowerCase().split(/\s+/);
      for (const word of words) {
        if (word.length > 2 && !stopWords.has(word)) {
          wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
        }
      }
    }

    return Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([word]) => word);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createConversationSearchService(db: D1Database): ConversationSearchService {
  return new ConversationSearchService(db);
}
