export { chat } from './lib/chat.js';
export { createBashExecTool } from './tools/bash-exec.js';
export { loadConfig, resolveProvider } from './lib/config.js';
export { initPai } from './lib/pai-instance.js';
export type { Pai, ChatOptions as PaiChatOptions, ProviderInfo } from './lib/pai-instance.js';
export type {
  ChatInput,
  ChatConfig,
  ChatEvent,
  Message,
  MessageContent,
  MessageRole,
  PAIConfig,
  ProviderConfig,
  Tool,
  Usage,
} from './lib/types.js';
