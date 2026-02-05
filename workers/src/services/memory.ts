/**
 * Memory Service
 * Provides persistent memory/context across conversations.
 * 
 * Features:
 * - User facts: Personal information the user has shared
 * - Preferences: User preferences for interactions
 * - Project context: Information about ongoing projects
 * - Custom memories: User-defined memory entries
 * - Automatic memory extraction from conversations
 */

// =============================================================================
// Types
// =============================================================================

export type MemoryType = 
  | 'fact'        // User facts (name, location, job, etc.)
  | 'preference'  // User preferences (communication style, etc.)
  | 'project'     // Project/work context
  | 'instruction' // Standing instructions
  | 'custom';     // User-defined memories

export interface Memory {
  id: string;
  userId: string;
  type: MemoryType;
  key: string;
  value: string;
  metadata?: Record<string, unknown>;
  source?: 'auto' | 'user' | 'agent';
  conversationId?: string;
  importance: number; // 0-1, higher = more important
  lastAccessedAt: string;
  accessCount: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface MemorySearchResult {
  memory: Memory;
  score: number;
}

export interface CreateMemoryInput {
  type: MemoryType;
  key: string;
  value: string;
  metadata?: Record<string, unknown>;
  source?: 'auto' | 'user' | 'agent';
  conversationId?: string;
  importance?: number;
  expiresAt?: string;
}

export interface UpdateMemoryInput {
  value?: string;
  metadata?: Record<string, unknown>;
  importance?: number;
  expiresAt?: string;
}

export interface MemoryContext {
  facts: Memory[];
  preferences: Memory[];
  projects: Memory[];
  instructions: Memory[];
  recent: Memory[];
  contextText: string;
}

// =============================================================================
// Memory Extraction Patterns
// =============================================================================

const EXTRACTION_PATTERNS = {
  name: [
    /my name is (\w+)/i,
    /i'm (\w+)/i,
    /call me (\w+)/i,
    /i am (\w+)/i,
  ],
  location: [
    /i live in ([^,.]+)/i,
    /i'm from ([^,.]+)/i,
    /i'm based in ([^,.]+)/i,
    /i'm located in ([^,.]+)/i,
  ],
  job: [
    /i work as a ([^,.]+)/i,
    /i'm a ([^,.]+) (?:developer|engineer|designer|manager)/i,
    /my job is ([^,.]+)/i,
    /i'm employed as ([^,.]+)/i,
  ],
  preference: [
    /i prefer ([^,.]+)/i,
    /i like ([^,.]+)/i,
    /i always want ([^,.]+)/i,
    /please always ([^,.]+)/i,
  ],
  project: [
    /i'm working on ([^,.]+)/i,
    /my project is ([^,.]+)/i,
    /the project is called ([^,.]+)/i,
    /we're building ([^,.]+)/i,
  ],
  instruction: [
    /always remember (?:that )?(.+)/i,
    /don't forget (?:that )?(.+)/i,
    /keep in mind (?:that )?(.+)/i,
    /note that (.+)/i,
  ],
};

// =============================================================================
// Memory Service Class
// =============================================================================

export class MemoryService {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Create a new memory
   */
  async create(userId: string, input: CreateMemoryInput): Promise<Memory> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Check for existing memory with same key
    const existing = await this.getByKey(userId, input.type, input.key);
    if (existing) {
      // Update existing memory instead
      return this.update(existing.id, userId, {
        value: input.value,
        metadata: input.metadata,
        importance: input.importance,
      }) as Promise<Memory>;
    }

    await this.db
      .prepare(`
        INSERT INTO memories (id, user_id, type, key, value, metadata, source, conversation_id, importance, last_accessed_at, access_count, created_at, updated_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      `)
      .bind(
        id,
        userId,
        input.type,
        input.key,
        input.value,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.source || 'user',
        input.conversationId || null,
        input.importance ?? 0.5,
        now,
        now,
        now,
        input.expiresAt || null
      )
      .run();

    return {
      id,
      userId,
      type: input.type,
      key: input.key,
      value: input.value,
      metadata: input.metadata,
      source: input.source || 'user',
      conversationId: input.conversationId,
      importance: input.importance ?? 0.5,
      lastAccessedAt: now,
      accessCount: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt,
    };
  }

