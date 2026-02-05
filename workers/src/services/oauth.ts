/**
 * OAuth Service
 * Handles Google, GitHub, and Discord OAuth authentication flows
 * 
 * SECURITY: Uses authorization code pattern to avoid exposing tokens in URLs
 */

import { generateUUID, generateRandomString } from './crypto';

// =============================================================================
// Types
// =============================================================================

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

export interface GitHubUserInfo {
  id: number;
  login: string;
  email: string | null;
  name: string | null;
  avatar_url: string;
}

export interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string | null;
}

export interface DiscordUserInfo {
  id: string;
  username: string;
  discriminator: string;
  email: string | null;
  verified: boolean;
  avatar: string | null;
  global_name: string | null;
}

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  id_token?: string;
  scope?: string;
}

// =============================================================================
// Google OAuth
// =============================================================================

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

/**
 * Generate Google OAuth authorization URL
 */
export function getGoogleAuthUrl(config: OAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeGoogleCode(
  code: string,
  config: OAuthConfig
): Promise<OAuthTokens> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Google token exchange failed:', error);
    throw new Error('Failed to exchange authorization code');
  }

  return response.json();
}

/**
 * Get user info from Google
 */
export async function getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to get user info from Google');
  }

  return response.json();
}

/**
 * Generate a secure state parameter for OAuth
 */
export function generateOAuthState(): string {
  return generateUUID();
}

/**
 * Store OAuth state in KV (with expiration)
 */
export async function storeOAuthState(
  kv: KVNamespace,
  state: string,
  data: { returnUrl?: string } = {}
): Promise<void> {
  await kv.put(
    `oauth_state:${state}`,
    JSON.stringify({ ...data, createdAt: Date.now() }),
    { expirationTtl: 600 } // 10 minutes
  );
}

/**
 * Verify and consume OAuth state from KV
 */
export async function verifyOAuthState(
  kv: KVNamespace,
  state: string
): Promise<{ returnUrl?: string } | null> {
  const key = `oauth_state:${state}`;
  const data = await kv.get(key);
  
  if (!data) {
    return null;
  }

  // Delete the state (one-time use)
  await kv.delete(key);
  
  return JSON.parse(data);
}

// =============================================================================
// User Management
// =============================================================================

export interface OAuthUser {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  provider: 'google' | 'github' | 'discord';
  providerId: string;
}

/**
 * Find or create user from OAuth profile
 */
export async function findOrCreateOAuthUser(
  db: D1Database,
  profile: GoogleUserInfo | GitHubUserInfo | DiscordUserInfo,
  provider: 'google' | 'github' | 'discord'
): Promise<OAuthUser> {
  // Normalize profile data based on provider
  const normalizedProfile = normalizeOAuthProfile(profile, provider);
  // First, try to find by provider ID
  let user = await db
    .prepare(
      'SELECT id, email, name, avatar, provider, provider_id FROM users WHERE provider = ? AND provider_id = ?'
    )
    .bind(provider, normalizedProfile.id)
    .first<{
      id: string;
      email: string;
      name: string;
      avatar: string | null;
      provider: string;
      provider_id: string;
    }>();

  if (user) {
    // Update user info if changed
    if (user.name !== normalizedProfile.name || user.avatar !== normalizedProfile.avatar) {
      await db
        .prepare('UPDATE users SET name = ?, avatar = ?, updated_at = ? WHERE id = ?')
        .bind(normalizedProfile.name, normalizedProfile.avatar || null, new Date().toISOString(), user.id)
        .run();
    }

    return {
      id: user.id,
      email: user.email,
      name: normalizedProfile.name,
      avatar: normalizedProfile.avatar || null,
      provider,
      providerId: normalizedProfile.id,
    };
  }

  // Check if email already exists (link accounts)
  user = await db
    .prepare('SELECT id, email, name, avatar, provider, provider_id FROM users WHERE email = ?')
    .bind(normalizedProfile.email.toLowerCase())
    .first();

  if (user) {
    // Update existing user to link OAuth account
    await db
      .prepare(
        'UPDATE users SET provider = ?, provider_id = ?, avatar = COALESCE(avatar, ?), updated_at = ? WHERE id = ?'
      )
      .bind(provider, normalizedProfile.id, normalizedProfile.avatar || null, new Date().toISOString(), user.id)
      .run();

    return {
      id: user.id,
      email: user.email,
      name: user.name || normalizedProfile.name,
      avatar: user.avatar || normalizedProfile.avatar || null,
      provider,
      providerId: normalizedProfile.id,
    };
  }

  // Create new user
  const userId = generateUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO users (id, email, name, username, avatar, provider, provider_id, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      userId,
      normalizedProfile.email.toLowerCase(),
      normalizedProfile.name,
      normalizedProfile.username,
      normalizedProfile.avatar || null,
      provider,
      normalizedProfile.id,
      1, // email is verified by OAuth provider
      now,
      now
    )
    .run();

  return {
    id: userId,
    email: normalizedProfile.email.toLowerCase(),
    name: normalizedProfile.name,
    avatar: normalizedProfile.avatar || null,
    provider,
    providerId: normalizedProfile.id,
  };
}

// =============================================================================
// Profile Normalization
// =============================================================================

interface NormalizedProfile {
  id: string;
  email: string;
  name: string;
  username: string;
  avatar: string | null;
}

