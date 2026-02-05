/**
 * Artifacts Service
 * Handles creation and management of AI-generated artifacts.
 * 
 * Artifacts are special content blocks that can be rendered by the frontend:
 * - React components (live preview)
 * - HTML/CSS (sandboxed iframe)
 * - Mermaid diagrams (flowcharts, sequence diagrams, etc.)
 * - SVG graphics
 * - Markdown documents
 * - Code snippets with syntax highlighting
 * - Charts (using Chart.js or similar)
 */

// =============================================================================
// Types
// =============================================================================

export type ArtifactType = 
  | 'react'
  | 'html'
  | 'mermaid'
  | 'svg'
  | 'markdown'
  | 'code'
  | 'chart'
  | 'table'
  | 'image';

export interface Artifact {
  id: string;
  type: ArtifactType;
  title: string;
  content: string;
  language?: string; // For code artifacts
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  messageId?: string;
  conversationId?: string;
  userId: string;
  version: number;
  parentId?: string; // For versioning
}

export interface ArtifactVersion {
  id: string;
  artifactId: string;
  version: number;
  content: string;
  title: string;
  createdAt: string;
  changes?: string;
}

export interface CreateArtifactInput {
  type: ArtifactType;
  title: string;
  content: string;
  language?: string;
  metadata?: Record<string, unknown>;
  messageId?: string;
  conversationId?: string;
}

export interface UpdateArtifactInput {
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface ParsedArtifact {
  type: ArtifactType;
  title: string;
  content: string;
  language?: string;
  identifier?: string;
}

// =============================================================================
// Artifact Detection Patterns
// =============================================================================

/**
 * Pattern to detect artifact blocks in AI responses
 * Format: <artifact type="react" title="My Component" identifier="comp-1">...</artifact>
 */
const ARTIFACT_PATTERN = /<artifact\s+(?:[^>]*?\s+)?type="([^"]+)"(?:\s+[^>]*?)?\s*(?:title="([^"]*)")?(?:\s+[^>]*?)?\s*(?:identifier="([^"]*)")?[^>]*>([\s\S]*?)<\/artifact>/gi;

/**
 * Alternative pattern for markdown-style artifacts
 * Format: ```artifact:react title="My Component"
 */
const MARKDOWN_ARTIFACT_PATTERN = /```artifact:(\w+)(?:\s+title="([^"]*)")?(?:\s+identifier="([^"]*)")?\n([\s\S]*?)```/gi;

/**
 * Pattern for Mermaid diagrams (common in markdown)
 */
const MERMAID_PATTERN = /```mermaid\n([\s\S]*?)```/gi;

// =============================================================================
// Artifact Parsing
// =============================================================================

/**
 * Parse artifacts from AI response text
 */
export function parseArtifacts(text: string): ParsedArtifact[] {
  const artifacts: ParsedArtifact[] = [];
  
  // Parse XML-style artifacts
  let match;
  const xmlPattern = new RegExp(ARTIFACT_PATTERN.source, 'gi');
  while ((match = xmlPattern.exec(text)) !== null) {
    artifacts.push({
      type: match[1].toLowerCase() as ArtifactType,
      title: match[2] || `Untitled ${match[1]}`,
      identifier: match[3],
      content: match[4].trim(),
    });
  }

  // Parse markdown-style artifacts
  const mdPattern = new RegExp(MARKDOWN_ARTIFACT_PATTERN.source, 'gi');
  while ((match = mdPattern.exec(text)) !== null) {
    artifacts.push({
      type: match[1].toLowerCase() as ArtifactType,
      title: match[2] || `Untitled ${match[1]}`,
      identifier: match[3],
      content: match[4].trim(),
    });
  }

  // Parse standalone Mermaid diagrams
  const mermaidPattern = new RegExp(MERMAID_PATTERN.source, 'gi');
  while ((match = mermaidPattern.exec(text)) !== null) {
    // Check if not already captured
    const content = match[1].trim();
    const alreadyExists = artifacts.some(a => a.type === 'mermaid' && a.content === content);
    if (!alreadyExists) {
      artifacts.push({
        type: 'mermaid',
        title: 'Diagram',
        content,
      });
    }
  }

  return artifacts;
}

/**
 * Remove artifact blocks from text, leaving markers
 */
export function stripArtifacts(text: string): string {
  let result = text;
  
  // Replace XML-style artifacts with markers
  result = result.replace(ARTIFACT_PATTERN, (_, type, title) => {
    return `[Artifact: ${title || type}]`;
  });

  // Replace markdown-style artifacts with markers
  result = result.replace(MARKDOWN_ARTIFACT_PATTERN, (_, type, title) => {
    return `[Artifact: ${title || type}]`;
  });

  return result;
}

/**
 * Extract the text content without artifacts
 */
