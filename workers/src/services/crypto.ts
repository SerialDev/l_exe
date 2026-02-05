/**
 * Crypto utilities for Cloudflare Workers
 * Uses Web Crypto API for edge-compatible cryptographic operations
 */

/**
 * Generate cryptographically secure random bytes
 */
export function generateRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Generate a UUID v4
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Convert ArrayBuffer to hex string
 */
export function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Convert ArrayBuffer to base64 string
 */
export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to Uint8Array
 */
export function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derive an AES-GCM key from a string key using PBKDF2
 */
async function deriveKey(key: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data using AES-GCM
 * Returns base64 encoded string: salt:iv:ciphertext
 */
export async function encrypt(data: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = generateRandomBytes(16);
  const iv = generateRandomBytes(12);
  const derivedKey = await deriveKey(key, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    encoder.encode(data)
  );

  const saltB64 = bufferToBase64(salt.buffer as ArrayBuffer);
  const ivB64 = bufferToBase64(iv.buffer as ArrayBuffer);
  const ciphertextB64 = bufferToBase64(ciphertext);

  return `${saltB64}:${ivB64}:${ciphertextB64}`;
}

/**
 * Decrypt data encrypted with AES-GCM
 * Expects base64 encoded string: salt:iv:ciphertext
 */
export async function decrypt(data: string, key: string): Promise<string> {
  const [saltB64, ivB64, ciphertextB64] = data.split(':');

  if (!saltB64 || !ivB64 || !ciphertextB64) {
    throw new Error('Invalid encrypted data format');
  }

  const salt = base64ToBuffer(saltB64);
  const iv = base64ToBuffer(ivB64);
  const ciphertext = base64ToBuffer(ciphertextB64);
  const derivedKey = await deriveKey(key, salt);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    ciphertext
  );

  const decoder = new TextDecoder();
  return decoder.decode(plaintext);
}

/**
 * Timing-safe string comparison to prevent timing attacks
 * Compares both strings in constant time regardless of where they differ
 */
export function timingSafeEqual(a: string, b: string): boolean {
  // Use the longer string length to ensure constant time
  const maxLen = Math.max(a.length, b.length);
  
  // Start with length mismatch flag (1 if different, 0 if same)
  let result = a.length === b.length ? 0 : 1;
  
  // Compare all characters up to maxLen
  // Use 0 for out-of-bounds access to maintain constant time
  for (let i = 0; i < maxLen; i++) {
    const charA = i < a.length ? a.charCodeAt(i) : 0;
    const charB = i < b.length ? b.charCodeAt(i) : 0;
    result |= charA ^ charB;
  }
  
  return result === 0;
}

/**
 * Generate a secure random string of specified length
 */
export function generateRandomString(length: number): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const randomBytes = generateRandomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[randomBytes[i] % charset.length];
  }
  return result;
}
