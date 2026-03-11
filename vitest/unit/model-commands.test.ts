import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleModelList, handleModelConfig } from '../../src/commands/model.js';
import { PAIError } from '../../src/types.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as fc from 'fast-check';

describe('Model Commands', () => {
  let tempDir: string;
  let configPath: string;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pai-model-test-'));
    configPath = join(tempDir, 'config.json');
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('handleModelList', () => {
    it('should list configured providers', async () => {
      const config = {
        schema_version: '1.0.0',
        providers: [
          { name: 'openai', models: ['gpt-4', 'gpt-3.5-turbo'], defaultModel: 'gpt-4' },
          { name: 'anthropic', models: ['claude-3-opus'], defaultModel: 'claude-3-opus' },
        ],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      await handleModelList({ config: configPath });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(output).toContain('openai');
      expect(output).toContain('anthropic');
    });

    it('should show message when no providers configured', async () => {
      await handleModelList({ config: configPath });

      expect(consoleLogSpy).toHaveBeenCalledWith('No providers configured.');
    });

    it('should list all providers with --all flag', async () => {
      await handleModelList({ config: configPath, all: true });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(output).toContain('Available Providers');
    });

    it('should output JSON with --json flag', async () => {
      const config = {
        schema_version: '1.0.0',
        providers: [{ name: 'openai', models: ['gpt-4'] }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      await handleModelList({ config: configPath, json: true });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });

  describe('handleModelConfig', () => {
    it('should add new provider', async () => {
      await handleModelConfig({
        config: configPath,
        add: true,
        name: 'test-provider',
        provider: 'openai',
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('configured successfully')
      );
    });

    it('should delete existing provider', async () => {
      const config = {
        schema_version: '1.0.0',
        providers: [{ name: 'openai' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      await handleModelConfig({
        config: configPath,
        delete: true,
        name: 'openai',
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('deleted successfully')
      );
    });

    it('should error when adding without name', async () => {
      await handleModelConfig({
        config: configPath,
        add: true,
        provider: 'openai',
      });

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Provider name is required')
      );
    });

    it('should error when adding without provider', async () => {
      await handleModelConfig({
        config: configPath,
        add: true,
        name: 'test',
      });

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Provider type is required')
      );
    });

    it('should error for unsupported provider', async () => {
      await handleModelConfig({
        config: configPath,
        add: true,
        name: 'test',
        provider: 'unsupported-provider-xyz',
      });

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unsupported provider')
      );
    });
  });

  // Property-Based Tests
  describe('Property-Based Tests', () => {
    // Feature: pai-cli-tool, Property 1: Provider Information Display Completeness
    it('should display all provider details when listing', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              name: fc.string({ minLength: 1, maxLength: 20 }),
              models: fc.option(
                fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 3 }),
                { nil: undefined }
              ),
              defaultModel: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
            }),
            { minLength: 1, maxLength: 3 }
          ),
          async (providers) => {
            const testDir = await mkdtemp(join(tmpdir(), 'pai-pbt-'));
            const testPath = join(testDir, 'config.json');

            try {
              const config = {
                schema_version: '1.0.0',
                providers,
              };
              await writeFile(testPath, JSON.stringify(config), 'utf-8');

              const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

              await handleModelList({ config: testPath });

              const output = spy.mock.calls.map((call: any) => call[0]).join('\n');

              // Property: All provider names must be displayed
              for (const provider of providers) {
                expect(output).toContain(provider.name);
              }

              spy.mockRestore();
            } finally {
              await rm(testDir, { recursive: true, force: true });
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    // Feature: pai-cli-tool, Property 5: Provider Validation
    it('should reject unsupported providers', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 30 }).filter(
            (s) => !['openai', 'anthropic', 'google', 'mistral', 'groq', 'cohere', 'github-copilot'].includes(s)
          ),
          async (invalidProvider) => {
            const testDir = await mkdtemp(join(tmpdir(), 'pai-pbt-'));
            const testPath = join(testDir, 'config.json');

            try {
              const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
              const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

              await handleModelConfig({
                config: testPath,
                add: true,
                name: 'test',
                provider: invalidProvider,
              });

              // Property: Must exit with code 1 for unsupported provider
              expect(exitSpy).toHaveBeenCalledWith(1);
              expect(errorSpy).toHaveBeenCalled();

              exitSpy.mockRestore();
              errorSpy.mockRestore();
            } finally {
              await rm(testDir, { recursive: true, force: true });
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    // Feature: pai-cli-tool, Property 4: Configuration Deletion
    it('should remove provider from config after deletion', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              name: fc.string({ minLength: 3, maxLength: 20 }) // Increased min length
                .filter(s => s.trim().length >= 3)
                .filter(s => /^[a-zA-Z0-9_-]+$/.test(s)), // Only alphanumeric, underscore, hyphen
            }),
            { minLength: 2, maxLength: 5 }
          ).filter(providers => {
            // Ensure no provider name is a substring of another
            const names = providers.map(p => p.name);
            for (let i = 0; i < names.length; i++) {
              for (let j = 0; j < names.length; j++) {
                if (i !== j && names[i]!.includes(names[j]!)) {
                  return false;
                }
              }
            }
            return true;
          }),
          async (providers) => {
            const testDir = await mkdtemp(join(tmpdir(), 'pai-pbt-'));
            const testPath = join(testDir, 'config.json');

            try {
              const config = {
                schema_version: '1.0.0',
                providers,
              };
              await writeFile(testPath, JSON.stringify(config), 'utf-8');

              // Delete the first provider
              const toDelete = providers[0]!.name;

              const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
              const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

              await handleModelConfig({
                config: testPath,
                delete: true,
                name: toDelete,
              });

              // Now list providers
              await handleModelList({ config: testPath });

              const output = logSpy.mock.calls.map((call: any) => call[0]).join('\n');

              // Property: Deleted provider should not appear in list
              if (providers.length > 1) {
                // Check that the deleted provider name doesn't appear as a configured provider
                // The output format is: "✓ <provider_name>" on its own line
                // We need to check if any line matches exactly "✓ <provider_name>"
                const lines = output.split('\n');
                const deletedProviderLine = lines.some(line => {
                  const trimmed = line.trim();
                  // Exact match: the line should be exactly "✓ <provider_name>"
                  return trimmed === `✓ ${toDelete}`;
                });
                expect(deletedProviderLine).toBe(false);
              }

              exitSpy.mockRestore();
              logSpy.mockRestore();
            } finally {
              await rm(testDir, { recursive: true, force: true });
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
