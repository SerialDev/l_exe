/**
 * Authentication routes (DEPRECATED - Legacy JWT-based auth)
 * 
 * NOTE: These routes are DEPRECATED. Use better-auth endpoints instead:
 * - Sign up: POST /api/auth/sign-up/email
 * - Sign in: POST /api/auth/sign-in/email
 * - Sign out: POST /api/auth/sign-out
 * - Get session: GET /api/auth/get-session
 * - OAuth: GET /api/auth/sign-in/social?provider=google (or github, discord)
 * 
 * The better-auth routes are mounted at /api/auth/* in the main index.ts
 * These legacy routes are kept for backward compatibility but should not be used.
 * 
 * Legacy routes:
 * POST /login, POST /register, POST /logout, POST /refresh
 * GET /google, GET /google/callback - Google OAuth
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  createSession,
  validateSession,
  deleteSession,
  registerUser,
  loginUser,
  refreshAccessToken,
  type RefreshTokenPayload,
} from '../services/auth';
import {
  getGoogleAuthUrl,
  exchangeGoogleCode,
  getGoogleUserInfo,
  getGitHubAuthUrl,
  exchangeGitHubCode,
  getGitHubUserInfo,
  getDiscordAuthUrl,
  exchangeDiscordCode,
  getDiscordUserInfo,
  generateOAuthState,
  storeOAuthState,
  verifyOAuthState,
  findOrCreateOAuthUser,
} from '../services/oauth';
import {
  generateSecret,
  generateTOTP,
  verifyTOTP,
  generateBackupCodes,
  hashBackupCodes,
  verifyBackupCode,
  generateTOTPUri,
} from '../services/totp';
import { generateUUID, generateRandomString } from '../services/crypto';
import {
  generateVerificationToken,
  sendVerificationEmail,
  sendPasswordResetEmail,
  type EmailConfig,
} from '../services/email';

// Types for Cloudflare bindings
interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  DOMAIN_CLIENT: string;
  DOMAIN_SERVER: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  ALLOW_REGISTRATION?: string;
  // Email configuration
  EMAIL_PROVIDER?: string; // 'resend' | 'sendgrid' | 'console'
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  APP_NAME?: string;
  // Feature flags
  CHECK_EMAIL_VERIFICATION?: string;
}

// Common weak passwords to reject (top 100 most common)
const WEAK_PASSWORDS = new Set([
  'password', '123456', '12345678', 'qwerty', 'abc123', 'monkey', '1234567',
  'letmein', 'trustno1', 'dragon', 'baseball', 'iloveyou', 'master', 'sunshine',
  'ashley', 'bailey', 'shadow', '123123', '654321', 'superman', 'qazwsx',
  'michael', 'football', 'password1', 'password123', 'batman', 'login', 'admin',
]);

// Password strength validation
const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine(
    (pw) => /[a-z]/.test(pw),
    'Password must contain at least one lowercase letter'
  )
  .refine(
    (pw) => /[A-Z]/.test(pw),
    'Password must contain at least one uppercase letter'
  )
  .refine(
    (pw) => /[0-9]/.test(pw),
    'Password must contain at least one number'
  )
  .refine(
    (pw) => !WEAK_PASSWORDS.has(pw.toLowerCase()),
    'This password is too common. Please choose a stronger password.'
  );

// Request schemas
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1), // Don't validate strength on login, just check it exists
});

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30).optional(),
  password: passwordSchema,
  confirm_password: z.string().min(8),
  name: z.string().optional(),
}).refine(data => data.password === data.confirm_password, {
  message: "Passwords don't match",
  path: ["confirm_password"],
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

// Helper to get email config from env
function getEmailConfig(env: Env): EmailConfig {
  return {
    provider: (env.EMAIL_PROVIDER as 'resend' | 'sendgrid' | 'console') || 'console',
    apiKey: env.EMAIL_API_KEY,
    fromEmail: env.EMAIL_FROM || 'noreply@example.com',
    fromName: env.EMAIL_FROM_NAME || env.APP_NAME || 'L_EXE',
  };
}

// Create router
const auth = new Hono<{ Bindings: Env }>();

// =============================================================================
// Account Lockout Configuration
// =============================================================================

const LOCKOUT_CONFIG = {
  maxFailedAttempts: 5,      // Number of failed attempts before lockout
  lockoutDurationSec: 900,   // 15 minutes lockout
  attemptWindowSec: 300,     // 5 minute window for counting attempts
};

interface LoginAttemptRecord {
  attempts: number;
  lastAttempt: number;
  lockedUntil?: number;
}

/**
 * Get client IP for login tracking
 */
function getClientIP(c: any): string {
  return c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';
}

/**
 * Check if account/IP is locked out
 */
async function checkLockout(
  kv: KVNamespace,
  email: string,
  ip: string
): Promise<{ locked: boolean; retryAfter?: number; message?: string }> {
  // Check both email and IP-based lockouts
  const emailKey = `lockout:email:${email.toLowerCase()}`;
  const ipKey = `lockout:ip:${ip}`;

  const [emailRecord, ipRecord] = await Promise.all([
    kv.get(emailKey),
    kv.get(ipKey),
  ]);

  const now = Math.floor(Date.now() / 1000);

  // Check email lockout
  if (emailRecord) {
    const record: LoginAttemptRecord = JSON.parse(emailRecord);
    if (record.lockedUntil && record.lockedUntil > now) {
      return {
        locked: true,
        retryAfter: record.lockedUntil - now,
        message: `Account temporarily locked. Try again in ${Math.ceil((record.lockedUntil - now) / 60)} minutes.`,
      };
    }
  }

  // Check IP lockout (more aggressive - blocks all attempts from IP)
  if (ipRecord) {
    const record: LoginAttemptRecord = JSON.parse(ipRecord);
    if (record.lockedUntil && record.lockedUntil > now) {
      return {
        locked: true,
        retryAfter: record.lockedUntil - now,
        message: `Too many login attempts. Try again in ${Math.ceil((record.lockedUntil - now) / 60)} minutes.`,
      };
    }
  }

  return { locked: false };
}

