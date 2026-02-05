/**
 * Code Interpreter Service
 * Provides sandboxed code execution for AI agents.
 * 
 * Supports multiple execution backends:
 * - Cloudflare Workers (JavaScript/TypeScript) - Built-in
 * - E2B (Python, JavaScript, etc.) - External service
 * - Judge0 (40+ languages) - External service
 * 
 * Security features:
 * - Execution timeouts
 * - Memory limits
 * - Network isolation (configurable)
 * - Output size limits
 */

// =============================================================================
// Types
// =============================================================================

export type SupportedLanguage = 
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'python3'
  | 'bash'
  | 'shell'
  | 'html'
  | 'css'
  | 'json'
  | 'sql';

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
  executionTime: number;
  memoryUsed?: number;
  outputFiles?: Array<{
    name: string;
    content: string;
    mimeType: string;
  }>;
}

export interface ExecutionOptions {
  language: SupportedLanguage;
  code: string;
  timeout?: number; // milliseconds
  memoryLimit?: number; // bytes
  stdin?: string;
  env?: Record<string, string>;
  files?: Array<{
    name: string;
    content: string;
  }>;
}

export type ExecutionBackend = 'workers' | 'e2b' | 'judge0';

export interface CodeInterpreterConfig {
  backend: ExecutionBackend;
  // E2B configuration
  e2bApiKey?: string;
  // Judge0 configuration
  judge0Url?: string;
  judge0ApiKey?: string;
  // General settings
  defaultTimeout?: number;
  maxOutputSize?: number;
}

// =============================================================================
// Language Configurations
// =============================================================================

const LANGUAGE_CONFIGS: Record<SupportedLanguage, {
  name: string;
  extension: string;
  judge0Id?: number;
  e2bTemplate?: string;
}> = {
  javascript: { name: 'JavaScript', extension: 'js', judge0Id: 63, e2bTemplate: 'nodejs' },
  typescript: { name: 'TypeScript', extension: 'ts', judge0Id: 74, e2bTemplate: 'nodejs' },
  python: { name: 'Python', extension: 'py', judge0Id: 71, e2bTemplate: 'python' },
  python3: { name: 'Python 3', extension: 'py', judge0Id: 71, e2bTemplate: 'python' },
  bash: { name: 'Bash', extension: 'sh', judge0Id: 46 },
  shell: { name: 'Shell', extension: 'sh', judge0Id: 46 },
  html: { name: 'HTML', extension: 'html' },
  css: { name: 'CSS', extension: 'css' },
  json: { name: 'JSON', extension: 'json' },
  sql: { name: 'SQL', extension: 'sql', judge0Id: 82 },
};

// =============================================================================
// Workers Backend (JavaScript/TypeScript only)
// =============================================================================

async function executeInWorkers(options: ExecutionOptions): Promise<ExecutionResult> {
  const { code, timeout = 5000, language } = options;
  const startTime = Date.now();

  if (language !== 'javascript' && language !== 'typescript') {
    return {
      success: false,
      output: '',
      error: `Workers backend only supports JavaScript/TypeScript. Got: ${language}`,
      executionTime: Date.now() - startTime,
    };
  }

  try {
    // Create a sandboxed execution environment
    const logs: string[] = [];
    const errors: string[] = [];

    // Create mock console
    const mockConsole = {
      log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
      error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
      warn: (...args: unknown[]) => logs.push(`[WARN] ${args.map(String).join(' ')}`),
      info: (...args: unknown[]) => logs.push(`[INFO] ${args.map(String).join(' ')}`),
    };

    // Create a Function with limited scope
    const wrappedCode = `
      "use strict";
      const console = arguments[0];
      const setTimeout = undefined;
      const setInterval = undefined;
      const fetch = undefined;
      const eval = undefined;
      const Function = undefined;
      
      ${code}
    `;

    // Execute with timeout
    const executePromise = new Promise<void>((resolve, reject) => {
      try {
        const fn = new Function(wrappedCode);
        const result = fn(mockConsole);
        
        // Handle async code
        if (result instanceof Promise) {
          result.then(() => resolve()).catch(reject);
        } else {
          resolve();
        }
      } catch (error) {
        reject(error);
      }
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Execution timed out')), timeout);
    });

    await Promise.race([executePromise, timeoutPromise]);

    const output = logs.join('\n');
    const errorOutput = errors.join('\n');

    return {
      success: errors.length === 0,
      output: output || '(no output)',
      error: errorOutput || undefined,
      exitCode: errors.length === 0 ? 0 : 1,
      executionTime: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error),
      exitCode: 1,
      executionTime: Date.now() - startTime,
    };
  }
}

