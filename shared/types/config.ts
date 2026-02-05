/**
 * Application configuration type definitions
 */

// Environment bindings for Cloudflare Workers
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
  
  // Optional: Workers AI
  AI?: Ai;
  
  // Environment variables
  APP_TITLE: string;
  DOMAIN_SERVER: string;
  DOMAIN_CLIENT: string;
  
  // Auth settings
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  SESSION_EXPIRY: string;
  REFRESH_TOKEN_EXPIRY: string;
  
  // Feature flags
  ALLOW_EMAIL_LOGIN: string;
  ALLOW_REGISTRATION: string;
  ALLOW_SOCIAL_LOGIN: string;
  ALLOW_SOCIAL_REGISTRATION: string;
  
  // OAuth providers (optional)
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  
  // AI Provider API Keys (optional - can also be user-provided)
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_AI_API_KEY?: string;
  AZURE_OPENAI_API_KEY?: string;
  AZURE_OPENAI_ENDPOINT?: string;
  
  // Email (optional)
  EMAIL_SERVICE?: string;
  EMAIL_FROM?: string;
  EMAIL_API_KEY?: string;
  
  // Rate limiting
  RATE_LIMIT_WINDOW_MS?: string;
  RATE_LIMIT_MAX_REQUESTS?: string;
  
  // File upload limits
  MAX_FILE_SIZE?: string;
  MAX_IMAGE_SIZE?: string;
}

// Application configuration (parsed from env)
export interface AppConfig {
  appTitle: string;
  domainServer: string;
  domainClient: string;
  
  auth: AuthConfig;
  providers: ProvidersConfig;
  features: FeaturesConfig;
  limits: LimitsConfig;
  email: EmailConfig;
}

export interface AuthConfig {
  jwtSecret: string;
  jwtRefreshSecret: string;
  sessionExpiry: number;
  refreshTokenExpiry: number;
  allowEmailLogin: boolean;
  allowRegistration: boolean;
  allowSocialLogin: boolean;
  allowSocialRegistration: boolean;
}

export interface ProvidersConfig {
  openai: {
    enabled: boolean;
    apiKey?: string;
    userProvide: boolean;
  };
  anthropic: {
    enabled: boolean;
    apiKey?: string;
    userProvide: boolean;
  };
  google: {
    enabled: boolean;
    apiKey?: string;
    userProvide: boolean;
  };
  azure: {
    enabled: boolean;
    apiKey?: string;
    endpoint?: string;
    userProvide: boolean;
  };
}

export interface FeaturesConfig {
  checkBalance: boolean;
  imageGeneration: boolean;
  codeInterpreter: boolean;
  webSearch: boolean;
  rag: boolean;
}

export interface LimitsConfig {
  maxFileSize: number;
  maxImageSize: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  maxConversationsPerUser: number;
  maxMessagesPerConversation: number;
  maxFilesPerUser: number;
}

export interface EmailConfig {
  enabled: boolean;
  service?: string;
  from?: string;
  apiKey?: string;
}

// Helper function to parse config from env
export function parseConfig(env: Env): AppConfig {
  return {
    appTitle: env.APP_TITLE || 'L_EXE',
    domainServer: env.DOMAIN_SERVER,
    domainClient: env.DOMAIN_CLIENT,
    
    auth: {
      jwtSecret: env.JWT_SECRET,
      jwtRefreshSecret: env.JWT_REFRESH_SECRET,
      sessionExpiry: parseExpiry(env.SESSION_EXPIRY),
      refreshTokenExpiry: parseExpiry(env.REFRESH_TOKEN_EXPIRY),
      allowEmailLogin: env.ALLOW_EMAIL_LOGIN === 'true',
      allowRegistration: env.ALLOW_REGISTRATION === 'true',
      allowSocialLogin: env.ALLOW_SOCIAL_LOGIN === 'true',
      allowSocialRegistration: env.ALLOW_SOCIAL_REGISTRATION === 'true',
    },
    
    providers: {
      openai: {
        enabled: !!env.OPENAI_API_KEY,
        apiKey: env.OPENAI_API_KEY,
        userProvide: !env.OPENAI_API_KEY,
      },
      anthropic: {
        enabled: !!env.ANTHROPIC_API_KEY,
        apiKey: env.ANTHROPIC_API_KEY,
        userProvide: !env.ANTHROPIC_API_KEY,
      },
      google: {
        enabled: !!env.GOOGLE_AI_API_KEY,
        apiKey: env.GOOGLE_AI_API_KEY,
        userProvide: !env.GOOGLE_AI_API_KEY,
      },
      azure: {
        enabled: !!env.AZURE_OPENAI_API_KEY,
        apiKey: env.AZURE_OPENAI_API_KEY,
        endpoint: env.AZURE_OPENAI_ENDPOINT,
        userProvide: !env.AZURE_OPENAI_API_KEY,
      },
    },
    
    features: {
      checkBalance: false,
      imageGeneration: true,
      codeInterpreter: false,
      webSearch: false,
      rag: !!env.VECTORIZE,
    },
    
    limits: {
      maxFileSize: parseInt(env.MAX_FILE_SIZE || '52428800', 10), // 50MB
      maxImageSize: parseInt(env.MAX_IMAGE_SIZE || '20971520', 10), // 20MB
      rateLimitWindowMs: parseInt(env.RATE_LIMIT_WINDOW_MS || '60000', 10),
      rateLimitMaxRequests: parseInt(env.RATE_LIMIT_MAX_REQUESTS || '60', 10),
      maxConversationsPerUser: 1000,
      maxMessagesPerConversation: 10000,
      maxFilesPerUser: 500,
    },
    
    email: {
      enabled: !!env.EMAIL_API_KEY,
      service: env.EMAIL_SERVICE,
      from: env.EMAIL_FROM,
      apiKey: env.EMAIL_API_KEY,
    },
  };
}

function parseExpiry(value: string): number {
  if (!value) return 15 * 60 * 1000; // 15 minutes default
  try {
    // Handle expressions like "1000 * 60 * 15"
    // eslint-disable-next-line no-eval
    return eval(value);
  } catch {
    return parseInt(value, 10) || 15 * 60 * 1000;
  }
}