/**
 * Record a failed login attempt
 */
async function recordFailedAttempt(
  kv: KVNamespace,
  email: string,
  ip: string
): Promise<{ shouldLock: boolean; attemptsRemaining: number }> {
  const emailKey = `lockout:email:${email.toLowerCase()}`;
  const ipKey = `lockout:ip:${ip}`;
  const now = Math.floor(Date.now() / 1000);

  // Update email-based record
  let emailRecord: LoginAttemptRecord = { attempts: 0, lastAttempt: now };
  const existingEmail = await kv.get(emailKey);
  
  if (existingEmail) {
    emailRecord = JSON.parse(existingEmail);
    // Reset if outside the attempt window
    if (now - emailRecord.lastAttempt > LOCKOUT_CONFIG.attemptWindowSec) {
      emailRecord = { attempts: 0, lastAttempt: now };
    }
  }

  emailRecord.attempts += 1;
  emailRecord.lastAttempt = now;

  // Check if we should lock the account
  const shouldLock = emailRecord.attempts >= LOCKOUT_CONFIG.maxFailedAttempts;
  if (shouldLock) {
    emailRecord.lockedUntil = now + LOCKOUT_CONFIG.lockoutDurationSec;
  }

  // Store email record
  await kv.put(emailKey, JSON.stringify(emailRecord), {
    expirationTtl: shouldLock ? LOCKOUT_CONFIG.lockoutDurationSec + 60 : LOCKOUT_CONFIG.attemptWindowSec + 60,
  });

  // Update IP-based record (track separately for distributed attack protection)
  let ipRecord: LoginAttemptRecord = { attempts: 0, lastAttempt: now };
  const existingIp = await kv.get(ipKey);

  if (existingIp) {
    ipRecord = JSON.parse(existingIp);
    if (now - ipRecord.lastAttempt > LOCKOUT_CONFIG.attemptWindowSec) {
      ipRecord = { attempts: 0, lastAttempt: now };
    }
  }

  ipRecord.attempts += 1;
  ipRecord.lastAttempt = now;

  // Lock IP after more attempts (to avoid blocking shared IPs too aggressively)
  const ipShouldLock = ipRecord.attempts >= LOCKOUT_CONFIG.maxFailedAttempts * 2;
  if (ipShouldLock) {
    ipRecord.lockedUntil = now + LOCKOUT_CONFIG.lockoutDurationSec;
  }

  await kv.put(ipKey, JSON.stringify(ipRecord), {
    expirationTtl: ipShouldLock ? LOCKOUT_CONFIG.lockoutDurationSec + 60 : LOCKOUT_CONFIG.attemptWindowSec + 60,
  });

  return {
    shouldLock,
    attemptsRemaining: Math.max(0, LOCKOUT_CONFIG.maxFailedAttempts - emailRecord.attempts),
  };
}

/**
 * Clear failed attempts on successful login
 */
async function clearFailedAttempts(kv: KVNamespace, email: string, ip: string): Promise<void> {
  const emailKey = `lockout:email:${email.toLowerCase()}`;
  const ipKey = `lockout:ip:${ip}`;

  await Promise.all([
    kv.delete(emailKey),
    kv.delete(ipKey),
  ]);
}

/**
 * POST /login
 * Authenticate user with email and password
 */
auth.post('/login', zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json');
  const clientIP = getClientIP(c);

  try {
    // Check for lockout first
    const lockoutStatus = await checkLockout(c.env.SESSIONS, email, clientIP);
    if (lockoutStatus.locked) {
      c.header('Retry-After', String(lockoutStatus.retryAfter));
      return c.json({
        success: false,
        error: { message: lockoutStatus.message },
      }, 429);
    }

    // First, check if user exists and verify password manually to check 2FA
    const user = await c.env.DB
      .prepare('SELECT id, email, name, username, avatar, role, password_hash, two_factor_enabled FROM users WHERE email = ?')
      .bind(email)
      .first<{
        id: string;
        email: string;
        name: string | null;
        username: string;
        avatar: string | null;
        role: string;
        password_hash: string | null;
        two_factor_enabled: number;
      }>();

    if (!user || !user.password_hash) {
      // Record failed attempt (even for non-existent users to prevent enumeration)
      const { attemptsRemaining } = await recordFailedAttempt(c.env.SESSIONS, email, clientIP);
      
      return c.json({
        success: false,
        error: { 
          message: 'Invalid credentials',
          ...(attemptsRemaining > 0 && attemptsRemaining <= 3 
            ? { attemptsRemaining } 
            : {}),
        },
      }, 401);
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      const { shouldLock, attemptsRemaining } = await recordFailedAttempt(c.env.SESSIONS, email, clientIP);
      
      if (shouldLock) {
        return c.json({
          success: false,
          error: { 
            message: `Account locked due to too many failed attempts. Try again in ${LOCKOUT_CONFIG.lockoutDurationSec / 60} minutes.`,
          },
        }, 429);
      }

      return c.json({
        success: false,
        error: { 
          message: 'Invalid credentials',
          ...(attemptsRemaining > 0 && attemptsRemaining <= 3 
            ? { attemptsRemaining } 
            : {}),
        },
      }, 401);
    }

    // Successful password verification - clear failed attempts
    await clearFailedAttempts(c.env.SESSIONS, email, clientIP);

    // Check if 2FA is enabled
    if (user.two_factor_enabled === 1) {
      // Generate temp token and store in KV
      const tempToken = generateRandomString(32);
      await c.env.SESSIONS.put(
        `2fa_temp:${tempToken}`,
        JSON.stringify({ userId: user.id }),
        { expirationTtl: 300 } // 5 minutes
      );

      return c.json({
        success: true,
        requires2FA: true,
        tempToken,
        message: 'Please provide your 2FA code',
      });
    }

    // No 2FA, proceed with normal login
    const result = await loginUser(c.env.DB, email, password, c.env.JWT_SECRET);

    return c.json({
      success: true,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      user: result.user,
    });
  } catch (error) {
    return c.json({
      success: false,
      error: { message: error instanceof Error ? error.message : 'Login failed' },
    }, 401);
  }
});