function normalizeOAuthProfile(
  profile: GoogleUserInfo | GitHubUserInfo | DiscordUserInfo,
  provider: 'google' | 'github' | 'discord'
): NormalizedProfile {
  switch (provider) {
    case 'google': {
      const p = profile as GoogleUserInfo;
      return {
        id: p.id,
        email: p.email,
        name: p.name,
        username: p.email.split('@')[0],
        avatar: p.picture || null,
      };
    }
    case 'github': {
      const p = profile as GitHubUserInfo;
      return {
        id: String(p.id),
        email: p.email || '',
        name: p.name || p.login,
        username: p.login,
        avatar: p.avatar_url || null,
      };
    }
    case 'discord': {
      const p = profile as DiscordUserInfo;
      const avatarUrl = p.avatar 
        ? `https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.png`
        : null;
      return {
        id: p.id,
        email: p.email || '',
        name: p.global_name || p.username,
        username: p.username,
        avatar: avatarUrl,
      };
    }
  }
}

// =============================================================================
// GitHub OAuth
// =============================================================================

const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USERINFO_URL = 'https://api.github.com/user';
const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';

/**
 * Generate GitHub OAuth authorization URL
 */
export function getGitHubAuthUrl(config: OAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'read:user user:email',
    state,
  });

  return `${GITHUB_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange GitHub authorization code for tokens
 */
export async function exchangeGitHubCode(
  code: string,
  config: OAuthConfig
): Promise<OAuthTokens> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('GitHub token exchange failed:', error);
    throw new Error('Failed to exchange authorization code');
  }

  const data = await response.json() as { access_token?: string; error?: string; error_description?: string };
  
  if (data.error) {
    console.error('GitHub OAuth error:', data.error_description || data.error);
    throw new Error(data.error_description || data.error);
  }

  return {
    access_token: data.access_token!,
    expires_in: 0, // GitHub tokens don't expire
    token_type: 'bearer',
  };
}

/**
 * Get user info from GitHub
 */
export async function getGitHubUserInfo(accessToken: string): Promise<GitHubUserInfo> {
  const response = await fetch(GITHUB_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'L-EXE-OAuth',
    },
  });

  if (!response.ok) {
    throw new Error('Failed to get user info from GitHub');
  }

  const user = await response.json() as GitHubUserInfo;

  // If email is not public, fetch from emails endpoint
  if (!user.email) {
    const emailResponse = await fetch(GITHUB_EMAILS_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'L-EXE-OAuth',
      },
    });

    if (emailResponse.ok) {
      const emails = await emailResponse.json() as GitHubEmail[];
      const primaryEmail = emails.find(e => e.primary && e.verified);
      if (primaryEmail) {
        user.email = primaryEmail.email;
      } else {
        // Fall back to any verified email
        const verifiedEmail = emails.find(e => e.verified);
        if (verifiedEmail) {
          user.email = verifiedEmail.email;
        }
      }
    }
  }

  return user;
}

// =============================================================================
// Discord OAuth
// =============================================================================

const DISCORD_AUTH_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_USERINFO_URL = 'https://discord.com/api/users/@me';

/**
 * Generate Discord OAuth authorization URL
 */
export function getDiscordAuthUrl(config: OAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'identify email',
    state,
  });

  return `${DISCORD_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange Discord authorization code for tokens
 */
export async function exchangeDiscordCode(
  code: string,
  config: OAuthConfig
): Promise<OAuthTokens> {
  const response = await fetch(DISCORD_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Discord token exchange failed:', error);
    throw new Error('Failed to exchange authorization code');
  }

  return response.json();
}

/**
 * Get user info from Discord
 */
export async function getDiscordUserInfo(accessToken: string): Promise<DiscordUserInfo> {
  const response = await fetch(DISCORD_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to get user info from Discord');
  }

  return response.json();
}

// =============================================================================
// Authorization Code for Token Exchange
// SECURITY: Prevents tokens from being exposed in URL query parameters
// =============================================================================

export interface AuthCodeData {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  returnUrl?: string;
}

/**
 * Generate a short-lived authorization code
 * The client will exchange this for actual tokens via POST request
 */
export function generateAuthCode(): string {
  // 64 alphanumeric characters ≈ 380 bits of entropy
  return generateRandomString(64);
}

/**
 * Store authorization code in KV with associated token data
 * @param kv - KV namespace
 * @param code - The authorization code
 * @param data - Token data to store
 */
export async function storeAuthCode(
  kv: KVNamespace,
  code: string,
  data: AuthCodeData
): Promise<void> {
  // Very short TTL (60 seconds) - code should be exchanged immediately
  await kv.put(
    `auth_code:${code}`,
    JSON.stringify(data),
    { expirationTtl: 60 }
  );
}

/**
 * Exchange authorization code for tokens (one-time use)
 * @param kv - KV namespace
 * @param code - The authorization code to exchange
 * @returns Token data or null if code is invalid/expired
 */
export async function exchangeAuthCode(
  kv: KVNamespace,
  code: string
): Promise<AuthCodeData | null> {
  // Validate code format
  if (!code || code.length !== 64 || !/^[A-Za-z0-9]+$/.test(code)) {
    return null;
  }

  const key = `auth_code:${code}`;
  const data = await kv.get(key);
  
  if (!data) {
    return null;
  }

  // Delete immediately (one-time use)
  await kv.delete(key);
  
  try {
    return JSON.parse(data) as AuthCodeData;
  } catch {
    return null;
  }
}
