/**
 * Token Counting Utilities
 * 
 * Provides token counting and context window management for different LLM providers.
 * Uses tiktoken-compatible encoding for accurate token estimates.
 */

import { encodingForModel, getEncoding, type TiktokenModel } from 'js-tiktoken';

// =============================================================================
// Model Context Windows
// =============================================================================

/**
 * Maximum context tokens for each model
 * Values represent usable context (total - some buffer for response)
 */
export const MODEL_MAX_TOKENS: Record<string, number> = {
  // OpenAI Models
  'gpt-4o': 127500,
  'gpt-4o-mini': 127500,
  'gpt-4-turbo': 127500,
  'gpt-4-turbo-preview': 127500,
  'gpt-4': 8192,
  'gpt-4-32k': 32768,
  'gpt-3.5-turbo': 16385,
  'gpt-3.5-turbo-16k': 16385,
  'o1': 195000,
  'o1-mini': 127500,
  'o1-preview': 127500,
  'o3-mini': 195000,
  
  // Anthropic Models
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-5-sonnet-latest': 200000,
  'claude-3-5-haiku-20241022': 200000,
  'claude-3-opus-20240229': 200000,
  'claude-3-sonnet-20240229': 200000,
  'claude-3-haiku-20240307': 200000,
  'claude-2.1': 200000,
  'claude-2': 100000,
  
  // Google Models
  'gemini-1.5-pro': 1000000,
  'gemini-1.5-flash': 1000000,
  'gemini-1.0-pro': 30720,
  'gemini-pro': 30720,
  
  // Default fallback
  'default': 4096,
};

/**
 * Model encoding mappings
 * Maps model names to tiktoken encoding names
 */
const MODEL_ENCODINGS: Record<string, string> = {
  // OpenAI uses cl100k_base for GPT-4 and GPT-3.5
  'gpt-4': 'cl100k_base',
  'gpt-4o': 'o200k_base',
  'gpt-4o-mini': 'o200k_base',
  'gpt-3.5': 'cl100k_base',
  'o1': 'o200k_base',
  'o3': 'o200k_base',
  
  // Anthropic (use cl100k_base as approximation)
  'claude': 'cl100k_base',
  
  // Google (use cl100k_base as approximation)
  'gemini': 'cl100k_base',
  
  // Default
  'default': 'cl100k_base',
};

// =============================================================================
// Token Counter Class
// =============================================================================

/**
 * Token counter with encoding caching
 */
class TokenCounter {
  private encodingCache: Map<string, ReturnType<typeof getEncoding>> = new Map();
  
  /**
   * Get encoding for a model
   */
  private getEncodingForModel(model: string): ReturnType<typeof getEncoding> {
    // Find matching encoding
    const lowerModel = model.toLowerCase();
    let encodingName = MODEL_ENCODINGS['default'];
    
    for (const [prefix, encoding] of Object.entries(MODEL_ENCODINGS)) {
      if (lowerModel.includes(prefix)) {
        encodingName = encoding;
        break;
      }
    }
    
    // Check cache
    if (this.encodingCache.has(encodingName)) {
      return this.encodingCache.get(encodingName)!;
    }
    
    // Create and cache encoding
    try {
      const encoding = getEncoding(encodingName as any);
      this.encodingCache.set(encodingName, encoding);
      return encoding;
    } catch {
      // Fallback to cl100k_base
      const encoding = getEncoding('cl100k_base');
      this.encodingCache.set(encodingName, encoding);
      return encoding;
    }
  }
  
  /**
   * Count tokens in a string
   */
  countTokens(text: string, model: string = 'gpt-4o'): number {
    if (!text) return 0;
    
    try {
      const encoding = this.getEncodingForModel(model);
      return encoding.encode(text).length;
    } catch {
      // Fallback: rough estimate of 4 chars per token
      return Math.ceil(text.length / 4);
    }
  }
  
