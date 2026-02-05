/**
 * File Processing Service
 * Handles file uploads, validation, and URL generation
 */

import {
  uploadFile,
  getSignedUrl,
  deleteFile,
  type UploadResult,
} from './storage';
import { validateImageFormat, getImageDimensions } from './images';

export interface FileRecord {
  id: string;
  userId: string;
  filename: string;
  r2Key: string;
  mimeType: string;
  size: number;
  purpose: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ProcessedFile {
  record: FileRecord;
  uploadResult: UploadResult;
}

/**
 * Generate a unique R2 key for a file
 * Format: {userId}/{purpose}/{timestamp}-{random}-{filename}
 */
export function generateFileKey(
  userId: string,
  filename: string,
  purpose: string = 'uploads'
): string {
  const timestamp = Date.now();
  const random = crypto.randomUUID().split('-')[0];
  
  // Sanitize filename - remove path components and special chars
  const sanitized = filename
    .split(/[/\\]/)
    .pop()!
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .toLowerCase();

  return `${userId}/${purpose}/${timestamp}-${random}-${sanitized}`;
}

/**
 * Validate file MIME type against allowed types
 * Supports wildcards like 'image/*'
 */
export function validateFileType(
  mimeType: string,
  allowedTypes: string[]
): boolean {
  const normalizedMime = mimeType.toLowerCase();

  return allowedTypes.some((allowed) => {
    const normalizedAllowed = allowed.toLowerCase();
    
    // Exact match
    if (normalizedAllowed === normalizedMime) {
      return true;
    }
    
    // Wildcard match (e.g., 'image/*')
    if (normalizedAllowed.endsWith('/*')) {
      const prefix = normalizedAllowed.slice(0, -1);
      return normalizedMime.startsWith(prefix);
    }
    
    return false;
  });
}

/**
 * Validate file size against maximum allowed
 */
export function validateFileSize(size: number, maxSize: number): boolean {
  return size > 0 && size <= maxSize;
}

/**
 * Default allowed image types
 */
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

/**
 * Default max file sizes (in bytes)
 */
export const MAX_FILE_SIZES = {
  image: 10 * 1024 * 1024, // 10MB
  document: 50 * 1024 * 1024, // 50MB
  default: 25 * 1024 * 1024, // 25MB
};

/**
 * Process and upload an image file
 */
export async function processImageUpload(
  bucket: R2Bucket,
  db: D1Database,
  userId: string,
  file: File
): Promise<ProcessedFile> {
  // Validate MIME type
  if (!validateFileType(file.type, ALLOWED_IMAGE_TYPES)) {
    throw new Error(
      `Invalid image type: ${file.type}. Allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}`
    );
  }

  // Validate file size
  if (!validateFileSize(file.size, MAX_FILE_SIZES.image)) {
    throw new Error(
      `File too large. Maximum size: ${MAX_FILE_SIZES.image / 1024 / 1024}MB`
    );
  }

  // Read file data
  const arrayBuffer = await file.arrayBuffer();

  // Validate image format by checking magic bytes
  if (!validateImageFormat(arrayBuffer)) {
    throw new Error('Invalid image format');
  }

  // Get image dimensions
  const dimensions = getImageDimensions(arrayBuffer);

  // Generate unique key
  const r2Key = generateFileKey(userId, file.name, 'images');

  // Upload to R2
  const uploadResult = await uploadFile(bucket, r2Key, arrayBuffer, {
    'content-type': file.type,
    'original-filename': file.name,
    'user-id': userId,
  });

  // Generate file ID
  const fileId = crypto.randomUUID();

  // Store record in database
  const metadata: Record<string, unknown> = {
    originalFilename: file.name,
    ...dimensions,
  };

  await db
    .prepare(
      `INSERT INTO files (id, user_id, filename, r2_key, mime_type, size, purpose, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .bind(
      fileId,
      userId,
      file.name,
      r2Key,
      file.type,
      file.size,
      'image',
      JSON.stringify(metadata)
    )
    .run();

  const record: FileRecord = {
    id: fileId,
    userId,
    filename: file.name,
    r2Key,
    mimeType: file.type,
    size: file.size,
    purpose: 'image',
    metadata,
    createdAt: new Date().toISOString(),
  };

  return { record, uploadResult };
}

/**
 * Process and upload a general file
 */
export async function processFileUpload(
  bucket: R2Bucket,
  db: D1Database,
  userId: string,
  file: File,
  purpose: string,
  options?: {
    allowedTypes?: string[];
    maxSize?: number;
  }
): Promise<ProcessedFile> {
  const allowedTypes = options?.allowedTypes;
  const maxSize = options?.maxSize ?? MAX_FILE_SIZES.default;

  // Validate MIME type if restrictions provided
  if (allowedTypes && !validateFileType(file.type, allowedTypes)) {
    throw new Error(
      `Invalid file type: ${file.type}. Allowed: ${allowedTypes.join(', ')}`
    );
  }

  // Validate file size
  if (!validateFileSize(file.size, maxSize)) {
    throw new Error(
      `File too large. Maximum size: ${maxSize / 1024 / 1024}MB`
    );
  }

  // Read file data
  const arrayBuffer = await file.arrayBuffer();

  // Generate unique key
  const r2Key = generateFileKey(userId, file.name, purpose);

  // Upload to R2
  const uploadResult = await uploadFile(bucket, r2Key, arrayBuffer, {
    'content-type': file.type,
    'original-filename': file.name,
    'user-id': userId,
    purpose,
  });

  // Generate file ID
  const fileId = crypto.randomUUID();

  // Store record in database
  const metadata: Record<string, unknown> = {
    originalFilename: file.name,
  };

  await db
    .prepare(
      `INSERT INTO files (id, user_id, filename, r2_key, mime_type, size, purpose, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .bind(
      fileId,
      userId,
      file.name,
      r2Key,
      file.type,
      file.size,
      purpose,
      JSON.stringify(metadata)
    )
    .run();

  const record: FileRecord = {
    id: fileId,
    userId,
    filename: file.name,
    r2Key,
    mimeType: file.type,
    size: file.size,
    purpose,
    metadata,
    createdAt: new Date().toISOString(),
  };

  return { record, uploadResult };
}

/**
 * Get file URL - either public or signed
 */
export function getFileUrl(
  r2Key: string,
  isPublic: boolean,
  options: {
    publicBaseUrl?: string;
    signedUrlSecret?: string;
    signedUrlBaseUrl?: string;
    expiresIn?: number;
  }
): string {
  if (isPublic) {
    if (!options.publicBaseUrl) {
      throw new Error('Public base URL required for public files');
    }
    return `${options.publicBaseUrl}/${r2Key}`;
  }

  // Generate signed URL
  if (!options.signedUrlSecret || !options.signedUrlBaseUrl) {
    throw new Error('Signed URL configuration required for private files');
  }

  const expiresIn = options.expiresIn ?? 3600; // Default 1 hour
  return getSignedUrl(
    null as unknown as R2Bucket, // Not used in getSignedUrl
    r2Key,
    expiresIn,
    options.signedUrlSecret,
    options.signedUrlBaseUrl
  );
}

/**
 * Delete a file and its database record
 */
export async function deleteFileRecord(
  bucket: R2Bucket,
  db: D1Database,
  fileId: string,
  userId: string
): Promise<boolean> {
  // Get file record
  const result = await db
    .prepare('SELECT r2_key FROM files WHERE id = ? AND user_id = ?')
    .bind(fileId, userId)
    .first<{ r2_key: string }>();

  if (!result) {
    return false;
  }

  // Delete from R2
  await deleteFile(bucket, result.r2_key);

  // Delete from database
  await db
    .prepare('DELETE FROM files WHERE id = ? AND user_id = ?')
    .bind(fileId, userId)
    .run();

  return true;
}

/**
 * Get file record by ID
 */
export async function getFileRecord(
  db: D1Database,
  fileId: string,
  userId?: string
): Promise<FileRecord | null> {
  let query = 'SELECT * FROM files WHERE id = ?';
  const params: string[] = [fileId];

  if (userId) {
    query += ' AND user_id = ?';
    params.push(userId);
  }

  const result = await db
    .prepare(query)
    .bind(...params)
    .first<{
      id: string;
      user_id: string;
      filename: string;
      r2_key: string;
      mime_type: string;
      size: number;
      purpose: string;
      metadata: string;
      created_at: string;
    }>();

  if (!result) {
    return null;
  }

  return {
    id: result.id,
    userId: result.user_id,
    filename: result.filename,
    r2Key: result.r2_key,
    mimeType: result.mime_type,
    size: result.size,
    purpose: result.purpose,
    metadata: JSON.parse(result.metadata || '{}'),
    createdAt: result.created_at,
  };
}

/**
 * List files for a user
 */
export async function listUserFiles(
  db: D1Database,
  userId: string,
  options?: {
    purpose?: string;
    limit?: number;
    offset?: number;
  }
): Promise<FileRecord[]> {
  let query = 'SELECT * FROM files WHERE user_id = ?';
  const params: (string | number)[] = [userId];

  if (options?.purpose) {
    query += ' AND purpose = ?';
    params.push(options.purpose);
  }

  query += ' ORDER BY created_at DESC';

  if (options?.limit) {
    query += ' LIMIT ?';
    params.push(options.limit);
  }

  if (options?.offset) {
    query += ' OFFSET ?';
    params.push(options.offset);
  }

  const results = await db
    .prepare(query)
    .bind(...params)
    .all<{
      id: string;
      user_id: string;
      filename: string;
      r2_key: string;
      mime_type: string;
      size: number;
      purpose: string;
      metadata: string;
      created_at: string;
    }>();

  return results.results.map((r) => ({
    id: r.id,
    userId: r.user_id,
    filename: r.filename,
    r2Key: r.r2_key,
    mimeType: r.mime_type,
    size: r.size,
    purpose: r.purpose,
    metadata: JSON.parse(r.metadata || '{}'),
    createdAt: r.created_at,
  }));
}