/**
 * POST /register
 * Register a new user account
 */
auth.post('/register', zValidator('json', registerSchema), async (c) => {
  // Check if registration is allowed
  if (c.env.ALLOW_REGISTRATION === 'false') {
    return c.json({
      success: false,
      error: { message: 'Registration is disabled' },
    }, 403);
  }

  const data = c.req.valid('json');

  try {
    // Register user
    const user = await registerUser(c.env.DB, {
      email: data.email,
      password: data.password,
      name: data.name,
    });

    // Check if email verification is required
    const requireEmailVerification = c.env.CHECK_EMAIL_VERIFICATION === 'true';

    if (requireEmailVerification) {
      // Generate verification token
      const verificationToken = generateVerificationToken();

      // Store in KV (expires in 24 hours)
      await c.env.SESSIONS.put(
        `email_verify:${verificationToken}`,
        JSON.stringify({ userId: user.id }),
        { expirationTtl: 86400 }
      );

      // Send verification email
      const emailConfig = getEmailConfig(c.env);
      try {
        await sendVerificationEmail(
          data.email,
          user.name || data.username || data.email.split('@')[0],
          verificationToken,
          emailConfig,
          c.env.DOMAIN_CLIENT,
          c.env.APP_NAME
        );
      } catch (emailError) {
        console.error('Failed to send verification email:', emailError);
        // Continue registration even if email fails
      }

      return c.json({
        success: true,
        requiresVerification: true,
        message: 'Registration successful. Please check your email to verify your account.',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          username: data.username || data.email.split('@')[0],
          avatar: null,
          role: 'user',
          emailVerified: false,
        },
      });
    }

    // Generate tokens (no verification required)
    const accessToken = await generateAccessToken(user.id, c.env.JWT_SECRET);
    const { token: refreshToken } = await generateRefreshToken(user.id, c.env.JWT_SECRET);

    // Create session
    await createSession(c.env.DB, user.id, refreshToken);

    return c.json({
      success: true,
      accessToken,
      refreshToken,
      expiresIn: 15 * 60,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        username: data.username || data.email.split('@')[0],
        avatar: null,
        role: 'user',
        emailVerified: !requireEmailVerification,
      },
    });
  } catch (error) {
    return c.json({
      success: false,
      error: { message: error instanceof Error ? error.message : 'Registration failed' },
    }, 400);
  }
});

/**
 * POST /logout
 * Invalidate user session
 */
auth.post('/logout', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: true });
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyToken<RefreshTokenPayload>(token, c.env.JWT_SECRET);
    if (payload?.sub) {
      // Try to find and delete the session
      // Note: This is a simplified logout - in production you'd track session IDs
    }
  } catch {
    // Ignore token errors on logout
  }

  return c.json({ success: true });
});

/**
 * POST /refresh
 * Refresh access token using refresh token
 */
auth.post('/refresh', zValidator('json', refreshSchema), async (c) => {
  const { refreshToken } = c.req.valid('json');

  try {
    const result = await refreshAccessToken(c.env.DB, refreshToken, c.env.JWT_SECRET);

    if (!result) {
      return c.json({
        success: false,
        error: { message: 'Invalid or expired refresh token' },
      }, 401);
    }

    return c.json({
      success: true,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    });
  } catch (error) {
    return c.json({
      success: false,
      error: { message: 'Token refresh failed' },
    }, 401);
  }
});

// =============================================================================
// Google OAuth Routes
// =============================================================================

/**
 * GET /google
 * Redirect to Google OAuth authorization page
 */
auth.get('/google', async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return c.json({
      success: false,
      error: { message: 'Google OAuth is not configured' },
    }, 503);
  }

  const returnUrl = c.req.query('returnUrl') || '/';
  const state = generateOAuthState();

  // Store state in KV
  await storeOAuthState(c.env.SESSIONS, state, { returnUrl });

  const redirectUri = `${c.env.DOMAIN_SERVER}/api/auth/google/callback`;
  const authUrl = getGoogleAuthUrl(
    { clientId, clientSecret, redirectUri },
    state
  );

  return c.redirect(authUrl);
});

/**
 * GET /google/callback
 * Handle Google OAuth callback
 */
