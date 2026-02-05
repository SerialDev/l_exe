/**
 * Automated Moderation Service
 * Content moderation for user messages and AI responses.
 * 
 * Features:
 * - OpenAI Moderation API integration
 * - Custom word filters
 * - Rate limiting for abuse prevention
 * - Logging for review
 */

// =============================================================================
// Types
// =============================================================================

export interface ModerationResult {
  flagged: boolean;
  categories: ModerationCategories;
  categoryScores: ModerationCategoryScores;
  blockedReason?: string;
}

export interface ModerationCategories {
  hate: boolean;
  'hate/threatening': boolean;
  harassment: boolean;
  'harassment/threatening': boolean;
  'self-harm': boolean;
  'self-harm/intent': boolean;
  'self-harm/instructions': boolean;
  sexual: boolean;
  'sexual/minors': boolean;
  violence: boolean;
  'violence/graphic': boolean;
}

export interface ModerationCategoryScores {
  hate: number;
  'hate/threatening': number;
  harassment: number;
  'harassment/threatening': number;
  'self-harm': number;
  'self-harm/intent': number;
  'self-harm/instructions': number;
  sexual: number;
  'sexual/minors': number;
  violence: number;
  'violence/graphic': number;
}

export interface ModerationConfig {
  enabled: boolean;
  openaiApiKey?: string;
  customBlockedWords?: string[];
  customBlockedPatterns?: string[];
  thresholds?: Partial<ModerationCategoryScores>;
  logViolations?: boolean;
  blockOnViolation?: boolean;
}

export interface ModerationLogEntry {
  id: string;
  userId: string;
  conversationId?: string;
  content: string;
  result: ModerationResult;
  action: 'allowed' | 'warned' | 'blocked';
  timestamp: string;
}

// =============================================================================
// OpenAI Moderation API
// =============================================================================

interface OpenAIModerationResponse {
  id: string;
  model: string;
  results: Array<{
    flagged: boolean;
    categories: ModerationCategories;
    category_scores: ModerationCategoryScores;
  }>;
}

async function moderateWithOpenAI(
  text: string,
  apiKey: string
): Promise<ModerationResult> {
  const response = await fetch('https://api.openai.com/v1/moderations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: text }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI Moderation API error: ${response.status}`);
  }

  const data = await response.json() as OpenAIModerationResponse;
  const result = data.results[0];

  return {
    flagged: result.flagged,
    categories: result.categories,
    categoryScores: result.category_scores,
  };
}

// =============================================================================
// Custom Filters
// =============================================================================

function checkCustomFilters(
  text: string,
  blockedWords: string[] = [],
  blockedPatterns: string[] = []
): { blocked: boolean; reason?: string } {
  const textLower = text.toLowerCase();

  // Check blocked words
  for (const word of blockedWords) {
    if (textLower.includes(word.toLowerCase())) {
      return { blocked: true, reason: `Contains blocked word` };
    }
  }

  // Check blocked patterns (regex)
  for (const pattern of blockedPatterns) {
    try {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(text)) {
        return { blocked: true, reason: `Matches blocked pattern` };
      }
    } catch {
      // Invalid regex, skip
    }
  }

  return { blocked: false };
}

function checkThresholds(
  scores: ModerationCategoryScores,
  thresholds: Partial<ModerationCategoryScores>
): { exceeded: boolean; category?: string } {
  for (const [category, threshold] of Object.entries(thresholds)) {
    const score = scores[category as keyof ModerationCategoryScores];
    if (score !== undefined && threshold !== undefined && score >= threshold) {
      return { exceeded: true, category };
    }
  }
  return { exceeded: false };
}

// =============================================================================
// Moderation Service Class
// =============================================================================

export class ModerationService {
  private config: ModerationConfig;
  private db?: D1Database;

  constructor(config: ModerationConfig, db?: D1Database) {
    this.config = config;
    this.db = db;
  }

