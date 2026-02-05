/**
 * AI Provider Factory and Registry
 * 
 * Usage:
 * ```typescript
 * import { getProvider, ProviderConfig } from './providers';
 * 
 * const provider = getProvider('openai', {
 *   apiKey: 'sk-...',
 *   defaultModel: 'gpt-4o',
 * });
 * 
 * const response = await provider.chat({
 *   model: 'gpt-4o',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 * ```
 */

// Re-export all types
export * from './types';

// Re-export base class for extension
export { BaseProvider, RateLimiter } from './base';

// Re-export providers
export { OpenAIProvider } from './openai';
export { AnthropicProvider } from './anthropic';
export { GoogleProvider } from './google';
export { AzureOpenAIProvider } from './azure';
export { OllamaProvider } from './ollama';
export { GroqProvider } from './groq';
export { MistralProvider } from './mistral';
export { OpenRouterProvider } from './openrouter';

// Import for factory
import { IProvider, ProviderConfig, ProviderError } from './types';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { GoogleProvider } from './google';
import { AzureOpenAIProvider } from './azure';
import { OllamaProvider } from './ollama';
import { GroqProvider } from './groq';
import { MistralProvider } from './mistral';
import { OpenRouterProvider } from './openrouter';

// =============================================================================
// Provider Registry
// =============================================================================

type ProviderConstructor = new (config: ProviderConfig) => IProvider;

const providerRegistry: Map<string, ProviderConstructor> = new Map();
providerRegistry.set('openai', OpenAIProvider);
providerRegistry.set('anthropic', AnthropicProvider);
providerRegistry.set('google', GoogleProvider);
providerRegistry.set('gemini', GoogleProvider); // Alias
providerRegistry.set('azure', AzureOpenAIProvider);
providerRegistry.set('azureopenai', AzureOpenAIProvider); // Alias
providerRegistry.set('ollama', OllamaProvider);
providerRegistry.set('groq', GroqProvider);
providerRegistry.set('mistral', MistralProvider);
providerRegistry.set('openrouter', OpenRouterProvider);

/**
 * Register a custom provider
 */
export function registerProvider(
  name: string,
  provider: ProviderConstructor
): void {
  providerRegistry.set(name.toLowerCase(), provider);
}

/**
 * Unregister a provider
 */
export function unregisterProvider(name: string): boolean {
  return providerRegistry.delete(name.toLowerCase());
}

/**
 * Get list of registered provider names
 */
export function getProviderNames(): string[] {
  return Array.from(providerRegistry.keys());
}

/**
 * Check if a provider is registered
 */
export function hasProvider(name: string): boolean {
  return providerRegistry.has(name.toLowerCase());
}

// =============================================================================
// Provider Factory
// =============================================================================

/**
 * Create a provider instance
 * 
 * @param endpoint - Provider name (e.g., 'openai', 'anthropic', 'google')
 * @param config - Provider configuration
 * @returns Provider instance
 * @throws ProviderError if provider is not found
 */
export function getProvider(
  endpoint: string,
  config: ProviderConfig
): IProvider {
  const normalizedEndpoint = endpoint.toLowerCase();
  
  // Try direct lookup
  const ProviderClass = providerRegistry.get(normalizedEndpoint);
  
  if (ProviderClass) {
    return new ProviderClass(config);
  }

  // Try to infer from base URL
  if (config.baseUrl) {
    const inferredProvider = inferProviderFromUrl(config.baseUrl);
    if (inferredProvider) {
      const InferredClass = providerRegistry.get(inferredProvider);
      if (InferredClass) {
        return new InferredClass(config);
      }
    }
  }

  throw new ProviderError(
    `Unknown provider: ${endpoint}. Available providers: ${getProviderNames().join(', ')}`,
    'INVALID_REQUEST',
    400,
    endpoint,
    false
  );
}

/**
 * Infer provider from base URL
 */
function inferProviderFromUrl(baseUrl: string): string | null {
  const url = baseUrl.toLowerCase();
  
  if (url.includes('openai.com') || url.includes('azure.com')) {
    return 'openai';
  }
  
  if (url.includes('anthropic.com')) {
    return 'anthropic';
  }
  
  if (url.includes('googleapis.com') || url.includes('generativelanguage')) {
    return 'google';
  }

  // Ollama typically runs on localhost:11434
  if (url.includes('localhost:11434') || url.includes('127.0.0.1:11434')) {
    return 'ollama';
  }

  return null;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create provider from model ID (e.g., 'gpt-4o', 'claude-3-5-sonnet')
 * Attempts to infer the provider from the model name
 */
export function getProviderForModel(
  modelId: string,
  configs: Record<string, ProviderConfig>
): IProvider | null {
  const normalizedModel = modelId.toLowerCase();

  // OpenAI models
  if (
    normalizedModel.startsWith('gpt-') ||
    normalizedModel.startsWith('o1') ||
    normalizedModel.includes('davinci') ||
    normalizedModel.includes('turbo')
  ) {
    const config = configs['openai'];
    if (config) {
      return new OpenAIProvider({ ...config, defaultModel: modelId });
    }
  }

  // Anthropic models
  if (normalizedModel.includes('claude')) {
    const config = configs['anthropic'];
    if (config) {
      return new AnthropicProvider({ ...config, defaultModel: modelId });
    }
  }

  // Google models
  if (normalizedModel.includes('gemini')) {
    const config = configs['google'];
    if (config) {
      return new GoogleProvider({ ...config, defaultModel: modelId });
    }
  }

  // Ollama models (local)
  if (
    normalizedModel.includes('llama') ||
    normalizedModel.includes('mistral') ||
    normalizedModel.includes('mixtral') ||
    normalizedModel.includes('codellama') ||
    normalizedModel.includes('deepseek') ||
    normalizedModel.includes('qwen') ||
    normalizedModel.includes('phi') ||
    normalizedModel.includes('gemma')
  ) {
    const config = configs['ollama'];
    if (config) {
      return new OllamaProvider({ ...config, defaultModel: modelId });
    }
  }

  return null;
}

/**
 * Get all available models across all providers
 */
export function getAllModels(
  configs: Record<string, ProviderConfig>
): Array<{ provider: string; models: import('./types').ModelConfig[] }> {
  const result: Array<{ provider: string; models: import('./types').ModelConfig[] }> = [];

  for (const [name, config] of Object.entries(configs)) {
    try {
      const provider = getProvider(name, config);
      result.push({
        provider: name,
        models: provider.models,
      });
    } catch {
      // Skip providers that can't be instantiated
    }
  }

  return result;
}

/**
 * Validate provider configuration
 */
export function validateConfig(
  endpoint: string,
  config: ProviderConfig
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.apiKey) {
    errors.push('API key is required');
  }

  if (config.timeout !== undefined && config.timeout <= 0) {
    errors.push('Timeout must be positive');
  }

  if (config.maxRetries !== undefined && config.maxRetries < 0) {
    errors.push('Max retries must be non-negative');
  }

  if (config.rateLimitRpm !== undefined && config.rateLimitRpm <= 0) {
    errors.push('Rate limit RPM must be positive');
  }

  if (config.rateLimitTpm !== undefined && config.rateLimitTpm <= 0) {
    errors.push('Rate limit TPM must be positive');
  }

  // Check if provider exists
  if (!hasProvider(endpoint) && !config.baseUrl) {
    errors.push(`Unknown provider: ${endpoint}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