  /**
   * Get memory by ID
   */
  async getById(id: string, userId: string): Promise<Memory | null> {
    const result = await this.db
      .prepare('SELECT * FROM memories WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<any>();

    if (!result) return null;

    // Update access stats
    await this.recordAccess(id);

    return this.mapMemory(result);
  }

  /**
   * Get memory by key
   */
  async getByKey(userId: string, type: MemoryType, key: string): Promise<Memory | null> {
    const result = await this.db
      .prepare('SELECT * FROM memories WHERE user_id = ? AND type = ? AND key = ?')
      .bind(userId, type, key)
      .first<any>();

    if (!result) return null;

    return this.mapMemory(result);
  }

  /**
   * List all memories for a user
   */
  async listByUser(userId: string, type?: MemoryType): Promise<Memory[]> {
    let query = 'SELECT * FROM memories WHERE user_id = ?';
    const params: unknown[] = [userId];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    // Exclude expired memories
    query += ' AND (expires_at IS NULL OR expires_at > datetime(\'now\'))';
    query += ' ORDER BY importance DESC, last_accessed_at DESC';

    const results = await this.db
      .prepare(query)
      .bind(...params)
      .all<any>();

    return results.results.map(this.mapMemory);
  }

  /**
   * Update a memory
   */
  async update(id: string, userId: string, input: UpdateMemoryInput): Promise<Memory | null> {
    const existing = await this.getById(id, userId);
    if (!existing) return null;

    const now = new Date().toISOString();
    const updates: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];

    if (input.value !== undefined) {
      updates.push('value = ?');
      values.push(input.value);
    }

    if (input.metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(JSON.stringify(input.metadata));
    }

    if (input.importance !== undefined) {
      updates.push('importance = ?');
      values.push(input.importance);
    }

    if (input.expiresAt !== undefined) {
      updates.push('expires_at = ?');
      values.push(input.expiresAt);
    }

    values.push(id, userId);

    await this.db
      .prepare(`UPDATE memories SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`)
      .bind(...values)
      .run();

    return this.getById(id, userId);
  }

  /**
   * Delete a memory
   */
  async delete(id: string, userId: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM memories WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .run();

    return result.meta.changes > 0;
  }

  /**
   * Delete all memories of a type
   */
  async deleteByType(userId: string, type: MemoryType): Promise<number> {
    const result = await this.db
      .prepare('DELETE FROM memories WHERE user_id = ? AND type = ?')
      .bind(userId, type)
      .run();

    return result.meta.changes;
  }

  /**
   * Clear all user memories
   */
  async clearAll(userId: string): Promise<number> {
    const result = await this.db
      .prepare('DELETE FROM memories WHERE user_id = ?')
      .bind(userId)
      .run();

    return result.meta.changes;
  }

