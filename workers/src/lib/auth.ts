/**
 * Better Auth Configuration
 * 
 * This module creates and exports the auth instance configured for Cloudflare Workers + D1.
 * Since env is only available at runtime in Workers, we create auth on each request.
 */

import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import type { Env } from '../types';

/**
 * Email sending function using the configured provider
 */
async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string
): Promise<void> {
  const provider = env.EMAIL_SERVICE || 'console';
  const apiKey = env.EMAIL_API_KEY;
  const from = env.EMAIL_FROM || 'noreply@example.com';

  if (provider === 'console' || !apiKey) {
    console.log('=== Email (console mode) ===');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${html}`);
    console.log('============================');
    return;
  }

  if (provider === 'resend') {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        html,
      }),
    });
  } else if (provider === 'sendgrid') {
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from },
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    });
  }
}

/**
 * Create a better-auth instance with the given environment
 * 
 * This is called on each request because Cloudflare Workers
 * don't have access to env vars at module initialization time.
 */
export function createAuth(env: Env) {
  const appName = env.APP_TITLE || 'L_EXE';
  const baseURL = env.DOMAIN_SERVER;
  const clientURL = env.DOMAIN_CLIENT;
  const requireEmailVerification = (env as any).CHECK_EMAIL_VERIFICATION === 'true';

  // Create Kysely instance with D1 dialect
  const db = new Kysely<any>({
    dialect: new D1Dialect({ database: env.DB }),
  });

  // Determine if we're in development mode (localhost)
  const isDev = baseURL?.includes('localhost') || baseURL?.includes('127.0.0.1');
  
  // Check if frontend and backend are on different domains (cross-origin)
  const isCrossOrigin = clientURL && baseURL && 
    new URL(clientURL).hostname !== new URL(baseURL).hostname;

  return betterAuth({
    // Database - Use Kysely with D1 dialect
    database: {
      db,
      type: 'sqlite',
    },
    
    // Base configuration
    baseURL,
    basePath: '/api/auth',
    secret: env.JWT_SECRET,
    
    // Session configuration  
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day - update session if older than this
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 minutes
      },
    },

    // Advanced cookie settings for cross-origin
    advanced: {
      // For cross-origin (frontend on pages.dev, backend on workers.dev):
      // - sameSite: 'none' is required for cross-origin cookie sending
      // - secure: true is required when sameSite is 'none'
      // For same-origin or development with proxy:
      // - sameSite: 'lax' works fine
      defaultCookieAttributes: {
        sameSite: isCrossOrigin ? 'none' : (isDev ? 'lax' : 'lax'),
        secure: isCrossOrigin || !isDev, // Always secure for cross-origin or production
        httpOnly: true,
        path: '/',
      },
    },

    // User configuration with role field and email change
    user: {
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: 'user',
        },
      },
      changeEmail: {
        enabled: true,
        sendChangeEmailVerification: async ({ user, newEmail, url }) => {
          await sendEmail(
            env,
            newEmail,
            `${appName} - Verify your new email`,
            `
              <h1>Verify your new email</h1>
              <p>Hi ${user.name || 'there'},</p>
              <p>Click the link below to verify your new email address:</p>
              <p><a href="${url}">${url}</a></p>
              <p>This link expires in 1 hour.</p>
            `
          );
        },
      },
    },

    // Email & password authentication
    emailAndPassword: {
      enabled: true,
      requireEmailVerification,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(
          env,
          user.email,
          `${appName} - Reset your password`,
          `
            <h1>Reset your password</h1>
            <p>Hi ${user.name || 'there'},</p>
            <p>Click the link below to reset your password:</p>
            <p><a href="${url}">${url}</a></p>
            <p>If you didn't request this, you can safely ignore this email.</p>
            <p>This link expires in 1 hour.</p>
          `
        );
      },
    },

    // Email verification
    emailVerification: {
      sendOnSignUp: requireEmailVerification,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(
          env,
          user.email,
          `${appName} - Verify your email`,
          `
            <h1>Verify your email</h1>
            <p>Hi ${user.name || 'there'},</p>
            <p>Thanks for signing up! Please verify your email by clicking the link below:</p>
            <p><a href="${url}">${url}</a></p>
            <p>This link expires in 24 hours.</p>
          `
        );
      },
    },

    // Social providers (optional - configured via env vars)
    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          redirectURI: `${baseURL}/api/auth/callback/google`,
        },
      } : {}),
      ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? {
        github: {
          clientId: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
          redirectURI: `${baseURL}/api/auth/callback/github`,
        },
      } : {}),
      ...(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET ? {
        discord: {
          clientId: env.DISCORD_CLIENT_ID,
          clientSecret: env.DISCORD_CLIENT_SECRET,
          redirectURI: `${baseURL}/api/auth/callback/discord`,
        },
      } : {}),
    },

    // Account settings
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google', 'github', 'discord'],
      },
    },

    // Rate limiting (built-in) - use 'memory' for simplicity
    rateLimit: {
      enabled: true,
      window: 60, // 1 minute
      max: 10, // 10 requests per minute for auth endpoints
    },

    // Plugins
    plugins: [
      // Two-factor authentication
      twoFactor({
        issuer: appName,
      }),
    ],

    // Trusted origins for CORS
    trustedOrigins: [clientURL],
  });
}

// Type export for use in routes
export type Auth = ReturnType<typeof createAuth>;
