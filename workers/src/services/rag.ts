/**
 * RAG (Retrieval Augmented Generation) Service
 * 
 * Handles document embedding, storage, and retrieval for context-aware
 * conversations with uploaded files.
 * 
 * Architecture:
 * - Uses OpenAI embeddings API for vector generation
 * - Stores vectors in D1 with a simple similarity search
 * - Retrieves relevant chunks based on semantic similarity
 */

import type { Env } from '../types';

// =============================================================================
// Types
// =============================================================================

export interface DocumentChunk {
  id: string;
  fileId: string;
  content: string;
  embedding?: number[];
  chunkIndex: number;
  metadata?: Record<string, any>;
}

export interface EmbeddingResult {
  embedding: number[];
  tokenCount: number;
}

export interface SearchResult {
  chunk: DocumentChunk;
  score: number;
  distance: number;
}

export interface RAGContext {
  query: string;
  results: SearchResult[];
  contextText: string;
}

// =============================================================================
// Constants
// =============================================================================

const CHUNK_SIZE = 1000; // Characters per chunk
const CHUNK_OVERLAP = 200; // Overlap between chunks
const MAX_RESULTS = 5; // Max chunks to return
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

// =============================================================================
// RAG Service Class
// =============================================================================

export class RAGService {
  private env: Env;
  private db: D1Database;

  constructor(env: Env) {
    this.env = env;
    this.db = env.DB;
  }

  /**
   * Generate embeddings for text using OpenAI
   */
  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    const apiKey = this.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Embedding API error: ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
      usage: { total_tokens: number };
    };

    return {
      embedding: data.data[0].embedding,
      tokenCount: data.usage.total_tokens,
    };
  }

  /**
   * Split document into chunks with overlap
   */
  chunkDocument(content: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < content.length) {
      const end = Math.min(start + chunkSize, content.length);
      let chunk = content.slice(start, end);

      // Try to break at sentence boundary
      if (end < content.length) {
        const lastSentence = chunk.lastIndexOf('. ');
        const lastNewline = chunk.lastIndexOf('\n');
        const breakPoint = Math.max(lastSentence, lastNewline);
        
        if (breakPoint > chunkSize * 0.5) {
          chunk = chunk.slice(0, breakPoint + 1);
        }
      }

      chunks.push(chunk.trim());
      start = start + chunk.length - overlap;
      
      // Prevent infinite loop
      if (start <= chunks.length * (chunkSize - overlap) - chunkSize) {
        start = end;
      }
    }

    return chunks.filter(c => c.length > 50); // Filter out tiny chunks
  }

  /**
   * Index a document for RAG
   */
  async indexDocument(
    fileId: string,
    content: string,
    userId: string,
    metadata?: Record<string, any>
  ): Promise<{ chunksCreated: number; totalTokens: number }> {
    // Split into chunks
    const chunks = this.chunkDocument(content);
    let totalTokens = 0;

    // Generate embeddings and store
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      try {
        const { embedding, tokenCount } = await this.generateEmbedding(chunk);
        totalTokens += tokenCount;

        // Store in database
        const chunkId = `${fileId}_chunk_${i}`;
        await this.db
          .prepare(`
            INSERT OR REPLACE INTO document_chunks 
            (id, file_id, user_id, content, embedding, chunk_index, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `)
          .bind(
            chunkId,
            fileId,
            userId,
            chunk,
            JSON.stringify(embedding),
            i,
            metadata ? JSON.stringify(metadata) : null
          )
          .run();
      } catch (error) {
        console.error(`[RAG] Failed to index chunk ${i}:`, error);
      }
    }

    // Mark file as embedded
    await this.db
      .prepare('UPDATE files SET embedded = 1 WHERE id = ?')
      .bind(fileId)
      .run();

    return { chunksCreated: chunks.length, totalTokens };
  }

  /**
   * Search for relevant chunks
   */
  async search(
    query: string,
    userId: string,
    fileIds?: string[],
    limit = MAX_RESULTS
  ): Promise<SearchResult[]> {
    // Generate query embedding
    const { embedding: queryEmbedding } = await this.generateEmbedding(query);

    // Build query
    let sql = `
      SELECT id, file_id, content, embedding, chunk_index, metadata
      FROM document_chunks
      WHERE user_id = ?
    `;
    const params: any[] = [userId];

    if (fileIds && fileIds.length > 0) {
      sql += ` AND file_id IN (${fileIds.map(() => '?').join(',')})`;
      params.push(...fileIds);
    }

    const results = await this.db
      .prepare(sql)
      .bind(...params)
      .all<{
        id: string;
        file_id: string;
        content: string;
        embedding: string;
        chunk_index: number;
        metadata: string | null;
      }>();

    if (!results.results || results.results.length === 0) {
      return [];
    }

    // Calculate cosine similarity for each chunk
    const scoredResults: SearchResult[] = results.results.map(row => {
      const chunkEmbedding = JSON.parse(row.embedding) as number[];
      const score = this.cosineSimilarity(queryEmbedding, chunkEmbedding);
      
      return {
        chunk: {
          id: row.id,
          fileId: row.file_id,
          content: row.content,
          chunkIndex: row.chunk_index,
          metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        },
        score,
        distance: 1 - score,
      };
    });

    // Sort by score (descending) and return top results
    return scoredResults
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Get RAG context for a query
   */
  async getContext(
    query: string,
    userId: string,
    fileIds?: string[]
  ): Promise<RAGContext> {
    const results = await this.search(query, userId, fileIds);

    // Build context text
    const contextParts = results.map((r, i) => {
      const source = r.chunk.metadata?.filename || `Document ${r.chunk.fileId}`;
      return `[Source ${i + 1}: ${source}]\n${r.chunk.content}`;
    });

    const contextText = contextParts.join('\n\n---\n\n');

    return {
      query,
      results,
      contextText,
    };
  }

  /**
   * Build a RAG-augmented prompt
   */
  buildRAGPrompt(userQuery: string, context: RAGContext): string {
    if (!context.results || context.results.length === 0) {
      return userQuery;
    }

    return `Use the following context to answer the question. If the context doesn't contain relevant information, say so.

<context>
${context.contextText}
</context>

Question: ${userQuery}

Answer based on the context provided:`;
  }

  /**
   * Delete chunks for a file
   */
  async deleteFileChunks(fileId: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM document_chunks WHERE file_id = ?')
      .bind(fileId)
      .run();
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createRAGService(env: Env): RAGService {
  return new RAGService(env);
}
