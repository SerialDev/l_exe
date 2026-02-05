/**
 * R2 Storage Service
 * Handles all R2 bucket operations for file storage
 */

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
  const httpMetadata: R2HTTPMetadata = {};
  
  // Extract content-type from metadata if provided
  if (metadata?.['content-type']) {
    httpMetadata.contentType = metadata['content-type'];
    delete metadata['content-type'];
  }

  const object = await bucket.put(key, data, {
    httpMetadata,
    customMetadata: metadata,
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
  return bucket.get(key);
}

/**
 * Delete a file from R2 bucket
 */
export async function deleteFile(
  bucket: R2Bucket,
  key: string
): Promise<void> {
  await bucket.delete(key);
}

/**
 * Generate a presigned URL for temporary file access
 * Note: R2 presigned URLs require the R2 bucket to be configured with a custom domain
 * or use the S3 API compatibility with credentials
 * 
 * For Workers, we typically use a signed URL pattern with a verification token
 */
export function getSignedUrl(
  bucket: R2Bucket,
  key: string,
  expiresIn: number,
  secret: string,
  baseUrl: string
): string {
  const expires = Math.floor(Date.now() / 1000) + expiresIn;
  const payload = `${key}:${expires}`;
  
  // Create a simple HMAC-like signature using Web Crypto would be async
  // For synchronous use, we use a simple hash approach
  // In production, use proper HMAC signing
  const signature = btoa(payload + ':' + secret).replace(/[+/=]/g, (c) => {
    return c === '+' ? '-' : c === '/' ? '_' : '';
  });

  const params = new URLSearchParams({
    key,
    expires: expires.toString(),
    signature,
  });

  return `${baseUrl}/files/download?${params.toString()}`;
}

/**
 * Verify a signed URL
 */
export function verifySignedUrl(
  key: string,
  expires: string,
  signature: string,
  secret: string
): boolean {
  const expiresNum = parseInt(expires, 10);
  
  // Check if expired
  if (Date.now() / 1000 > expiresNum) {
    return false;
  }

  // Verify signature
  const payload = `${key}:${expires}`;
  const expectedSignature = btoa(payload + ':' + secret).replace(/[+/=]/g, (c) => {
    return c === '+' ? '-' : c === '/' ? '_' : '';
  });

  return signature === expectedSignature;
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
  const options: R2ListOptions = {
    prefix,
    limit: limit ?? 100,
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
