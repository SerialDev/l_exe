/**
 * Authentication-related type definitions
 */

// Login/Register
export interface LoginRequest {
  email: string;
  password: string;
  totpToken?: string;
}

export interface RegisterRequest {
  email: string;
  username: string;
  name: string;
  password: string;
  confirm_password: string;
}

export interface AuthResponse {
  token: string;
  refreshToken?: string;
  user: {
    id: string;
    email: string;
    username: string;
    name: string;
    avatar: string | null;
    role: string;
    provider: string;
    emailVerified: boolean;
  };
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  token: string;
  refreshToken: string;
}

// Password reset
export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
  confirm_password: string;
}

export interface PasswordResetToken {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

// Email verification
export interface VerifyEmailRequest {
  token: string;
}

export interface EmailVerificationToken {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

// TOTP/2FA
export interface TotpSetupResponse {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

export interface TotpVerifyRequest {
  token: string;
}

export interface TotpDisableRequest {
  password: string;
  token: string;
}

export interface BackupCode {
  id: string;
  userId: string;
  code: string; // Hashed
  usedAt: string | null;
  createdAt: string;
}

// OAuth/Social login
export interface OAuthState {
  provider: string;
  returnUrl: string;
  nonce: string;
  createdAt: number;
}

export interface OAuthCallback {
  code: string;
  state: string;
}

export interface OAuthProfile {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  provider: string;
}

// API Keys for programmatic access
export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  keyHash: string;
  keyPrefix: string; // First 8 chars for identification
  scopes: string; // JSON array of allowed scopes
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ApiKeyCreate {
  name: string;
  scopes?: string[];
  expiresAt?: string;
}

export interface ApiKeyResponse {
  id: string;
  name: string;
  key: string; // Only returned on creation
  keyPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
}

// Session management
export interface Session {
  id: string;
  userId: string;
  refreshToken: string;
  expiresAt: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  current: boolean;
}

// JWT payload types
export interface JWTPayload {
  sub: string; // User ID
  email: string;
  role: string;
  iat: number;
  exp: number;
  jti?: string;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
}