  /**
   * Moderate content
   */
  async moderate(
    content: string,
    userId: string,
    conversationId?: string
  ): Promise<ModerationResult> {
    if (!this.config.enabled) {
      return {
        flagged: false,
        categories: this.getEmptyCategories(),
        categoryScores: this.getEmptyScores(),
      };
    }

    let result: ModerationResult;

    // Check custom filters first (faster)
    const customCheck = checkCustomFilters(
      content,
      this.config.customBlockedWords,
      this.config.customBlockedPatterns
    );

    if (customCheck.blocked) {
      result = {
        flagged: true,
        categories: this.getEmptyCategories(),
        categoryScores: this.getEmptyScores(),
        blockedReason: customCheck.reason,
      };
    } else if (this.config.openaiApiKey) {
      // Use OpenAI Moderation API
      result = await moderateWithOpenAI(content, this.config.openaiApiKey);

      // Check custom thresholds
      if (this.config.thresholds) {
        const thresholdCheck = checkThresholds(result.categoryScores, this.config.thresholds);
        if (thresholdCheck.exceeded) {
          result.flagged = true;
          result.blockedReason = `Threshold exceeded for: ${thresholdCheck.category}`;
        }
      }
    } else {
      // No moderation configured
      result = {
        flagged: false,
        categories: this.getEmptyCategories(),
        categoryScores: this.getEmptyScores(),
      };
    }

    // Log violation if configured
    if (result.flagged && this.config.logViolations && this.db) {
      await this.logViolation(userId, conversationId, content, result);
    }

    return result;
  }

  /**
   * Check if content should be blocked
   */
  async shouldBlock(
    content: string,
    userId: string,
    conversationId?: string
  ): Promise<{ block: boolean; reason?: string }> {
    if (!this.config.enabled) {
      return { block: false };
    }

    const result = await this.moderate(content, userId, conversationId);

    if (result.flagged && this.config.blockOnViolation) {
      return {
        block: true,
        reason: result.blockedReason || 'Content flagged by moderation',
      };
    }

    return { block: false };
  }

  /**
   * Log violation to database
   */
  private async logViolation(
    userId: string,
    conversationId: string | undefined,
    content: string,
    result: ModerationResult
  ): Promise<void> {
    if (!this.db) return;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      await this.db
        .prepare(`
          INSERT INTO moderation_logs (id, user_id, conversation_id, content, result, action, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          id,
          userId,
          conversationId || null,
          content.slice(0, 1000), // Limit stored content
          JSON.stringify(result),
          this.config.blockOnViolation ? 'blocked' : 'warned',
          now
        )
        .run();
    } catch (error) {
      console.warn('[Moderation] Failed to log violation:', error);
    }
  }

  /**
   * Get moderation logs for admin review
   */
  async getLogs(
    limit: number = 50,
    offset: number = 0,
    userId?: string
  ): Promise<ModerationLogEntry[]> {
    if (!this.db) return [];

    let query = 'SELECT * FROM moderation_logs';
    const params: unknown[] = [];

    if (userId) {
      query += ' WHERE user_id = ?';
      params.push(userId);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const results = await this.db
      .prepare(query)
      .bind(...params)
      .all<any>();

    return results.results.map(row => ({
      id: row.id,
      userId: row.user_id,
      conversationId: row.conversation_id,
      content: row.content,
      result: JSON.parse(row.result),
      action: row.action,
      timestamp: row.created_at,
    }));
  }

  private getEmptyCategories(): ModerationCategories {
    return {
      hate: false,
      'hate/threatening': false,
      harassment: false,
      'harassment/threatening': false,
      'self-harm': false,
      'self-harm/intent': false,
      'self-harm/instructions': false,
      sexual: false,
      'sexual/minors': false,
      violence: false,
      'violence/graphic': false,
    };
  }

  private getEmptyScores(): ModerationCategoryScores {
    return {
      hate: 0,
      'hate/threatening': 0,
      harassment: 0,
      'harassment/threatening': 0,
      'self-harm': 0,
      'self-harm/intent': 0,
      'self-harm/instructions': 0,
      sexual: 0,
      'sexual/minors': 0,
      violence: 0,
      'violence/graphic': 0,
    };
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createModerationService(
  config: ModerationConfig,
  db?: D1Database
): ModerationService {
  return new ModerationService(config, db);
}

export function createModerationServiceFromEnv(env: {
  MODERATION_ENABLED?: string;
  OPENAI_API_KEY?: string;
  MODERATION_BLOCKED_WORDS?: string;
  MODERATION_BLOCK_ON_VIOLATION?: string;
  DB?: D1Database;
}): ModerationService {
  const blockedWords = env.MODERATION_BLOCKED_WORDS
    ? env.MODERATION_BLOCKED_WORDS.split(',').map(w => w.trim())
    : [];

  return new ModerationService(
    {
      enabled: env.MODERATION_ENABLED === 'true',
      openaiApiKey: env.OPENAI_API_KEY,
      customBlockedWords: blockedWords,
      blockOnViolation: env.MODERATION_BLOCK_ON_VIOLATION === 'true',
      logViolations: true,
    },
    env.DB
  );
}
