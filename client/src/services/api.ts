/**
 * API Client Service
 * Handles all HTTP requests to the backend
 * 
 * Authentication is handled via cookies (better-auth).
 * All requests include credentials to send cookies.
 */

import type {
  Conversation,
  ConversationListResponse,
  Message,
  SendMessageRequest,
  StreamStartEvent,
  StreamMessageEvent,
  StreamErrorEvent,
  StreamDoneEvent,
} from '../types';

const API_BASE = '/api';

/**
 * Base fetch with cookie-based auth
 * better-auth handles sessions via cookies, so we just need to include credentials
 */
async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
    credentials: 'include', // Include cookies for auth
  });
  
  return response;
}

// =============================================================================
// User Profile API
// Note: Auth (login/register/logout) is now handled by better-auth client
// =============================================================================

export async function getCurrentUser() {
  const response = await fetchWithAuth('/user');
  if (!response.ok) {
    throw new Error('Failed to get user');
  }
  return response.json();
}

// =============================================================================
// User Profile API
// =============================================================================

export interface UpdateProfileData {
  name?: string;
  username?: string;
  avatar?: string;
}

export async function updateProfile(data: UpdateProfileData) {
  const response = await fetchWithAuth('/user', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to update profile');
  }
  
  return response.json();
}

export interface ChangePasswordData {
  currentPassword: string;
  newPassword: string;
}

