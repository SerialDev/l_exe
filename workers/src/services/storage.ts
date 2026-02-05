/**
 * R2 Storage Service
 * Handles all R2 bucket operations for file storage
 */

/**
 * SECURITY: Validate storage key to prevent path traversal attacks
 * @throws Error if key is invalid
 */
function validateKey(key: string): void {
  if (!key || typeof key !== 'string') {
    throw new Error('Storage key is required');
  }
  
  // Check for path traversal patterns
  if (key.includes('..') || key.startsWith('/') || key.includes('//')) {
    throw new Error('Invalid storage key: path traversal detected');
  }
  
  // Check for null bytes and other dangerous characters
  if (key.includes('\x00') || key.includes('\n') || key.includes('\r')) {
    throw new Error('Invalid storage key: contains forbidden characters');
  }
  
  // Enforce maximum key length (R2 limit is 1024 bytes)
  if (key.length > 1024) {
    throw new Error('Storage key exceeds maximum length');
  }
  
  // Validate character set - allow alphanumeric, hyphens, underscores, dots, and forward slashes
  if (!/^[a-zA-Z0-9\-_./]+$/.test(key)) {
    throw new Error('Invalid storage key: contains disallowed characters');
  }
}

/**
 * SECURITY: Validate expiration time for signed URLs
 */
function validateExpiresIn(expiresIn: number): void {
  const MIN_EXPIRES = 60; // 1 minute minimum
  const MAX_EXPIRES = 86400 * 7; // 7 days maximum
  
  if (!Number.isInteger(expiresIn) || expiresIn < MIN_EXPIRES || expiresIn > MAX_EXPIRES) {
    throw new Error(`expiresIn must be between ${MIN_EXPIRES} and ${MAX_EXPIRES} seconds`);
  }
}

/**
 * SECURITY: Validate secret for signed URLs
 */
function validateSecret(secret: string): void {
  if (!secret || typeof secret !== 'string' || secret.length < 32) {
    throw new Error('Signing secret must be at least 32 characters');
  }
}

export interface UploadResult {
  key: string;
  etag: string;
  size: number;
  uploaded: Date;
}

