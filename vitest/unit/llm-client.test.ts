import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMClient } from '../../src/llm-client.js';
import type { Message, Tool } from '../../src/types.js';

// Mock pi-ai module
vi.mock('@mariozechner/pi-ai', () => ({
  getModel: vi.fn(() => ({
    id: 'test-model',
    name: 'Test Model',
    provider: 'test',
  })),
  stream: vi.fn(),
  complete: vi.fn(),
}));

describe('LLMClient', () => {
  let client: LLMClient;

  beforeEach(() => {
    client = new LLMClient({
      provider: 'test',
      model: 'test-model',
      apiKey: 'test-key',
      temperature: 0.7,
      maxTokens: 1000,
    });
  });

  describe('constructor', () => {
    it('should create client with config', () => {
      expect(client).toBeDefined();
      expect(client.getModel()).toBeDefined();
    });
  });

  describe('chatComplete', () => {
    it('should handle simple text response', async () => {
      const { complete } = await import('@mariozechner/pi-ai');
      vi.mocked(complete).mockResolvedValue({
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello, world!' }],
        stopReason: 'stop',
        usage: { input: 10, output: 5, cost: { total: 0 } },
        timestamp: Date.now(),
      } as any);

      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
      ];

      const response = await client.chatComplete(messages);

      expect(response.content).toBe('Hello, world!');
      expect(response.finishReason).toBe('stop');
      expect(response.toolCalls).toBeUndefined();
    });

    it('should handle tool calls in response', async () => {
      const { complete } = await import('@mariozechner/pi-ai');
      vi.mocked(complete).mockResolvedValue({
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check that.' },
          {
            type: 'toolCall',
            id: 'call_123',
            name: 'bash_exec',
            arguments: { command: 'pwd' },
          },
        ],
        stopReason: 'toolUse',
        usage: { input: 10, output: 5, cost: { total: 0 } },
        timestamp: Date.now(),
      } as any);

      const messages: Message[] = [
        { role: 'user', content: 'What directory am I in?' },
      ];

      const response = await client.chatComplete(messages);

      expect(response.content).toBe('Let me check that.');
      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls?.[0]?.name).toBe('bash_exec');
    });

    it('should pass tools to pi-ai', async () => {
      const { complete } = await import('@mariozechner/pi-ai');
      vi.mocked(complete).mockResolvedValue({
        role: 'assistant',
        content: [{ type: 'text', text: 'OK' }],
        stopReason: 'stop',
        usage: { input: 10, output: 5, cost: { total: 0 } },
        timestamp: Date.now(),
      } as any);

      const messages: Message[] = [{ role: 'user', content: 'Test' }];
      const tools: Tool[] = [
        {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
          handler: async () => ({}),
        },
      ];

      const response = await client.chatComplete(messages, tools);

      // Just verify the call succeeded
      expect(complete).toHaveBeenCalled();
      expect(response.content).toBe('OK');
    });
  });

  describe('chat (streaming)', () => {
    it('should yield streaming text deltas', async () => {
      const { stream } = await import('@mariozechner/pi-ai');
      
      // Mock async generator
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text_delta', delta: 'Hello' };
          yield { type: 'text_delta', delta: ' world' };
          yield { type: 'done', reason: 'stop' };
        },
      };

      vi.mocked(stream).mockReturnValue(mockStream as any);

      const messages: Message[] = [{ role: 'user', content: 'Hi' }];
      const responses: LLMResponse[] = [];

      for await (const response of client.chat(messages)) {
        responses.push(response);
      }

      expect(responses.length).toBeGreaterThan(0);
      expect(responses.some((r) => r.content === 'Hello')).toBe(true);
    });

    it('should handle tool calls in streaming', async () => {
      const { stream } = await import('@mariozechner/pi-ai');
      
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'toolcall_end',
            toolCall: {
              id: 'call_123',
              name: 'bash_exec',
              arguments: { command: 'ls' },
            },
          };
          yield { type: 'done', reason: 'toolUse' };
        },
      };

      vi.mocked(stream).mockReturnValue(mockStream as any);

      const messages: Message[] = [{ role: 'user', content: 'List files' }];
      let finalResponse: LLMResponse | null = null;

      for await (const response of client.chat(messages)) {
        if (response.finishReason !== 'streaming') {
          finalResponse = response;
        }
      }

      expect(finalResponse).toBeDefined();
      expect(finalResponse?.toolCalls).toBeDefined();
      expect(finalResponse?.toolCalls?.[0]?.name).toBe('bash_exec');
    });
  });

  describe('message conversion', () => {
    it('should convert system messages', async () => {
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

      const response = await client.chatComplete(messages);

      // Just verify the call succeeded with system message
      expect(complete).toHaveBeenCalled();
      expect(response.content).toBe('OK');
    });

    it('should handle multimodal content', async () => {
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

      expect(complete).toHaveBeenCalled();
    });
  });
});
