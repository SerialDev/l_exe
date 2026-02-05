/**
 * Chat Service
 * Handles chat completions with AI providers, streaming, and conversation management
 * 
 * Features:
 * - Token counting and context window management
 * - Automatic context compaction for long conversations
 * - Message summarization (optional)
 * - AI-powered title generation
 */

import { getProvider, ProviderConfig, ChatRequest, ChatMessage, StreamChunk, IProvider } from '../providers';
import * as conversationsDb from '../db/conversations';
import * as messagesDb from '../db/messages';
import type { Env } from '../types';
import { countTokens, countMessageTokens, getMaxContextTokens } from '../utils/tokens';
import { buildContext, generateSummaryPrompt, type Message as ContextMessage } from '../utils/context';
import { createRAGService, type RAGContext } from './rag';
import { generateSummary, createSummarySystemMessage } from './summarization';
import { createWebSearchServiceFromEnv, type SearchResponse } from './websearch';
import { createMemoryService, getMemorySystemPrompt, type MemoryContext } from './memory';
import { createArtifactService, parseArtifacts } from './artifacts';

// =============================================================================
// Types
// =============================================================================

export interface ChatServiceConfig {
  env: Env;
  userId: string;
}

export interface SendMessageRequest {
  conversationId?: string;
  parentMessageId?: string;
  endpoint: string;
  model: string;
  text: string;
  systemPrompt?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  files?: Array<{ file_id: string; type: string }>;
  tools?: string[];
  /** Enable RAG - search for relevant context in user's documents */
  enableRAG?: boolean;
  /** Specific file IDs to search for RAG context (if not provided, searches all) */
  ragFileIds?: string[];
  /** Strategy for handling long conversations: 'discard' drops old messages, 'summarize' generates summaries */
  contextStrategy?: 'discard' | 'summarize';
  /** Enable web search - allows AI to search the web for information */
  enableWebSearch?: boolean;
  /** Specific search query (if not provided, AI decides when to search) */
  searchQuery?: string;
  /** Enable memory - inject user's persistent context */
  enableMemory?: boolean;
  /** Enable artifact extraction - parse and save artifacts from responses */
  enableArtifacts?: boolean;
  /** AbortSignal for canceling the request */
  signal?: AbortSignal;
}

export interface SendMessageResponse {
  conversationId: string;
  messageId: string;
  parentMessageId: string;
  userMessageId: string;
  text: string;
  model: string;
  endpoint: string;
  finish_reason?: string;
  tokenCount?: number;
}

export interface StreamCallbacks {
  onStart?: (data: { conversationId: string; messageId: string; parentMessageId: string }) => void;
  onToken?: (token: string) => void;
  onToolCall?: (tool: string, input: string) => void;
  onToolResult?: (tool: string, output: string) => void;
  onError?: (error: Error) => void;
  onDone?: (response: SendMessageResponse) => void;
}

// =============================================================================
// Chat Service Class
// =============================================================================

export class ChatService {
  private env: Env;
  private userId: string;
  private db: D1Database;
  private kv?: KVNamespace;
  private vectorize?: VectorizeIndex;
  private ai?: Ai;

  constructor(config: ChatServiceConfig) {
    this.env = config.env;
    this.userId = config.userId;
    this.db = config.env.DB;
    this.kv = (config.env as any).KV || (config.env as any).SESSIONS;
    this.vectorize = config.env.MEMORY_VECTORIZE;
    this.ai = config.env.AI;
  }

  /**
   * Check if a message generation was aborted
   */
  private async isAborted(conversationId: string, messageId: string): Promise<boolean> {
    if (!this.kv) return false;
    
    const key = `abort:${conversationId}:${messageId}`;
    const aborted = await this.kv.get(key);
    return aborted === 'true';
  }

  /**
   * Mark a message as aborted in KV
   */
  private async markAborted(conversationId: string, messageId: string): Promise<void> {
    if (!this.kv) return;
    
    const key = `abort:${conversationId}:${messageId}`;
    // TTL of 5 minutes - abort signals don't need to persist long
    await this.kv.put(key, 'true', { expirationTtl: 300 });
  }

  /**
   * Clear abort status for a message
   */
  private async clearAborted(conversationId: string, messageId: string): Promise<void> {
    if (!this.kv) return;
    
    const key = `abort:${conversationId}:${messageId}`;
    await this.kv.delete(key);
  }

  /**
   * Get provider configuration from environment
   */
  private getProviderConfig(endpoint: string): ProviderConfig {
    const normalizedEndpoint = endpoint.toLowerCase();
    
    switch (normalizedEndpoint) {
      case 'openai':
        return {
          apiKey: this.env.OPENAI_API_KEY || '',
          defaultModel: 'gpt-4o',
        };
      
      case 'anthropic':
        return {
          apiKey: this.env.ANTHROPIC_API_KEY || '',
          defaultModel: 'claude-3-5-sonnet-20241022',
        };
      
      case 'google':
      case 'gemini':
        return {
          apiKey: this.env.GOOGLE_AI_API_KEY || '',
          defaultModel: 'gemini-1.5-pro',
        };
      
      case 'azure':
      case 'azureopenai':
        return {
          apiKey: this.env.AZURE_OPENAI_API_KEY || '',
          baseUrl: this.env.AZURE_OPENAI_ENDPOINT,
          defaultModel: 'gpt-4o',
        };
      
      case 'ollama':
        return {
          apiKey: '', // Ollama doesn't require API key
          baseUrl: this.env.OLLAMA_BASE_URL || 'http://localhost:11434',
          defaultModel: 'llama2',
        };
      
      case 'groq':
        return {
          apiKey: this.env.GROQ_API_KEY || '',
          defaultModel: 'mixtral-8x7b-32768',
        };
      
      case 'mistral':
        return {
          apiKey: this.env.MISTRAL_API_KEY || '',
          defaultModel: 'mistral-large-latest',
        };
      
      case 'openrouter':
        return {
          apiKey: this.env.OPENROUTER_API_KEY || '',
          defaultModel: 'openai/gpt-4o',
        };
      
      default:
        throw new Error(`Unknown endpoint: ${endpoint}`);
    }
  }

