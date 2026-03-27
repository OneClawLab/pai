import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleEmbedCommand } from '../../src/commands/embed.js';
import { PAIError, ExitCode } from '../../src/types.js';
import type { EmbedOptions } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLoadConfig = vi.fn();
const mockResolveCredentials = vi.fn();
vi.mock('../../src/config-manager.js', () => ({
  ConfigurationManager: class {
    loadConfig = mockLoadConfig;
    resolveCredentials = mockResolveCredentials;
  },
}));

const mockResolveUserInput = vi.fn();
vi.mock('../../src/input-resolver.js', () => ({
  InputResolver: class {
    resolveUserInput = mockResolveUserInput;
  },
}));

const mockEmbed = vi.fn();
vi.mock('../../src/embedding-client.js', () => ({
  EmbeddingClient: class {
    embed = mockEmbed;
  },
}));

// Capture stdout/stderr writes
let stdoutOutput: string;
let stderrOutput: string;

const baseConfig = {
  schema_version: '1.0.0',
  defaultProvider: 'openai',
  defaultEmbedProvider: 'openai',
  defaultEmbedModel: 'text-embedding-3-small',
  providers: [
    { name: 'openai', apiKey: 'sk-test' },
  ],
};

const baseEmbedResponse = {
  embeddings: [[0.1, 0.2, 0.3]],
  model: 'text-embedding-3-small',
  usage: { promptTokens: 2, totalTokens: 2 },
};

const baseOptions: EmbedOptions = {};