export function extractTextContent(text: string): string {
  let result = text;
  
  // Remove XML-style artifacts
  result = result.replace(ARTIFACT_PATTERN, '');
  
  // Remove markdown-style artifacts
  result = result.replace(MARKDOWN_ARTIFACT_PATTERN, '');
  
  // Clean up extra whitespace
  result = result.replace(/\n{3,}/g, '\n\n').trim();
  
  return result;
}

// =============================================================================
// Artifact Validation
// =============================================================================

/**
 * Validate artifact content based on type
 */
export function validateArtifact(artifact: ParsedArtifact): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!artifact.content || artifact.content.trim().length === 0) {
    errors.push('Artifact content is empty');
  }

  switch (artifact.type) {
    case 'react':
      // Check for basic React component structure
      if (!artifact.content.includes('return') && !artifact.content.includes('=>')) {
        errors.push('React artifact should contain a component with a return statement');
      }
      break;

    case 'html':
      // Basic HTML validation
      if (!artifact.content.includes('<') || !artifact.content.includes('>')) {
        errors.push('HTML artifact should contain HTML tags');
      }
      break;

    case 'mermaid':
      // Check for Mermaid diagram type
      const mermaidTypes = ['graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'erDiagram', 'gantt', 'pie', 'journey', 'gitGraph'];
      const hasValidType = mermaidTypes.some(t => artifact.content.toLowerCase().startsWith(t.toLowerCase()));
      if (!hasValidType) {
        errors.push(`Mermaid diagram should start with a valid type: ${mermaidTypes.join(', ')}`);
      }
      break;

    case 'svg':
      if (!artifact.content.includes('<svg') || !artifact.content.includes('</svg>')) {
        errors.push('SVG artifact should contain valid SVG markup');
      }
      break;

    case 'chart':
      // Chart should be valid JSON configuration
      try {
        JSON.parse(artifact.content);
      } catch {
        errors.push('Chart artifact should contain valid JSON configuration');
      }
      break;

    case 'table':
      // Table should have some structure
      if (!artifact.content.includes('|') && !artifact.content.includes('<table')) {
        errors.push('Table artifact should contain markdown or HTML table');
      }
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// =============================================================================
// Artifact Service Class
// =============================================================================

export class ArtifactService {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * Create a new artifact
   */
  async create(userId: string, input: CreateArtifactInput): Promise<Artifact> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db
      .prepare(`
        INSERT INTO artifacts (id, user_id, type, title, content, language, metadata, message_id, conversation_id, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `)
      .bind(
        id,
        userId,
        input.type,
        input.title,
        input.content,
        input.language || null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.messageId || null,
        input.conversationId || null,
        now,
        now
      )
      .run();

    // Store initial version
    await this.createVersion(id, 1, input.content, input.title, 'Initial version');

    return {
      id,
      userId,
      type: input.type,
      title: input.title,
      content: input.content,
      language: input.language,
      metadata: input.metadata,
      messageId: input.messageId,
      conversationId: input.conversationId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get artifact by ID
   */
  async getById(id: string, userId: string): Promise<Artifact | null> {
    const result = await this.db
      .prepare('SELECT * FROM artifacts WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<any>();

    if (!result) return null;

    return this.mapArtifact(result);
  }

  /**
   * List artifacts for a conversation
   */
  async listByConversation(conversationId: string, userId: string): Promise<Artifact[]> {
    const results = await this.db
      .prepare('SELECT * FROM artifacts WHERE conversation_id = ? AND user_id = ? ORDER BY created_at DESC')
      .bind(conversationId, userId)
      .all<any>();

    return results.results.map(this.mapArtifact);
  }

  /**
   * List artifacts for a message
   */
  async listByMessage(messageId: string, userId: string): Promise<Artifact[]> {
    const results = await this.db
      .prepare('SELECT * FROM artifacts WHERE message_id = ? AND user_id = ? ORDER BY created_at')
      .bind(messageId, userId)
      .all<any>();

    return results.results.map(this.mapArtifact);
  }

  /**
   * List all user artifacts
   */
  async listByUser(userId: string, limit = 50, offset = 0): Promise<Artifact[]> {
    const results = await this.db
      .prepare('SELECT * FROM artifacts WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?')
      .bind(userId, limit, offset)
      .all<any>();

    return results.results.map(this.mapArtifact);
  }

  /**
   * Update an artifact
   */
  async update(id: string, userId: string, input: UpdateArtifactInput): Promise<Artifact | null> {
    const existing = await this.getById(id, userId);
    if (!existing) return null;

    const now = new Date().toISOString();
    const newVersion = existing.version + 1;
    
    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.title !== undefined) {
      updates.push('title = ?');
      values.push(input.title);
    }

    if (input.content !== undefined) {
      updates.push('content = ?');
      values.push(input.content);
    }

    if (input.metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(JSON.stringify(input.metadata));
    }

    updates.push('version = ?');
    values.push(newVersion);

    updates.push('updated_at = ?');
    values.push(now);

    values.push(id, userId);

    await this.db
      .prepare(`UPDATE artifacts SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`)
      .bind(...values)
      .run();

    // Store version history
    if (input.content !== undefined) {
      await this.createVersion(
        id,
        newVersion,
        input.content,
        input.title || existing.title,
        `Version ${newVersion}`
      );
    }

    return this.getById(id, userId);
  }

  /**
   * Delete an artifact
   */
  async delete(id: string, userId: string): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM artifacts WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .run();

    // Also delete version history (tenant isolation via artifact ownership already verified above)
    // Only delete versions if the artifact delete succeeded (confirming ownership)
    if (result.meta.changes > 0) {
      await this.db
        .prepare('DELETE FROM artifact_versions WHERE artifact_id = ? AND artifact_id IN (SELECT id FROM artifacts WHERE user_id = ?)')
        .bind(id, userId)
        .run();
    }

    return result.meta.changes > 0;
  }

  /**
   * Get version history for an artifact
   */
  async getVersions(artifactId: string, userId: string): Promise<ArtifactVersion[]> {
    // First verify user owns the artifact
    const artifact = await this.getById(artifactId, userId);
    if (!artifact) return [];

    const results = await this.db
      .prepare('SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version DESC')
      .bind(artifactId)
      .all<any>();

    return results.results.map(r => ({
      id: r.id,
      artifactId: r.artifact_id,
      version: r.version,
      content: r.content,
      title: r.title,
      createdAt: r.created_at,
      changes: r.changes,
    }));
  }

  /**
   * Restore a specific version
   */
  async restoreVersion(artifactId: string, version: number, userId: string): Promise<Artifact | null> {
    const versions = await this.getVersions(artifactId, userId);
    const targetVersion = versions.find(v => v.version === version);
    
    if (!targetVersion) return null;

    return this.update(artifactId, userId, {
      content: targetVersion.content,
      title: targetVersion.title,
    });
  }

  /**
   * Create artifacts from AI response
   */
  async createFromResponse(
    userId: string,
    messageId: string,
    conversationId: string,
    responseText: string
  ): Promise<Artifact[]> {
    const parsed = parseArtifacts(responseText);
    const artifacts: Artifact[] = [];

    for (const parsedArtifact of parsed) {
      const validation = validateArtifact(parsedArtifact);
      if (!validation.valid) {
        console.warn(`[Artifacts] Invalid artifact skipped: ${validation.errors.join(', ')}`);
        continue;
      }

      const artifact = await this.create(userId, {
        type: parsedArtifact.type,
        title: parsedArtifact.title,
        content: parsedArtifact.content,
        language: parsedArtifact.language,
        messageId,
        conversationId,
      });

      artifacts.push(artifact);
    }

    return artifacts;
  }

  /**
   * Store version history
   */
  private async createVersion(
    artifactId: string,
    version: number,
    content: string,
    title: string,
    changes?: string
  ): Promise<void> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.db
      .prepare(`
        INSERT INTO artifact_versions (id, artifact_id, version, content, title, changes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(id, artifactId, version, content, title, changes || null, now)
      .run();
  }

  /**
   * Map database row to Artifact
   */
  private mapArtifact(row: any): Artifact {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type as ArtifactType,
      title: row.title,
      content: row.content,
      language: row.language,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      messageId: row.message_id,
      conversationId: row.conversation_id,
      version: row.version,
      parentId: row.parent_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create artifact service instance
 */
export function createArtifactService(db: D1Database): ArtifactService {
  return new ArtifactService(db);
}

/**
 * Generate system prompt instructions for artifact creation
 */
export function getArtifactSystemPrompt(): string {
  return `You can create interactive artifacts that will be rendered in the UI. Use this format:

<artifact type="TYPE" title="Title">
content here
</artifact>

Available types:
- react: React component (will be rendered live)
- html: HTML/CSS content (sandboxed iframe)
- mermaid: Mermaid diagram (flowchart, sequence, etc.)
- svg: SVG graphics
- markdown: Formatted markdown document
- code: Syntax-highlighted code snippet
- chart: Chart.js configuration (JSON)
- table: Data table

Example React component:
<artifact type="react" title="Counter">
function Counter() {
  const [count, setCount] = React.useState(0);
  return (
    <div className="p-4">
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>Increment</button>
    </div>
  );
}
</artifact>

Example Mermaid diagram:
<artifact type="mermaid" title="Flow">
flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
</artifact>

Use artifacts when the user asks for:
- Interactive demos or visualizations
- Diagrams or flowcharts
- HTML/CSS previews
- Data visualizations
- Code examples that benefit from syntax highlighting`;
}
