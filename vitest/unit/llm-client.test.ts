import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMClient } from '../../src/llm-client.js';
import type { Message, Tool, LLMResponse } from '../../src/types.js';

// Mock pi-ai module
vi.mock('@mariozechner/pi-ai', () => ({
  getModel: vi.fn(() => ({
    id: 'test-model',
    name: 'Test Model',
    provider: 'test',
    api: 'openai-completions',
    baseUrl: '',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
  })),
  stream: vi.fn(),
  complete: vi.fn(),
}));

describe('LLMClient', () => {
  let client: LLMClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new LLMClient({
      provider: 'test',
      model: 'test-model',
      apiKey: 'test-key',
      temperature: 0.7,
      maxTokens: 1000,
    });
  });

  describe('constructor and buildModel', () => {
    it('should create client with config and use getModel for known providers', async () => {
      const { getModel } = await import('@mariozechner/pi-ai');
      // getModel was called during LLMClient construction in beforeEach
      expect(vi.mocked(getModel)).toHaveBeenCalledWith('test', 'test-model');
      expect(client.getModel()).toBeDefined();
      expect(client.getModel().id).toBe('test-model');
    });

    it('should build custom model when api is specified', () => {
      const customClient = new LLMClient({
        provider: 'azure',
        model: 'gpt-4.1-mini',
        apiKey: 'key',
        api: 'azure-openai-responses',
        baseUrl: 'https://example.openai.azure.com/openai/v1',
        reasoning: false,
        input: ['text', 'image'],
        contextWindow: 200000,
      });

      const model = customClient.getModel();
      expect(model.id).toBe('gpt-4.1-mini');
      expect(model.api).toBe('azure-openai-responses');
      expect(model.baseUrl).toBe('https://example.openai.azure.com/openai/v1');
      expect(model.reasoning).toBe(false);
      expect(model.input).toEqual(['text', 'image']);
      expect(model.contextWindow).toBe(200000);
    });

    it('should fall back to openai-completions when getModel throws', async () => {
      const { getModel } = await import('@mariozechner/pi-ai');
      vi.mocked(getModel).mockImplementationOnce(() => { throw new Error('Unknown model'); });

      const fallbackClient = new LLMClient({
        provider: 'unknown-provider',
        model: 'unknown-model',
        apiKey: 'key',
      });

      const model = fallbackClient.getModel();
      expect(model.id).toBe('unknown-model');
      expect(model.api).toBe('openai-completions');
    });

    it('should pass providerOptions through buildOptions', async () => {
      const { complete } = await import('@mariozechner/pi-ai');
      vi.mocked(complete).mockResolvedValue({
        role: 'assistant',
        content: [{ type: 'text', text: 'OK' }],
        stopReason: 'stop',
        usage: { input: 10, output: 5, cost: { total: 0 } },
        timestamp: Date.now(),
      } as any);

      const clientWithOpts = new LLMClient({
        provider: 'azure',
        model: 'gpt-4.1',
        apiKey: 'key',
        api: 'azure-openai-responses',
        providerOptions: { azureApiVersion: 'v1', azureDeploymentName: 'gpt-4.1' },
      });

      await clientWithOpts.chatComplete([{ role: 'user', content: 'test' }]);

      // Verify providerOptions were passed to complete()
      const callArgs = vi.mocked(complete).mock.calls[0];
      const options = callArgs?.[2] as any;
      expect(options.azureApiVersion).toBe('v1');
      expect(options.azureDeploymentName).toBe('gpt-4.1');
      expect(options.apiKey).toBe('key');
    });
  });

  describe('message conversion (buildContext)', () => {
    it('should extract system prompt from first message', async () => {
      const { complete } = await import('@mariozechner/pi-ai');
      vi.mocked(complete).mockResolvedValue({
        role: 'assistant',
        content: [{ type: 'text', text: 'OK' }],
        stopReason: 'stop',
        usage: { input: 10, output: 5, cost: { total: 0 } },
        timestamp: Date.now(),
      } as any);

      const messages: Message[] = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
      ];

      await client.chatComplete(messages);

      const callArgs = vi.mocked(complete).mock.calls[0];
      const context = callArgs?.[1] as any;
      expect(context.systemPrompt).toBe('You are helpful');
      // System message should be removed from messages array
      expect(context.messages.every((m: any) => m.role !== 'system')).toBe(true);
    });

    it('should convert tool messages to toolResult format', async () => {
      const { complete } = await import('@mariozechner/pi-ai');
      vi.mocked(complete).mockResolvedValue({
        role: 'assistant',
        content: [{ type: 'text', text: 'OK' }],
        stopReason: 'stop',
        usage: { input: 10, output: 5, cost: { total: 0 } },
        timestamp: Date.now(),
      } as any);

      const messages: Message[] = [
        { role: 'user', content: 'Run ls' },
        {
          role: 'assistant',
          content: 'Let me run that.',
          tool_calls: [{ id: 'call_1', name: 'bash_exec', arguments: { command: 'ls' } }],
        } as any,
        {
          role: 'tool',
          name: 'bash_exec',
          tool_call_id: 'call_1',
          content: '{"stdout":"file.txt","stderr":"","exitCode":0}',
        },
      ];

      await client.chatComplete(messages);

      const callArgs = vi.mocked(complete).mock.calls[0];
      const context = callArgs?.[1] as any;
      const toolResultMsg = context.messages.find((m: any) => m.role === 'toolResult');
      expect(toolResultMsg).toBeDefined();
      expect(toolResultMsg.toolCallId).toBe('call_1');
      expect(toolResultMsg.toolName).toBe('bash_exec');
    });

    it('should convert assistant messages with tool_calls to content blocks', async () => {
      const { complete } = await import('@mariozechner/pi-ai');
      vi.mocked(complete).mockResolvedValue({
        role: 'assistant',
        content: [{ type: 'text', text: 'Done' }],
        stopReason: 'stop',
        usage: { input: 10, output: 5, cost: { total: 0 } },
        timestamp: Date.now(),
      } as any);

      const messages: Message[] = [
        { role: 'user', content: 'Run pwd' },
        {
          role: 'assistant',
          content: 'Running command.',
          tool_calls: [{ id: 'tc_1', name: 'bash_exec', arguments: { command: 'pwd' } }],
        } as any,
        { role: 'tool', name: 'bash_exec', tool_call_id: 'tc_1', content: '/home' },
      ];

      await client.chatComplete(messages);

      const callArgs = vi.mocked(complete).mock.calls[0];
      const context = callArgs?.[1] as any;
      const assistantMsg = context.messages.find((m: any) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      // Should have content as array of blocks, not a string
      expect(Array.isArray(assistantMsg.content)).toBe(true);
      // Should contain text block
      expect(assistantMsg.content.some((b: any) => b.type === 'text' && b.text === 'Running command.')).toBe(true);
      // Should contain toolCall block
      expect(assistantMsg.content.some((b: any) => b.type === 'toolCall' && b.name === 'bash_exec')).toBe(true);
    });

    it('should pass tools to pi-ai context', async () => {
      const { complete } = await import('@mariozechner/pi-ai');
      vi.mocked(complete).mockResolvedValue({
        role: 'assistant',
        content: [{ type: 'text', text: 'OK' }],
        stopReason: 'stop',
        usage: { input: 10, output: 5, cost: { total: 0 } },
        timestamp: Date.now(),
      } as any);

      const tools: Tool[] = [
        {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: { x: { type: 'string' } } },
          handler: async () => ({}),
        },
      ];

      await client.chatComplete([{ role: 'user', content: 'Test' }], tools);

      const callArgs = vi.mocked(complete).mock.calls[0];
      const context = callArgs?.[1] as any;
      expect(context.tools).toBeDefined();
      expect(context.tools).toHaveLength(1);
      expect(context.tools[0].name).toBe('test_tool');
      // handler should NOT be passed to pi-ai
      expect(context.tools[0].handler).toBeUndefined();
    });

    it('should handle multimodal user content', async () => {
      const { complete } = await import('@mariozechner/pi-ai');
      vi.mocked(complete).mockResolvedValue({
        role: 'assistant',
        content: [{ type: 'text', text: 'OK' }],
        stopReason: 'stop',
        usage: { input: 10, output: 5, cost: { total: 0 } },
        timestamp: Date.now(),
      } as any);

      const messages: Message[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            { type: 'image', data: 'base64data' },
          ],
        },
      ];

      await client.chatComplete(messages);

      const callArgs = vi.mocked(complete).mock.calls[0];
      const context = callArgs?.[1] as any;
      const userMsg = context.messages[0];
      // Array content should be passed through
      expect(Array.isArray(userMsg.content)).toBe(true);
    });
  });

  describe('chatComplete response parsing', () => {
    it('should extract text content from response', async () => {
      const { complete } = await import('@mariozechner/pi-ai');
      vi.mocked(complete).mockResolvedValue({
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello, world!' }],
        stopReason: 'stop',
        usage: { input: 10, output: 5, cost: { total: 0 } },
        timestamp: Date.now(),
      } as any);

      const response = await client.chatComplete([{ role: 'user', content: 'Hello' }]);

      expect(response.content).toBe('Hello, world!');
      expect(response.finishReason).toBe('stop');
      expect(response.toolCalls).toBeUndefined();
    });

    it('should extract tool calls from response', async () => {
      const { complete } = await import('@mariozechner/pi-ai');
      vi.mocked(complete).mockResolvedValue({
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'toolCall', id: 'call_123', name: 'bash_exec', arguments: { command: 'pwd' } },
        ],
        stopReason: 'toolUse',
        usage: { input: 10, output: 5, cost: { total: 0 } },
        timestamp: Date.now(),
      } as any);

      const response = await client.chatComplete([{ role: 'user', content: 'Where am I?' }]);

      expect(response.content).toBe('Let me check.');
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0]!.id).toBe('call_123');
      expect(response.toolCalls![0]!.name).toBe('bash_exec');
      expect(response.toolCalls![0]!.arguments).toEqual({ command: 'pwd' });
      expect(response.finishReason).toBe('toolUse');
    });

    it('should concatenate multiple text blocks', async () => {
      const { complete } = await import('@mariozechner/pi-ai');
      vi.mocked(complete).mockResolvedValue({
        role: 'assistant',
        content: [
          { type: 'text', text: 'Part 1. ' },
          { type: 'text', text: 'Part 2.' },
        ],
        stopReason: 'stop',
        usage: { input: 10, output: 5, cost: { total: 0 } },
        timestamp: Date.now(),
      } as any);

      const response = await client.chatComplete([{ role: 'user', content: 'test' }]);
      expect(response.content).toBe('Part 1. Part 2.');
    });
  });

  describe('chat (streaming)', () => {
    it('should yield streaming text deltas then final response', async () => {
      const { stream } = await import('@mariozechner/pi-ai');

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text_delta', delta: 'Hello' };
          yield { type: 'text_delta', delta: ' world' };
          yield { type: 'done', reason: 'stop' };
        },
      };
      vi.mocked(stream).mockReturnValue(mockStream as any);

      const responses: LLMResponse[] = [];
      for await (const response of client.chat([{ role: 'user', content: 'Hi' }])) {
        responses.push(response);
      }

      // Should have streaming deltas + final
      expect(responses.length).toBe(3);
      expect(responses[0]!.content).toBe('Hello');
      expect(responses[0]!.finishReason).toBe('streaming');
      expect(responses[1]!.content).toBe(' world');
      expect(responses[1]!.finishReason).toBe('streaming');
      // Final response has accumulated content
      expect(responses[2]!.content).toBe('Hello world');
      expect(responses[2]!.finishReason).toBe('stop');
    });

    it('should handle tool calls in streaming', async () => {
      const { stream } = await import('@mariozechner/pi-ai');

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'toolcall_end',
            toolCall: { id: 'call_123', name: 'bash_exec', arguments: { command: 'ls' } },
          };
          yield { type: 'done', reason: 'toolUse' };
        },
      };
      vi.mocked(stream).mockReturnValue(mockStream as any);

      const responses: LLMResponse[] = [];
      for await (const response of client.chat([{ role: 'user', content: 'List files' }])) {
        responses.push(response);
      }

      const finalResponse = responses[responses.length - 1];
      expect(finalResponse).toBeDefined();
      expect(finalResponse!.toolCalls).toHaveLength(1);
      expect(finalResponse!.toolCalls![0]!.name).toBe('bash_exec');
      expect(finalResponse!.finishReason).toBe('toolUse');
    });

    it('should throw on stream error event', async () => {
      const { stream } = await import('@mariozechner/pi-ai');

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'error', error: { errorMessage: 'Rate limited' } };
        },
      };
      vi.mocked(stream).mockReturnValue(mockStream as any);

      await expect(async () => {
        for await (const _ of client.chat([{ role: 'user', content: 'test' }])) {
          // consume
        }
      }).rejects.toThrow('Rate limited');
    });
  });
});
