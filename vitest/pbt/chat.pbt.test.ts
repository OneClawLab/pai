import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { Writable } from 'node:stream';

// ============================================================================
// Mock LLMClient — must use class syntax so `new LLMClient(...)` works
// ============================================================================

type MockInstance = {
  chat: ReturnType<typeof vi.fn>;
  chatComplete: ReturnType<typeof vi.fn>;
};

// Shared state so tests can swap the mock behaviour
let _mockInstance: MockInstance = makeMockInstance();

function makeMockInstance(opts?: {
  streaming?: boolean;
  withToolCall?: boolean;
}): MockInstance {
  if (opts?.streaming) {
    return {
      chat: vi.fn(async function* () {
        yield { content: 'Hello ', finishReason: 'streaming' };
        yield { content: 'world', finishReason: 'streaming' };
        yield { content: '', finishReason: 'stop', usage: { input: 10, output: 5 } };
      }),
      chatComplete: vi.fn(),
    };
  }
  if (opts?.withToolCall) {
    let callCount = 0;
    const chatCompleteMock = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: '',
          finishReason: 'tool_calls',
          usage: { input: 10, output: 5 },
          toolCalls: [{ id: 'call-1', name: 'test_tool', arguments: { arg: 'value' } }],
        };
      }
      return { content: 'Done', finishReason: 'stop', usage: { input: 10, output: 5 } };
    });
    return {
      chat: vi.fn(async function* () {
        yield { content: 'Hello world', finishReason: 'stop', usage: { input: 10, output: 5 } };
      }),
      chatComplete: chatCompleteMock,
    };
  }
  return {
    chat: vi.fn(async function* () {
      yield { content: 'Hello world', finishReason: 'stop', usage: { input: 10, output: 5 } };
    }),
    chatComplete: vi.fn(async () => ({
      content: 'Hello world',
      finishReason: 'stop',
      usage: { input: 10, output: 5 },
    })),
  };
}

vi.mock('../../src/lib/llm-client.js', () => {
  class LLMClient {
    chat(...args: unknown[]) { return _mockInstance.chat(...args); }
    chatComplete(...args: unknown[]) { return _mockInstance.chatComplete(...args); }
  }
  return { LLMClient };
});

import { chat } from '../../src/lib/chat.js';
import type { ChatInput, ChatConfig, ChatEvent, Tool } from '../../src/lib/types.js';
import { PAIError } from '../../src/lib/types.js';

// ============================================================================
// Arbitraries
// ============================================================================

const messageContentArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 100 }),
  fc.record({
    type: fc.constant('text'),
    text: fc.string({ minLength: 1, maxLength: 100 }),
  }),
);

const messageArb = fc.record({
  role: fc.constantFrom('user' as const, 'assistant' as const),
  content: messageContentArb,
  timestamp: fc.option(fc.string({ minLength: 10, maxLength: 30 })),
});

const chatInputArb = fc.record({
  system: fc.option(fc.string({ minLength: 1, maxLength: 100 })),
  userMessage: messageContentArb,
  history: fc.option(fc.array(messageArb, { maxLength: 5 })),
});

const chatConfigArb = fc.record({
  provider: fc.constantFrom('openai', 'anthropic', 'gemini'),
  model: fc.constantFrom('gpt-4', 'claude-3-opus', 'gemini-pro'),
  apiKey: fc.string({ minLength: 10, maxLength: 50 }),
  stream: fc.option(fc.boolean()),
  temperature: fc.option(fc.float({ min: 0, max: 2 })),
  maxTokens: fc.option(fc.integer({ min: 100, max: 4000 })),
});

// ============================================================================
// Property Tests
// ============================================================================