auth.get('/google/callback', async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return c.redirect(`${c.env.DOMAIN_CLIENT}/login?error=oauth_not_configured`);
  }

  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  // Handle OAuth errors
  if (error) {
    console.error('Google OAuth error:', error);
    return c.redirect(`${c.env.DOMAIN_CLIENT}/login?error=${error}`);
  }

  if (!code || !state) {
    return c.redirect(`${c.env.DOMAIN_CLIENT}/login?error=missing_params`);
  }

  // Verify state
  const stateData = await verifyOAuthState(c.env.SESSIONS, state);
  if (!stateData) {
    return c.redirect(`${c.env.DOMAIN_CLIENT}/login?error=invalid_state`);
  }

  try {
    const redirectUri = `${c.env.DOMAIN_SERVER}/api/auth/google/callback`;

    // Exchange code for tokens
    const tokens = await exchangeGoogleCode(code, {
      clientId,
      clientSecret,
      redirectUri,
    });

    // Get user info
    const googleUser = await getGoogleUserInfo(tokens.access_token);

    // Find or create user
    const user = await findOrCreateOAuthUser(c.env.DB, googleUser, 'google');

    // Generate our tokens
    const accessToken = await generateAccessToken(user.id, c.env.JWT_SECRET);
    const { token: refreshToken } = await generateRefreshToken(user.id, c.env.JWT_SECRET);

    // Create session
    await createSession(c.env.DB, user.id, refreshToken);

    // Redirect back to client with tokens
    const returnUrl = stateData.returnUrl || '/';
    const params = new URLSearchParams({
      accessToken,
      refreshToken,
      expiresIn: '900',
    });

    return c.redirect(`${c.env.DOMAIN_CLIENT}/auth/callback?${params.toString()}&returnUrl=${encodeURIComponent(returnUrl)}`);
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    return c.redirect(`${c.env.DOMAIN_CLIENT}/login?error=oauth_failed`);
  }
});

// =============================================================================
// GitHub OAuth Routes
// =============================================================================

/**
 * GET /github
 * Redirect to GitHub OAuth authorization page
 */
auth.get('/github', async (c) => {
  const clientId = c.env.GITHUB_CLIENT_ID;
  const clientSecret = c.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return c.json({
      success: false,
      error: { message: 'GitHub OAuth is not configured' },
    }, 503);
  }

  const returnUrl = c.req.query('returnUrl') || '/';
  const state = generateOAuthState();

  // Store state in KV
  await storeOAuthState(c.env.SESSIONS, state, { returnUrl });

  const redirectUri = `${c.env.DOMAIN_SERVER}/api/auth/github/callback`;
  const authUrl = getGitHubAuthUrl(
    { clientId, clientSecret, redirectUri },
    state
  );

  return c.redirect(authUrl);
});

/**
 * GET /github/callback
 * Handle GitHub OAuth callback
 */
auth.get('/github/callback', async (c) => {
  const clientId = c.env.GITHUB_CLIENT_ID;
  const clientSecret = c.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return c.redirect(`${c.env.DOMAIN_CLIENT}/login?error=oauth_not_configured`);
  }

  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  // Handle OAuth errors
  if (error) {
    console.error('GitHub OAuth error:', error);
    return c.redirect(`${c.env.DOMAIN_CLIENT}/login?error=${error}`);
  }

  if (!code || !state) {
    return c.redirect(`${c.env.DOMAIN_CLIENT}/login?error=missing_params`);
  }

  // Verify state
  const stateData = await verifyOAuthState(c.env.SESSIONS, state);
  if (!stateData) {
    return c.redirect(`${c.env.DOMAIN_CLIENT}/login?error=invalid_state`);
  }

  try {
    const redirectUri = `${c.env.DOMAIN_SERVER}/api/auth/github/callback`;

    // Exchange code for tokens
    const tokens = await exchangeGitHubCode(code, {
      clientId,
      clientSecret,
      redirectUri,
    });

    // Get user info
    const githubUser = await getGitHubUserInfo(tokens.access_token);

    // Check if user has email
    if (!githubUser.email) {
      return c.redirect(`${c.env.DOMAIN_CLIENT}/login?error=email_required`);
    }

    // Find or create user
    const user = await findOrCreateOAuthUser(c.env.DB, githubUser, 'github');

    // Generate our tokens
    const accessToken = await generateAccessToken(user.id, c.env.JWT_SECRET);
    const { token: refreshToken } = await generateRefreshToken(user.id, c.env.JWT_SECRET);

    // Create session
    await createSession(c.env.DB, user.id, refreshToken);

    // Redirect back to client with tokens
    const returnUrl = stateData.returnUrl || '/';
    const params = new URLSearchParams({
      accessToken,
      refreshToken,
      expiresIn: '900',
    });

    return c.redirect(`${c.env.DOMAIN_CLIENT}/auth/callback?${params.toString()}&returnUrl=${encodeURIComponent(returnUrl)}`);
  } catch (error) {
    console.error('GitHub OAuth callback error:', error);
    return c.redirect(`${c.env.DOMAIN_CLIENT}/login?error=oauth_failed`);
  }
});

// =============================================================================
// Discord OAuth Routes
// =============================================================================

/**
 * GET /discord
 * Redirect to Discord OAuth authorization page
 */
auth.get('/discord', async (c) => {
  const clientId = c.env.DISCORD_CLIENT_ID;
  const clientSecret = c.env.DISCORD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return c.json({
      success: false,
      error: { message: 'Discord OAuth is not configured' },
    }, 503);
  }

  const returnUrl = c.req.query('returnUrl') || '/';
  const state = generateOAuthState();

  // Store state in KV
  await storeOAuthState(c.env.SESSIONS, state, { returnUrl });

  const redirectUri = `${c.env.DOMAIN_SERVER}/api/auth/discord/callback`;
  const authUrl = getDiscordAuthUrl(
    { clientId, clientSecret, redirectUri },
    state
  );

  return c.redirect(authUrl);
});

