/**
 * OAuthCallback Component
 * Handles the OAuth callback for better-auth
 * 
 * With better-auth, OAuth is handled via cookies, so this page just needs to
 * check the session and redirect. If there's an error, it shows the error message.
 */

import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { Bot, Loader2, AlertCircle } from 'lucide-react';

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

      // With better-auth, OAuth sets a session cookie
      // We just need to check if we're authenticated
      await checkAuth();

      // Get return URL from params or default to home
      const returnUrl = params.get('returnUrl') || params.get('callbackURL') || '/';

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