export async function changePassword(data: ChangePasswordData) {
  const response = await fetchWithAuth('/user/password', {
    method: 'PATCH',
    body: JSON.stringify({
      current_password: data.currentPassword,
      new_password: data.newPassword,
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to change password');
  }
  
  return response.json();
}

export async function deleteAccount(password: string) {
  const response = await fetchWithAuth('/user', {
    method: 'DELETE',
    body: JSON.stringify({ password }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to delete account');
  }
  
  // Session is handled by better-auth via cookies
  return response.json();
}

export async function getUserBalance() {
  const response = await fetchWithAuth('/user/balance');
  if (!response.ok) {
    throw new Error('Failed to get balance');
  }
  return response.json();
}

// =============================================================================
// Conversations API
// =============================================================================

export async function getConversations(page = 1, pageSize = 20): Promise<ConversationListResponse> {
  const response = await fetchWithAuth(`/convos?page=${page}&pageSize=${pageSize}`);
  if (!response.ok) {
    throw new Error('Failed to fetch conversations');
  }
  return response.json();
}

export async function getConversation(id: string): Promise<Conversation> {
  const response = await fetchWithAuth(`/convos/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch conversation');
  }
  return response.json();
}

export async function deleteConversation(id: string): Promise<void> {
  const response = await fetchWithAuth(`/convos/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error('Failed to delete conversation');
  }
}

export async function updateConversationTitle(id: string, title: string): Promise<Conversation> {
  const response = await fetchWithAuth(`/convos/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    throw new Error('Failed to update conversation');
  }
  return response.json();
}

// =============================================================================
// Messages API
// =============================================================================

export async function getMessages(conversationId: string): Promise<Message[]> {
  const response = await fetchWithAuth(`/messages/${conversationId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch messages');
  }
  const data = await response.json();
  return data.messages || data;
}

// =============================================================================
// Chat API (Streaming)
// =============================================================================

export interface StreamCallbacks {
  onStart?: (data: StreamStartEvent) => void;
  onMessage?: (data: StreamMessageEvent) => void;
  onError?: (data: StreamErrorEvent) => void;
  onDone?: (data: StreamDoneEvent) => void;
}

function processEvent(eventType: string, data: any, callbacks: StreamCallbacks) {
  switch (eventType) {
    case 'start':
      callbacks.onStart?.(data);
      break;
    case 'message':
      callbacks.onMessage?.(data);
      break;
    case 'error':
      callbacks.onError?.(data);
      break;
    case 'done':
      console.log('[SSE] Done event processed!');
      callbacks.onDone?.(data);
      break;
  }
}

export async function sendMessageStream(
  request: SendMessageRequest,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const endpoint = request.endpoint.toLowerCase();
  
  const response = await fetch(`${API_BASE}/ask/${endpoint}/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal,
    credentials: 'include', // Include cookies for auth
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.error?.message || error.message || 'Request failed');
  }
  
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }
  
  const decoder = new TextDecoder();
  let buffer = '';
  
  // Helper function to process an event block
  const processEventBlock = (eventBlock: string) => {
    if (!eventBlock.trim()) return;
    
    const lines = eventBlock.split('\n');
    let eventType = '';
    let eventData = '';
    
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        eventData = line.slice(6);
      }
    }
    
    if (eventType && eventData) {
      try {
        const data = JSON.parse(eventData);
        console.log('[SSE] Event:', eventType, eventType === 'message' ? '(content)' : data);
        processEvent(eventType, data, callbacks);
      } catch (e) {
        console.error('Failed to parse SSE data:', e, eventData);
      }
    }
  };
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        // Process any remaining data in buffer when stream ends
        if (buffer.trim()) {
          console.log('[SSE] Processing remaining buffer:', buffer);
          // The buffer might contain one or more events
          const remainingEvents = buffer.split('\n\n');
          for (const eventBlock of remainingEvents) {
            processEventBlock(eventBlock);
          }
        }
        break;
      }
      
      buffer += decoder.decode(value, { stream: true });
      
      // Process complete SSE events (split by double newline)
      const events = buffer.split('\n\n');
      buffer = events.pop() || ''; // Keep incomplete event in buffer
      
      for (const eventBlock of events) {
        processEventBlock(eventBlock);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function sendMessage(request: SendMessageRequest) {
  const endpoint = request.endpoint.toLowerCase();
  
  const response = await fetchWithAuth(`/ask/${endpoint}`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.error?.message || 'Request failed');
  }
  
  return response.json();
}

export async function abortMessage(conversationId: string, messageId: string, endpoint: string): Promise<void> {
  await fetchWithAuth(`/ask/${endpoint}/abort`, {
    method: 'POST',
    body: JSON.stringify({ conversationId, messageId }),
  });
}

// =============================================================================
// Files API
// =============================================================================

export interface UploadedFile {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  purpose: string;
  url: string;
  createdAt: string;
}

export interface UploadFileResponse {
  success: boolean;
  file?: UploadedFile;
  error?: { message: string };
}

export async function uploadFile(
  file: File,
  purpose: 'attachment' | 'avatar' | 'rag' = 'attachment',
  conversationId?: string
): Promise<UploadFileResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('purpose', purpose);
  if (conversationId) {
    formData.append('conversationId', conversationId);
  }

  const response = await fetch(`${API_BASE}/files/upload`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Upload failed' } }));
    throw new Error(error.error?.message || 'Failed to upload file');
  }

  return response.json();
}

export async function uploadImage(
  file: File,
  purpose: string = 'attachment'
): Promise<UploadFileResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('purpose', purpose);

  const response = await fetch(`${API_BASE}/files/images`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Upload failed' } }));
    throw new Error(error.error?.message || 'Failed to upload image');
  }

  return response.json();
}

export async function deleteFile(fileId: string): Promise<void> {
  const response = await fetchWithAuth(`/files/${fileId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to delete file');
  }
}

export async function getFiles(
  page = 1,
  pageSize = 20,
  purpose?: string,
  conversationId?: string
): Promise<{ files: UploadedFile[]; total: number; hasMore: boolean }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (purpose) params.append('purpose', purpose);
  if (conversationId) params.append('conversationId', conversationId);

  const response = await fetchWithAuth(`/files?${params}`);
  if (!response.ok) {
    throw new Error('Failed to fetch files');
  }

  return response.json();
}

// =============================================================================
// Regenerate Message API
// =============================================================================

// =============================================================================
// Speech API (STT/TTS)
// =============================================================================

export interface TranscriptionResult {
  success: boolean;
  text?: string;
  language?: string;
  duration?: number;
  error?: { message: string };
}

export interface SynthesisResult {
  success: boolean;
  audioUrl?: string;
  duration?: number;
  error?: { message: string };
}

export interface Voice {
  id: string;
  name: string;
  language: string;
  gender?: string;
}

export async function transcribeAudio(audioBlob: Blob, language?: string): Promise<TranscriptionResult> {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');
  if (language) {
    formData.append('language', language);
  }

  const response = await fetch(`${API_BASE}/speech/transcribe`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Transcription failed' } }));
    throw new Error(error.error?.message || 'Failed to transcribe audio');
  }

  return response.json();
}

export async function synthesizeSpeech(text: string, voice?: string): Promise<Blob> {
  const response = await fetchWithAuth('/speech/synthesize', {
    method: 'POST',
    body: JSON.stringify({ text, voice }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Synthesis failed' } }));
    throw new Error(error.error?.message || 'Failed to synthesize speech');
  }

  return response.blob();
}

export async function getVoices(): Promise<{ voices: Voice[] }> {
  const response = await fetchWithAuth('/speech/voices');
  if (!response.ok) {
    throw new Error('Failed to fetch voices');
  }
  return response.json();
}

// =============================================================================
// Import/Export API
// =============================================================================

export type ExportFormat = 'json' | 'markdown' | 'text' | 'html';

export async function exportConversation(
  conversationId: string,
  format: ExportFormat = 'json'
): Promise<Blob> {
  const response = await fetchWithAuth(`/data/export/${conversationId}?format=${format}`);
  if (!response.ok) {
    throw new Error('Export failed');
  }
  return response.blob();
}

export async function exportAllConversations(format: ExportFormat = 'json'): Promise<Blob> {
  const response = await fetchWithAuth(`/data/export/all?format=${format}`);
  if (!response.ok) {
    throw new Error('Export failed');
  }
  return response.blob();
}

export interface ImportResult {
  success: boolean;
  conversationsImported: number;
  messagesImported: number;
  errors: string[];
}

export async function importConversations(file: File): Promise<ImportResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/data/import`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Import failed' } }));
    throw new Error(error.error?.message || 'Failed to import');
  }

  return response.json();
}

// =============================================================================
// Conversation Search API
// =============================================================================

export interface SearchResult {
  conversationId: string;
  conversationTitle: string;
  messageId: string;
  content: string;
  role: 'user' | 'assistant';
  createdAt: string;
  highlights: string[];
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  query: string;
}

export async function searchConversations(
  query: string,
  options?: {
    page?: number;
    pageSize?: number;
    conversationId?: string;
  }
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query });
  if (options?.page) params.append('page', String(options.page));
  if (options?.pageSize) params.append('pageSize', String(options.pageSize));
  if (options?.conversationId) params.append('conversationId', options.conversationId);

  const response = await fetchWithAuth(`/convsearch?${params}`);
  if (!response.ok) {
    throw new Error('Search failed');
  }

  return response.json();
}

// =============================================================================
// Regenerate Message API
// =============================================================================

export async function regenerateMessage(
  conversationId: string,
  parentMessageId: string,
  endpoint: string,
  model: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(`${API_BASE}/ask/${endpoint}/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      conversationId,
      parentMessageId,
      endpoint,
      model,
      text: '', // Empty text triggers regeneration
      regenerate: true,
    }),
    signal,
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.error?.message || error.message || 'Request failed');
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  const processEventBlock = (eventBlock: string) => {
    if (!eventBlock.trim()) return;

    const lines = eventBlock.split('\n');
    let eventType = '';
    let eventData = '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        eventData = line.slice(6);
      }
    }

    if (eventType && eventData) {
      try {
        const data = JSON.parse(eventData);
        processEvent(eventType, data, callbacks);
      } catch (e) {
        console.error('Failed to parse SSE data:', e, eventData);
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        if (buffer.trim()) {
          const remainingEvents = buffer.split('\n\n');
          for (const eventBlock of remainingEvents) {
            processEventBlock(eventBlock);
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const eventBlock of events) {
        processEventBlock(eventBlock);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
