/**
 * End-to-End Encryption Utilities
 * 
 * Uses Web Crypto API for:
 * - AES-256-GCM for message encryption
 * - PBKDF2 for key derivation from password
 * 
 * Architecture:
 * 1. User has a Master Key (random 256-bit AES key)
 * 2. Master Key is wrapped (encrypted) with a Key-Encryption-Key (KEK)
 * 3. KEK is derived from user's password using PBKDF2
 * 4. Only the wrapped key + salt is stored on server
 * 5. Messages are encrypted with Master Key before sending to server
 */

// Constants - OWASP 2023 recommends 310000 for PBKDF2-SHA256
const PBKDF2_ITERATIONS = 310000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 256;

/**
 * Generate a random salt for PBKDF2
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

/**
 * Generate a random IV for AES-GCM
 */
export function generateIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_LENGTH));
}

/**
 * Derive a key from password using PBKDF2
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  // Import password as raw key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  // Derive AES key from password
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as Uint8Array<ArrayBuffer>,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH },
    true, // extractable for wrapping
    ['wrapKey', 'unwrapKey']
  );
}

/**
 * Generate a new random master key for encryption
 */
export async function generateMasterKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: KEY_LENGTH },
    true, // extractable so it can be wrapped
    ['encrypt', 'decrypt']
  );
}

/**
 * Wrap (encrypt) the master key with the password-derived key
 */
export async function wrapMasterKey(
  masterKey: CryptoKey,
  wrappingKey: CryptoKey
): Promise<{ wrappedKey: ArrayBuffer; iv: Uint8Array }> {
  const iv = generateIV();
  
  const wrappedKey = await crypto.subtle.wrapKey(
    'raw',
    masterKey,
    wrappingKey,
    { name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> }
  );

  return { wrappedKey, iv };
}

/**
 * Unwrap (decrypt) the master key with the password-derived key
 */
export async function unwrapMasterKey(
  wrappedKey: ArrayBuffer,
  wrappingKey: CryptoKey,
  iv: Uint8Array
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    wrappedKey,
    wrappingKey,
    { name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> },
    { name: 'AES-GCM', length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a message with the master key
 */
export async function encryptMessage(
  plaintext: string,
  masterKey: CryptoKey
): Promise<string> {
  const encoder = new TextEncoder();
  const iv = generateIV();
  const data = encoder.encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> },
    masterKey,
    data
  );

  // Combine IV + ciphertext and encode as base64
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a message with the master key
 */
export async function decryptMessage(
  encryptedBase64: string,
  masterKey: CryptoKey
): Promise<string> {
  // Decode base64
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  
  // Extract IV and ciphertext
  const iv = combined.slice(0, IV_LENGTH) as Uint8Array<ArrayBuffer>;
  const ciphertext = combined.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    masterKey,
    ciphertext
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

/**
 * Convert ArrayBuffer to base64 string
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

/**
 * Convert base64 string to ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Convert Uint8Array to base64 string
 */
export function uint8ArrayToBase64(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr));
}

/**
 * Convert base64 string to Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

/**
 * Check if a string looks like encrypted content (base64 with expected length)
 */
export function isEncrypted(content: string): boolean {
  // Encrypted content is base64 and starts with IV (12 bytes = 16 base64 chars minimum)
  if (content.length < 20) return false;
  try {
    const decoded = atob(content);
    // Should have at least IV (12 bytes) + some ciphertext + auth tag (16 bytes)
    return decoded.length >= 12 + 1 + 16;
  } catch {
    return false;
  }
}

// ============================================================================
// Key Management Store
// ============================================================================

let masterKeyCache: CryptoKey | null = null;
let keyTimeout: ReturnType<typeof setTimeout> | null = null;

// Auto-clear master key after 15 minutes of inactivity for security
const KEY_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Reset the key timeout - call this on user activity
 */
function resetKeyTimeout(): void {
  if (keyTimeout) {
    clearTimeout(keyTimeout);
  }
  if (masterKeyCache) {
    keyTimeout = setTimeout(() => {
      console.log('[E2EE] Master key cleared due to inactivity');
      clearMasterKey();
    }, KEY_TIMEOUT_MS);
  }
}

/**
 * Store the master key in memory (cleared on page refresh or timeout)
 */
export function cacheMasterKey(key: CryptoKey): void {
  masterKeyCache = key;
  resetKeyTimeout();
}

/**
 * Get the cached master key
 */
export function getCachedMasterKey(): CryptoKey | null {
  if (masterKeyCache) {
    resetKeyTimeout(); // Reset timeout on access
  }
  return masterKeyCache;
}

/**
 * Clear the cached master key (on logout or timeout)
 */
export function clearMasterKey(): void {
  masterKeyCache = null;
  if (keyTimeout) {
    clearTimeout(keyTimeout);
    keyTimeout = null;
  }
}

/**
 * Check if encryption is available (master key is loaded)
 */
export function isEncryptionReady(): boolean {
  return masterKeyCache !== null;
}