// =============================================================================
// E2B Backend (Python, JavaScript, etc.)
// =============================================================================

interface E2BExecutionResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

async function executeWithE2B(
  options: ExecutionOptions,
  apiKey: string
): Promise<ExecutionResult> {
  const { code, language, timeout = 30000, files } = options;
  const startTime = Date.now();

  const langConfig = LANGUAGE_CONFIGS[language];
  if (!langConfig.e2bTemplate) {
    return {
      success: false,
      output: '',
      error: `E2B does not support language: ${language}`,
      executionTime: Date.now() - startTime,
    };
  }

  try {
    // Create sandbox session
    const createResponse = await fetch('https://api.e2b.dev/sandboxes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        template: langConfig.e2bTemplate,
        timeout: Math.ceil(timeout / 1000),
      }),
    });

    if (!createResponse.ok) {
      throw new Error(`Failed to create E2B sandbox: ${await createResponse.text()}`);
    }

    const { sandboxId } = await createResponse.json() as { sandboxId: string };

    try {
      // Write files if provided
      if (files && files.length > 0) {
        for (const file of files) {
          await fetch(`https://api.e2b.dev/sandboxes/${sandboxId}/files`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': apiKey,
            },
            body: JSON.stringify({
              path: file.name,
              content: file.content,
            }),
          });
        }
      }

      // Execute code
      const execResponse = await fetch(`https://api.e2b.dev/sandboxes/${sandboxId}/code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          code,
          language: language === 'python3' ? 'python' : language,
        }),
      });

      if (!execResponse.ok) {
        throw new Error(`E2B execution failed: ${await execResponse.text()}`);
      }

      const result = await execResponse.json() as E2BExecutionResponse;

      return {
        success: result.exitCode === 0,
        output: result.stdout || '(no output)',
        error: result.stderr || result.error,
        exitCode: result.exitCode,
        executionTime: Date.now() - startTime,
      };
    } finally {
      // Clean up sandbox
      await fetch(`https://api.e2b.dev/sandboxes/${sandboxId}`, {
        method: 'DELETE',
        headers: { 'X-API-Key': apiKey },
      }).catch(() => {}); // Ignore cleanup errors
    }
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error),
      executionTime: Date.now() - startTime,
    };
  }
}

// =============================================================================
// Judge0 Backend (40+ languages)
// =============================================================================

interface Judge0Submission {
  source_code: string;
  language_id: number;
  stdin?: string;
  expected_output?: string;
  cpu_time_limit?: number;
  memory_limit?: number;
}

interface Judge0Result {
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
  exit_code: number | null;
  status: {
    id: number;
    description: string;
  };
  time: string;
  memory: number;
}

