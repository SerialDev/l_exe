/**
 * Preset-related type definitions
 */

export interface Preset {
  id: string;
  presetId: string; // Client-facing ID
  userId: string | null; // null for default/system presets
  title: string;
  endpoint: string;
  model: string | null;
  chatGptLabel: string | null;
  promptPrefix: string | null;
  temperature: number | null;
  topP: number | null;
  frequencyPenalty: number | null;
  presencePenalty: number | null;
  maxContextTokens: number | null;
  maxOutputTokens: number | null;
  agentOptions: string | null; // JSON string
  tools: string | null; // JSON array
  isDefault: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface PresetCreate {
  presetId?: string;
  userId?: string;
  title: string;
  endpoint: string;
  model?: string;
  chatGptLabel?: string;
  promptPrefix?: string;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  agentOptions?: Record<string, unknown>;
  tools?: string[];
  isDefault?: boolean;
  order?: number;
}

export interface PresetUpdate {
  title?: string;
  endpoint?: string;
  model?: string;
  chatGptLabel?: string;
  promptPrefix?: string;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  agentOptions?: Record<string, unknown>;
  tools?: string[];
  isDefault?: boolean;
  order?: number;
}

export interface PresetListResponse {
  presets: Preset[];
}

// Model-specific settings that can be saved
export interface ModelSettings {
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  maxContextTokens?: number;
  maxOutputTokens?: number;
}

// Prompt templates (separate from presets)
export interface PromptTemplate {
  id: string;
  userId: string | null;
  title: string;
  content: string;
  category: string | null;
  tags: string | null; // JSON array
  isPublic: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PromptTemplateCreate {
  title: string;
  content: string;
  category?: string;
  tags?: string[];
  isPublic?: boolean;
}
