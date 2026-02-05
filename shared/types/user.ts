/**
 * User-related type definitions
 */

export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  username: string;
  name: string;
  avatar: string | null;
  provider: AuthProvider;
  providerId: string | null;
  role: UserRole;
  totpEnabled: boolean;
  totpSecret: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AuthProvider = 'local' | 'google' | 'github' | 'discord' | 'openid';

export type UserRole = 'user' | 'admin' | 'super';

export interface UserCreate {
  email: string;
  username: string;
  name: string;
  password?: string;
  provider?: AuthProvider;
  providerId?: string;
  avatar?: string;
}

export interface UserUpdate {
  email?: string;
  username?: string;
  name?: string;
  avatar?: string;
  role?: UserRole;
  emailVerified?: boolean;
}

export interface UserPassword {
  id: string;
  userId: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserSession {
  id: string;
  userId: string;
  refreshToken: string;
  expiresAt: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface UserPublic {
  id: string;
  username: string;
  name: string;
  avatar: string | null;
}

export interface UserWithPassword extends User {
  passwordHash: string | null;
}

// Balance/Credits system
export interface UserBalance {
  id: string;
  
  userId: string;
  tokenCredits: number;
  monthlyAllowance: number;
  lastReset: string;
  createdAt: string;
  updatedAt: string;
}

export interface TokenUsage {
  id: string;
  userId: string;
  conversationId: string | null;
  model: string;
  endpoint: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  createdAt: string;
}

// User preferences
export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  language: string;
  defaultModel: string;
  defaultEndpoint: string;
  sendWithEnter: boolean;
  showCode: boolean;
  showSidebar: boolean;
}