beforeEach(() => {
  stdoutOutput = '';
  stderrOutput = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    stdoutOutput += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
    stderrOutput += String(chunk);
    return true;
  });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as () => never);

  // Default mock returns
  mockLoadConfig.mockResolvedValue({ ...baseConfig });
  mockResolveCredentials.mockResolvedValue('sk-test');
  mockEmbed.mockResolvedValue({ ...baseEmbedResponse });

  // stdin is a TTY by default (no stdin input)
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleEmbedCommand', () => {
  describe('single text embedding', () => {
    it('should embed text from positional argument', async () => {
      await handleEmbedCommand('hello world', baseOptions);

      expect(mockEmbed).toHaveBeenCalledWith({
        texts: ['hello world'],
        model: 'text-embedding-3-small',
      });
      // Output is now a hex string array (one 8-char hex per float32)
      const parsed: string[] = JSON.parse(stdoutOutput.trim());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(3);
      for (const h of parsed) {
        expect(h).toMatch(/^[0-9a-f]{8}$/);
      }
    });

    it('should embed text from --input-file', async () => {
      mockResolveUserInput.mockResolvedValue('file content here');

      await handleEmbedCommand(undefined, { inputFile: 'test.txt' });

      expect(mockResolveUserInput).toHaveBeenCalledWith({ file: 'test.txt' });
      expect(mockEmbed).toHaveBeenCalledWith({
        texts: ['file content here'],
        model: 'text-embedding-3-small',
      });
    });

    it('should embed text from stdin when available', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
      mockResolveUserInput.mockResolvedValue('stdin content');

      await handleEmbedCommand(undefined, baseOptions);

      expect(mockResolveUserInput).toHaveBeenCalledWith({ stdin: true });
      expect(mockEmbed).toHaveBeenCalledWith({
        texts: ['stdin content'],
        model: 'text-embedding-3-small',
      });
    });
  });

  describe('batch mode', () => {
    it('should parse batch JSON input and embed multiple texts', async () => {
      mockEmbed.mockResolvedValue({
        embeddings: [[0.1, 0.2], [0.3, 0.4]],
        model: 'text-embedding-3-small',
        usage: { promptTokens: 4, totalTokens: 4 },
      });

      await handleEmbedCommand('["hello","world"]', { batch: true });

      expect(mockEmbed).toHaveBeenCalledWith({
        texts: ['hello', 'world'],
        model: 'text-embedding-3-small',
      });
      // Each line is a hex string array
      const lines = stdoutOutput.trim().split('\n');
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        const parsed: string[] = JSON.parse(line);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toHaveLength(2);
      }
    });

    it('should handle empty batch array', async () => {
      mockEmbed.mockResolvedValue({
        embeddings: [],
        model: 'text-embedding-3-small',
        usage: { promptTokens: 0, totalTokens: 0 },
      });

      await handleEmbedCommand('[]', { batch: true });

      expect(mockEmbed).toHaveBeenCalledWith({
        texts: [],
        model: 'text-embedding-3-small',
      });
    });
  });

  describe('JSON output mode', () => {
    it('should output JSON format for single embedding', async () => {
      await handleEmbedCommand('hello', { json: true });

      const parsed = JSON.parse(stdoutOutput.trim());
      expect(parsed).toHaveProperty('embedding');
      expect(Array.isArray(parsed.embedding)).toBe(true);
      for (const h of parsed.embedding) {
        expect(h).toMatch(/^[0-9a-f]{8}$/);
      }
      expect(parsed).toHaveProperty('model', 'text-embedding-3-small');
      expect(parsed).toHaveProperty('usage');
    });

    it('should output JSON format for batch embedding', async () => {
      mockEmbed.mockResolvedValue({
        embeddings: [[0.1], [0.2]],
        model: 'text-embedding-3-small',
        usage: { promptTokens: 4, totalTokens: 4 },
      });

      await handleEmbedCommand('["a","b"]', { json: true, batch: true });

      const parsed = JSON.parse(stdoutOutput.trim());
      expect(parsed).toHaveProperty('embeddings');
      expect(parsed).not.toHaveProperty('embedding');
    });
  });

  describe('text truncation warnings', () => {
    it('should output plain warning when text is truncated', async () => {
      // text-embedding-3-small has 8191 token limit, ~32764 chars
      const longText = 'a'.repeat(40000);

      await handleEmbedCommand(longText, baseOptions);

      expect(stderrOutput).toContain('[Warning]');
      expect(stderrOutput).toContain('truncated');
    });

    it('should output NDJSON warning in json mode when text is truncated', async () => {
      const longText = 'a'.repeat(40000);

      await handleEmbedCommand(longText, { json: true });

      const lines = stderrOutput.trim().split('\n');
      const warningLine = lines.find((l) => l.includes('"type":"warning"'));
      expect(warningLine).toBeDefined();
      const parsed = JSON.parse(warningLine!);
      expect(parsed.type).toBe('warning');
      expect(parsed.data).toHaveProperty('originalTokens');
      expect(parsed.data).toHaveProperty('truncatedTokens');
    });

    it('should not warn when text is within limit', async () => {
      await handleEmbedCommand('short text', baseOptions);

      // Filter out progress events, check only for truncation warnings
      const warningLines = stderrOutput.split('\n').filter(l =>
        l.includes('[Warning]') && l.includes('truncated')
      );
      expect(warningLines).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('should exit with code 2 when no input is provided', async () => {
      await expect(
        handleEmbedCommand(undefined, baseOptions)
      ).rejects.toThrow('process.exit(2)');
    });

    it('should exit with code 2 when provider not found in config', async () => {
      mockLoadConfig.mockResolvedValue({
        ...baseConfig,
        providers: [], // no providers
      });

      await expect(
        handleEmbedCommand('hello', baseOptions)
      ).rejects.toThrow('process.exit(2)');
    });

    it('should exit with code 2 when no provider configured', async () => {
      mockLoadConfig.mockResolvedValue({
        schema_version: '1.0.0',
        providers: [],
      });

      await expect(
        handleEmbedCommand('hello', baseOptions)
      ).rejects.toThrow('process.exit(2)');
    });

    it('should exit with code 2 for invalid batch JSON', async () => {
      await expect(
        handleEmbedCommand('not json', { batch: true })
      ).rejects.toThrow('process.exit(2)');
    });

    it('should exit with code 3 on API error', async () => {
      mockEmbed.mockRejectedValue(
        new PAIError('API error', ExitCode.API_ERROR)
      );

      await expect(
        handleEmbedCommand('hello', baseOptions)
      ).rejects.toThrow('process.exit(3)');
    });

    it('should exit with code 1 on network error', async () => {
      mockEmbed.mockRejectedValue(
        new PAIError('Network error', ExitCode.RUNTIME_ERROR)
      );

      await expect(
        handleEmbedCommand('hello', baseOptions)
      ).rejects.toThrow('process.exit(1)');
    });

    it('should exit with code 1 on unexpected error', async () => {
      mockEmbed.mockRejectedValue(new Error('unexpected'));

      await expect(
        handleEmbedCommand('hello', baseOptions)
      ).rejects.toThrow('process.exit(1)');
    });
  });

  describe('provider and model resolution', () => {
    it('should use CLI --provider and --model over config defaults', async () => {
      mockLoadConfig.mockResolvedValue({
        ...baseConfig,
        providers: [
          { name: 'openai', apiKey: 'sk-test' },
          { name: 'custom', apiKey: 'ck-test' },
        ],
      });

      await handleEmbedCommand('hello', {
        provider: 'custom',
        model: 'custom-embed-v1',
      });

      expect(mockEmbed).toHaveBeenCalledWith({
        texts: ['hello'],
        model: 'custom-embed-v1',
      });
      expect(mockResolveCredentials).toHaveBeenCalledWith('custom', undefined);
    });
  });

  describe('quiet mode', () => {
    it('should suppress progress output in quiet mode', async () => {
      await handleEmbedCommand('hello', { quiet: true });

      // stdout should still have the embedding output (hex string array)
      const parsed: string[] = JSON.parse(stdoutOutput.trim());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(3);
    });
  });
});
