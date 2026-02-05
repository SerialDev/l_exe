/**
 * Encryption Store
 * 
 * Manages the encryption key lifecycle:
 * 1. On login: Derive key from password, unwrap master key
 * 2. On first use: Generate master key, wrap with password-derived key
 * 3. On logout: Clear master key from memory
 */

import { create } from 'zustand';
import * as api from '../services/api';
import {
  deriveKeyFromPassword,
  generateMasterKey,
  wrapMasterKey,
  unwrapMasterKey,
  cacheMasterKey,
  getCachedMasterKey,
  clearMasterKey,
  generateSalt,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  uint8ArrayToBase64,
  base64ToUint8Array,
  encryptMessage,
  decryptMessage,
  isEncrypted,
} from '../lib/encryption';

interface EncryptionState {
  isInitialized: boolean;
  isEncryptionEnabled: boolean;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  initializeEncryption: (password: string) => Promise<void>;
  setupEncryption: (password: string) => Promise<void>;
  encrypt: (plaintext: string) => Promise<string>;
  decrypt: (ciphertext: string) => Promise<string>;
  logout: () => void;
  clearError: () => void;
}

export const useEncryptionStore = create<EncryptionState>((set, get) => ({
  isInitialized: false,
  isEncryptionEnabled: false,
  isLoading: false,
  error: null,

  /**
   * Initialize encryption after login
   * Fetches wrapped key from server and unwraps it with password
   */
  initializeEncryption: async (password: string) => {
    set({ isLoading: true, error: null });
    
    try {
      // Check if user has an encryption key
      const keyData = await api.getEncryptionKey();
      
      if (!keyData.exists) {
        // No key exists - user needs to set up encryption
        set({ isInitialized: true, isEncryptionEnabled: false, isLoading: false });
        return;
      }
      
      // Derive key from password
      const salt = base64ToUint8Array(keyData.salt!);
      const kek = await deriveKeyFromPassword(password, salt);
      
      // Unwrap the master key
      const wrappedKey = base64ToArrayBuffer(keyData.wrappedKey!);
      const iv = base64ToUint8Array(keyData.keyIv!);
      
      const masterKey = await unwrapMasterKey(wrappedKey, kek, iv);
      
      // Cache the master key in memory
      cacheMasterKey(masterKey);
      
      set({ isInitialized: true, isEncryptionEnabled: true, isLoading: false });
    } catch (error) {
      console.error('Failed to initialize encryption:', error);
      set({ 
        isInitialized: true,
        isEncryptionEnabled: false, 
        isLoading: false, 
        error: 'Failed to unlock encryption. Wrong password?' 
      });
    }
  },

  /**
   * Set up encryption for first time use
   * Generates a new master key and wraps it with password
   */
  setupEncryption: async (password: string) => {
    set({ isLoading: true, error: null });
    
    try {
      // Generate new master key
      const masterKey = await generateMasterKey();
      
      // Generate salt for PBKDF2
      const salt = generateSalt();
      
      // Derive key-encryption-key from password
      const kek = await deriveKeyFromPassword(password, salt);
      
      // Wrap the master key
      const { wrappedKey, iv } = await wrapMasterKey(masterKey, kek);
      
      // Store wrapped key on server
      await api.createEncryptionKey({
        wrappedKey: arrayBufferToBase64(wrappedKey),
        keyIv: uint8ArrayToBase64(iv),
        salt: uint8ArrayToBase64(salt),
      });
      
      // Cache the master key in memory
      cacheMasterKey(masterKey);
      
      set({ isEncryptionEnabled: true, isLoading: false });
    } catch (error) {
      console.error('Failed to setup encryption:', error);
      set({ 
        isLoading: false, 
        error: error instanceof Error ? error.message : 'Failed to set up encryption' 
      });
      throw error;
    }
  },

  /**
   * Encrypt a message
   */
  encrypt: async (plaintext: string): Promise<string> => {
    const masterKey = getCachedMasterKey();
    if (!masterKey) {
      throw new Error('Encryption not initialized');
    }
    return encryptMessage(plaintext, masterKey);
  },

  /**
   * Decrypt a message
   */
  decrypt: async (ciphertext: string): Promise<string> => {
    const masterKey = getCachedMasterKey();
    if (!masterKey) {
      // If no key, return as-is (might be unencrypted legacy data)
      return ciphertext;
    }
    
    // Check if this looks like encrypted content
    if (!isEncrypted(ciphertext)) {
      return ciphertext;
    }
    
    try {
      return await decryptMessage(ciphertext, masterKey);
    } catch {
      // If decryption fails, return as-is (might be unencrypted)
      console.warn('Failed to decrypt message, returning as-is');
      return ciphertext;
    }
  },

  /**
   * Clear encryption state on logout
   */
  logout: () => {
    clearMasterKey();
    set({ isInitialized: false, isEncryptionEnabled: false, error: null });
  },

  /**
   * Clear error
   */
  clearError: () => {
    set({ error: null });
  },
}));

/**
 * Helper to check if encryption is ready
 */
export function isEncryptionReady(): boolean {
  return getCachedMasterKey() !== null;
}
