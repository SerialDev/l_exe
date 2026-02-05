/**
 * OAuthCallback Component
 * Handles the OAuth callback with authorization code exchange
 * 
 * SECURITY: The server returns only a short-lived auth code in the URL.
 * This component exchanges it for actual tokens via a POST request,
 * preventing tokens from being exposed in URLs/logs.
 */

import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { Bot, Loader2, AlertCircle } from 'lucide-react';

// Get API URL
function getApiUrl(): string {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  if (typeof window !== 'undefined' && window.location.hostname.includes('pages.dev')) {
    return 'https://l-exe.datasloth.workers.dev/api';
  }
  return `${window.location.origin}/api`;
}

export function OAuthCallback() {
  const [error, setError] = useState<string | null>(null);
  const { checkAuth } = useAuthStore();

  useEffect(() => {
    const handleCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      
      // Check for error
      const errorParam = params.get('error');
      if (errorParam) {
        setError(getErrorMessage(errorParam));
        return;
      }

      // Get the authorization code from URL
      const code = params.get('code');
      
      if (code) {
        // Exchange the auth code for tokens via POST request
        // SECURITY: Tokens are returned in response body, not exposed in URL
        try {
          const response = await fetch(`${getApiUrl()}/auth/oauth/exchange`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ code }),
          });

          const data = await response.json();

          if (!response.ok || !data.success) {
            setError(data.error?.message || 'Failed to exchange authorization code');
            return;
          }

          // Store tokens securely
          if (data.accessToken) {
            localStorage.setItem('accessToken', data.accessToken);
          }
          if (data.refreshToken) {
            localStorage.setItem('refreshToken', data.refreshToken);
          }
        } catch (err) {
          console.error('OAuth code exchange error:', err);
          setError('Failed to complete authentication');
          return;
        }
      }

      // Check authentication status
      await checkAuth();

      // Get return URL from params or default to home
      // SECURITY: Validate returnUrl to prevent open redirect attacks
      let returnUrl = params.get('returnUrl') || params.get('callbackURL') || '/';
      
      // Only allow relative paths or same-origin URLs
      try {
        const url = new URL(returnUrl, window.location.origin);
        if (url.origin !== window.location.origin) {
          // External URL - reject and use default
          console.warn('Rejected external returnUrl:', returnUrl);
          returnUrl = '/';
        } else {
          // Use pathname + search + hash to ensure it's relative
          returnUrl = url.pathname + url.search + url.hash;
        }
      } catch {
        // Invalid URL - must be a relative path, which is fine
        // But make sure it starts with / to prevent protocol-relative URLs
        if (!returnUrl.startsWith('/')) {
          returnUrl = '/' + returnUrl;
        }
      }

      // Small delay to ensure state is updated
      setTimeout(() => {
        window.location.href = returnUrl;
      }, 500);
    };

    handleCallback();
  }, [checkAuth]);

  const getErrorMessage = (code: string): string => {
    switch (code) {
      case 'oauth_not_configured':
        return 'Social sign-in is not configured. Please contact support.';
      case 'access_denied':
        return 'Access was denied. Please try again.';
      case 'invalid_state':
        return 'Invalid request. Please try signing in again.';
      case 'oauth_failed':
        return 'Authentication failed. Please try again.';
      case 'email_required':
        return 'Email access is required for sign-in. Please grant email permission.';
      default:
        return `Authentication error: ${code}`;
    }
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 px-4">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full mb-4">
            <AlertCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Authentication Failed
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {error}
          </p>
          <a
            href="/"
            className="inline-flex items-center justify-center px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
          >
            Back to Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 px-4">
      <div className="w-full max-w-md text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-green-600 rounded-full mb-4">
          <Bot className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Signing you in...
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Please wait while we complete your sign-in.
        </p>
        <Loader2 className="w-8 h-8 animate-spin text-green-600 mx-auto" />
      </div>
    </div>
  );
}
