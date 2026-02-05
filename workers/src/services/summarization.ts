/**
 * Conversation Summarization Service
 * 
 * Generates progressive summaries of conversation history to maintain
 * context while staying within token limits.
 */

import { getProvider, type ChatMessage } from '../providers';
import type { Env } from '../types';
import { countTokens } from '../utils/tokens';

// =============================================================================
// Types
// =============================================================================

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  summary?: string;
  summaryTokenCount?: number;
}

export interface SummarizationResult {
  summary: string;
  tokenCount: number;
}

// =============================================================================
// Prompts
// =============================================================================

const INITIAL_SUMMARY_PROMPT = `Summarize the following conversation, capturing the key points and context needed to continue the conversation.

Focus on:
- Main topics discussed
- Important decisions or conclusions
- Any specific requests or requirements mentioned
- Context needed for future responses

Be concise but comprehensive. The summary will be used to maintain context in a long conversation.

Conversation:
{conversation}

Summary:`;

const PROGRESSIVE_SUMMARY_PROMPT = `Progressively update the summary by integrating the new conversation into the existing summary.

Current summary:
{existing_summary}

New conversation:
{new_conversation}

Provide an updated summary that:
- Integrates the new information naturally
- Maintains the most important context from the original summary
- Captures any new topics, decisions, or requirements
- Stays concise while being comprehensive

Updated summary:`;

// =============================================================================
// Summarization Functions
// =============================================================================

/**
 * Generate a summary of messages
 */
export async function generateSummary(
  env: Env,
  messages: Message[],
  existingSummary?: string
): Promise<SummarizationResult> {
  // Format messages for the prompt
  const conversationText = messages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
  
  // Build the prompt
  let prompt: string;
  if (existingSummary) {
    prompt = PROGRESSIVE_SUMMARY_PROMPT
      .replace('{existing_summary}', existingSummary)
      .replace('{new_conversation}', conversationText);
  } else {
    prompt = INITIAL_SUMMARY_PROMPT.replace('{conversation}', conversationText);
  }
  
  // Use a fast/cheap model for summarization
  const summaryModel = 'gpt-4o-mini';
  
  try {
    const provider = getProvider('openai', {
      apiKey: env.OPENAI_API_KEY || '',
      defaultModel: summaryModel,
    });
    
    const response = await provider.chat({
      model: summaryModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3, // Lower temperature for more focused summaries
      maxTokens: 500, // Summaries should be concise
    });
    
    const summary = response.content.trim();
    const tokenCount = countTokens(summary, summaryModel);
    
    return { summary, tokenCount };
  } catch (error) {
    console.error('[Summarization] Failed to generate summary:', error);
    
    // Fallback: create a simple extractive summary
    const fallbackSummary = createFallbackSummary(messages, existingSummary);
    return {
      summary: fallbackSummary,
      tokenCount: countTokens(fallbackSummary, 'gpt-4o'),
    };
  }
}

/**
 * Create a simple fallback summary when AI summarization fails
 */
function createFallbackSummary(messages: Message[], existingSummary?: string): string {
  const parts: string[] = [];
  
  if (existingSummary) {
    parts.push(`Previous context: ${existingSummary}`);
  }
  
  // Extract key points from messages
  for (const msg of messages) {
    if (msg.role === 'user') {
      // Get first sentence or first 100 chars
      const text = msg.content.split(/[.!?]/)[0]?.trim() || msg.content.slice(0, 100);
      parts.push(`User asked about: ${text}`);
    }
  }
  
  return parts.join('\n');
}

/**
 * Check if summarization is needed based on token count
 */
export function needsSummarization(
  totalMessageTokens: number,
  maxContextTokens: number,
  threshold: number = 0.8
): boolean {
  return totalMessageTokens > maxContextTokens * threshold;
}

/**
 * Create a system message with the summary for context injection
 */
export function createSummarySystemMessage(summary: string): ChatMessage {
  return {
    role: 'system',
    content: `[Conversation Summary]
The following is a summary of the earlier conversation for context:

${summary}

Continue the conversation naturally, using this context as needed.`,
  };
}
