/**
 * Better Auth Client
 * 
 * Client-side authentication using better-auth library.
 * Handles sign-in, sign-up, sign-out, and session management.
 */

import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';

// Import server auth type for type inference (if available)
// import type { auth } from '../../../workers/src/lib/auth';

/**
 * Create the auth client
 * 
 * In development: Vite runs on port 3000 and proxies /api to localhost:8787
 * In production: Same origin serves both frontend and API
 * 
 * We use the current window origin so the Vite proxy handles routing.
 */
// Determine API base URL based on environment
function getApiBaseUrl(): string {
  // Check for environment variable first
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace('/api', '');
  }
  
  // In production (pages.dev), use the worker URL
  if (typeof window !== 'undefined' && window.location.hostname.includes('pages.dev')) {
    return 'https://l-exe.datasloth.workers.dev';
  }
  
  // In development or same-origin deployment, use current origin
  return typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
}

export const authClient = createAuthClient({
  baseURL: getApiBaseUrl(),
  
  // Plugins
  plugins: [
    twoFactorClient({
      // Redirect callback when 2FA verification is required
      onTwoFactorRedirect: () => {
        window.location.href = '/two-factor';
      },
    }),
  ],
});

// Export individual methods for convenience
export const {
  signIn,
  signUp,
  signOut,
  useSession,
  getSession,
} = authClient;

// Type exports
export type Session = typeof authClient.$Infer.Session;
export type User = Session['user'];
