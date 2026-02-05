/**
 * TOTP (Time-based One-Time Password) service for Cloudflare Workers
 * RFC 6238 compliant implementation using Web Crypto API
 */

import {
  generateRandomBytes,
  bufferToHex,
  generateRandomString,
} from './crypto';

// Base32 alphabet (RFC 4648)
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Encode bytes to base32 string
 */
function base32Encode(buffer: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decode base32 string to bytes
 */
function base32Decode(input: string): Uint8Array {
  const cleanInput = input.toUpperCase().replace(/=+$/, '');
  const output = new Uint8Array(Math.floor((cleanInput.length * 5) / 8));
  let bits = 0;
  let value = 0;
  let index = 0;

  for (let i = 0; i < cleanInput.length; i++) {
    const charIndex = BASE32_ALPHABET.indexOf(cleanInput[i]);
    if (charIndex === -1) {
      throw new Error(`Invalid base32 character: ${cleanInput[i]}`);
    }

    value = (value << 5) | charIndex;
    bits += 5;

    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }

  return output;
}

/**
 * Generate HMAC-SHA1 hash
 */
async function hmacSha1(key: Uint8Array, data: Uint8Array): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );

  return crypto.subtle.sign('HMAC', cryptoKey, data);
}

/**
 * Convert number to 8-byte big-endian array
 */
function intToBytes(num: number): Uint8Array {
  const bytes = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    bytes[i] = num & 0xff;
    num = Math.floor(num / 256);
  }
  return bytes;
}

/**
 * Generate a TOTP secret (20 bytes = 160 bits, base32 encoded)
 */
export function generateSecret(): string {
  const secretBytes = generateRandomBytes(20);
  return base32Encode(secretBytes);
}

/**
 * Generate TOTP code for the current time
 * @param secret - Base32 encoded secret
 * @param timeStep - Time step in seconds (default: 30)
 * @param digits - Number of digits (default: 6)
 * @param time - Optional timestamp in milliseconds (default: current time)
 */
export async function generateTOTP(
  secret: string,
  timeStep = 30,
  digits = 6,
  time?: number
): Promise<string> {
  const timestamp = time ?? Date.now();
  const counter = Math.floor(timestamp / 1000 / timeStep);

  const secretBytes = base32Decode(secret);
  const counterBytes = intToBytes(counter);

  const hmac = await hmacSha1(secretBytes, counterBytes);
  const hmacArray = new Uint8Array(hmac);

  // Dynamic truncation
  const offset = hmacArray[hmacArray.length - 1] & 0x0f;
  const binary =
    ((hmacArray[offset] & 0x7f) << 24) |
    ((hmacArray[offset + 1] & 0xff) << 16) |
    ((hmacArray[offset + 2] & 0xff) << 8) |
    (hmacArray[offset + 3] & 0xff);

  const otp = binary % Math.pow(10, digits);
  return otp.toString().padStart(digits, '0');
}

/**
 * Verify a TOTP token with time window tolerance
 * @param token - The TOTP token to verify
 * @param secret - Base32 encoded secret
 * @param window - Number of time steps to check before/after current (default: 1)
 * @param timeStep - Time step in seconds (default: 30)
 * @param digits - Number of digits (default: 6)
 */
export async function verifyTOTP(
  token: string,
  secret: string,
  window = 1,
  timeStep = 30,
  digits = 6
): Promise<boolean> {
  if (token.length !== digits) {
    return false;
  }

  const currentTime = Date.now();

  // Check current time step and surrounding windows
  for (let i = -window; i <= window; i++) {
    const checkTime = currentTime + i * timeStep * 1000;
    const expectedToken = await generateTOTP(secret, timeStep, digits, checkTime);

    // Use timing-safe comparison
    if (timingSafeCompare(token, expectedToken)) {
      return true;
    }
  }

  return false;
}

/**
 * Simple timing-safe comparison for TOTP tokens
 */
function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Generate backup codes for account recovery
 * @param count - Number of backup codes to generate (default: 10)
 * @param length - Length of each code (default: 8)
 */
export function generateBackupCodes(count = 10, length = 8): string[] {
  const codes: string[] = [];

  for (let i = 0; i < count; i++) {
    // Generate alphanumeric backup codes
    const code = generateRandomString(length).toUpperCase();
    // Format as XXXX-XXXX for readability
    const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
    codes.push(formatted);
  }

  return codes;
}

/**
 * Generate a TOTP URI for QR code generation
 * @param secret - Base32 encoded secret
 * @param accountName - User's account identifier (e.g., email)
 * @param issuer - Service name
 * @param digits - Number of digits (default: 6)
 * @param period - Time step in seconds (default: 30)
 */
export function generateTOTPUri(
  secret: string,
  accountName: string,
  issuer: string,
  digits = 6,
  period = 30
): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedAccount = encodeURIComponent(accountName);

  return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${digits}&period=${period}`;
}

/**
 * Hash backup codes for secure storage
 */
export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  const hashedCodes: string[] = [];

  for (const code of codes) {
    // Remove formatting for consistent hashing
    const cleanCode = code.replace(/-/g, '');
    const encoder = new TextEncoder();
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(cleanCode));
    hashedCodes.push(bufferToHex(hash));
  }

  return hashedCodes;
}

/**
 * Verify a backup code against stored hashes
 */
export async function verifyBackupCode(
  code: string,
  hashedCodes: string[]
): Promise<{ valid: boolean; index: number }> {
  // Remove formatting
  const cleanCode = code.replace(/-/g, '').toUpperCase();
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(cleanCode));
  const codeHash = bufferToHex(hash);

  for (let i = 0; i < hashedCodes.length; i++) {
    if (timingSafeCompare(codeHash, hashedCodes[i])) {
      return { valid: true, index: i };
    }
  }

  return { valid: false, index: -1 };
}
