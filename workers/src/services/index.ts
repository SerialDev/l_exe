/**
 * Services Index
 * Central export for all service modules
 */

// Auth service
export {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  createSession,
  validateSession,
  deleteSession,
  deleteUserSessions,
  registerUser,
  loginUser,
  refreshAccessToken,
  logoutUser,
  getUserById,
  updatePassword,
  type AccessTokenPayload,
  type RefreshTokenPayload,
  type RegisterInput,
  type Session,
  type AuthTokens,
  type User,
} from './auth';

// Chat service
export {
  ChatService,
  createChatService,
  type ChatServiceConfig,
  type SendMessageRequest,
  type SendMessageResponse,
  type StreamCallbacks,
} from './chat';

// Crypto utilities
export {
  generateRandomBytes,
  bufferToHex,
  hexToBuffer,
  bufferToBase64,
  base64ToBuffer,
  timingSafeEqual,
  generateUUID,
  encrypt,
  decrypt,
} from './crypto';

// File service
export {
  processFileUpload,
  processImageUpload,
  getFileRecord,
  deleteFileRecord,
  listUserFiles,
  generateFileKey,
  validateFileType,
  validateFileSize,
  getFileUrl,
  ALLOWED_IMAGE_TYPES,
  MAX_FILE_SIZES,
  type FileRecord,
  type ProcessedFile,
} from './files';

// Image processing
export {
  getImageDimensions,
  generateThumbnailKey,
  type ImageDimensions,
} from './images';

// Storage (R2)
export {
  uploadFile,
  downloadFile,
  deleteFile,
  getSignedUrl,
  listFiles,
} from './storage';

// TOTP/2FA
export {
  generateSecret,
  generateTOTP,
  verifyTOTP,
  generateBackupCodes,
} from './totp';

// Web Search
export {
  WebSearchService,
  createWebSearchService,
  createWebSearchServiceFromEnv,
  type SearchResult,
  type ImageResult,
  type NewsResult,
  type SearchResponse,
  type SearchOptions,
  type SearchProvider,
  type WebSearchConfig,
} from './websearch';

// Code Interpreter
export {
  CodeInterpreterService,
  createCodeInterpreter,
  createCodeInterpreterFromEnv,
  getLanguageInfo,
  detectLanguage,
  type ExecutionResult,
  type ExecutionOptions,
  type SupportedLanguage,
  type ExecutionBackend,
  type CodeInterpreterConfig,
} from './codeinterpreter';

// Artifacts
export {
  ArtifactService,
  createArtifactService,
  parseArtifacts,
  validateArtifact,
  stripArtifacts,
  extractTextContent,
  getArtifactSystemPrompt,
  type Artifact,
  type ArtifactType,
  type ArtifactVersion,
  type CreateArtifactInput,
  type UpdateArtifactInput,
  type ParsedArtifact,
} from './artifacts';

// Memory
export {
  MemoryService,
  createMemoryService,
  getMemorySystemPrompt,
  type Memory,
  type MemoryType,
  type MemoryContext,
  type MemorySearchResult,
  type CreateMemoryInput,
  type UpdateMemoryInput,
} from './memory';

// Speech (STT/TTS)
export {
  SpeechService,
  createSpeechService,
  createSpeechServiceFromEnv,
  type STTProvider,
  type TTSProvider,
  type TTSVoice,
  type STTResult,
  type TTSResult,
  type STTOptions,
  type TTSOptions,
  type SpeechConfig,
} from './speech';

// Image Generation
export {
  ImageGenService,
  createImageGenService,
  createImageGenServiceFromEnv,
  type ImageGenProvider,
  type ImageSize,
  type ImageQuality,
  type ImageStyle,
  type GeneratedImage,
  type ImageGenResult,
  type ImageGenOptions,
  type ImageEditOptions,
  type ImageVariationOptions,
  type ImageGenConfig,
} from './imagegen';

// Import/Export
export {
  ImportExportService,
  createImportExportService,
  type ImportFormat,
  type ExportFormat,
  type ImportedConversation,
  type ExportedConversation,
  type ImportResult,
  type BulkImportResult,
} from './importexport';

// Resumable Streams
export {
  ResumableStreamService,
  createResumableStreamService,
  createResumableSSEHeaders,
  formatResumableSSE,
  parseLastEventId,
  type StreamState,
  type StreamChunkData,
  type StreamRecoveryResult,
} from './streams';

// Conversation Search (aliased to avoid collision with websearch types)
export {
  ConversationSearchService,
  createConversationSearchService,
  type SearchResult as ConvSearchResult,
  type SearchOptions as ConvSearchOptions,
  type SearchResponse as ConvSearchResponse,
} from './conversationsearch';

// Moderation
export {
  ModerationService,
  createModerationService,
  createModerationServiceFromEnv,
  type ModerationResult,
  type ModerationConfig,
  type ModerationLogEntry,
} from './moderation';
