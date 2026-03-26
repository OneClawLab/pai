/**
 * Core type definitions for PAI - shared between CLI and LIB interfaces
 */

// ============================================================================
// Configuration Types
// ============================================================================

export interface ProviderConfig {
  name: string;
  apiKey?: string;
  models?: string[];
  defaultModel?: string;
  temperature?: number;
  maxTokens?: number;
  /** pi-ai API type, e.g. 'openai-responses', 'azure-openai-responses', 'anthropic-messages' */
  api?: string;
  /** Base URL for custom/self-hosted endpoints */
  baseUrl?: string;
  /** Whether the model supports reasoning/thinking */
  reasoning?: boolean;
  /** Input modalities: ['text'] or ['text', 'image'] */
  input?: string[];
  /** Context window size in tokens */
  contextWindow?: number;
  /** Provider-specific options (e.g. azureApiVersion, azureDeploymentName) */
  providerOptions?: Record<string, unknown>;
  /** OAuth credentials (for OAuth-based providers like github-copilot, anthropic, etc.) */
  oauth?: OAuthCredentialStore;
}

export interface OAuthCredentialStore {
  refresh: string;
  access: string;
  expires: number;
  /** Extra provider-specific fields (e.g. enterpriseUrl, projectId, accountId) */
  [key: string]: unknown;
}

export interface PAIConfig {
  schema_version: string;
  defaultProvider?: string;
  defaultEmbedProvider?: string;
  defaultEmbedModel?: string;
  providers: ProviderConfig[];
}

// ============================================================================
// Message Types (Session File)
// ============================================================================

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type MessageContent = string | object | unknown[];

export interface Message {
  role: MessageRole;
  content: MessageContent;
  name?: string; // For tool messages
  tool_call_id?: string; // For tool responses
  timestamp?: string; // ISO8601 timestamp
  id?: string; // Optional message ID
}

// ============================================================================
// Tool Types
// ============================================================================

export interface Tool {
  name: string;
  description: string;
  parameters: object; // JSON Schema
  handler: (args: unknown, signal?: AbortSignal) => Promise<unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

// ============================================================================
// LLM Client Types
// ============================================================================

export interface LLMClientConfig {
  provider: string;
  model: string;
  apiKey: string;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  stream?: boolean | undefined;
  /** pi-ai API type for custom models */
  api?: string | undefined;
  /** Base URL for custom/self-hosted endpoints */
  baseUrl?: string | undefined;
  /** Whether the model supports reasoning */
  reasoning?: boolean | undefined;
  /** Input modalities */
  input?: string[] | undefined;
  /** Context window size */
  contextWindow?: number | undefined;
  /** Provider-specific options passed through to pi-ai */
  providerOptions?: Record<string, unknown> | undefined;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: string;
  usage?: {
    input: number;
    output: number;
    cost?: { total: number };
  };
}

// ============================================================================
// CLI Option Types
// ============================================================================

export interface CLIOptions {
  config?: string;
  json?: boolean;
  quiet?: boolean;
}

export interface EmbedOptions extends CLIOptions {
  provider?: string;
  model?: string;
  inputFile?: string;
  batch?: boolean;
}

export interface ChatOptions extends CLIOptions {
  session?: string;
  system?: string;
  systemFile?: string;
  inputFile?: string;
  image?: string[];
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  log?: string;
  append?: boolean; // Commander.js: --no-append sets this to false
  dryRun?: boolean;
  maxTurns?: number; // Max tool-call turns
}

export interface ModelConfigOptions extends CLIOptions {
  add?: boolean;
  update?: boolean;
  delete?: boolean;
  show?: boolean;
  all?: boolean;
  name?: string;
  provider?: string;
  set?: string[];
  default?: boolean;
  embedProvider?: string;
  embedModel?: string;
}

// ============================================================================
// bash_exec Tool Types
// ============================================================================

export interface BashExecArgs {
  command: string;
  cwd?: string;
  /** Timeout in seconds for this invocation. Default: 600. Max: 3600. */
  timeout_seconds?: number;
}

export interface BashExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ============================================================================
// Output Formatter Types
// ============================================================================

export interface OutputEvent {
  type: 'start' | 'chunk' | 'tool_call' | 'tool_result' | 'complete' | 'error';
  data: unknown;
  timestamp?: number;
}

// ============================================================================
// Input Resolver Types
// ============================================================================

export interface InputSource {
  message?: string | undefined; // CLI argument
  stdin?: boolean | undefined;
  file?: string | undefined;
  images?: string[] | undefined;
}

// ============================================================================
// Error Types
// ============================================================================

export enum ExitCode {
  SUCCESS = 0,
  PARAMETER_ERROR = 1,
  RUNTIME_ERROR = 2,
  API_ERROR = 3,
  IO_ERROR = 4,
}

export class PAIError extends Error {
  constructor(
    message: string,
    public exitCode: ExitCode,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'PAIError';
  }
}

// ============================================================================
// LIB Interface Types (new)
// ============================================================================

export interface ChatInput {
  system?: string;
  userMessage: MessageContent;
  history?: Message[];
}

export interface ChatConfig {
  provider: string;
  model: string;
  apiKey: string;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  contextWindow?: number;
  providerOptions?: Record<string, unknown>;
}

export interface Usage {
  input: number;
  output: number;
  cost?: { total: number };
}

export type ChatEvent =
  | { type: 'start'; provider: string; model: string; messageCount: number; toolCount: number }
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_end'; thinking: string }
  | { type: 'tool_call'; callId: string; name: string; args: unknown }
  | { type: 'tool_result'; callId: string; name: string; result: unknown }
  | { type: 'complete'; finishReason: string; usage?: Usage }
  | { type: 'chat_end'; newMessages: Message[] };
