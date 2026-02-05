/**
 * Context Management Utilities
 * 
 * Handles context window management, message compaction, and summarization
 * for long conversations that exceed model token limits.
 */

import {
  countTokens,
  countMessageTokens,
  getMaxContextTokens,
  getResponseTokensReserve,
} from './tokens';

// =============================================================================
// Types
// =============================================================================

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tokenCount?: number;
  summary?: string;
  summaryTokenCount?: number;
  parentMessageId?: string | null;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  name?: string;
}

export interface ContextBuildResult {
  /** Messages to send to the API */
  messages: ChatMessage[];
  /** Total tokens in the context */
  totalTokens: number;
  /** Messages that were excluded due to token limit */
  excludedMessages: Message[];
  /** Whether summarization is needed */
  needsSummarization: boolean;
  /** System message tokens (if any) */
  systemTokens: number;
  /** Summary of excluded messages (if available) */
  summary?: string;
  /** Token count of the summary */
  summaryTokenCount?: number;
}

export interface ContextOptions {
  /** Model to use for token counting */
  model: string;
  /** System prompt to prepend */
  systemPrompt?: string;
  /** Max tokens for response (reserves space) */
  maxResponseTokens?: number;
  /** Strategy for handling overflow: 'discard' or 'summarize' */
  strategy?: 'discard' | 'summarize';
  /** Minimum messages to keep (even if over limit) */
  minMessages?: number;
  /** Existing summary from previous messages */
  existingSummary?: string;
  /** Token count of existing summary */
  existingSummaryTokenCount?: number;
}

// =============================================================================
// Context Builder
// =============================================================================

/**
 * Build context from messages, respecting token limits
 * 
 * Uses a "newest first" approach:
 * 1. Start from the most recent message
 * 2. Add messages going backwards until token limit reached
 * 3. Always include at least the latest user message
 */
export function buildContext(
  messages: Message[],
  options: ContextOptions
): ContextBuildResult {
  const {
    model,
    systemPrompt,
    maxResponseTokens,
    strategy = 'discard',
    minMessages = 2, // At least keep latest user + assistant
    existingSummary,
    existingSummaryTokenCount,
  } = options;

  // Calculate available tokens
  const maxContext = getMaxContextTokens(model);
  const responseReserve = getResponseTokensReserve(model, maxResponseTokens);
  
  // Calculate system prompt tokens
  let systemTokens = 0;
  if (systemPrompt) {
    systemTokens = countMessageTokens({ role: 'system', content: systemPrompt }, model);
  }
  
  // Account for existing summary tokens
  let summaryTokens = 0;
  if (existingSummary && existingSummaryTokenCount) {
    summaryTokens = existingSummaryTokenCount;
  }
  
  const availableTokens = maxContext - responseReserve - systemTokens - summaryTokens;
  
  // Ensure all messages have token counts
  const messagesWithTokens = messages.map(msg => ({
    ...msg,
    tokenCount: msg.tokenCount ?? countMessageTokens(
      { role: msg.role, content: msg.content },
      model
    ),
  }));
  
  // Build context from newest to oldest
  const context: ChatMessage[] = [];
  const excludedMessages: Message[] = [];
  let currentTokens = 0;
  
  // Process messages from newest to oldest
  for (let i = messagesWithTokens.length - 1; i >= 0; i--) {
    const msg = messagesWithTokens[i];
    const msgTokens = msg.tokenCount!;
    
    // Check if we can fit this message
    if (currentTokens + msgTokens <= availableTokens) {
      context.unshift({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      });
      currentTokens += msgTokens;
    } else {
      // Message doesn't fit
      // Always keep minimum messages (latest exchange)
      if (context.length < minMessages) {
        context.unshift({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
        });
        currentTokens += msgTokens;
      } else {
        // Add to excluded list
        excludedMessages.unshift(msg);
      }
    }
  }
  
  // Prepend system prompt if provided
  const finalMessages: ChatMessage[] = [];
  if (systemPrompt) {
    finalMessages.push({ role: 'system', content: systemPrompt });
  }
  
  // Add summary context if we have excluded messages and an existing summary
  if (existingSummary && excludedMessages.length > 0) {
    finalMessages.push({
      role: 'system',
      content: `[Previous conversation context]\n${existingSummary}`,
    });
  }
  
  finalMessages.push(...context);
  
  return {
    messages: finalMessages,
    totalTokens: currentTokens + systemTokens + summaryTokens,
    excludedMessages,
    needsSummarization: excludedMessages.length > 0 && strategy === 'summarize',
    systemTokens,
    summary: existingSummary,
    summaryTokenCount: existingSummaryTokenCount,
  };
}