/**
 * GET /discord/callback
 * Handle Discord OAuth callback
 */
auth.get('/discord/callback', async (c) => {
  const clientId = c.env.DISCORD_CLIENT_ID;
  const clientSecret = c.env.DISCORD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return c.redirect(`${c.env.DOMAIN_CLIENT}/login?error=oauth_not_configured`);
  }

  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  // Handle OAuth errors
  if (error) {
    console.error('Discord OAuth error:', error);
    return c.redirect(`${c.env.DOMAIN_CLIENT}/login?error=${error}`);
  }

  if (!code || !state) {
    return c.redirect(`${c.env.DOMAIN_CLIENT}/login?error=missing_params`);
  }

  // Verify state
  const stateData = await verifyOAuthState(c.env.SESSIONS, state);
  if (!stateData) {
    return c.redirect(`${c.env.DOMAIN_CLIENT}/login?error=invalid_state`);
  }

  try {
    const redirectUri = `${c.env.DOMAIN_SERVER}/api/auth/discord/callback`;

    // Exchange code for tokens
    const tokens = await exchangeDiscordCode(code, {
      clientId,
      clientSecret,
      redirectUri,
    });

    // Get user info
    const discordUser = await getDiscordUserInfo(tokens.access_token);

    // Check if user has email
    if (!discordUser.email) {
      return c.redirect(`${c.env.DOMAIN_CLIENT}/login?error=email_required`);
    }

    // Find or create user
    const user = await findOrCreateOAuthUser(c.env.DB, discordUser, 'discord');

    // Generate our tokens
    const accessToken = await generateAccessToken(user.id, c.env.JWT_SECRET);
    const { token: refreshToken } = await generateRefreshToken(user.id, c.env.JWT_SECRET);

    // Create session
    await createSession(c.env.DB, user.id, refreshToken);

    // Redirect back to client with tokens
    const returnUrl = stateData.returnUrl || '/';
    const params = new URLSearchParams({
      accessToken,
      refreshToken,
      expiresIn: '900',
    });

    return c.redirect(`${c.env.DOMAIN_CLIENT}/auth/callback?${params.toString()}&returnUrl=${encodeURIComponent(returnUrl)}`);
  } catch (error) {
    console.error('Discord OAuth callback error:', error);
    return c.redirect(`${c.env.DOMAIN_CLIENT}/login?error=oauth_failed`);
  }
});

/**
 * GET /me
 * Get current user info (requires auth)
 */
auth.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({
      success: false,
      error: { message: 'Unauthorized' },
    }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyToken<{ sub: string }>(token, c.env.JWT_SECRET);
    if (!payload?.sub) {
      return c.json({
        success: false,
        error: { message: 'Invalid token' },
      }, 401);
    }

    // Get user from DB
    const user = await c.env.DB
      .prepare('SELECT id, email, name, username, avatar, role FROM users WHERE id = ?')
      .bind(payload.sub)
      .first<{
        id: string;
        email: string;
        name: string | null;
        username: string;
        avatar: string | null;
        role: string;
      }>();

    if (!user) {
      return c.json({
        success: false,
        error: { message: 'User not found' },
      }, 404);
    }

    return c.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || user.username,
        username: user.username,
        avatar: user.avatar,
        role: user.role || 'user',
      },
    });
  } catch (error) {
    return c.json({
      success: false,
      error: { message: 'Invalid token' },
    }, 401);
  }
});

// =============================================================================
// Two-Factor Authentication (2FA) Routes
// =============================================================================

// 2FA request schemas
const verify2FASchema = z.object({
  token: z.string().length(6),
});

const disable2FASchema = z.object({
  token: z.string().length(6),
  password: z.string().min(1),
});

const verifyBackupSchema = z.object({
  backupCode: z.string(),
});

/**
 * GET /2fa/enable
 * Generate TOTP secret and QR code URI for 2FA setup
 */