  /**
   * Create or get a provider instance
   */
  private getProvider(endpoint: string): IProvider {
    const config = this.getProviderConfig(endpoint);
    
    if (!config.apiKey) {
      throw new Error(`API key not configured for ${endpoint}`);
    }
    
    return getProvider(endpoint, config);
  }

  /**
   * Build conversation history from database with context compaction
   * 
   * Uses token counting to ensure the context fits within the model's limits.
   * Supports two strategies:
   * - 'discard': Drop old messages (default)
   * - 'summarize': Generate AI summary of excluded messages
   */
  private async buildConversationHistory(
    conversationId: string,
    parentMessageId: string | undefined,
    model: string,
    systemPrompt?: string,
    strategy: 'discard' | 'summarize' = 'discard'
  ): Promise<{ 
    messages: ChatMessage[]; 
    excludedCount: number; 
    totalTokens: number;
    summary?: string;
  }> {
    const dbMessages = await messagesDb.findByConversation(this.db, conversationId, this.userId);
    
    // Get conversation for existing summary
    const conversation = await conversationsDb.findById(this.db, conversationId);
    const existingSummary = (conversation as any)?.summary;
    const existingSummaryTokenCount = (conversation as any)?.summaryTokenCount;
    
    // Convert to context messages
    let contextMessages: ContextMessage[];
    
    if (!parentMessageId) {
      // Get all messages in order
      contextMessages = dbMessages.map(msg => ({
        id: msg.id,
        role: msg.role as 'user' | 'assistant' | 'system' | 'tool',
        content: msg.content,
        tokenCount: msg.tokenCount || undefined,
        parentMessageId: msg.parentMessageId,
      }));
    } else {
      // Build path from root to parent message (for branching conversations)
      const messageMap = new Map(dbMessages.map(m => [m.id, m]));
      const path: typeof dbMessages = [];
      
      let currentId: string | null = parentMessageId;
      while (currentId) {
        const msg = messageMap.get(currentId);
        if (msg) {
          path.unshift(msg);
          currentId = msg.parentMessageId;
        } else {
          break;
        }
      }
      
      contextMessages = path.map(msg => ({
        id: msg.id,
        role: msg.role as 'user' | 'assistant' | 'system' | 'tool',
        content: msg.content,
        tokenCount: msg.tokenCount || undefined,
        parentMessageId: msg.parentMessageId,
      }));
    }
    
    // Build context with token limits
    const result = buildContext(contextMessages, {
      model,
      systemPrompt,
      strategy,
      minMessages: 2,
      existingSummary,
      existingSummaryTokenCount,
    });
    
    let summary = existingSummary;
    
    // Log if messages were excluded
    if (result.excludedMessages.length > 0) {
      console.log(
        `[ChatService] Context compaction: excluded ${result.excludedMessages.length} messages, ` +
        `total tokens: ${result.totalTokens}, model: ${model}, strategy: ${strategy}`
      );
      
      // Generate summary if using summarize strategy
      if (strategy === 'summarize' && result.needsSummarization) {
        try {
          console.log('[ChatService] Generating summary for excluded messages...');
          const summaryResult = await generateSummary(
            this.env,
            result.excludedMessages.map(m => ({
              id: m.id,
              role: m.role as 'user' | 'assistant' | 'system' | 'tool',
              content: m.content,
            })),
            existingSummary
          );
          
          summary = summaryResult.summary;
          
          // Store summary in conversation for future use (with tenant isolation)
          await this.db
            .prepare('UPDATE conversations SET summary = ?, summary_token_count = ? WHERE id = ? AND user_id = ?')
            .bind(summary, summaryResult.tokenCount, conversationId, this.userId)
            .run();
          
          console.log(`[ChatService] Summary generated: ${summaryResult.tokenCount} tokens`);
        } catch (error) {
          console.warn('[ChatService] Failed to generate summary:', error);
        }
      }
    }
    
    // Return messages WITHOUT the system prompt (it's added separately)
    // The buildContext already added it, so we need to remove it
    const messagesWithoutSystem = result.messages.filter(m => 
      !(m.role === 'system' && m.content === systemPrompt)
    );
    
    return {
      messages: messagesWithoutSystem,
      excludedCount: result.excludedMessages.length,
      totalTokens: result.totalTokens,
      summary,
    };
  }

