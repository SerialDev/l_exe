/**
 * Cloudflare Workers environment bindings type
 */

import type { Context } from 'hono';

// Environment bindings from wrangler.toml
export interface Env {
  // D1 Database
  DB: D1Database;
  
  // R2 Buckets
  FILES_BUCKET: R2Bucket;
  IMAGES_BUCKET: R2Bucket;
  
  // KV Namespaces
  SESSIONS: KVNamespace;
  RATE_LIMIT: KVNamespace;
  
  // Optional: Vectorize for RAG
  VECTORIZE?: VectorizeIndex;
  
  // Vectorize for memory similarity search
  MEMORY_VECTORIZE?: VectorizeIndex;
  
  // Workers AI (for embeddings)
  AI?: Ai;
  
  // Optional: Durable Objects
  CONVERSATIONS?: DurableObjectNamespace;
  
  // Environment variables
  APP_TITLE: string;
  DOMAIN_SERVER: string;
  DOMAIN_CLIENT: string;
  
  // Auth settings (secrets - set via wrangler secret put)
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  SESSION_EXPIRY: string;
  REFRESH_TOKEN_EXPIRY: string;
  
  // Feature flags
  ALLOW_EMAIL_LOGIN: string;
  ALLOW_REGISTRATION: string;
  ALLOW_SOCIAL_LOGIN: string;
  ALLOW_SOCIAL_REGISTRATION: string;
  
  // OAuth providers (optional secrets)
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  
  // AI Provider API Keys (optional secrets)
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_AI_API_KEY?: string;
  AZURE_OPENAI_API_KEY?: string;
  AZURE_OPENAI_ENDPOINT?: string;
  GROQ_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OLLAMA_BASE_URL?: string;
  
  // Web Search
  SEARCH_PROVIDER?: string;
  SERPER_API_KEY?: string;
  SEARXNG_URL?: string;
  BRAVE_SEARCH_API_KEY?: string;
  TAVILY_API_KEY?: string;
  
  // Code Interpreter
  CODE_INTERPRETER_BACKEND?: string;
  E2B_API_KEY?: string;
  JUDGE0_URL?: string;
  JUDGE0_API_KEY?: string;
  
  // Speech
  STT_PROVIDER?: string;
  TTS_PROVIDER?: string;
  AZURE_SPEECH_KEY?: string;
  AZURE_SPEECH_REGION?: string;
  ELEVENLABS_API_KEY?: string;
  DEEPGRAM_API_KEY?: string;
  DEFAULT_TTS_VOICE?: string;
  
  // Image Generation
  IMAGE_GEN_PROVIDER?: string;
  STABILITY_API_KEY?: string;
  REPLICATE_API_KEY?: string;
  
  // Moderation
  MODERATION_ENABLED?: string;
  MODERATION_BLOCKED_WORDS?: string;
  MODERATION_BLOCK_ON_VIOLATION?: string;
  
  // Email configuration (optional secrets)
  EMAIL_SERVICE?: string;
  EMAIL_FROM?: string;
  EMAIL_API_KEY?: string;
  
  // Rate limiting config
  RATE_LIMIT_WINDOW_MS?: string;
  RATE_LIMIT_MAX_REQUESTS?: string;
  
  // File upload limits
  MAX_FILE_SIZE?: string;
  MAX_IMAGE_SIZE?: string;
  
  // Access Control (comma-separated email lists)
  ADMIN_EMAILS?: string;    // Emails that get admin tier automatically
  ALLOWED_EMAILS?: string;  // Emails that get pro tier automatically
  
  // Stripe (for future billing integration)
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID_BASIC?: string;
  STRIPE_PRICE_ID_PRO?: string;
}

// Authenticated user attached to context
export interface AuthUser {
  id: string;
  email: string;
  username: string;
  name: string;
  role: 'user' | 'admin' | 'super';
  avatar: string | null;
}

// Import service types for Variables interface
import type { WebSearchService } from './services/websearch';
import type { ImageGenService } from './services/imagegen';
import type { SpeechService } from './services/speech';
import type { CodeInterpreterService } from './services/codeinterpreter';

// Extended context variables
export interface Variables {
  userId?: string;  // Convenience accessor for user.id
  user?: AuthUser;  // Full authenticated user object
  requestId: string;
  startTime: number;
  // Service instances set by middleware
  searchService?: WebSearchService | null;
  imageService?: ImageGenService | null;
  speechService?: SpeechService;
  interpreter?: CodeInterpreterService;
  // Subscription context (set by subscription middleware)
  subscriptionTier?: 'free' | 'basic' | 'pro' | 'admin';
  subscriptionLimited?: boolean;
  remainingTokens?: number;
  remainingRequests?: number;
  requestBody?: any;  // Cached request body for downstream use
  usageInfo?: {       // Set by route to record usage
    tokens?: number;
    promptTokens?: number;
    completionTokens?: number;
    provider?: string;
    model?: string;
  };
}

// Hono app environment type
export type AppEnv = { Bindings: Env; Variables: Variables };

// Hono context type with our bindings and variables
export type AppContext = Context<AppEnv>;

// Helper type for route handlers
export type RouteHandler = (c: AppContext) => Response | Promise<Response>;

// Database result types
export interface D1Result<T> {
  results: T[];
  success: boolean;
  error?: string;
  meta?: {
    duration: number;
    changes: number;
    last_row_id: number;
    served_by: string;
  };
}

// R2 metadata type
export interface R2ObjectMetadata {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

// KV metadata for sessions
export interface SessionMetadata {
  userId: string;
  userAgent?: string;
  ipAddress?: string;
  createdAt: number;
}

// Rate limit metadata
export interface RateLimitMetadata {
  count: number;
  resetAt: number;
}
