/**
 * Encryption Unlock Modal
 * Shows when user has encryption enabled but hasn't unlocked it yet
 */

import { useState, useEffect } from 'react';
import { useEncryptionStore } from '../../stores/encryptionStore';
import { getEncryptionKey } from '../../services/api';
import { Lock, Eye, EyeOff, AlertCircle, Loader2, Shield } from 'lucide-react';

interface EncryptionUnlockModalProps {
  isOpen: boolean;
  onUnlocked: () => void;
  onSkip: () => void;
}

export function EncryptionUnlockModal({ isOpen, onUnlocked, onSkip }: EncryptionUnlockModalProps) {
  const { initializeEncryption, isEncryptionEnabled, isLoading, error, clearError } = useEncryptionStore();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Clear errors when modal opens
  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setLocalError(null);
      clearError();
    }
  }, [isOpen, clearError]);

  // Auto-close when encryption is enabled
  useEffect(() => {
    if (isEncryptionEnabled && isOpen) {
      onUnlocked();
    }
  }, [isEncryptionEnabled, isOpen, onUnlocked]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!password) {
      setLocalError('Please enter your encryption password');
      return;
    }

    try {
      await initializeEncryption(password);
      // onUnlocked will be called by the useEffect when isEncryptionEnabled becomes true
    } catch {
      // Error is handled by the store
    }
  };

  if (!isOpen) return null;

  const displayError = localError || error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden m-4">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-green-500 to-green-600">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <Lock className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">
                Unlock Encryption
              </h2>
              <p className="text-sm text-green-100">
                Your messages are protected
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <Shield className="w-5 h-5 text-green-600 dark:text-green-400" />
            <p className="text-sm text-green-700 dark:text-green-400">
              You have end-to-end encryption enabled. Enter your password to decrypt your messages.
            </p>
          </div>

          {displayError && (
            <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm">{displayError}</span>
            </div>
          )}

          <form onSubmit={handleUnlock} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Encryption Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 pr-12 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                  placeholder="Enter your encryption password"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Unlocking...
                </>
              ) : (
                <>
                  <Lock className="w-5 h-5" />
                  Unlock
                </>
              )}
            </button>
          </form>

          {/* Skip option */}
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={onSkip}
              className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              Skip for now (encrypted messages will appear garbled)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