  /**
   * Generate a title for a new conversation
   * Uses AI to generate a concise, descriptive title
   */
  private async generateTitle(text: string, responseText?: string): Promise<string> {
    // For initial title, use first 50 chars as fallback
    const fallbackTitle = text.slice(0, 50).trim();
    const title = fallbackTitle.length < text.length ? `${fallbackTitle}...` : fallbackTitle;
    
    // If we have a response, try to generate a better title async
    // (Title generation is done in background, see generateTitleAsync)
    return title;
  }

  /**
   * Build message content with images for vision models
   * Fetches images from R2 and converts to base64
   */
  private async buildMessageWithImages(
    text: string,
    files?: Array<{ file_id: string; type: string }>
  ): Promise<string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; mediaType: string; data: string } }>> {
    if (!files || files.length === 0) {
      return text;
    }

    const imageFiles = files.filter(f => f.type === 'image');
    if (imageFiles.length === 0) {
      return text;
    }

    const content: Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; mediaType: string; data: string } }> = [
      { type: 'text', text },
    ];

    for (const file of imageFiles) {
      try {
        // Get file info from database
        const fileInfo = await this.db
          .prepare('SELECT r2_key, mime_type FROM files WHERE id = ? AND user_id = ?')
          .bind(file.file_id, this.userId)
          .first<{ r2_key: string; mime_type: string }>();

        if (!fileInfo) {
          console.warn(`[ChatService] Image file not found: ${file.file_id}`);
          continue;
        }

        // Get image from R2
        const bucket = (this.env as any).FILES_BUCKET || (this.env as any).IMAGES_BUCKET;
        if (!bucket) {
          console.warn('[ChatService] No R2 bucket configured for images');
          continue;
        }

        const object = await bucket.get(fileInfo.r2_key);
        if (!object) {
          console.warn(`[ChatService] Image not found in R2: ${fileInfo.r2_key}`);
          continue;
        }

        // Convert to base64
        const arrayBuffer = await object.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

        content.push({
          type: 'image',
          source: {
            type: 'base64',
            mediaType: fileInfo.mime_type,
            data: base64,
          },
        });

        console.log(`[ChatService] Added image: ${fileInfo.r2_key} (${fileInfo.mime_type})`);
      } catch (error) {
        console.warn(`[ChatService] Failed to load image ${file.file_id}:`, error);
      }
    }

    // If no images were successfully loaded, return just the text
    if (content.length === 1) {
      return text;
    }

    return content;
  }

  /**
   * Get RAG context for a user query
   * Searches indexed documents for relevant content
   */
  private async getRAGContext(
    query: string,
    fileIds?: string[]
  ): Promise<RAGContext | null> {
    try {
      const ragService = createRAGService(this.env);
      const context = await ragService.getContext(query, this.userId, fileIds);
      
      if (context.results.length === 0) {
        return null;
      }
      
      console.log(
        `[ChatService] RAG context: found ${context.results.length} relevant chunks, ` +
        `top score: ${context.results[0]?.score.toFixed(3)}`
      );
      
      return context;
    } catch (error) {
      console.warn('[ChatService] RAG search failed:', error);
      return null;
    }
  }

  /**
   * Build system prompt with optional RAG context
   */
  private buildSystemPromptWithRAG(
    basePrompt: string | undefined,
    ragContext: RAGContext | null
  ): string | undefined {
    if (!ragContext || ragContext.results.length === 0) {
      return basePrompt;
    }

    const ragInstructions = `You have access to the following context from the user's documents. Use this information to answer their questions when relevant.

<document_context>
${ragContext.contextText}
</document_context>

When using information from the documents:
- Cite the source when possible
- If the documents don't contain relevant information, say so
- Don't make up information not present in the documents`;

    if (basePrompt) {
      return `${basePrompt}\n\n${ragInstructions}`;
    }
    
    return ragInstructions;
  }

  /**
   * Perform web search to gather context for the user's query
   */
  private async getWebSearchContext(query: string): Promise<SearchResponse | null> {
    try {
      const searchService = createWebSearchServiceFromEnv({
        SEARCH_PROVIDER: (this.env as any).SEARCH_PROVIDER,
        SERPER_API_KEY: (this.env as any).SERPER_API_KEY,
        SEARXNG_URL: (this.env as any).SEARXNG_URL,
        BRAVE_SEARCH_API_KEY: (this.env as any).BRAVE_SEARCH_API_KEY,
        TAVILY_API_KEY: (this.env as any).TAVILY_API_KEY,
      });

      if (!searchService) {
        console.log('[ChatService] Web search not configured');
        return null;
      }

      const results = await searchService.search(query, { numResults: 5 });
      
      console.log(
        `[ChatService] Web search: found ${results.organic.length} results for "${query.slice(0, 50)}..."`
      );
      
      return results;
    } catch (error) {
      console.warn('[ChatService] Web search failed:', error);
      return null;
    }
  }

  /**
   * Build system prompt with web search context
   */
  private buildSystemPromptWithWebSearch(
    basePrompt: string | undefined,
    searchResults: SearchResponse | null
  ): string | undefined {
    if (!searchResults || searchResults.organic.length === 0) {
      return basePrompt;
    }

    const searchContext = this.formatSearchResultsAsContext(searchResults);
    
    const webSearchInstructions = `You have access to the following web search results. Use this information to provide accurate, up-to-date answers.

<web_search_results>
${searchContext}
</web_search_results>

When using information from web search:
- Cite the source URL when providing information
- Indicate when information might be outdated
- If the search results don't answer the question, say so and provide your best knowledge`;

    if (basePrompt) {
      return `${basePrompt}\n\n${webSearchInstructions}`;
    }
    
    return webSearchInstructions;
  }

  /**
   * Format search results as context text
   */
  private formatSearchResultsAsContext(results: SearchResponse): string {
    const lines: string[] = [];

    // Include answer box if available
    if (results.answerBox?.answer) {
      lines.push(`Direct Answer: ${results.answerBox.answer}`);
      if (results.answerBox.url) {
        lines.push(`Source: ${results.answerBox.url}`);
      }
      lines.push('');
    }

    // Include knowledge graph if available
    if (results.knowledgeGraph?.description) {
      lines.push(`Knowledge Panel: ${results.knowledgeGraph.title || 'Information'}`);
      lines.push(results.knowledgeGraph.description);
      lines.push('');
    }

    // Include organic results
    for (const [index, result] of results.organic.entries()) {
      lines.push(`[${index + 1}] ${result.title}`);
      lines.push(`URL: ${result.url}`);
      lines.push(result.snippet);
      if (result.publishedDate) {
        lines.push(`Published: ${result.publishedDate}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get memory context for the current user
   * Uses similarity search if query is provided and Vectorize is available
   */
  private async getMemoryContext(query?: string): Promise<MemoryContext | null> {
    try {
      const memoryService = createMemoryService(this.db, this.vectorize, this.ai);
      
      // If query is provided and Vectorize is available, use similarity search
      if (query && this.vectorize && this.ai) {
        console.log(`[ChatService] Using similarity search for memory context, query: "${query.slice(0, 50)}..."`);
        const similarMemories = await memoryService.searchBySimilarity(this.userId, query, 10);
        
        if (similarMemories.length > 0) {
          console.log(`[ChatService] Found ${similarMemories.length} relevant memories via similarity search`);
          
          // Convert to MemoryContext format
          const context: MemoryContext = {
            facts: [],
            preferences: [],
            instructions: [],
            projects: [],
            recent: [],
            contextText: '',
          };
          
          const lines: string[] = ['## Relevant Memories'];
          for (const { memory, score } of similarMemories) {
            lines.push(`- [${memory.type}] ${memory.value} (relevance: ${(score * 100).toFixed(0)}%)`);
            
            // Also categorize for structured access
            switch (memory.type) {
              case 'fact':
                context.facts.push(memory);
                break;
              case 'preference':
                context.preferences.push(memory);
                break;
              case 'instruction':
              case 'custom':
                context.instructions.push(memory);
                break;
              case 'project':
                context.projects.push(memory);
                break;
            }
          }
          
          context.contextText = lines.join('\n');
          return context;
        }
      }
      
      // Fall back to getting all memories
      const context = await memoryService.getContext(this.userId);
      
      const totalMemories = context.facts.length + context.preferences.length + 
                           context.instructions.length + context.projects.length;
      
      if (totalMemories === 0) {
        console.log(`[ChatService] No memories found for user ${this.userId}`);
        return null;
      }
      
      console.log(
        `[ChatService] Memory context for user ${this.userId}: ${context.facts.length} facts, ` +
        `${context.preferences.length} preferences, ${context.instructions.length} instructions/custom, ` +
        `${context.projects.length} projects. Context text length: ${context.contextText.length}`
      );
      
      // Debug: log first instruction if any
      if (context.instructions.length > 0) {
        console.log(`[ChatService] First instruction/memory: "${context.instructions[0].value}"`);
      }
      
      return context;
    } catch (error) {
      console.warn('[ChatService] Failed to get memory context:', error);
      return null;
    }
  }

  /**
   * Build system prompt with memory context
   */
  private buildSystemPromptWithMemory(
    basePrompt: string | undefined,
    memoryContext: MemoryContext | null
  ): string | undefined {
    if (!memoryContext) {
      return basePrompt;
    }

    const memoryPrompt = getMemorySystemPrompt(memoryContext);
    if (!memoryPrompt) {
      return basePrompt;
    }

    if (basePrompt) {
      return `${basePrompt}\n\n${memoryPrompt}`;
    }
    
    return memoryPrompt;
  }

  /**
   * Extract and save artifacts from AI response
   */
  private async extractAndSaveArtifacts(
    conversationId: string,
    messageId: string,
    responseText: string
  ): Promise<void> {
    try {
      const artifacts = parseArtifacts(responseText);
      if (artifacts.length === 0) return;

      const artifactService = createArtifactService(this.db);
      const created = await artifactService.createFromResponse(
        this.userId,
        messageId,
        conversationId,
        responseText
      );

      console.log(`[ChatService] Extracted ${created.length} artifacts from response`);
    } catch (error) {
      console.warn('[ChatService] Failed to extract artifacts:', error);
    }
  }

  /**
   * Extract and save memories from user message text
   * This is called asynchronously to avoid blocking the response
   */
  private async extractMemoriesFromText(text: string, conversationId: string): Promise<void> {
    console.log(`[ChatService] extractMemoriesFromText called for user ${this.userId}, text: "${text.slice(0, 100)}..."`);
    try {
      const memoryService = createMemoryService(this.db, this.vectorize, this.ai);
      console.log(`[ChatService] Created memory service with Vectorize=${!!this.vectorize}, AI=${!!this.ai}`);
      const extracted = await memoryService.extractFromText(this.userId, text, conversationId);
      
      if (extracted.length > 0) {
        console.log(`[ChatService] SUCCESS: Extracted ${extracted.length} memories from user message for user ${this.userId}`);
        for (const mem of extracted) {
          console.log(`[ChatService] Saved memory: type=${mem.type}, key=${mem.key}, value="${mem.value}"`);
        }
      } else {
        console.log(`[ChatService] No memories extracted from: "${text.slice(0, 50)}..."`);
      }
    } catch (error) {
      console.error('[ChatService] Failed to extract memories:', error);
      throw error; // Re-throw so caller can log it too
    }
  }

  /**
   * Generate a title using AI (called asynchronously after first response)
   */
  private async generateTitleAsync(
    conversationId: string,
    userText: string,
    assistantText: string
  ): Promise<void> {
    try {
      // Use a fast/cheap model for title generation
      const titleModel = 'gpt-4o-mini';
      const provider = this.getProvider('openai');
      
      const titlePrompt = `Generate a concise title (max 6 words) for this conversation:

User: ${userText.slice(0, 500)}
Assistant: ${assistantText.slice(0, 500)}

Title (no quotes, no punctuation at end):`;

      const response = await provider.chat({
        model: titleModel,
        messages: [{ role: 'user', content: titlePrompt }],
        temperature: 0.7,
        maxTokens: 30,
      });
      
      let title = response.content.trim();
      // Clean up the title
      title = title.replace(/^["']|["']$/g, ''); // Remove quotes
      title = title.replace(/[.!?]$/, ''); // Remove trailing punctuation
      title = title.slice(0, 60); // Max 60 chars
      
      if (title) {
        await conversationsDb.update(this.db, conversationId, { title }, this.userId);
      }
    } catch (error) {
      // Title generation is non-critical, just log and continue
      console.warn('[ChatService] Title generation failed:', error);
    }
  }

  /**
   * Verify conversation ownership
   * @throws Error if conversation doesn't exist or user doesn't own it
   */
  private async verifyConversationOwnership(conversationId: string): Promise<void> {
    const conversation = await conversationsDb.findByIdForUser(this.db, conversationId, this.userId);
    if (!conversation) {
      throw new Error('Conversation not found or access denied');
    }
  }

  /**
   * Send a message and get a response (non-streaming)
   */
  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    const provider = this.getProvider(request.endpoint);
    
    // Create or get conversation
    let conversationId = request.conversationId;
    let isNewConversation = false;
    
    if (!conversationId) {
      isNewConversation = true;
      conversationId = crypto.randomUUID();
      
      const title = await this.generateTitle(request.text);
      await conversationsDb.create(this.db, {
        id: conversationId,
        userId: this.userId,
        title,
        endpoint: request.endpoint,
        model: request.model,
      });
    } else {
      // Verify user owns this conversation
      await this.verifyConversationOwnership(conversationId);
    }
    
    // Get RAG context if enabled
    let ragContext: RAGContext | null = null;
    if (request.enableRAG) {
      ragContext = await this.getRAGContext(request.text, request.ragFileIds);
    }
    
    // Get memory context (enabled by default for personalization)
    let memoryContext: MemoryContext | null = null;
    if (request.enableMemory !== false) {
      memoryContext = await this.getMemoryContext(request.text);
    }
    
    // Build system prompt with RAG and memory context
    let systemPrompt = this.buildSystemPromptWithRAG(request.systemPrompt, ragContext);
    systemPrompt = this.buildSystemPromptWithMemory(systemPrompt, memoryContext);
    
    // Build conversation history with context compaction
    const { messages: history, excludedCount, summary } = await this.buildConversationHistory(
      conversationId,
      request.parentMessageId,
      request.model,
      systemPrompt,
      request.contextStrategy || 'discard'
    );
    
    // Add system prompt if provided
    const messages: ChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    
    // Add summary context if available and messages were excluded
    if (summary && excludedCount > 0) {
      messages.push(createSummarySystemMessage(summary));
    }
    
    // Add history (already compacted to fit context)
    messages.push(...history);
    
    // Build user message content (with images if provided)
    const userMessageContent = await this.buildMessageWithImages(request.text, request.files);
    
    // Calculate user message token count
    const userMessageTokens = countMessageTokens(
      { role: 'user', content: request.text }, // Use text only for token counting
      request.model
    );
    
    // Add user message
    const userMessageId = crypto.randomUUID();
    messages.push({ role: 'user', content: userMessageContent });
    
    // Save user message to database with token count
    // Store attachments as JSON in the attachments column
    const attachments = request.files?.length ? JSON.stringify(request.files) : null;
    await messagesDb.create(this.db, {
      id: userMessageId,
      conversationId,
      parentMessageId: request.parentMessageId,
      role: 'user',
      content: request.text,
      model: request.model,
      endpoint: request.endpoint,
      tokenCount: userMessageTokens,
      attachments,
    });
    
    // Build chat request
    const chatRequest: ChatRequest = {
      model: request.model,
      messages,
      temperature: request.temperature,
      topP: request.topP,
      maxTokens: request.maxTokens,
      stream: false,
    };
    
    // Send to provider
    const response = await provider.chat(chatRequest);
    
    // Calculate assistant message token count
    const assistantMessageTokens = countMessageTokens(
      { role: 'assistant', content: response.content },
      request.model
    );
    
    // Save assistant message to database with token count
    const assistantMessageId = crypto.randomUUID();
    await messagesDb.create(this.db, {
      id: assistantMessageId,
      conversationId,
      parentMessageId: userMessageId,
      role: 'assistant',
      content: response.content,
      model: response.model,
      endpoint: request.endpoint,
      tokenCount: assistantMessageTokens,
      finishReason: response.finishReason || undefined,
    });
    
    // Update conversation timestamp
    await conversationsDb.update(this.db, conversationId, {}, this.userId);
    
    // Run background tasks in parallel and AWAIT them before returning response
    // This is critical for Cloudflare Workers - fire-and-forget tasks may be dropped
    const backgroundTasks: Promise<void>[] = [];
    
    // Generate better title for new conversations
    if (isNewConversation) {
      backgroundTasks.push(
        this.generateTitleAsync(conversationId, request.text, response.content).catch((err) => {
          console.error('[ChatService] Title generation failed:', err);
        })
      );
    }
    
    // Extract memories from user message
    if (request.enableMemory !== false) {
      backgroundTasks.push(
        this.extractMemoriesFromText(request.text, conversationId).catch((err) => {
          console.error('[ChatService] Memory extraction failed:', err);
        })
      );
    }
    
    // Extract and save artifacts from response
    if (request.enableArtifacts !== false) {
      backgroundTasks.push(
        this.extractAndSaveArtifacts(conversationId, assistantMessageId, response.content).catch((err) => {
          console.error('[ChatService] Artifact extraction failed:', err);
        })
      );
    }
    
    // Wait for all background tasks to complete
    if (backgroundTasks.length > 0) {
      console.log(`[ChatService] Awaiting ${backgroundTasks.length} background tasks...`);
      await Promise.all(backgroundTasks);
      console.log(`[ChatService] Background tasks completed`);
    }
    
    return {
      conversationId,
      messageId: assistantMessageId,
      parentMessageId: userMessageId,
      userMessageId,
      text: response.content,
      model: response.model,
      endpoint: request.endpoint,
      finish_reason: response.finishReason || undefined,
      tokenCount: response.usage?.totalTokens,
    };
  }

  /**
   * Send a message and stream the response
   * Returns a ReadableStream for SSE
   */
  async sendMessageStream(
    request: SendMessageRequest,
    callbacks?: StreamCallbacks
  ): Promise<ReadableStream<Uint8Array>> {
    const provider = this.getProvider(request.endpoint);
    const encoder = new TextEncoder();
    
    // Create or get conversation
    let conversationId = request.conversationId;
    let isNewConversation = false;
    
    if (!conversationId) {
      isNewConversation = true;
      conversationId = crypto.randomUUID();
      
      const title = await this.generateTitle(request.text);
      await conversationsDb.create(this.db, {
        id: conversationId,
        userId: this.userId,
        title,
        endpoint: request.endpoint,
        model: request.model,
      });
    } else {
      // Verify user owns this conversation
      await this.verifyConversationOwnership(conversationId);
    }
    
    // Get RAG context if enabled
    let ragContext: RAGContext | null = null;
    if (request.enableRAG) {
      ragContext = await this.getRAGContext(request.text, request.ragFileIds);
    }
    
    // Get memory context (enabled by default for personalization)
    let memoryContext: MemoryContext | null = null;
    if (request.enableMemory !== false) {
      memoryContext = await this.getMemoryContext(request.text);
    }
    
    // Build system prompt with RAG and memory context
    let systemPrompt = this.buildSystemPromptWithRAG(request.systemPrompt, ragContext);
    systemPrompt = this.buildSystemPromptWithMemory(systemPrompt, memoryContext);
    
    // Build conversation history with context compaction
    const { messages: history, excludedCount, summary } = await this.buildConversationHistory(
      conversationId,
      request.parentMessageId,
      request.model,
      systemPrompt,
      request.contextStrategy || 'discard'
    );
    
    // Add system prompt if provided
    const messages: ChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    
    // Add summary context if available and messages were excluded
    if (summary && excludedCount > 0) {
      messages.push(createSummarySystemMessage(summary));
    }
    
    // Add history (already compacted)
    messages.push(...history);
    
    // Build user message content (with images if provided)
    const userMessageContent = await this.buildMessageWithImages(request.text, request.files);
    
    // Calculate user message token count
    const userMessageTokens = countMessageTokens(
      { role: 'user', content: request.text }, // Use text only for token counting
      request.model
    );
    
    // Add user message
    const userMessageId = crypto.randomUUID();
    messages.push({ role: 'user', content: userMessageContent });
    
    // Save user message to database with token count
    const attachments = request.files?.length ? JSON.stringify(request.files) : null;
    await messagesDb.create(this.db, {
      id: userMessageId,
      conversationId,
      parentMessageId: request.parentMessageId,
      role: 'user',
      content: request.text,
      model: request.model,
      endpoint: request.endpoint,
      tokenCount: userMessageTokens,
      attachments,
    });
    
    const assistantMessageId = crypto.randomUUID();
    const db = this.db;
    const self = this; // Capture reference for async closure
    const newConversation = isNewConversation;
    
    // Create the stream
    const { readable, writable } = new TransformStream<Uint8Array>();
    const writer = writable.getWriter();
    
    // Process streaming in background
    (async () => {
      let fullContent = '';
      let finishReason = 'stop';
      let tokenCount = 0;
      
      try {
        // Send start event
        const startData = {
          conversationId,
          messageId: assistantMessageId,
          parentMessageId: userMessageId,
          model: request.model,
          endpoint: request.endpoint,
        };
        await writer.write(encoder.encode(
          `event: start\ndata: ${JSON.stringify(startData)}\n\n`
        ));
        callbacks?.onStart?.(startData);
        
        // Build chat request
        const chatRequest: ChatRequest = {
          model: request.model,
          messages,
          temperature: request.temperature,
          topP: request.topP,
          maxTokens: request.maxTokens,
          stream: true,
        };
        
        // Stream from provider with abort signal
        const stream = provider.stream(chatRequest, request.signal);
        
        // Track chunk count for periodic abort check
        let chunkCount = 0;
        let wasAborted = false;
        
        for await (const chunk of stream) {
          // Check for client abort signal
          if (request.signal?.aborted) {
            wasAborted = true;
            finishReason = 'cancelled';
            break;
          }
          
          // Periodically check KV for abort status (every 10 chunks to avoid excessive KV reads)
          chunkCount++;
          if (chunkCount % 10 === 0) {
            const aborted = await self.isAborted(conversationId!, assistantMessageId);
            if (aborted) {
              wasAborted = true;
              finishReason = 'cancelled';
              console.log(`[ChatService] Stream aborted via KV for message ${assistantMessageId}`);
              break;
            }
          }
          
          if (chunk.delta?.content) {
            fullContent += chunk.delta.content;
            
            // Send message event
            await writer.write(encoder.encode(
              `event: message\ndata: ${JSON.stringify({ text: chunk.delta.content, messageId: assistantMessageId })}\n\n`
            ));
            callbacks?.onToken?.(chunk.delta.content);
          }
          
          if (chunk.finishReason) {
            finishReason = chunk.finishReason;
          }
          
          if (chunk.usage) {
            tokenCount = chunk.usage.totalTokens || 0;
          }
          
          // Handle tool calls
          if (chunk.delta?.toolCalls) {
            for (const toolCall of chunk.delta.toolCalls) {
              if (toolCall.function?.name) {
                await writer.write(encoder.encode(
                  `event: tool\ndata: ${JSON.stringify({ 
                    tool: toolCall.function.name, 
                    input: toolCall.function.arguments || ''
                  })}\n\n`
                ));
                callbacks?.onToolCall?.(toolCall.function.name, toolCall.function.arguments || '');
              }
            }
          }
        }
        
        // If aborted, send abort event
        if (wasAborted) {
          await writer.write(encoder.encode(
            `event: abort\ndata: ${JSON.stringify({ messageId: assistantMessageId, content: fullContent })}\n\n`
          ));
          // Clear the abort flag
          await self.clearAborted(conversationId!, assistantMessageId);
        }
        
        // Calculate token count from content if not provided by API
        const assistantMessageTokens = tokenCount || countMessageTokens(
          { role: 'assistant', content: fullContent },
          request.model
        );
        
        // Save assistant message to database with accurate token count
        await messagesDb.create(db, {
          id: assistantMessageId,
          conversationId: conversationId!,
          parentMessageId: userMessageId,
          role: 'assistant',
          content: fullContent,
          model: request.model,
          endpoint: request.endpoint,
          tokenCount: assistantMessageTokens,
          finishReason,
        });
        
        // Update conversation timestamp
        await conversationsDb.update(db, conversationId!, {}, self.userId);
        
        // Run background tasks in parallel and AWAIT them before sending done event
        // This is critical for Cloudflare Workers - fire-and-forget tasks may be dropped
        // when the worker terminates after the response is sent
        const backgroundTasks: Promise<void>[] = [];
        
        // Generate better title for new conversations
        if (newConversation && fullContent) {
          backgroundTasks.push(
            self.generateTitleAsync(conversationId!, request.text, fullContent).catch((err) => {
              console.error('[ChatService] Title generation failed (stream):', err);
            })
          );
        }
        
        // Extract memories from user message
        if (request.enableMemory !== false) {
          backgroundTasks.push(
            self.extractMemoriesFromText(request.text, conversationId!).catch((err) => {
              console.error('[ChatService] Memory extraction failed (stream):', err);
            })
          );
        }
        
        // Extract and save artifacts from response
        if (request.enableArtifacts !== false && fullContent) {
          backgroundTasks.push(
            self.extractAndSaveArtifacts(conversationId!, assistantMessageId, fullContent).catch((err) => {
              console.error('[ChatService] Artifact extraction failed (stream):', err);
            })
          );
        }
        
        // Wait for all background tasks to complete before closing stream
        if (backgroundTasks.length > 0) {
          console.log(`[ChatService] Awaiting ${backgroundTasks.length} background tasks...`);
          await Promise.all(backgroundTasks);
          console.log(`[ChatService] Background tasks completed`);
        }
        
        // Send done event
        const doneData: SendMessageResponse = {
          conversationId: conversationId!,
          messageId: assistantMessageId,
          parentMessageId: userMessageId,
          userMessageId,
          text: fullContent,
          model: request.model,
          endpoint: request.endpoint,
          finish_reason: finishReason,
          tokenCount: assistantMessageTokens,
        };
        await writer.write(encoder.encode(
          `event: done\ndata: ${JSON.stringify(doneData)}\n\n`
        ));
        callbacks?.onDone?.(doneData);
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // Save error state to message
        await messagesDb.create(db, {
          id: assistantMessageId,
          conversationId: conversationId!,
          parentMessageId: userMessageId,
          role: 'assistant',
          content: `Error: ${errorMessage}`,
          model: request.model,
          endpoint: request.endpoint,
        }).catch(() => {});
        
        await writer.write(encoder.encode(
          `event: error\ndata: ${JSON.stringify({ message: errorMessage })}\n\n`
        ));
        callbacks?.onError?.(error instanceof Error ? error : new Error(errorMessage));
      } finally {
        await writer.close();
      }
    })();
    
    return readable;
  }

  /**
   * Abort an in-progress message
   * Uses KV to signal the streaming worker to stop
   */
  async abortMessage(conversationId: string, messageId: string): Promise<boolean> {
    // Verify user owns this conversation first
    await this.verifyConversationOwnership(conversationId);
    
    // Mark as aborted in KV - this will be picked up by the streaming loop
    await this.markAborted(conversationId, messageId);
    
    console.log(`[ChatService] Abort requested for conversation ${conversationId}, message ${messageId}`);
    
    // Note: The actual message content update happens in the streaming loop
    // when it detects the abort signal. We don't update the message here
    // because the stream is still writing to it.
    
    return true;
  }

  /**
   * Regenerate a response for a message
   */
  async regenerateMessage(
    conversationId: string,
    messageId: string,
    options?: Partial<SendMessageRequest>
  ): Promise<SendMessageResponse> {
    // CRITICAL: Verify user owns this conversation first
    await this.verifyConversationOwnership(conversationId);
    
    // Get the original message (use findByIdForUser for tenant isolation)
    const message = await messagesDb.findByIdForUser(this.db, messageId, this.userId);
    if (!message) {
      throw new Error('Message not found');
    }
    
    // Get the conversation (already verified ownership above)
    const conversation = await conversationsDb.findByIdForUser(this.db, conversationId, this.userId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    
    // Find the user message that triggered this response (use findByIdForUser for tenant isolation)
    const userMessage = message.parentMessageId
      ? await messagesDb.findByIdForUser(this.db, message.parentMessageId, this.userId)
      : null;
    
    if (!userMessage || userMessage.role !== 'user') {
      throw new Error('Cannot find user message to regenerate from');
    }
    
    // Send a new message from the same parent
    return this.sendMessage({
      conversationId,
      parentMessageId: userMessage.parentMessageId || undefined,
      endpoint: options?.endpoint || conversation.endpoint,
      model: options?.model || conversation.model,
      text: userMessage.content,
      systemPrompt: options?.systemPrompt,
      temperature: options?.temperature,
      topP: options?.topP,
      maxTokens: options?.maxTokens,
    });
  }

  /**
   * Edit a user message and get a new response
   */
  async editMessage(
    conversationId: string,
    messageId: string,
    newText: string,
    options?: Partial<SendMessageRequest>
  ): Promise<SendMessageResponse> {
    // CRITICAL: Verify user owns this conversation first
    await this.verifyConversationOwnership(conversationId);
    
    // Get the original message (use findByIdForUser for tenant isolation)
    const message = await messagesDb.findByIdForUser(this.db, messageId, this.userId);
    if (!message) {
      throw new Error('Message not found');
    }
    
    if (message.role !== 'user') {
      throw new Error('Can only edit user messages');
    }
    
    // Get the conversation (already verified ownership above)
    const conversation = await conversationsDb.findByIdForUser(this.db, conversationId, this.userId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    
    // Send a new message from the same parent (creating a branch)
    return this.sendMessage({
      conversationId,
      parentMessageId: message.parentMessageId || undefined,
      endpoint: options?.endpoint || conversation.endpoint,
      model: options?.model || conversation.model,
      text: newText,
      systemPrompt: options?.systemPrompt,
      temperature: options?.temperature,
      topP: options?.topP,
      maxTokens: options?.maxTokens,
    });
  }

  /**
   * Continue a conversation from a specific message
   */
  async continueFromMessage(
    conversationId: string,
    messageId: string,
    text: string,
    options?: Partial<SendMessageRequest>
  ): Promise<SendMessageResponse> {
    // CRITICAL: Verify user owns this conversation first
    await this.verifyConversationOwnership(conversationId);
    
    // Get the conversation (already verified ownership above)
    const conversation = await conversationsDb.findByIdForUser(this.db, conversationId, this.userId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    
    return this.sendMessage({
      conversationId,
      parentMessageId: messageId,
      endpoint: options?.endpoint || conversation.endpoint,
      model: options?.model || conversation.model,
      text,
      systemPrompt: options?.systemPrompt,
      temperature: options?.temperature,
      topP: options?.topP,
      maxTokens: options?.maxTokens,
    });
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a chat service instance
 */
export function createChatService(env: Env, userId: string): ChatService {
  return new ChatService({ env, userId });
}
