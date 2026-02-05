/**
 * Agent and Tool type definitions
 */

export interface Agent {
  id: string;
  agentId: string; // Client-facing ID
  userId: string | null; // null for system agents
  name: string;
  description: string | null;
  instructions: string | null; // System prompt
  model: string;
  endpoint: string;
  tools: string | null; // JSON array of tool IDs
  toolResources: string | null; // JSON object
  provider: AgentProvider;
  avatar: string | null;
  isPublic: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AgentProvider = 
  | 'openai'
  | 'azure'
  | 'anthropic'
  | 'google'
  | 'custom';

export interface AgentCreate {
  agentId?: string;
  userId?: string;
  name: string;
  description?: string;
  instructions?: string;
  model: string;
  endpoint: string;
  tools?: string[];
  toolResources?: Record<string, unknown>;
  provider?: AgentProvider;
  avatar?: string;
  isPublic?: boolean;
}

export interface AgentUpdate {
  name?: string;
  description?: string;
  instructions?: string;
  model?: string;
  endpoint?: string;
  tools?: string[];
  toolResources?: Record<string, unknown>;
  avatar?: string;
  isPublic?: boolean;
  isActive?: boolean;
}

// Tool definitions
export interface Tool {
  id: string;
  toolId: string;
  userId: string | null;
  name: string;
  description: string;
  type: ToolType;
  schema: string; // JSON Schema for function parameters
  authentication: string | null; // JSON for auth config
  endpoint: string | null; // For API tools
  isBuiltin: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ToolType = 
  | 'function'
  | 'code_interpreter'
  | 'retrieval'
  | 'api'
  | 'plugin';

export interface ToolCreate {
  toolId?: string;
  name: string;
  description: string;
  type: ToolType;
  schema: Record<string, unknown>;
  authentication?: Record<string, unknown>;
  endpoint?: string;
}

// Built-in tools
export const BUILTIN_TOOLS = {
  WEB_SEARCH: 'web_search',
  CALCULATOR: 'calculator',
  CODE_INTERPRETER: 'code_interpreter',
  IMAGE_GENERATION: 'image_generation',
  FILE_RETRIEVAL: 'file_retrieval',
} as const;

// Tool execution types
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolResult {
  tool_call_id: string;
  role: 'tool';
  content: string;
}

// Plugin types (for gptPlugins endpoint)
export interface Plugin {
  id: string;
  pluginId: string;
  name: string;
  description: string;
  icon: string | null;
  authConfig: string | null; // JSON for OAuth/API key config
  authenticated: boolean;
  isAuthRequired: boolean;
  createdAt: string;
}

export interface PluginAuth {
  id: string;
  userId: string;
  pluginId: string;
  authType: 'api_key' | 'oauth' | 'service_http';
  credentials: string; // Encrypted JSON
  createdAt: string;
  updatedAt: string;
}

// Action/Function calling
export interface Action {
  id: string;
  actionId: string;
  userId: string;
  name: string;
  description: string;
  metadata: string; // JSON
  agent_id: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActionCreate {
  name: string;
  description: string;
  metadata: Record<string, unknown>;
  agent_id?: string;
}