async function executeWithJudge0(
  options: ExecutionOptions,
  baseUrl: string,
  apiKey?: string
): Promise<ExecutionResult> {
  const { code, language, timeout = 10000, stdin, memoryLimit } = options;
  const startTime = Date.now();

  const langConfig = LANGUAGE_CONFIGS[language];
  if (!langConfig.judge0Id) {
    return {
      success: false,
      output: '',
      error: `Judge0 does not support language: ${language}`,
      executionTime: Date.now() - startTime,
    };
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['X-Auth-Token'] = apiKey;
    }

    // Create submission
    const submission: Judge0Submission = {
      source_code: btoa(code), // Base64 encode
      language_id: langConfig.judge0Id,
      stdin: stdin ? btoa(stdin) : undefined,
      cpu_time_limit: timeout / 1000,
      memory_limit: memoryLimit ? memoryLimit / 1024 : undefined, // Convert to KB
    };

    const createResponse = await fetch(`${baseUrl}/submissions?base64_encoded=true&wait=true`, {
      method: 'POST',
      headers,
      body: JSON.stringify(submission),
    });

    if (!createResponse.ok) {
      throw new Error(`Judge0 submission failed: ${await createResponse.text()}`);
    }

    const result = await createResponse.json() as Judge0Result;

    // Decode base64 outputs
    const stdout = result.stdout ? atob(result.stdout) : '';
    const stderr = result.stderr ? atob(result.stderr) : '';
    const compileOutput = result.compile_output ? atob(result.compile_output) : '';

    // Status codes: 3 = Accepted, 4 = Wrong Answer, 5 = Time Limit, 6 = Compilation Error, etc.
    const success = result.status.id === 3;

    let errorMessage: string | undefined;
    if (!success) {
      errorMessage = [
        result.status.description,
        stderr,
        compileOutput,
        result.message,
      ].filter(Boolean).join('\n');
    }

    return {
      success,
      output: stdout || '(no output)',
      error: errorMessage,
      exitCode: result.exit_code ?? (success ? 0 : 1),
      executionTime: parseFloat(result.time) * 1000 || (Date.now() - startTime),
      memoryUsed: result.memory * 1024, // Convert from KB to bytes
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error),
      executionTime: Date.now() - startTime,
    };
  }
}

// =============================================================================
// Code Interpreter Service Class
// =============================================================================

export class CodeInterpreterService {
  private config: CodeInterpreterConfig;

  constructor(config: CodeInterpreterConfig) {
    this.config = {
      defaultTimeout: 10000,
      maxOutputSize: 100000, // 100KB
      ...config,
    };
  }

  /**
   * Get supported languages for the configured backend
   */
  getSupportedLanguages(): SupportedLanguage[] {
    switch (this.config.backend) {
      case 'workers':
        return ['javascript', 'typescript'];
      case 'e2b':
        return ['javascript', 'typescript', 'python', 'python3'];
      case 'judge0':
        return Object.entries(LANGUAGE_CONFIGS)
          .filter(([_, config]) => config.judge0Id !== undefined)
          .map(([lang]) => lang as SupportedLanguage);
      default:
        return [];
    }
  }

  /**
   * Check if a language is supported
   */
  isLanguageSupported(language: SupportedLanguage): boolean {
    return this.getSupportedLanguages().includes(language);
  }

  /**
   * Execute code in the configured sandbox
   */
  async execute(options: ExecutionOptions): Promise<ExecutionResult> {
    const { language, code } = options;
    
    // Validate language
    if (!this.isLanguageSupported(language)) {
      return {
        success: false,
        output: '',
        error: `Language '${language}' is not supported by ${this.config.backend} backend. Supported: ${this.getSupportedLanguages().join(', ')}`,
        executionTime: 0,
      };
    }

    // Validate code is not empty
    if (!code.trim()) {
      return {
        success: false,
        output: '',
        error: 'Code cannot be empty',
        executionTime: 0,
      };
    }

    const timeout = options.timeout || this.config.defaultTimeout;

    // Execute based on backend
    let result: ExecutionResult;
    
    switch (this.config.backend) {
      case 'workers':
        result = await executeInWorkers({ ...options, timeout });
        break;
      
      case 'e2b':
        if (!this.config.e2bApiKey) {
          return {
            success: false,
            output: '',
            error: 'E2B API key is not configured',
            executionTime: 0,
          };
        }
        result = await executeWithE2B({ ...options, timeout }, this.config.e2bApiKey);
        break;
      
      case 'judge0':
        if (!this.config.judge0Url) {
          return {
            success: false,
            output: '',
            error: 'Judge0 URL is not configured',
            executionTime: 0,
          };
        }
        result = await executeWithJudge0(
          { ...options, timeout },
          this.config.judge0Url,
          this.config.judge0ApiKey
        );
        break;
      
      default:
        return {
          success: false,
          output: '',
          error: `Unknown backend: ${this.config.backend}`,
          executionTime: 0,
        };
    }

    // Truncate output if too large
    const maxSize = this.config.maxOutputSize || 100000;
    if (result.output.length > maxSize) {
      result.output = result.output.slice(0, maxSize) + `\n... (output truncated, ${result.output.length} total chars)`;
    }
    if (result.error && result.error.length > maxSize) {
      result.error = result.error.slice(0, maxSize) + `\n... (error truncated)`;
    }

    return result;
  }