auth.get('/2fa/enable', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyToken<{ sub: string }>(token, c.env.JWT_SECRET);
    if (!payload?.sub) {
      return c.json({ success: false, error: { message: 'Invalid token' } }, 401);
    }

    // Get user
    const user = await c.env.DB
      .prepare('SELECT id, email, two_factor_enabled FROM users WHERE id = ?')
      .bind(payload.sub)
      .first<{ id: string; email: string; two_factor_enabled: number }>();

    if (!user) {
      return c.json({ success: false, error: { message: 'User not found' } }, 404);
    }

    if (user.two_factor_enabled === 1) {
      return c.json({
        success: false,
        error: { message: '2FA is already enabled' },
      }, 400);
    }

    // Generate secret
    const secret = generateSecret();

    // Store temporarily in KV (expires in 10 minutes)
    const setupKey = `2fa_setup:${user.id}`;
    await c.env.SESSIONS.put(setupKey, secret, { expirationTtl: 600 });

    // Generate OTP URI for QR code
    const issuer = 'L_EXE';
    const otpUri = generateTOTPUri(secret, user.email, issuer);

    return c.json({
      success: true,
      data: {
        secret,
        otpUri,
        qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpUri)}`,
      },
    });
  } catch (error) {
    console.error('2FA enable error:', error);
    return c.json({ success: false, error: { message: 'Failed to setup 2FA' } }, 500);
  }
});

/**
 * POST /2fa/verify
 * Verify TOTP token during 2FA setup (before confirming)
 */
auth.post('/2fa/verify', zValidator('json', verify2FASchema), async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const authToken = authHeader.slice(7);
  const { token } = c.req.valid('json');

  try {
    const payload = await verifyToken<{ sub: string }>(authToken, c.env.JWT_SECRET);
    if (!payload?.sub) {
      return c.json({ success: false, error: { message: 'Invalid token' } }, 401);
    }

    // Get the temporary secret from KV
    const setupKey = `2fa_setup:${payload.sub}`;
    const secret = await c.env.SESSIONS.get(setupKey);

    if (!secret) {
      return c.json({
        success: false,
        error: { message: '2FA setup session expired. Please start again.' },
      }, 400);
    }

    // Verify the token
    const isValid = await verifyTOTP(token, secret);

    return c.json({
      success: true,
      data: { valid: isValid },
    });
  } catch (error) {
    console.error('2FA verify error:', error);
    return c.json({ success: false, error: { message: 'Verification failed' } }, 500);
  }
});

/**
 * POST /2fa/confirm
 * Confirm and enable 2FA (final step)
 */
auth.post('/2fa/confirm', zValidator('json', verify2FASchema), async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const authToken = authHeader.slice(7);
  const { token } = c.req.valid('json');

  try {
    const payload = await verifyToken<{ sub: string }>(authToken, c.env.JWT_SECRET);
    if (!payload?.sub) {
      return c.json({ success: false, error: { message: 'Invalid token' } }, 401);
    }

    // Get the temporary secret from KV
    const setupKey = `2fa_setup:${payload.sub}`;
    const secret = await c.env.SESSIONS.get(setupKey);

    if (!secret) {
      return c.json({
        success: false,
        error: { message: '2FA setup session expired. Please start again.' },
      }, 400);
    }

    // Verify the token
    const isValid = await verifyTOTP(token, secret);
    if (!isValid) {
      return c.json({
        success: false,
        error: { message: 'Invalid verification code' },
      }, 400);
    }

    // Generate backup codes
    const backupCodes = generateBackupCodes(10);
    const hashedBackupCodes = await hashBackupCodes(backupCodes);

    // Update user with 2FA enabled
    await c.env.DB
      .prepare(`
        UPDATE users 
        SET two_factor_enabled = 1, 
            two_factor_secret = ?, 
            backup_codes = ?
        WHERE id = ?
      `)
      .bind(secret, JSON.stringify(hashedBackupCodes), payload.sub)
      .run();

    // Delete the temporary setup secret
    await c.env.SESSIONS.delete(setupKey);

    return c.json({
      success: true,
      data: {
        enabled: true,
        backupCodes, // Return plain backup codes only once
        message: 'Two-factor authentication has been enabled. Save your backup codes securely.',
      },
    });
  } catch (error) {
    console.error('2FA confirm error:', error);
    return c.json({ success: false, error: { message: 'Failed to enable 2FA' } }, 500);
  }
});

/**
 * POST /2fa/disable
 * Disable 2FA for the account
 */
auth.post('/2fa/disable', zValidator('json', disable2FASchema), async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const authToken = authHeader.slice(7);
  const { token, password } = c.req.valid('json');

  try {
    const payload = await verifyToken<{ sub: string }>(authToken, c.env.JWT_SECRET);
    if (!payload?.sub) {
      return c.json({ success: false, error: { message: 'Invalid token' } }, 401);
    }

    // Get user with password and 2FA info
    const user = await c.env.DB
      .prepare('SELECT id, password_hash, two_factor_enabled, two_factor_secret FROM users WHERE id = ?')
      .bind(payload.sub)
      .first<{
        id: string;
        password_hash: string | null;
        two_factor_enabled: number;
        two_factor_secret: string | null;
      }>();

    if (!user) {
      return c.json({ success: false, error: { message: 'User not found' } }, 404);
    }

    if (user.two_factor_enabled !== 1 || !user.two_factor_secret) {
      return c.json({
        success: false,
        error: { message: '2FA is not enabled' },
      }, 400);
    }

    // Verify password (skip for OAuth users)
    if (user.password_hash) {
      const isPasswordValid = await verifyPassword(password, user.password_hash);
      if (!isPasswordValid) {
        return c.json({
          success: false,
          error: { message: 'Invalid password' },
        }, 401);
      }
    }

    // Verify the TOTP token
    const isValid = await verifyTOTP(token, user.two_factor_secret);
    if (!isValid) {
      return c.json({
        success: false,
        error: { message: 'Invalid verification code' },
      }, 400);
    }

    // Disable 2FA
    await c.env.DB
      .prepare(`
        UPDATE users 
        SET two_factor_enabled = 0, 
            two_factor_secret = NULL, 
            backup_codes = NULL
        WHERE id = ?
      `)
      .bind(payload.sub)
      .run();

    return c.json({
      success: true,
      data: {
        disabled: true,
        message: 'Two-factor authentication has been disabled.',
      },
    });
  } catch (error) {
    console.error('2FA disable error:', error);
    return c.json({ success: false, error: { message: 'Failed to disable 2FA' } }, 500);
  }
});

/**
 * POST /2fa/backup/regenerate
 * Regenerate backup codes
 */
auth.post('/2fa/backup/regenerate', zValidator('json', verify2FASchema), async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const authToken = authHeader.slice(7);
  const { token } = c.req.valid('json');

  try {
    const payload = await verifyToken<{ sub: string }>(authToken, c.env.JWT_SECRET);
    if (!payload?.sub) {
      return c.json({ success: false, error: { message: 'Invalid token' } }, 401);
    }

    // Get user with 2FA info
    const user = await c.env.DB
      .prepare('SELECT id, two_factor_enabled, two_factor_secret FROM users WHERE id = ?')
      .bind(payload.sub)
      .first<{
        id: string;
        two_factor_enabled: number;
        two_factor_secret: string | null;
      }>();

    if (!user) {
      return c.json({ success: false, error: { message: 'User not found' } }, 404);
    }

    if (user.two_factor_enabled !== 1 || !user.two_factor_secret) {
      return c.json({
        success: false,
        error: { message: '2FA is not enabled' },
      }, 400);
    }

    // Verify the TOTP token
    const isValid = await verifyTOTP(token, user.two_factor_secret);
    if (!isValid) {
      return c.json({
        success: false,
        error: { message: 'Invalid verification code' },
      }, 400);
    }

    // Generate new backup codes
    const backupCodes = generateBackupCodes(10);
    const hashedBackupCodes = await hashBackupCodes(backupCodes);

    // Update backup codes
    await c.env.DB
      .prepare('UPDATE users SET backup_codes = ? WHERE id = ?')
      .bind(JSON.stringify(hashedBackupCodes), payload.sub)
      .run();

    return c.json({
      success: true,
      data: {
        backupCodes,
        message: 'New backup codes generated. Save them securely.',
      },
    });
  } catch (error) {
    console.error('Backup regenerate error:', error);
    return c.json({ success: false, error: { message: 'Failed to regenerate backup codes' } }, 500);
  }
});

/**
 * POST /2fa/verify-temp
 * Verify 2FA during login (with temp token)
 */
auth.post('/2fa/verify-temp', zValidator('json', z.object({
  tempToken: z.string(),
  token: z.string().length(6).optional(),
  backupCode: z.string().optional(),
}).refine(data => data.token || data.backupCode, {
  message: 'Either token or backupCode is required',
})), async (c) => {
  const data = c.req.valid('json');

  try {
    // Get temp token data from KV
    const tempData = await c.env.SESSIONS.get(`2fa_temp:${data.tempToken}`);
    if (!tempData) {
      return c.json({
        success: false,
        error: { message: 'Session expired. Please login again.' },
      }, 401);
    }

    const { userId } = JSON.parse(tempData);

    // Get user with 2FA info
    const user = await c.env.DB
      .prepare('SELECT id, email, name, username, avatar, role, two_factor_secret, backup_codes FROM users WHERE id = ?')
      .bind(userId)
      .first<{
        id: string;
        email: string;
        name: string | null;
        username: string;
        avatar: string | null;
        role: string;
        two_factor_secret: string | null;
        backup_codes: string | null;
      }>();

    if (!user || !user.two_factor_secret) {
      return c.json({ success: false, error: { message: 'User not found' } }, 404);
    }

    let verified = false;

    // Verify TOTP token
    if (data.token) {
      verified = await verifyTOTP(data.token, user.two_factor_secret);
    }
    // Or verify backup code
    else if (data.backupCode && user.backup_codes) {
      const hashedCodes: string[] = JSON.parse(user.backup_codes);
      const result = await verifyBackupCode(data.backupCode, hashedCodes);

      if (result.valid) {
        verified = true;
        // Remove used backup code
        hashedCodes.splice(result.index, 1);
        await c.env.DB
          .prepare('UPDATE users SET backup_codes = ? WHERE id = ?')
          .bind(JSON.stringify(hashedCodes), userId)
          .run();
      }
    }

    if (!verified) {
      return c.json({
        success: false,
        error: { message: 'Invalid verification code' },
      }, 401);
    }

    // Delete temp token
    await c.env.SESSIONS.delete(`2fa_temp:${data.tempToken}`);

    // Generate real tokens
    const accessToken = await generateAccessToken(userId, c.env.JWT_SECRET);
    const { token: refreshToken } = await generateRefreshToken(userId, c.env.JWT_SECRET);

    // Create session
    await createSession(c.env.DB, userId, refreshToken);

    return c.json({
      success: true,
      accessToken,
      refreshToken,
      expiresIn: 15 * 60,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || user.username,
        username: user.username,
        avatar: user.avatar,
        role: user.role || 'user',
      },
    });
  } catch (error) {
    console.error('2FA verify-temp error:', error);
    return c.json({ success: false, error: { message: 'Verification failed' } }, 500);
  }
});

/**
 * GET /2fa/status
 * Check if 2FA is enabled for the current user
 */
auth.get('/2fa/status', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyToken<{ sub: string }>(token, c.env.JWT_SECRET);
    if (!payload?.sub) {
      return c.json({ success: false, error: { message: 'Invalid token' } }, 401);
    }

    const user = await c.env.DB
      .prepare('SELECT two_factor_enabled, backup_codes FROM users WHERE id = ?')
      .bind(payload.sub)
      .first<{ two_factor_enabled: number; backup_codes: string | null }>();

    if (!user) {
      return c.json({ success: false, error: { message: 'User not found' } }, 404);
    }

    const backupCodesCount = user.backup_codes
      ? JSON.parse(user.backup_codes).length
      : 0;

    return c.json({
      success: true,
      data: {
        enabled: user.two_factor_enabled === 1,
        backupCodesRemaining: backupCodesCount,
      },
    });
  } catch (error) {
    console.error('2FA status error:', error);
    return c.json({ success: false, error: { message: 'Failed to get 2FA status' } }, 500);
  }
});

// =============================================================================
// Email Verification Routes
// =============================================================================

// Verification schemas
const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

const resendVerificationSchema = z.object({
  email: z.string().email(),
});

/**
 * POST /verify
 * Verify email with token
 */
auth.post('/verify', zValidator('json', verifyEmailSchema), async (c) => {
  const { token } = c.req.valid('json');

  try {
    // Get verification token from KV
    const tokenData = await c.env.SESSIONS.get(`email_verify:${token}`);
    if (!tokenData) {
      return c.json({
        success: false,
        error: { message: 'Invalid or expired verification token' },
      }, 400);
    }

    const { userId } = JSON.parse(tokenData);

    // Update user as verified
    await c.env.DB
      .prepare('UPDATE users SET email_verified = 1 WHERE id = ?')
      .bind(userId)
      .run();

    // Delete the used token
    await c.env.SESSIONS.delete(`email_verify:${token}`);

    return c.json({
      success: true,
      data: {
        verified: true,
        message: 'Email verified successfully',
      },
    });
  } catch (error) {
    console.error('Email verification error:', error);
    return c.json({ success: false, error: { message: 'Verification failed' } }, 500);
  }
});

/**
 * POST /verify/resend
 * Resend verification email
 */
auth.post('/verify/resend', zValidator('json', resendVerificationSchema), async (c) => {
  const { email } = c.req.valid('json');

  try {
    // Get user by email
    const user = await c.env.DB
      .prepare('SELECT id, name, username, email_verified FROM users WHERE email = ?')
      .bind(email)
      .first<{ id: string; name: string | null; username: string; email_verified: number }>();

    if (!user) {
      // Don't reveal if email exists
      return c.json({
        success: true,
        data: { message: 'If the email exists, a verification link has been sent.' },
      });
    }

    if (user.email_verified === 1) {
      return c.json({
        success: false,
        error: { message: 'Email is already verified' },
      }, 400);
    }

    // Generate new verification token
    const token = generateVerificationToken();

    // Store in KV (expires in 24 hours)
    await c.env.SESSIONS.put(
      `email_verify:${token}`,
      JSON.stringify({ userId: user.id }),
      { expirationTtl: 86400 }
    );

    // Send verification email
    const emailConfig = getEmailConfig(c.env);
    await sendVerificationEmail(
      email,
      user.name || user.username,
      token,
      emailConfig,
      c.env.DOMAIN_CLIENT,
      c.env.APP_NAME
    );

    return c.json({
      success: true,
      data: { message: 'Verification email sent' },
    });
  } catch (error) {
    console.error('Resend verification error:', error);
    return c.json({ success: false, error: { message: 'Failed to send verification email' } }, 500);
  }
});

// =============================================================================
// Password Reset Routes
// =============================================================================

// Password reset schemas
const requestPasswordResetSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
  confirmPassword: z.string().min(8),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

/**
 * POST /requestPasswordReset
 * Request a password reset email
 */
auth.post('/requestPasswordReset', zValidator('json', requestPasswordResetSchema), async (c) => {
  const { email } = c.req.valid('json');

  try {
    // Get user by email
    const user = await c.env.DB
      .prepare('SELECT id, name, username, provider FROM users WHERE email = ?')
      .bind(email)
      .first<{ id: string; name: string | null; username: string; provider: string }>();

    // Don't reveal if email exists
    const successResponse = {
      success: true,
      data: { message: 'If an account exists with this email, a reset link has been sent.' },
    };

    if (!user) {
      return c.json(successResponse);
    }

    // Don't allow password reset for OAuth users
    if (user.provider !== 'local') {
      return c.json(successResponse);
    }

    // Generate reset token
    const token = generateVerificationToken();

    // Store in KV (expires in 1 hour)
    await c.env.SESSIONS.put(
      `password_reset:${token}`,
      JSON.stringify({ userId: user.id }),
      { expirationTtl: 3600 }
    );

    // Send password reset email
    const emailConfig = getEmailConfig(c.env);
    await sendPasswordResetEmail(
      email,
      user.name || user.username,
      token,
      emailConfig,
      c.env.DOMAIN_CLIENT,
      c.env.APP_NAME
    );

    return c.json(successResponse);
  } catch (error) {
    console.error('Request password reset error:', error);
    return c.json({ success: false, error: { message: 'Failed to process request' } }, 500);
  }
});

/**
 * POST /resetPassword
 * Reset password with token
 */
auth.post('/resetPassword', zValidator('json', resetPasswordSchema), async (c) => {
  const { token, password } = c.req.valid('json');

  try {
    // Get reset token from KV
    const tokenData = await c.env.SESSIONS.get(`password_reset:${token}`);
    if (!tokenData) {
      return c.json({
        success: false,
        error: { message: 'Invalid or expired reset token' },
      }, 400);
    }

    const { userId } = JSON.parse(tokenData);

    // Hash new password
    const passwordHash = await hashPassword(password);

    // Update user password
    await c.env.DB
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(passwordHash, userId)
      .run();

    // Delete the used token
    await c.env.SESSIONS.delete(`password_reset:${token}`);

    // Invalidate all existing sessions for this user (security measure)
    // Get all sessions and delete them
    const sessions = await c.env.DB
      .prepare('SELECT id FROM sessions WHERE user_id = ?')
      .bind(userId)
      .all<{ id: string }>();

    for (const session of sessions.results || []) {
      await c.env.DB
        .prepare('DELETE FROM sessions WHERE id = ?')
        .bind(session.id)
        .run();
    }

    return c.json({
      success: true,
      data: {
        reset: true,
        message: 'Password has been reset. Please login with your new password.',
      },
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return c.json({ success: false, error: { message: 'Failed to reset password' } }, 500);
  }
});

export { auth };
export default auth;
