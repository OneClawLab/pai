import { getModel, stream, complete, type Model } from '@mariozechner/pi-ai';
import type { LLMClientConfig, Message, Tool, ToolCall, LLMResponse } from './types.js';

/**
 * LLM Client wrapper for pi-ai library
 */
export class LLMClient {
  private config: LLMClientConfig;
  private model: Model<any>;

  constructor(config: LLMClientConfig) {
    this.config = config;
    // Get model from pi-ai library
    this.model = getModel(config.provider as any, config.model as any);
  }

  /**
   * Chat with streaming responses
   */
  async *chat(messages: Message[], tools?: Tool[]): AsyncGenerator<LLMResponse> {
    const context = this.buildContext(messages, tools);
    const options = this.buildOptions();

    const streamResult = stream(this.model, context, options);

    let currentContent = '';
    let currentToolCalls: ToolCall[] = [];

    for await (const event of streamResult) {
      switch (event.type) {
        case 'text_delta':
          currentContent += event.delta;
          yield {
            content: event.delta,
            finishReason: 'streaming',
          };
          break;

        case 'toolcall_end':
          currentToolCalls.push({
            id: event.toolCall.id,
            name: event.toolCall.name,
            arguments: event.toolCall.arguments,
          });
          break;

        case 'done':
          yield {
            content: currentContent,
            toolCalls: currentToolCalls.length > 0 ? currentToolCalls : undefined,
            finishReason: event.reason,
          };
          break;

        case 'error':
          throw new Error(event.error.errorMessage || 'LLM request failed');
      }
    }
  }

  /**
   * Chat without streaming (complete response)
   */
  async chatComplete(messages: Message[], tools?: Tool[]): Promise<LLMResponse> {
    const context = this.buildContext(messages, tools);
    const options = this.buildOptions();

    const result = await complete(this.model, context, options);

    // Extract text content
    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of result.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'toolCall') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.arguments,
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: result.stopReason,
    };
  }

  /**
   * Build context for pi-ai
   */
  private buildContext(messages: Message[], tools?: Tool[]) {
    // Convert messages to pi-ai format
    const piMessages = messages.map((msg) => {
      if (msg.role === 'system') {
        return { role: 'system' as const, content: String(msg.content) };
      } else if (msg.role === 'user') {
        return { role: 'user' as const, content: this.formatContent(msg.content) };
      } else if (msg.role === 'assistant') {
        return { role: 'assistant' as const, content: this.formatContent(msg.content) };
      } else if (msg.role === 'tool') {
        return {
          role: 'toolResult' as const,
          toolCallId: msg.tool_call_id || '',
          toolName: msg.name || '',
          content: [{ type: 'text' as const, text: String(msg.content) }],
          isError: false,
          timestamp: Date.now(),
        };
      }
      return { role: 'user' as const, content: String(msg.content) };
    });

    // Extract system prompt if first message is system
    let systemPrompt: string | undefined;
    let contextMessages = piMessages;

    if (piMessages.length > 0 && piMessages[0]?.role === 'system') {
      systemPrompt = String(piMessages[0].content);
      contextMessages = piMessages.slice(1);
    }

    const context: any = {
      messages: contextMessages,
    };

    if (systemPrompt) {
      context.systemPrompt = systemPrompt;
    }

    // Add tools if provided
    if (tools && tools.length > 0) {
      context.tools = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
    }

    return context;
  }

  /**
   * Format message content for pi-ai
   */
  private formatContent(content: any): any {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content;
    }
    if (typeof content === 'object') {
      return JSON.stringify(content);
    }
    return String(content);
  }

  /**
   * Build options for pi-ai
   */
  private buildOptions() {
    const options: any = {
      apiKey: this.config.apiKey,
    };

    if (this.config.temperature !== undefined) {
      options.temperature = this.config.temperature;
    }

    if (this.config.maxTokens !== undefined) {
      options.maxTokens = this.config.maxTokens;
    }

    return options;
  }

  /**
   * Get model information
   */
  getModel(): Model<any> {
    return this.model;
  }
}
