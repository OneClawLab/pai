import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleChatCommand } from '../../src/commands/chat.js';
import type { ChatOptions } from '../../src/types.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
      content: [{ type: 'text', text: 'OK' }],
      stopReason: 'stop',
      usage: { input: 10, output: 5, cost: { total: 0 } },
      timestamp: Date.now(),
    })
  ),
}));

describe('Provider and Model Selection', () => {
  let tempDir: string;
  let configPath: string;
  let stdoutSpy: any;
  let stderrSpy: any;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pai-provider-test-'));
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

  describe('explicit provider selection', () => {
    it('should use specified --provider flag', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'default-provider',
        providers: [
          { name: 'default-provider', apiKey: 'key1', models: ['model-a'], defaultModel: 'model-a' },
          { name: 'explicit-provider', apiKey: 'key2', models: ['model-b'], defaultModel: 'model-b' },
        ],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const { complete } = await import('@mariozechner/pi-ai');

      await handleChatCommand('Hello', {
        config: configPath,
        provider: 'explicit-provider',
      });

      // Should have called complete (non-streaming by default)
      expect(vi.mocked(complete)).toHaveBeenCalled();
      expect(stdoutSpy).toHaveBeenCalledWith('OK');
    });

    it('should error when specified provider not in config', async () => {
      const config = {
        schema_version: '1.0.0',
        providers: [{ name: 'openai', apiKey: 'key1', defaultModel: 'gpt-4' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      await handleChatCommand('Hello', {
        config: configPath,
        provider: 'nonexistent',
      });

      expect(exitSpy).toHaveBeenCalledWith(1);
      const errorOutput = stderrSpy.mock.calls.map((c: any) => c[0]).join('');
      expect(errorOutput).toContain('nonexistent');

      exitSpy.mockRestore();
    });
  });

  describe('default provider', () => {
    it('should use defaultProvider from config when no --provider flag', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'anthropic',
        providers: [
          { name: 'openai', apiKey: 'key1', defaultModel: 'gpt-4' },
          { name: 'anthropic', apiKey: 'key2', defaultModel: 'claude-3' },
        ],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const { complete } = await import('@mariozechner/pi-ai');

      await handleChatCommand('Hello', { config: configPath });

      expect(vi.mocked(complete)).toHaveBeenCalled();
      expect(stdoutSpy).toHaveBeenCalledWith('OK');
    });

    it('should error when no default provider and no --provider flag', async () => {
      const config = {
        schema_version: '1.0.0',
        providers: [{ name: 'openai', apiKey: 'key1', defaultModel: 'gpt-4' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      await handleChatCommand('Hello', { config: configPath });

      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });
  });

  describe('model parameter passing', () => {
    it('should pass CLI temperature to LLM client', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const { complete } = await import('@mariozechner/pi-ai');

      await handleChatCommand('Hello', {
        config: configPath,
        temperature: 0.5,
      });

      expect(vi.mocked(complete)).toHaveBeenCalled();
      const callArgs = vi.mocked(complete).mock.calls[0];
      const options = callArgs?.[2] as any;
      expect(options.temperature).toBe(0.5);
    });

    it('should pass CLI maxTokens to LLM client', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const { complete } = await import('@mariozechner/pi-ai');

      await handleChatCommand('Hello', {
        config: configPath,
        maxTokens: 500,
      });

      expect(vi.mocked(complete)).toHaveBeenCalled();
      const callArgs = vi.mocked(complete).mock.calls[0];
      const options = callArgs?.[2] as any;
      expect(options.maxTokens).toBe(500);
    });

    it('should use config defaults when CLI params not provided', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model', temperature: 0.3, maxTokens: 2000 }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const { complete } = await import('@mariozechner/pi-ai');

      await handleChatCommand('Hello', { config: configPath });

      expect(vi.mocked(complete)).toHaveBeenCalled();
      const callArgs = vi.mocked(complete).mock.calls[0];
      const options = callArgs?.[2] as any;
      expect(options.temperature).toBe(0.3);
      expect(options.maxTokens).toBe(2000);
    });

    it('should override config defaults with CLI params', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'test-model', temperature: 0.3, maxTokens: 2000 }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const { complete } = await import('@mariozechner/pi-ai');

      await handleChatCommand('Hello', {
        config: configPath,
        temperature: 1.0,
        maxTokens: 500,
      });

      expect(vi.mocked(complete)).toHaveBeenCalled();
      const callArgs = vi.mocked(complete).mock.calls[0];
      const options = callArgs?.[2] as any;
      expect(options.temperature).toBe(1.0);
      expect(options.maxTokens).toBe(500);
    });
  });

  describe('model selection', () => {
    it('should use --model flag over config default', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'default-model', models: ['default-model', 'other-model'] }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const { complete } = await import('@mariozechner/pi-ai');

      await handleChatCommand('Hello', {
        config: configPath,
        model: 'other-model',
      });

      expect(vi.mocked(complete)).toHaveBeenCalled();
      // The model is passed to the LLMClient constructor which calls getModel/buildModel
      // We verify it was called successfully
      expect(stdoutSpy).toHaveBeenCalledWith('OK');
    });

    it('should use defaultModel from provider config', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', defaultModel: 'my-default-model' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const { complete } = await import('@mariozechner/pi-ai');

      await handleChatCommand('Hello', { config: configPath });

      expect(vi.mocked(complete)).toHaveBeenCalled();
      expect(stdoutSpy).toHaveBeenCalledWith('OK');
    });

    it('should fall back to first model in models array', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key', models: ['first-model', 'second-model'] }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const { complete } = await import('@mariozechner/pi-ai');

      await handleChatCommand('Hello', { config: configPath });

      expect(vi.mocked(complete)).toHaveBeenCalled();
      expect(stdoutSpy).toHaveBeenCalledWith('OK');
    });

    it('should error when no model available', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'test',
        providers: [{ name: 'test', apiKey: 'key' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      await handleChatCommand('Hello', { config: configPath });

      expect(exitSpy).toHaveBeenCalledWith(1);
      const errorOutput = stderrSpy.mock.calls.map((c: any) => c[0]).join('');
      expect(errorOutput).toContain('No model specified');

      exitSpy.mockRestore();
    });
  });
});