  /**
   * Search memories by content
   */
  async search(userId: string, query: string, limit = 10): Promise<MemorySearchResult[]> {
    // Simple text search (could be enhanced with embeddings)
    const queryLower = query.toLowerCase();
    const memories = await this.listByUser(userId);

    const scored = memories
      .map(memory => {
        let score = 0;
        const keyLower = memory.key.toLowerCase();
        const valueLower = memory.value.toLowerCase();

        // Exact key match
        if (keyLower === queryLower) score += 1.0;
        // Key contains query
        else if (keyLower.includes(queryLower)) score += 0.7;
        // Value contains query
        if (valueLower.includes(queryLower)) score += 0.5;

        // Boost by importance
        score *= (0.5 + memory.importance * 0.5);

        // Boost recently accessed
        const daysSinceAccess = (Date.now() - new Date(memory.lastAccessedAt).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceAccess < 1) score *= 1.2;
        else if (daysSinceAccess < 7) score *= 1.1;

        return { memory, score };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  }

  /**
   * Get context for AI prompts
   */
  async getContext(userId: string, maxTokens = 1000): Promise<MemoryContext> {
    const all = await this.listByUser(userId);
    
    // Group by type
    const facts = all.filter(m => m.type === 'fact');
    const preferences = all.filter(m => m.type === 'preference');
    const projects = all.filter(m => m.type === 'project');
    const instructions = all.filter(m => m.type === 'instruction');
    
    // Get recently accessed (across all types)
    const recent = [...all]
      .sort((a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime())
      .slice(0, 5);

    // Build context text
    const contextText = this.buildContextText({
      facts,
      preferences,
      projects,
      instructions,
      recent,
    }, maxTokens);

    return {
      facts,
      preferences,
      projects,
      instructions,
      recent,
      contextText,
    };
  }

  /**
   * Extract memories from conversation text
   */
  async extractFromText(
    userId: string,
    text: string,
    conversationId?: string
  ): Promise<Memory[]> {
    const extracted: Memory[] = [];

    // Try each extraction pattern
    for (const [category, patterns] of Object.entries(EXTRACTION_PATTERNS)) {
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const value = match[1].trim();
          
          // Determine memory type
          let type: MemoryType = 'fact';
          let key = category;
          
          if (category === 'preference') {
            type = 'preference';
            key = `preference_${Date.now()}`;
          } else if (category === 'project') {
            type = 'project';
            key = `project_${value.slice(0, 20).toLowerCase().replace(/\s+/g, '_')}`;
          } else if (category === 'instruction') {
            type = 'instruction';
            key = `instruction_${Date.now()}`;
          }

          const memory = await this.create(userId, {
            type,
            key,
            value,
            source: 'auto',
            conversationId,
            importance: 0.6,
          });

          extracted.push(memory);
        }
      }
    }

    return extracted;
  }

  /**
   * Build context text from memories
   */
  private buildContextText(
    context: Omit<MemoryContext, 'contextText'>,
    maxTokens: number
  ): string {
    const lines: string[] = [];
    let estimatedTokens = 0;
    const tokensPerChar = 0.25; // Rough estimate

    const addLine = (line: string): boolean => {
      const tokens = line.length * tokensPerChar;
      if (estimatedTokens + tokens > maxTokens) return false;
      lines.push(line);
      estimatedTokens += tokens;
      return true;
    };

    // Add user facts
    if (context.facts.length > 0) {
      addLine('User Information:');
      for (const fact of context.facts.slice(0, 10)) {
        if (!addLine(`- ${fact.key}: ${fact.value}`)) break;
      }
      addLine('');
    }

    // Add preferences
    if (context.preferences.length > 0) {
      addLine('User Preferences:');
      for (const pref of context.preferences.slice(0, 5)) {
        if (!addLine(`- ${pref.value}`)) break;
      }
      addLine('');
    }

    // Add standing instructions
    if (context.instructions.length > 0) {
      addLine('Standing Instructions:');
      for (const inst of context.instructions.slice(0, 5)) {
        if (!addLine(`- ${inst.value}`)) break;
      }
      addLine('');
    }

    // Add active projects
    if (context.projects.length > 0) {
      addLine('Active Projects:');
      for (const proj of context.projects.slice(0, 3)) {
        if (!addLine(`- ${proj.key}: ${proj.value}`)) break;
      }
    }

    return lines.join('\n');
  }

  /**
   * Record memory access
   */
  private async recordAccess(id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare('UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?')
      .bind(now, id)
      .run();
  }

  /**
   * Clean up expired memories
   */
  async cleanupExpired(): Promise<number> {
    const result = await this.db
      .prepare("DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < datetime('now')")
      .run();

    return result.meta.changes;
  }

  /**
   * Map database row to Memory
   */
  private mapMemory(row: any): Memory {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type as MemoryType,
      key: row.key,
      value: row.value,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      source: row.source,
      conversationId: row.conversation_id,
      importance: row.importance,
      lastAccessedAt: row.last_accessed_at,
      accessCount: row.access_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create memory service instance
 */
export function createMemoryService(db: D1Database): MemoryService {
  return new MemoryService(db);
}

/**
 * Get system prompt for memory-aware conversations
 */
export function getMemorySystemPrompt(context: MemoryContext): string {
  if (!context.contextText.trim()) {
    return '';
  }

  return `You have access to the following information about the user. Use this context to personalize your responses when relevant.

<user_memory>
${context.contextText}
</user_memory>

Guidelines:
- Reference this information naturally when relevant
- Don't explicitly mention that you "remember" things unless asked
- Update your understanding based on new information the user shares
- Respect user privacy and don't over-reference personal details`;
}