/**
 * Build context following the message tree (parent-child relationships)
 * Used when messages have parentMessageId for branching conversations
 */
export function buildContextFromTree(
  messages: Message[],
  targetMessageId: string | null,
  options: ContextOptions
): ContextBuildResult {
  // Build path from root to target message
  const messageMap = new Map(messages.map(m => [m.id, m]));
  const path: Message[] = [];
  
  let currentId = targetMessageId;
  while (currentId) {
    const msg = messageMap.get(currentId);
    if (msg) {
      path.unshift(msg);
      currentId = msg.parentMessageId || null;
    } else {
      break;
    }
  }
  
  // Use the linear path as input
  return buildContext(path, options);
}

// =============================================================================
// Summarization
// =============================================================================

/**
 * Generate a summary prompt for excluded messages
 */
export function generateSummaryPrompt(
  excludedMessages: Message[],
  existingSummary?: string
): string {
  const newLines = excludedMessages
    .map(m => `${m.role === 'user' ? 'Human' : 'AI'}: ${m.content}`)
    .join('\n');
  
  if (existingSummary) {
    return `Summarize the conversation by integrating new lines into the current summary.

Current summary:
${existingSummary}

New lines of conversation:
${newLines}

Provide a concise summary that captures the key points and context needed to continue the conversation. Focus on:
- Main topics discussed
- Important decisions or conclusions
- Any specific requests or requirements mentioned
- Context needed for future responses

New summary:`;
  }
  
  return `Summarize the following conversation, capturing the key points and context needed to continue the conversation.

Conversation:
${newLines}

Focus on:
- Main topics discussed
- Important decisions or conclusions
- Any specific requests or requirements mentioned
- Context needed for future responses

Summary:`;
}

/**
 * Create a system message with the summary
 */
export function createSummarySystemMessage(summary: string): ChatMessage {
  return {
    role: 'system',
    content: `Previous conversation summary:\n${summary}\n\nContinue the conversation based on this context.`,
  };
}

// =============================================================================
// Token Estimation Helpers
// =============================================================================

/**
 * Estimate if a conversation will fit in context
 */
export function willFitInContext(
  messages: Message[],
  model: string,
  systemPrompt?: string,
  maxResponseTokens?: number
): { fits: boolean; totalTokens: number; available: number; overflow: number } {
  const maxContext = getMaxContextTokens(model);
  const responseReserve = getResponseTokensReserve(model, maxResponseTokens);
  
  let totalTokens = 0;
  
  if (systemPrompt) {
    totalTokens += countMessageTokens({ role: 'system', content: systemPrompt }, model);
  }
  
  for (const msg of messages) {
    totalTokens += msg.tokenCount ?? countMessageTokens(
      { role: msg.role, content: msg.content },
      model
    );
  }
  
  const available = maxContext - responseReserve;
  const overflow = Math.max(0, totalTokens - available);
  
  return {
    fits: totalTokens <= available,
    totalTokens,
    available,
    overflow,
  };
}

/**
 * Get recommended action based on context state
 */
export function getContextRecommendation(
  messages: Message[],
  model: string,
  systemPrompt?: string
): {
  action: 'none' | 'truncate' | 'summarize' | 'new_conversation';
  reason: string;
  utilization: number;
} {
  const { fits, totalTokens, available } = willFitInContext(messages, model, systemPrompt);
  const utilization = totalTokens / available;
  
  if (fits && utilization < 0.7) {
    return {
      action: 'none',
      reason: 'Context is within limits',
      utilization,
    };
  }
  
  if (fits && utilization < 0.9) {
    return {
      action: 'none',
      reason: 'Context is filling up, consider summarization soon',
      utilization,
    };
  }
  
  if (!fits || utilization >= 0.9) {
    if (messages.length > 20) {
      return {
        action: 'summarize',
        reason: 'Long conversation, summarization recommended',
        utilization,
      };
    }
    return {
      action: 'truncate',
      reason: 'Context overflow, older messages will be dropped',
      utilization,
    };
  }
  
  return {
    action: 'new_conversation',
    reason: 'Context severely exceeded, consider starting new conversation',
    utilization,
  };
}
