import { getModel, stream, complete, type Model, type Api } from '@mariozechner/pi-ai';
import type { LLMClientConfig, Message, Tool, ToolCall, LLMResponse } from './types.js';

/**
 * Build a pi-ai Model object from PAI provider config + runtime overrides.
 * If the provider is a known pi-ai provider with pre-registered models, use getModel().
 * Otherwise, construct a custom Model object for custom/Azure/self-hosted endpoints.
 */
function buildModel(config: LLMClientConfig): Model<any> {
  // If provider config specifies an api type, build a custom model
  if (config.api) {
    return {
      id: config.model,
      name: config.model,
      api: config.api as Api,
      provider: config.provider,
      baseUrl: config.baseUrl || '',
      reasoning: config.reasoning ?? false,
      input: (config.input as any) ?? ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: config.contextWindow ?? 128000,
      maxTokens: config.maxTokens ?? 16384,
    } as Model<any>;
  }

  // Fall back to pi-ai's built-in model registry
  try {
    return getModel(config.provider as any, config.model as any);
  } catch {
    // If getModel fails, try building a custom model with openai-completions as default
    return {
      id: config.model,
      name: config.model,
      api: 'openai-completions' as Api,
      provider: config.provider,
      baseUrl: config.baseUrl || '',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 16384,
    } as Model<any>;
  }
}

/**
 * LLM Client wrapper for pi-ai library
 */
export class LLMClient {
  private config: LLMClientConfig;
  private model: Model<any>;

  constructor(config: LLMClientConfig) {
    this.config = config;
    this.model = buildModel(config);
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

        case 'done': {
          const usageData = (event as any).usage;
          const doneResponse: LLMResponse = {
            content: currentContent,
            finishReason: event.reason,
            ...(usageData ? {
              usage: {
                input: usageData.input ?? 0,
                output: usageData.output ?? 0,
                ...(usageData.cost ? { cost: { total: usageData.cost.total ?? 0 } } : {}),
              },
            } : {}),
          };
          if (currentToolCalls.length > 0) {
            doneResponse.toolCalls = currentToolCalls;
          }
          yield doneResponse;
          break;
        }

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

    const response: LLMResponse = {
      content,
      finishReason: result.stopReason,
      ...(result.usage ? {
        usage: {
          input: result.usage.input ?? 0,
          output: result.usage.output ?? 0,
          ...(result.usage.cost ? { cost: { total: result.usage.cost.total ?? 0 } } : {}),
        },
      } : {}),
    };
    if (toolCalls.length > 0) {
      response.toolCalls = toolCalls;
    }

    return response;
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
        return { role: 'user' as const, content: this.formatContent(msg.content), timestamp: Date.now() };
      } else if (msg.role === 'assistant') {
        return this.buildAssistantMessage(msg);
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
      return { role: 'user' as const, content: String(msg.content), timestamp: Date.now() };
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
   * Build a pi-ai AssistantMessage from a PAI Message.
   * pi-ai expects assistant messages with content as an array of typed blocks.
   */
  private buildAssistantMessage(msg: Message) {
    const contentBlocks: any[] = [];
    const textContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    if (textContent) {
      contentBlocks.push({ type: 'text', text: textContent });
    }
    const toolCalls = (msg as any).tool_calls;
    if (toolCalls && Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        contentBlocks.push({
          type: 'toolCall',
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        });
      }
    }
    return {
      role: 'assistant' as const,
      content: contentBlocks,
      api: this.model.api,
      provider: this.model.provider,
      model: this.model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: (toolCalls ? 'toolUse' : 'stop') as 'toolUse' | 'stop',
      timestamp: Date.now(),
    };
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
   * Build options for pi-ai, including provider-specific options
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

    // Merge provider-specific options (e.g. azureApiVersion, azureBaseUrl, azureDeploymentName)
    if (this.config.providerOptions) {
      Object.assign(options, this.config.providerOptions);
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