describe('chat() - Property-Based Tests', () => {
  beforeEach(() => {
    _mockInstance = makeMockInstance();
  });

  // ========================================================================
  // Property 1: LIB 入口无副作用
  // ========================================================================

  it('Property 1: importing src/index.ts should not write to stdout/stderr', async () => {
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    let stdoutCalls = 0;
    let stderrCalls = 0;

    process.stdout.write = (() => { stdoutCalls++; return true; }) as typeof process.stdout.write;
    process.stderr.write = (() => { stderrCalls++; return true; }) as typeof process.stderr.write;

    try {
      await import('../../src/index.js');
      expect(stdoutCalls).toBe(0);
      expect(stderrCalls).toBe(0);
    } finally {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    }
  });

  // ========================================================================
  // Property 2: chat() 事件序列不变量
  // ========================================================================

  it('Property 2: events start with start and end with chat_end', async () => {
    await fc.assert(
      fc.asyncProperty(chatInputArb, chatConfigArb, async (input, config) => {
        _mockInstance = makeMockInstance();
        const signal = new AbortController().signal;
        const events: ChatEvent[] = [];

        for await (const event of chat(input, config, null, [], signal)) {
          events.push(event);
        }

        expect(events.length).toBeGreaterThan(0);
        expect(events[0]?.type).toBe('start');
        expect(events[events.length - 1]?.type).toBe('chat_end');

        const chatEndEvent = events[events.length - 1];
        if (chatEndEvent?.type === 'chat_end') {
          expect(Array.isArray(chatEndEvent.newMessages)).toBe(true);
          expect(chatEndEvent.newMessages.length).toBeGreaterThan(0);
          expect(chatEndEvent.newMessages.some(m => m.role === 'assistant')).toBe(true);
        }
      }),
      { numRuns: 10 },
    );
  });

  // ========================================================================
  // Property 3: streaming chunk 写入 Writable
  // ========================================================================

  it('Property 3: chunks are written to Writable when streaming', async () => {
    await fc.assert(
      fc.asyncProperty(chatInputArb, async (input) => {
        _mockInstance = makeMockInstance({ streaming: true });

        const config: ChatConfig = {
          provider: 'openai',
          model: 'gpt-4',
          apiKey: 'sk-test-key',
          stream: true,
        };

        const signal = new AbortController().signal;
        const chunks: string[] = [];

        const mockWritable = new Writable({
          write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
            chunks.push(chunk.toString());
            callback();
          },
        });

        for await (const _event of chat(input, config, mockWritable, [], signal)) {
          // consume
        }

        expect(chunks.join('')).toBe('Hello world');
      }),
      { numRuns: 5 },
    );
  });

  // ========================================================================
  // Property 4: tool 事件配对
  // ========================================================================

  it('Property 4: tool events have correct structure and are paired', async () => {
    await fc.assert(
      fc.asyncProperty(chatInputArb, async (input) => {
        _mockInstance = makeMockInstance({ withToolCall: true });

        const config: ChatConfig = { provider: 'openai', model: 'gpt-4', apiKey: 'sk-test' };
        const signal = new AbortController().signal;
        const testTool: Tool = {
          name: 'test_tool',
          description: 'Test tool',
          parameters: {},
          handler: async () => ({ success: true }),
        };

        const toolCallEvents: ChatEvent[] = [];
        const toolResultEvents: ChatEvent[] = [];

        for await (const event of chat(input, config, null, [testTool], signal)) {
          if (event.type === 'tool_call') toolCallEvents.push(event);
          if (event.type === 'tool_result') toolResultEvents.push(event);
        }

        expect(toolCallEvents.length).toBe(toolResultEvents.length);
        for (const e of toolCallEvents) {
          if (e.type === 'tool_call') {
            expect(e.callId).toBeDefined();
            expect(e.name).toBeDefined();
            expect(e.args).toBeDefined();
          }
        }
        for (const e of toolResultEvents) {
          if (e.type === 'tool_result') {
            expect(e.callId).toBeDefined();
            expect(e.name).toBeDefined();
            expect(e.result).toBeDefined();
          }
        }
      }),
      { numRuns: 5 },
    );
  });

  // ========================================================================
  // Property 5: AbortSignal 立即中止
  // ========================================================================

  it('Property 5: chat() respects AbortSignal when already aborted', async () => {
    await fc.assert(
      fc.asyncProperty(chatInputArb, async (input) => {
        _mockInstance = makeMockInstance();
        const config: ChatConfig = { provider: 'openai', model: 'gpt-4', apiKey: 'sk-test' };
        const controller = new AbortController();
        controller.abort();

        let errorThrown: Error | undefined;
        try {
          for await (const _event of chat(input, config, null, [], controller.signal)) {
            // should not reach here
          }
        } catch (err) {
          errorThrown = err as Error;
        }

        expect(errorThrown).toBeInstanceOf(PAIError);
        if (errorThrown instanceof PAIError) {
          expect(errorThrown.message).toContain('aborted');
        }
      }),
      { numRuns: 5 },
    );
  });

  // ========================================================================
  // Property 6: start event 包含正确的 provider/model/messageCount
  // ========================================================================

  it('Property 6: start event contains correct provider, model, messageCount', async () => {
    await fc.assert(
      fc.asyncProperty(chatInputArb, chatConfigArb, async (input, config) => {
        _mockInstance = makeMockInstance();
        const signal = new AbortController().signal;

        let startEvent: ChatEvent | undefined;
        for await (const event of chat(input, config, null, [], signal)) {
          if (!startEvent && event.type === 'start') startEvent = event;
        }

        expect(startEvent).toBeDefined();
        if (startEvent?.type === 'start') {
          expect(startEvent.provider).toBe(config.provider);
          expect(startEvent.model).toBe(config.model);
          expect(startEvent.messageCount).toBeGreaterThan(0);
          expect(startEvent.toolCount).toBe(0);
        }
      }),
      { numRuns: 10 },
    );
  });

  // ========================================================================
  // Property 7: null chunkWriter does not crash
  // ========================================================================

  it('Property 7: chat() with null chunkWriter does not crash', async () => {
    await fc.assert(
      fc.asyncProperty(chatInputArb, chatConfigArb, async (input, config) => {
        _mockInstance = makeMockInstance();
        const signal = new AbortController().signal;
        const events: ChatEvent[] = [];

        for await (const event of chat(input, config, null, [], signal)) {
          events.push(event);
          expect(event).toBeDefined();
          expect(event.type).toBeDefined();
        }

        expect(events.length).toBeGreaterThan(0);
      }),
      { numRuns: 5 },
    );
  });
});