export interface FileMetadata {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

export interface ListFilesResult {
  files: FileMetadata[];
  truncated: boolean;
  cursor?: string;
}

/**
 * Upload a file to R2 bucket
 */
export async function uploadFile(
  bucket: R2Bucket,
  key: string,
  data: ArrayBuffer | ReadableStream,
  metadata?: Record<string, string>
): Promise<UploadResult> {
  // SECURITY: Validate key to prevent path traversal
  validateKey(key);
  
  const httpMetadata: R2HTTPMetadata = {};
  
  // Copy metadata to avoid mutating input
  let customMetadata = metadata ? { ...metadata } : undefined;
  
  // Extract content-type from metadata if provided
  if (customMetadata?.['content-type']) {
    httpMetadata.contentType = customMetadata['content-type'];
    delete customMetadata['content-type'];
  }

  const object = await bucket.put(key, data, {
    httpMetadata,
    customMetadata,
  });

  return {
    key: object.key,
    etag: object.etag,
    size: object.size,
    uploaded: object.uploaded,
  };
}

/**
 * Download a file from R2 bucket
 */
export async function downloadFile(
  bucket: R2Bucket,
  key: string
): Promise<R2ObjectBody | null> {
  // SECURITY: Validate key to prevent path traversal
  validateKey(key);
  
  return bucket.get(key);
}

/**
 * Delete a file from R2 bucket
 */
export async function deleteFile(
  bucket: R2Bucket,
  key: string
): Promise<void> {
  // SECURITY: Validate key to prevent path traversal
  validateKey(key);
  
  await bucket.delete(key);
}

/**
 * Generate a presigned URL for temporary file access using HMAC-SHA256
 * This is an async function that uses proper cryptographic signing
 * Note: Does not verify file existence - caller should check if needed
 */
export async function getSignedUrl(
  _bucket: R2Bucket,
  key: string,
  expiresIn: number,
  secret: string,
  baseUrl: string
): Promise<string> {
  // SECURITY: Validate all inputs
  validateKey(key);
  validateExpiresIn(expiresIn);
  validateSecret(secret);
  
  const expires = Math.floor(Date.now() / 1000) + expiresIn;
  const payload = `${key}:${expires}`;
  
  // Use proper HMAC-SHA256 for signing
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const data = encoder.encode(payload);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, data);
  const signatureArray = new Uint8Array(signatureBuffer);
  const signature = btoa(String.fromCharCode(...signatureArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const params = new URLSearchParams({
    key,
    expires: expires.toString(),
    signature,
  });

  return `${baseUrl}/files/download?${params.toString()}`;
}

/**
 * Verify a signed URL using timing-safe comparison
 */
export async function verifySignedUrl(
  key: string,
  expires: string,
  signature: string,
  secret: string
): Promise<boolean> {
  // SECURITY: Validate inputs
  try {
    validateKey(key);
    validateSecret(secret);
  } catch {
    return false; // Invalid inputs should fail verification
  }
  
  // Validate signature format (base64url)
  if (!signature || !/^[A-Za-z0-9_-]+$/.test(signature)) {
    return false;
  }
  
  const expiresNum = parseInt(expires, 10);
  
  // Validate expires is a valid number
  if (isNaN(expiresNum) || !Number.isFinite(expiresNum)) {
    return false;
  }
  
  // Check if expired
  if (Date.now() / 1000 > expiresNum) {
    return false;
  }

  // Recreate the expected signature
  const payload = `${key}:${expires}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const data = encoder.encode(payload);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const expectedBuffer = await crypto.subtle.sign('HMAC', cryptoKey, data);
  const expectedArray = new Uint8Array(expectedBuffer);
  const expectedSignature = btoa(String.fromCharCode(...expectedArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  // Timing-safe comparison
  if (signature.length !== expectedSignature.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }
  
  return result === 0;
}

/**
 * List files in R2 bucket with pagination
 */
export async function listFiles(
  bucket: R2Bucket,
  prefix: string,
  limit?: number,
  cursor?: string
): Promise<ListFilesResult> {
  // SECURITY: Validate prefix to prevent path traversal
  // Allow empty prefix for listing root
  if (prefix) {
    validateKey(prefix);
  }
  
  // SECURITY: Enforce reasonable limit
  const maxLimit = 1000;
  const safeLimit = Math.min(Math.max(1, limit ?? 100), maxLimit);
  
  const options: R2ListOptions = {
    prefix,
    limit: safeLimit,
    cursor,
  };

  const listed = await bucket.list(options);

  const files: FileMetadata[] = listed.objects.map((obj) => ({
    key: obj.key,
    size: obj.size,
    etag: obj.etag,
    httpEtag: obj.httpEtag,
    uploaded: obj.uploaded,
    httpMetadata: obj.httpMetadata,
    customMetadata: obj.customMetadata,
  }));

  return {
    files,
    truncated: listed.truncated,
    cursor: listed.truncated ? listed.cursor : undefined,
  };
}

/**
 * Copy a file within the same R2 bucket
 */
export async function copyFile(
  bucket: R2Bucket,
  sourceKey: string,
  destKey: string
): Promise<UploadResult> {
  // SECURITY: Validate both keys to prevent path traversal
  validateKey(sourceKey);
  validateKey(destKey);
  
  // R2 doesn't have a native copy operation, so we download and re-upload
  const sourceObject = await bucket.get(sourceKey);
  
  if (!sourceObject) {
    throw new Error(`Source file not found: ${sourceKey}`);
  }

  const object = await bucket.put(destKey, sourceObject.body, {
    httpMetadata: sourceObject.httpMetadata,
    customMetadata: sourceObject.customMetadata,
  });

  return {
    key: object.key,
    etag: object.etag,
    size: object.size,
    uploaded: object.uploaded,
  };
}

/**
 * Check if a file exists in R2 bucket
 */
export async function fileExists(
  bucket: R2Bucket,
  key: string
): Promise<boolean> {
  // SECURITY: Validate key to prevent path traversal
  validateKey(key);
  
  const head = await bucket.head(key);
  return head !== null;
}

/**
 * Get file metadata without downloading the file
 */
export async function getFileMetadata(
  bucket: R2Bucket,
  key: string
): Promise<FileMetadata | null> {
  // SECURITY: Validate key to prevent path traversal
  validateKey(key);
  
  const head = await bucket.head(key);
  
  if (!head) {
    return null;
  }

  return {
    key: head.key,
    size: head.size,
    etag: head.etag,
    httpEtag: head.httpEtag,
    uploaded: head.uploaded,
    httpMetadata: head.httpMetadata,
    customMetadata: head.customMetadata,
  };
}