  /**
   * Count tokens in a chat message
   * Accounts for message formatting overhead
   */
  countMessageTokens(
    message: { role: string; content: string; name?: string },
    model: string = 'gpt-4o'
  ): number {
    // Base tokens per message (role, formatting)
    let tokensPerMessage = 3;
    let tokensPerName = 1;
    
    // GPT-4 uses slightly different formatting
    if (model.includes('gpt-4')) {
      tokensPerMessage = 3;
      tokensPerName = 1;
    }
    
    let numTokens = tokensPerMessage;
    
    // Count content
    if (message.content) {
      numTokens += this.countTokens(message.content, model);
    }
    
    // Count role
    numTokens += this.countTokens(message.role, model);
    
    // Count name if present
    if (message.name) {
      numTokens += this.countTokens(message.name, model);
      numTokens += tokensPerName;
    }
    
    return numTokens;
  }
  
  /**
   * Count tokens in an array of messages
   */
  countMessagesTokens(
    messages: Array<{ role: string; content: string; name?: string }>,
    model: string = 'gpt-4o'
  ): number {
    let total = 0;
    
    for (const message of messages) {
      total += this.countMessageTokens(message, model);
    }
    
    // Account for assistant label priming (3 tokens)
    total += 3;
    
    return total;
  }
  
  /**
   * Get max context tokens for a model
   */
  getMaxContextTokens(model: string): number {
    const lowerModel = model.toLowerCase();
    
    // Exact match first
    if (MODEL_MAX_TOKENS[lowerModel]) {
      return MODEL_MAX_TOKENS[lowerModel];
    }
    
    // Pattern match
    for (const [pattern, maxTokens] of Object.entries(MODEL_MAX_TOKENS)) {
      if (lowerModel.includes(pattern)) {
        return maxTokens;
      }
    }
    
    return MODEL_MAX_TOKENS['default'];
  }
  
  /**
   * Estimate response tokens to reserve
   * Returns tokens to reserve for the model's response
   */
  getResponseTokensReserve(model: string, requestedMaxTokens?: number): number {
    // If user specified max tokens, use that
    if (requestedMaxTokens) {
      return Math.min(requestedMaxTokens, 4096);
    }
    
    // Default reserves based on model
    const maxContext = this.getMaxContextTokens(model);
    
    // Reserve 10-25% for response, min 1024, max 8192
    const reserve = Math.floor(maxContext * 0.15);
    return Math.max(1024, Math.min(reserve, 8192));
  }
}

// Export singleton instance
export const tokenCounter = new TokenCounter();

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Count tokens in text
 */
export function countTokens(text: string, model: string = 'gpt-4o'): number {
  return tokenCounter.countTokens(text, model);
}

/**
 * Count tokens in a message
 */
export function countMessageTokens(
  message: { role: string; content: string; name?: string },
  model: string = 'gpt-4o'
): number {
  return tokenCounter.countMessageTokens(message, model);
}

/**
 * Count tokens in messages array
 */
export function countMessagesTokens(
  messages: Array<{ role: string; content: string; name?: string }>,
  model: string = 'gpt-4o'
): number {
  return tokenCounter.countMessagesTokens(messages, model);
}

/**
 * Get max context tokens for a model
 */
export function getMaxContextTokens(model: string): number {
  return tokenCounter.getMaxContextTokens(model);
}

/**
 * Get tokens to reserve for response
 */
export function getResponseTokensReserve(model: string, requestedMaxTokens?: number): number {
  return tokenCounter.getResponseTokensReserve(model, requestedMaxTokens);
}

/**
 * Calculate available context tokens
 * Returns how many tokens can be used for messages
 */
export function getAvailableContextTokens(
  model: string,
  systemPromptTokens: number = 0,
  requestedMaxTokens?: number
): number {
  const maxContext = getMaxContextTokens(model);
  const responseReserve = getResponseTokensReserve(model, requestedMaxTokens);
  
  return maxContext - responseReserve - systemPromptTokens;
}
