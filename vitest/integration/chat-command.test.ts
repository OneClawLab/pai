import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleChatCommand } from '../../src/commands/chat.js';
import type { ChatOptions } from '../../src/types.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@mariozechner/pi-ai', () => ({
  getModel: vi.fn(() => ({ id: 'test-model', name: 'Test Model', provider: 'test' })),
  stream: vi.fn(),
  complete: vi.fn(),
}));

describe('Chat Command Integration Tests', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pai-chat-test-'));
    configPath = join(tempDir, 'config.json');
    const config = {
      schema_version: '1.0.0',
      defaultProvider: 'test',
      providers: [{ name: 'test', apiKey: 'test-key', models: ['test-model'], defaultModel: 'test-model' }],
    };
    await writeFile(configPath, JSON.stringify(config), 'utf-8');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
      throw new Error('Process exited with code ' + code);
    }) as any);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('parameter validation', () => {
    it('should reject invalid temperature', async () => {
      const options: ChatOptions = { config: configPath, temperature: 3.0 };
      try {
        await handleChatCommand('Hello', options);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('Process exited with code 1');
      }
      expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Invalid temperature'));
    });

    it('should reject negative maxTokens', async () => {
      const options: ChatOptions = { config: configPath, maxTokens: -100 };
      try {
        await handleChatCommand('Hello', options);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('Process exited with code 1');
      }
      expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Invalid maxTokens'));
    });
  });

  describe('error handling', () => {
    it('should handle missing provider', async () => {
      const options: ChatOptions = { config: configPath, provider: 'nonexistent' };
      try {
        await handleChatCommand('Hello', options);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('Process exited with code 1');
      }
      expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('Provider not found'));
    });

    it('should handle missing model', async () => {
      const config = { schema_version: '1.0.0', providers: [{ name: 'test', apiKey: 'test-key' }] };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');
      const options: ChatOptions = { config: configPath, provider: 'test' };
      try {
        await handleChatCommand('Hello', options);
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('Process exited with code 1');
      }
      expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('No model specified'));
    });
  });
});
