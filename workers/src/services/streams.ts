/**
 * Resumable Streams Service
 * Enables stream recovery if connection drops during AI response generation.
 * 
 * Features:
 * - Stores stream state in KV for recovery
 * - Multi-tab and multi-device sync
 * - Automatic cleanup of completed/expired streams
 */

// =============================================================================
// Types
// =============================================================================

export interface StreamState {
  id: string;
  conversationId: string;
  messageId: string;
  userId: string;
  model: string;
  endpoint: string;
  status: 'generating' | 'completed' | 'failed' | 'cancelled';
  content: string;
  tokenCount: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  finishReason?: string;
}

export interface StreamChunkData {
  index: number;
  content: string;
  timestamp: number;
}

export interface StreamRecoveryResult {
  state: StreamState;
  chunks: StreamChunkData[];
  canResume: boolean;
}

const STREAM_TTL = 60 * 60; // 1 hour
const CHUNK_BATCH_SIZE = 50; // Store chunks in batches

// =============================================================================
// Resumable Streams Service
// =============================================================================

export class ResumableStreamService {
  private kv: KVNamespace;

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  /**
   * Create a new stream state
   */
  async createStream(params: {
    conversationId: string;
    messageId: string;
    userId: string;
    model: string;
    endpoint: string;
  }): Promise<StreamState> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const state: StreamState = {
      id,
      conversationId: params.conversationId,
      messageId: params.messageId,
      userId: params.userId,
      model: params.model,
      endpoint: params.endpoint,
      status: 'generating',
      content: '',
      tokenCount: 0,
      startedAt: now,
      updatedAt: now,
    };

    // Store stream state
    await this.kv.put(
      this.getStreamKey(id),
      JSON.stringify(state),
      { expirationTtl: STREAM_TTL }
    );

    // Store message-to-stream mapping for lookup
    await this.kv.put(
      this.getMessageStreamKey(params.messageId),
      id,
      { expirationTtl: STREAM_TTL }
    );

    // Initialize chunk storage
    await this.kv.put(
      this.getChunksKey(id),
      JSON.stringify([]),
      { expirationTtl: STREAM_TTL }
    );

    return state;
  }

  /**
   * Append content to stream
   */
  async appendContent(streamId: string, content: string): Promise<void> {
    const state = await this.getStream(streamId);
    if (!state || state.status !== 'generating') return;

    // Update state
    state.content += content;
    state.tokenCount += Math.ceil(content.length / 4); // Rough estimate
    state.updatedAt = new Date().toISOString();

    await this.kv.put(
      this.getStreamKey(streamId),
      JSON.stringify(state),
      { expirationTtl: STREAM_TTL }
    );

    // Store chunk for recovery
    const chunksData = await this.kv.get(this.getChunksKey(streamId));
    const chunks: StreamChunkData[] = chunksData ? JSON.parse(chunksData) : [];
    
    chunks.push({
      index: chunks.length,
      content,
      timestamp: Date.now(),
    });

    // Only keep recent chunks to limit storage
    const recentChunks = chunks.slice(-1000);
    
    await this.kv.put(
      this.getChunksKey(streamId),
      JSON.stringify(recentChunks),
      { expirationTtl: STREAM_TTL }
    );
  }

  /**
   * Mark stream as completed
   */
  async completeStream(streamId: string, finishReason?: string): Promise<void> {
    const state = await this.getStream(streamId);
    if (!state) return;

    state.status = 'completed';
    state.completedAt = new Date().toISOString();
    state.updatedAt = state.completedAt;
    state.finishReason = finishReason;

    await this.kv.put(
      this.getStreamKey(streamId),
      JSON.stringify(state),
      { expirationTtl: STREAM_TTL }
    );
  }

  /**
   * Mark stream as failed
   */
  async failStream(streamId: string, error: string): Promise<void> {
    const state = await this.getStream(streamId);
    if (!state) return;

    state.status = 'failed';
    state.error = error;
    state.updatedAt = new Date().toISOString();

    await this.kv.put(
      this.getStreamKey(streamId),
      JSON.stringify(state),
      { expirationTtl: STREAM_TTL }
    );
  }

  /**
   * Cancel a stream
   */
  async cancelStream(streamId: string): Promise<void> {
    const state = await this.getStream(streamId);
    if (!state) return;

    state.status = 'cancelled';
    state.updatedAt = new Date().toISOString();

    await this.kv.put(
      this.getStreamKey(streamId),
      JSON.stringify(state),
      { expirationTtl: STREAM_TTL }
    );
  }

  /**
   * Get stream state
   */
  async getStream(streamId: string): Promise<StreamState | null> {
    const data = await this.kv.get(this.getStreamKey(streamId));
    return data ? JSON.parse(data) : null;
  }

  /**
   * Get stream by message ID
   */
  async getStreamByMessage(messageId: string): Promise<StreamState | null> {
    const streamId = await this.kv.get(this.getMessageStreamKey(messageId));
    if (!streamId) return null;
    return this.getStream(streamId);
  }

  /**
   * Recover stream data for resumption
   */
  async recoverStream(streamId: string, fromIndex: number = 0): Promise<StreamRecoveryResult | null> {
    const state = await this.getStream(streamId);
    if (!state) return null;

    const chunksData = await this.kv.get(this.getChunksKey(streamId));
    const allChunks: StreamChunkData[] = chunksData ? JSON.parse(chunksData) : [];
    
    // Get chunks from the requested index
    const chunks = allChunks.filter(c => c.index >= fromIndex);

    return {
      state,
      chunks,
      canResume: state.status === 'generating',
    };
  }

  /**
   * Get active streams for a user
   */
  async getActiveStreams(userId: string): Promise<StreamState[]> {
    // Note: KV doesn't support listing by prefix efficiently in all cases
    // In production, you might use a different approach or Durable Objects
    // This is a simplified implementation
    return [];
  }

  /**
   * Clean up old stream data
   */
  async cleanup(streamId: string): Promise<void> {
    await Promise.all([
      this.kv.delete(this.getStreamKey(streamId)),
      this.kv.delete(this.getChunksKey(streamId)),
    ]);
  }

  // Key generators
  private getStreamKey(streamId: string): string {
    return `stream:${streamId}`;
  }

  private getChunksKey(streamId: string): string {
    return `stream:${streamId}:chunks`;
  }

  private getMessageStreamKey(messageId: string): string {
    return `message-stream:${messageId}`;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createResumableStreamService(kv: KVNamespace): ResumableStreamService {
  return new ResumableStreamService(kv);
}

// =============================================================================
// SSE Helpers for Resumable Streams
// =============================================================================

/**
 * Create SSE response headers with stream ID for recovery
 */
export function createResumableSSEHeaders(streamId: string): Headers {
  return new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Stream-Id': streamId,
    'X-Accel-Buffering': 'no',
  });
}

/**
 * Format SSE message with index for recovery
 */
export function formatResumableSSE(index: number, data: unknown): string {
  return `id: ${index}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Parse Last-Event-ID header for stream recovery
 */
export function parseLastEventId(header: string | null): number {
  if (!header) return 0;
  const parsed = parseInt(header, 10);
  return isNaN(parsed) ? 0 : parsed;
}
