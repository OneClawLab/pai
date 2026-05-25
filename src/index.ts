export { createBashExecTool, BASH_EXEC_TOOL_DESC } from './tools/bash-exec.js';
export type { BashExecOutputCallback, BashExecToolOptions } from './tools/bash-exec.js';
export { initPai } from './lib/pai-instance.js';
export { defineTool } from './lib/types.js';
export { ImageClient } from './image-client.js';
export type { ImageClientConfig, ImageGenerationRequest, ImageEditRequest, ImageGenerationResponse, GeneratedImage } from './image-client.js';
export type { Pai, ChatOptions as PaiChatOptions, ProviderInfo } from './lib/pai-instance.js';
export type {
  ChatInput,
  ChatEvent,
  ChatHooks,
  Message,
  MessageContent,
  Tool,
  Usage,
} from './lib/types.js';
