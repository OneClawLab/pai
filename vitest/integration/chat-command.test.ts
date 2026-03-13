import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleChatCommand } from '../../src/commands/chat.js';
import { handleModelList, handleModelConfig } from '../../src/commands/model.js';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
  complete: vi.fn(() =>
    Promise.resolve({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello from LLM' }],
      stopReason: 'stop',
      usage: { input: 10, output: 5, cost: { total: 0 } },
      timestamp: Date.now(),
    })
  ),
  getProviders: vi.fn(() => ['openai', 'anthropic', 'google']),
  getModels: vi.fn(() => [{ id: 'model-1' }, { id: 'model-2' }]),
}));

describe('Integration Tests', () => {
  let tempDir: string;
  let configPath: string;
  let stdoutSpy: any;
  let stderrSpy: any;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pai-e2e-test-'));
    configPath = join(tempDir, 'config.json');
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  describe('Chat Command - Basic Flow', () => {
    it('should complete a basic chat interaction', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      await handleChatCommand('Hello', { config: configPath });

      expect(stdoutSpy).toHaveBeenCalledWith('Hello from LLM');
    });

    it('should read input from file', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const inputFile = join(tempDir, 'input.txt');
      await writeFile(inputFile, 'Message from file', 'utf-8');

      await handleChatCommand(undefined, {
        config: configPath,
        inputFile,
      });

      expect(stdoutSpy).toHaveBeenCalledWith('Hello from LLM');
    });

    it('should include system instructions', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const { complete } = await import('@mariozechner/pi-ai');

      await handleChatCommand('Hello', {
        config: configPath,
        system: 'You are a helpful assistant',
      });

      expect(vi.mocked(complete)).toHaveBeenCalled();
      const callArgs = vi.mocked(complete).mock.calls[0];
      const context = callArgs?.[1] as any;
      expect(context.systemPrompt).toBe('You are a helpful assistant');
    });

    it('should read system instructions from file', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const systemFile = join(tempDir, 'system.txt');
      await writeFile(systemFile, 'System from file', 'utf-8');

      const { complete } = await import('@mariozechner/pi-ai');

      await handleChatCommand('Hello', {
        config: configPath,
        systemFile,
      });

      expect(vi.mocked(complete)).toHaveBeenCalled();
      const callArgs = vi.mocked(complete).mock.calls[0];
      const context = callArgs?.[1] as any;
      expect(context.systemPrompt).toBe('System from file');
    });
  });

  describe('Chat Command - Session Management', () => {
    it('should create session file on first message', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const sessionPath = join(tempDir, 'session.jsonl');

      await handleChatCommand('Hello', {
        config: configPath,
        session: sessionPath,
      });

      const content = await readFile(sessionPath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(2); // user + assistant

      const userMsg = JSON.parse(lines[0]!);
      expect(userMsg.role).toBe('user');
      expect(userMsg.content).toBe('Hello');

      const assistantMsg = JSON.parse(lines[1]!);
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.content).toBe('Hello from LLM');
    });

    it('should load existing session and append new messages', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const sessionPath = join(tempDir, 'session.jsonl');

      // First interaction
      await handleChatCommand('First message', {
        config: configPath,
        session: sessionPath,
      });

      // Second interaction
      await handleChatCommand('Second message', {
        config: configPath,
        session: sessionPath,
      });

      const content = await readFile(sessionPath, 'utf-8');
      const lines = content.trim().split('\n');
      // Should have messages from both interactions
      expect(lines.length).toBeGreaterThanOrEqual(4);
    });

    it('should include system message in session with --system', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const sessionPath = join(tempDir, 'session.jsonl');

      await handleChatCommand('Hello', {
        config: configPath,
        session: sessionPath,
        system: 'Be helpful',
      });

      const content = await readFile(sessionPath, 'utf-8');
      const lines = content.trim().split('\n');
      const systemMsg = lines.find(l => {
        const parsed = JSON.parse(l);
        return parsed.role === 'system';
      });
      expect(systemMsg).toBeDefined();
      expect(JSON.parse(systemMsg!).content).toBe('Be helpful');
    });
  });

  describe('Chat Command - Streaming', () => {
    it('should handle streaming responses', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const { stream } = await import('@mariozechner/pi-ai');
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text_delta', delta: 'Hello' };
          yield { type: 'text_delta', delta: ' world' };
          yield { type: 'done', reason: 'stop' };
        },
      };
      vi.mocked(stream).mockReturnValue(mockStream as any);

      await handleChatCommand('Hi', {
        config: configPath,
        stream: true,
      });

      // Should have written streaming chunks
      expect(stdoutSpy).toHaveBeenCalledWith('Hello');
      expect(stdoutSpy).toHaveBeenCalledWith(' world');
    });
  });

  describe('Chat Command - Tool Invocation', () => {
    it('should handle tool calls and continue conversation', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const { complete } = await import('@mariozechner/pi-ai');
      let callCount = 0;
      vi.mocked(complete).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Let me check.' },
              { type: 'toolCall', id: 'call_1', name: 'bash_exec', arguments: { command: 'echo hello' } },
            ],
            stopReason: 'toolUse',
            usage: { input: 10, output: 5, cost: { total: 0 } },
            timestamp: Date.now(),
          } as any;
        }
        return {
          role: 'assistant',
          content: [{ type: 'text', text: 'The output was: hello' }],
          stopReason: 'stop',
          usage: { input: 10, output: 5, cost: { total: 0 } },
          timestamp: Date.now(),
        } as any;
      });

      await handleChatCommand('Run echo hello', { config: configPath });

      // Should have called complete twice (initial + after tool result)
      expect(vi.mocked(complete)).toHaveBeenCalledTimes(2);
      // Should have written both responses
      expect(stdoutSpy).toHaveBeenCalledWith('Let me check.');
      expect(stdoutSpy).toHaveBeenCalledWith('The output was: hello');
    });
  });

  describe('Chat Command - Parameter Validation', () => {
    it('should reject invalid temperature', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      await handleChatCommand('Hello', {
        config: configPath,
        temperature: 3.0,
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      const errorOutput = stderrSpy.mock.calls.map((c: any) => c[0]).join('');
      expect(errorOutput).toContain('Invalid temperature');

      exitSpy.mockRestore();
    });

    it('should reject negative maxTokens', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      await handleChatCommand('Hello', {
        config: configPath,
        maxTokens: -100,
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      const errorOutput = stderrSpy.mock.calls.map((c: any) => c[0]).join('');
      expect(errorOutput).toContain('Invalid maxTokens');

      exitSpy.mockRestore();
    });
  });

  describe('Chat Command - Error Handling', () => {
    it('should handle missing provider', async () => {
      const config = {
        schema_version: '1.0.0',
        providers: [],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      await handleChatCommand('Hello', {
        config: configPath,
        provider: 'nonexistent',
      });

      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('should handle missing model', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      // Mock getModels to return empty so no fallback model is found
      const piAi = await import('@mariozechner/pi-ai');
      const getModelsMock = vi.mocked(piAi.getModels);
      getModelsMock.mockReturnValueOnce([]);

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      await handleChatCommand('Hello', { config: configPath });

      expect(exitSpy).toHaveBeenCalledWith(1);
      const errorOutput = stderrSpy.mock.calls.map((c: any) => c[0]).join('');
      expect(errorOutput).toContain('No model specified');

      exitSpy.mockRestore();
    });

    it('should handle malformed config file', async () => {
      await writeFile(configPath, '{ invalid json }', 'utf-8');

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      await handleChatCommand('Hello', { config: configPath });

      expect(exitSpy).toHaveBeenCalledWith(4);

      exitSpy.mockRestore();
    });
  });

  describe('Chat Command - Log File', () => {
    it('should write to log file when --log specified', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const logPath = join(tempDir, 'chat.log');

      await handleChatCommand('Hello', {
        config: configPath,
        log: logPath,
      });

      // Wait for async log writes
      await new Promise(resolve => setTimeout(resolve, 200));

      const logContent = await readFile(logPath, 'utf-8');
      expect(logContent).toContain('# Chat Log');
      expect(logContent).toContain('Hello');
      // Assistant output is written asynchronously via writeModelOutput
      // It may or may not be in the log depending on timing
    });
  });

  describe('Model Configuration Workflow', () => {
    it('should add and list a provider', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Add provider
      await handleModelConfig({
        config: configPath,
        add: true,
        name: 'openai',
        provider: 'openai',
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('configured successfully'));

      consoleSpy.mockClear();

      // List providers
      await handleModelList({ config: configPath });

      const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
      expect(output).toContain('openai');

      consoleSpy.mockRestore();
      consoleErrSpy.mockRestore();
    });

    it('should add and delete a provider', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Add provider
      await handleModelConfig({
        config: configPath,
        add: true,
        name: 'openai',
        provider: 'openai',
      });

      // Delete provider
      await handleModelConfig({
        config: configPath,
        delete: true,
        name: 'openai',
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('deleted successfully'));

      consoleSpy.mockClear();

      // List should show no providers
      await handleModelList({ config: configPath });

      expect(consoleSpy).toHaveBeenCalledWith('No providers configured.');

      consoleSpy.mockRestore();
      consoleErrSpy.mockRestore();
    });

    it('should reject unsupported provider', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      await handleModelConfig({
        config: configPath,
        add: true,
        name: 'test',
        provider: 'unsupported-xyz',
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringContaining('Unsupported provider'));

      consoleSpy.mockRestore();
      consoleErrSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });

  describe('Error Scenarios End-to-End', () => {
    it('should handle conflicting system instruction sources', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      await handleChatCommand('Hello', {
        config: configPath,
        system: 'text',
        systemFile: 'file.txt',
      });

      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('should handle non-existent input file', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      await handleChatCommand(undefined, {
        config: configPath,
        inputFile: '/nonexistent/input.txt',
      });

      expect(exitSpy).toHaveBeenCalledWith(4);

      exitSpy.mockRestore();
    });

    it('should handle malformed session file', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const sessionPath = join(tempDir, 'bad-session.jsonl');
      await writeFile(sessionPath, '{ invalid json }\n', 'utf-8');

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      await handleChatCommand('Hello', {
        config: configPath,
        session: sessionPath,
      });

      expect(exitSpy).toHaveBeenCalledWith(4);

      exitSpy.mockRestore();
    });
  });

  describe('Tool Calling Loop', () => {
    it('should handle multi-turn tool calls (tool → LLM → tool → LLM)', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const { complete } = await import('@mariozechner/pi-ai');
      let callCount = 0;
      vi.mocked(complete).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Step 1' },
              { type: 'toolCall', id: 'call_1', name: 'bash_exec', arguments: { command: 'echo first' } },
            ],
            stopReason: 'toolUse',
            usage: { input: 10, output: 5, cost: { total: 0 } },
            timestamp: Date.now(),
          } as any;
        }
        if (callCount === 2) {
          return {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Step 2' },
              { type: 'toolCall', id: 'call_2', name: 'bash_exec', arguments: { command: 'echo second' } },
            ],
            stopReason: 'toolUse',
            usage: { input: 10, output: 5, cost: { total: 0 } },
            timestamp: Date.now(),
          } as any;
        }
        return {
          role: 'assistant',
          content: [{ type: 'text', text: 'Done' }],
          stopReason: 'stop',
          usage: { input: 10, output: 5, cost: { total: 0 } },
          timestamp: Date.now(),
        } as any;
      });

      await handleChatCommand('Do two things', { config: configPath });

      expect(vi.mocked(complete)).toHaveBeenCalledTimes(3);
      expect(stdoutSpy).toHaveBeenCalledWith('Step 1');
      expect(stdoutSpy).toHaveBeenCalledWith('Step 2');
      expect(stdoutSpy).toHaveBeenCalledWith('Done');
    });

    it('should respect max iteration guard', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const { complete } = await import('@mariozechner/pi-ai');
      // Always return tool calls — should stop after 10 iterations
      vi.mocked(complete).mockImplementation(async () => ({
        role: 'assistant',
        content: [
          { type: 'text', text: 'Again' },
          { type: 'toolCall', id: 'call_n', name: 'bash_exec', arguments: { command: 'echo loop' } },
        ],
        stopReason: 'toolUse',
        usage: { input: 10, output: 5, cost: { total: 0 } },
        timestamp: Date.now(),
      } as any));

      await handleChatCommand('Loop forever', { config: configPath });

      // Max 10 iterations + initial = at most 11, but loop guard is 10
      expect(vi.mocked(complete).mock.calls.length).toBeLessThanOrEqual(10);
    });

    it('should capture tool errors as tool result messages', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const { complete } = await import('@mariozechner/pi-ai');
      let callCount = 0;
      vi.mocked(complete).mockImplementation(async (_model: any, context: any) => {
        callCount++;
        if (callCount === 1) {
          return {
            role: 'assistant',
            content: [
              { type: 'toolCall', id: 'call_bad', name: 'nonexistent_tool', arguments: {} },
            ],
            stopReason: 'toolUse',
            usage: { input: 10, output: 5, cost: { total: 0 } },
            timestamp: Date.now(),
          } as any;
        }
        // Second call: verify tool error was passed back
        const messages = context.messages;
        const toolResult = messages.find((m: any) => m.role === 'toolResult');
        expect(toolResult).toBeDefined();
        expect(toolResult.content[0].text).toContain('Error');

        return {
          role: 'assistant',
          content: [{ type: 'text', text: 'Handled error' }],
          stopReason: 'stop',
          usage: { input: 10, output: 5, cost: { total: 0 } },
          timestamp: Date.now(),
        } as any;
      });

      await handleChatCommand('Try bad tool', { config: configPath });

      expect(callCount).toBe(2);
      expect(stdoutSpy).toHaveBeenCalledWith('Handled error');
    });

    it('should only append new messages to session file', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const sessionPath = join(tempDir, 'session-append.jsonl');

      // Reset complete mock to default behavior
      const { complete } = await import('@mariozechner/pi-ai');
      vi.mocked(complete).mockImplementation(async () => ({
        role: 'assistant',
        content: [{ type: 'text', text: 'Reply' }],
        stopReason: 'stop',
        usage: { input: 10, output: 5, cost: { total: 0 } },
        timestamp: Date.now(),
      } as any));

      // First turn
      await handleChatCommand('First', {
        config: configPath,
        session: sessionPath,
      });

      const afterFirst = await readFile(sessionPath, 'utf-8');
      const firstLines = afterFirst.trim().split('\n');
      expect(firstLines.length).toBe(2); // user + assistant

      // Second turn
      await handleChatCommand('Second', {
        config: configPath,
        session: sessionPath,
      });

      const afterSecond = await readFile(sessionPath, 'utf-8');
      const secondLines = afterSecond.trim().split('\n');
      // Should have 4 lines: first user + first assistant + second user + second assistant
      expect(secondLines.length).toBe(4);

      // Verify no duplication
      const roles = secondLines.map(l => JSON.parse(l).role);
      expect(roles).toEqual(['user', 'assistant', 'user', 'assistant']);
    });
  });

  describe('Image/Multimodal Integration', () => {
    it('should pass image content through to LLM', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      // Create a minimal 1x1 PNG fixture
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, // 8-bit RGB
        0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, // IDAT chunk
        0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00,
        0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC, 0x33,
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, // IEND chunk
        0xAE, 0x42, 0x60, 0x82,
      ]);
      const imagePath = join(tempDir, 'test.png');
      await writeFile(imagePath, pngHeader);

      const { complete } = await import('@mariozechner/pi-ai');
      vi.mocked(complete).mockImplementation(async (_model: any, context: any) => {
        // Verify the user message contains multimodal content
        const userMsg = context.messages.find((m: any) => m.role === 'user');
        expect(userMsg).toBeDefined();
        expect(Array.isArray(userMsg.content)).toBe(true);
        expect(userMsg.content.length).toBe(2); // text + image
        expect(userMsg.content[0].type).toBe('text');
        expect(userMsg.content[1].type).toBe('image');
        expect(userMsg.content[1].mimeType).toBe('image/png');
        expect(userMsg.content[1].data).toBeTruthy(); // base64 data

        return {
          role: 'assistant',
          content: [{ type: 'text', text: 'I see the image' }],
          stopReason: 'stop',
          usage: { input: 10, output: 5, cost: { total: 0 } },
          timestamp: Date.now(),
        } as any;
      });

      await handleChatCommand('Describe this', {
        config: configPath,
        image: [imagePath],
      });

      expect(stdoutSpy).toHaveBeenCalledWith('I see the image');
    });

    it('should preserve multimodal content in session file', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      // Create a minimal PNG
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE,
        0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54,
        0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00,
        0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC, 0x33,
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
        0xAE, 0x42, 0x60, 0x82,
      ]);
      const imagePath = join(tempDir, 'test2.png');
      await writeFile(imagePath, pngHeader);

      const sessionPath = join(tempDir, 'multimodal-session.jsonl');

      await handleChatCommand('What is this?', {
        config: configPath,
        image: [imagePath],
        session: sessionPath,
      });

      const content = await readFile(sessionPath, 'utf-8');
      const lines = content.trim().split('\n');
      const userMsg = JSON.parse(lines[0]!);
      expect(userMsg.role).toBe('user');
      expect(Array.isArray(userMsg.content)).toBe(true);
      expect(userMsg.content[0].type).toBe('text');
      expect(userMsg.content[1].type).toBe('image');
      expect(userMsg.content[1].mimeType).toBe('image/png');
    });
  });

  describe('Dry Run', () => {
    it('should output resolved config and not call LLM', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const { complete } = await import('@mariozechner/pi-ai');
      vi.mocked(complete).mockClear();

      await handleChatCommand('Hello', {
        config: configPath,
        dryRun: true,
      });

      // LLM should not be called
      expect(vi.mocked(complete)).not.toHaveBeenCalled();

      // Should have written config info to stderr
      const stderrOutput = stderrSpy.mock.calls.map((c: any) => c[0]).join('');
      expect(stderrOutput).toContain('test');
      expect(stderrOutput).toContain('test-model');
    });
  });
});
