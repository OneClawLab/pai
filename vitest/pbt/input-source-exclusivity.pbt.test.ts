/**
 * Feature: embed-command, Property 1: 多输入源互斥
 *
 * **Validates: Requirements 1.4**
 *
 * For any combination of input sources, when two or more input sources
 * (positional argument, stdin, --input-file) are provided simultaneously,
 * Embed_Command should return a parameter error with exit code 1.
 *
 * Implementation note: The embed command guards stdin with `!hasExplicitInput`,
 * meaning when text or inputFile is provided, stdinAvailable is always false.
 * Therefore the only multi-source combination that triggers the error through
 * the command handler is text + inputFile. This test verifies:
 *   1. text + inputFile always causes exit code 1
 *   2. Exactly one source never triggers a multi-source error
 *   3. No sources triggers a "no input" error (exit code 1)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { handleEmbedCommand } from '../../src/commands/embed.js';
import type { EmbedOptions } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Mocks (same pattern as unit tests)
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

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const baseConfig = {
  schema_version: '1.0.0',
  defaultProvider: 'openai',
  defaultEmbedProvider: 'openai',
  defaultEmbedModel: 'text-embedding-3-small',
  providers: [{ name: 'openai', apiKey: 'sk-test' }],
};

const baseEmbedResponse = {
  embeddings: [[0.1, 0.2, 0.3]],
  model: 'text-embedding-3-small',
  usage: { promptTokens: 2, totalTokens: 2 },
};

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generate a non-empty text string for positional argument */
const textArb = fc.string({ minLength: 1, maxLength: 100 });

/** Generate a non-empty file path for --input-file */
const filePathArb = fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0);

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let exitCode: number | undefined;

beforeEach(() => {
  exitCode = undefined;

  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code;
    throw new Error(`process.exit(${code})`);
  }) as () => never);

  mockLoadConfig.mockResolvedValue({ ...baseConfig });
  mockResolveCredentials.mockResolvedValue('sk-test');
  mockResolveUserInput.mockResolvedValue('mock input content');
  mockEmbed.mockResolvedValue({ ...baseEmbedResponse });

  // Default: stdin is a TTY (not available)
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Property 1: 多输入源互斥', () => {
  // Feature: embed-command, Property 1: 多输入源互斥
  // **Validates: Requirements 1.4**

  it('text + inputFile always causes exit code 1 (parameter error)', async () => {
    await fc.assert(
      fc.asyncProperty(textArb, filePathArb, async (text, filePath) => {
        exitCode = undefined;
        mockLoadConfig.mockResolvedValue({ ...baseConfig });
        mockResolveCredentials.mockResolvedValue('sk-test');

        const options: EmbedOptions = { inputFile: filePath };

        try {
          await handleEmbedCommand(text, options);
          // Should not reach here — must throw
          expect.unreachable('Expected process.exit(1) for multiple input sources');
        } catch {
          expect(exitCode).toBe(1);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('text-only input never triggers multi-source error', async () => {
    await fc.assert(
      fc.asyncProperty(textArb, async (text) => {
        exitCode = undefined;
        mockLoadConfig.mockResolvedValue({ ...baseConfig });
        mockResolveCredentials.mockResolvedValue('sk-test');
        mockEmbed.mockResolvedValue({ ...baseEmbedResponse });

        // Only positional argument, no inputFile, stdin is TTY
        Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

        await handleEmbedCommand(text, {});

        // Should succeed — no exit called
        expect(exitCode).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('inputFile-only input never triggers multi-source error', async () => {
    await fc.assert(
      fc.asyncProperty(filePathArb, async (filePath) => {
        exitCode = undefined;
        mockLoadConfig.mockResolvedValue({ ...baseConfig });
        mockResolveCredentials.mockResolvedValue('sk-test');
        mockResolveUserInput.mockResolvedValue('file content');
        mockEmbed.mockResolvedValue({ ...baseEmbedResponse });

        Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

        await handleEmbedCommand(undefined, { inputFile: filePath });

        expect(exitCode).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('stdin-only input never triggers multi-source error', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        exitCode = undefined;
        mockLoadConfig.mockResolvedValue({ ...baseConfig });
        mockResolveCredentials.mockResolvedValue('sk-test');
        mockResolveUserInput.mockResolvedValue('stdin content');
        mockEmbed.mockResolvedValue({ ...baseEmbedResponse });

        // stdin available: isTTY = false, no text, no inputFile
        Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

        await handleEmbedCommand(undefined, {});

        expect(exitCode).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it('no input source causes exit code 1 (no input error)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        exitCode = undefined;
        mockLoadConfig.mockResolvedValue({ ...baseConfig });

        // No text, no inputFile, stdin is TTY (not available)
        Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

        try {
          await handleEmbedCommand(undefined, {});
          expect.unreachable('Expected process.exit(1) for no input');
        } catch {
          expect(exitCode).toBe(1);
        }
      }),
      { numRuns: 100 },
    );
  });
});
