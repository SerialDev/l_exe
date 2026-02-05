/**
 * File-related type definitions
 */

export interface File {
  id: string;
  fileId: string; // Client-facing ID
  userId: string;
  conversationId: string | null;
  messageId: string | null;
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  filepath: string; // R2 key
  source: FileSource;
  type: FileType;
  width: number | null;
  height: number | null;
  embedded: boolean; // For RAG
  embeddingModel: string | null;
  context: string | null; // Extracted text for RAG
  createdAt: string;
  updatedAt: string;
}

export type FileSource = 'local' | 'openai' | 'azure' | 'google' | 'anthropic';

export type FileType = 
  | 'image'
  | 'document'
  | 'code'
  | 'audio'
  | 'video'
  | 'archive'
  | 'other';

export interface FileCreate {
  fileId?: string;
  userId: string;
  conversationId?: string;
  messageId?: string;
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  filepath: string;
  source?: FileSource;
  type?: FileType;
  width?: number;
  height?: number;
}

export interface FileUpdate {
  conversationId?: string;
  messageId?: string;
  embedded?: boolean;
  embeddingModel?: string;
  context?: string;
}

export interface FileUploadResponse {
  file_id: string;
  filename: string;
  filepath: string;
  type: FileType;
  size: number;
  width?: number;
  height?: number;
}

export interface FileListResponse {
  files: File[];
  pageNumber: number;
  pageSize: number;
  pages: number;
}

// Image-specific types
export interface ImageFile extends File {
  type: 'image';
  width: number;
  height: number;
  thumbnail?: string; // R2 key for thumbnail
}

export interface ImageGenerationRequest {
  prompt: string;
  model?: string;
  size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792';
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  n?: number;
}

export interface ImageGenerationResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
}

// Document processing types
export interface DocumentChunk {
  id: string;
  fileId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  embedding: number[] | null;
  metadata: string | null; // JSON
}

// Avatar types
export interface Avatar {
  id: string;
  userId: string;
  filename: string;
  filepath: string;
  mimetype: string;
  size: number;
  createdAt: string;
}

// Allowed file types configuration
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
] as const;

export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/xml',
  'text/html',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export const ALLOWED_CODE_TYPES = [
  'text/javascript',
  'application/javascript',
  'text/typescript',
  'text/x-python',
  'text/x-java',
  'text/x-c',
  'text/x-cpp',
  'text/x-csharp',
  'text/x-go',
  'text/x-rust',
] as const;

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