  /**
   * Execute JavaScript code (convenience method)
   */
  async executeJS(code: string, options?: Partial<ExecutionOptions>): Promise<ExecutionResult> {
    return this.execute({ language: 'javascript', code, ...options });
  }

  /**
   * Execute Python code (convenience method)
   */
  async executePython(code: string, options?: Partial<ExecutionOptions>): Promise<ExecutionResult> {
    return this.execute({ language: 'python3', code, ...options });
  }

  /**
   * Validate code syntax without executing
   */
  async validateSyntax(language: SupportedLanguage, code: string): Promise<{ valid: boolean; error?: string }> {
    if (language === 'javascript' || language === 'typescript') {
      try {
        // Use Function constructor to check syntax
        new Function(code);
        return { valid: true };
      } catch (error) {
        return {
          valid: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    if (language === 'json') {
      try {
        JSON.parse(code);
        return { valid: true };
      } catch (error) {
        return {
          valid: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    // For other languages, we can't validate without executing
    return { valid: true };
  }

  /**
   * Format execution result as text for AI context
   */
  formatResultAsContext(result: ExecutionResult): string {
    const lines: string[] = [];
    
    lines.push(`Execution ${result.success ? 'succeeded' : 'failed'}`);
    lines.push(`Time: ${result.executionTime}ms`);
    
    if (result.memoryUsed) {
      lines.push(`Memory: ${Math.round(result.memoryUsed / 1024)}KB`);
    }
    
    if (result.output) {
      lines.push('');
      lines.push('Output:');
      lines.push('```');
      lines.push(result.output);
      lines.push('```');
    }
    
    if (result.error) {
      lines.push('');
      lines.push('Error:');
      lines.push('```');
      lines.push(result.error);
      lines.push('```');
    }

    return lines.join('\n');
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a code interpreter service instance
 */
export function createCodeInterpreter(config: CodeInterpreterConfig): CodeInterpreterService {
  return new CodeInterpreterService(config);
}

/**
 * Create code interpreter from environment variables
 */
export function createCodeInterpreterFromEnv(env: {
  CODE_INTERPRETER_BACKEND?: string;
  E2B_API_KEY?: string;
  JUDGE0_URL?: string;
  JUDGE0_API_KEY?: string;
}): CodeInterpreterService {
  const backend = (env.CODE_INTERPRETER_BACKEND || 'workers') as ExecutionBackend;
  
  return new CodeInterpreterService({
    backend,
    e2bApiKey: env.E2B_API_KEY,
    judge0Url: env.JUDGE0_URL,
    judge0ApiKey: env.JUDGE0_API_KEY,
  });
}

/**
 * Get language info
 */
export function getLanguageInfo(language: SupportedLanguage) {
  return LANGUAGE_CONFIGS[language];
}

/**
 * Detect language from code or filename
 */
export function detectLanguage(codeOrFilename: string): SupportedLanguage | null {
  const ext = codeOrFilename.includes('.') 
    ? codeOrFilename.split('.').pop()?.toLowerCase()
    : null;

  if (ext) {
    const match = Object.entries(LANGUAGE_CONFIGS).find(([_, config]) => config.extension === ext);
    if (match) return match[0] as SupportedLanguage;
  }

  // Try to detect from code content
  const code = codeOrFilename;
  
  if (code.includes('def ') || code.includes('import ') || code.includes('print(')) {
    return 'python3';
  }
  
  if (code.includes('function ') || code.includes('const ') || code.includes('let ') || code.includes('=>')) {
    return 'javascript';
  }
  
  if (code.includes('interface ') || code.includes(': string') || code.includes(': number')) {
    return 'typescript';
  }
  
  if (code.startsWith('#!/bin/bash') || code.startsWith('#!/bin/sh')) {
    return 'bash';
  }
  
  if (code.startsWith('{') || code.startsWith('[')) {
    try {
      JSON.parse(code);
      return 'json';
    } catch {}
  }

  return null;
}
