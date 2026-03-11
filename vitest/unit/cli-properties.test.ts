import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleChatCommand } from '../../src/commands/chat.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as fc from 'fast-check';

describe('CLI Property-Based Tests', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pai-cli-test-'));
    configPath = join(tempDir, 'config.json');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // Feature: pai-cli-tool, Property 6: Exit Code Correctness
  describe('Property 6: Exit Code Correctness', () => {
    it('should exit with code 1 for parameter errors (multiple input sources)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            hasMessage: fc.boolean(),
            hasStdin: fc.boolean(),
            hasFile: fc.boolean(),
          }).filter(({ hasMessage, hasStdin, hasFile }) => {
            // Ensure multiple sources are specified
            const count = [hasMessage, hasStdin, hasFile].filter(Boolean).length;
            return count > 1;
          }),
          async ({ hasMessage, hasStdin, hasFile }) => {
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
            const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

            try {
              const options: any = { config: configPath };
              
              await handleChatCommand(
                hasMessage ? 'test message' : undefined,
                {
                  ...options,
                  stdin: hasStdin,
                  inputFile: hasFile ? 'test.txt' : undefined,
                }
              );

              // Property: Parameter errors should exit with code 1
              expect(exitSpy).toHaveBeenCalledWith(1);
            } finally {
              exitSpy.mockRestore();
              stderrSpy.mockRestore();
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should exit with code 1 for missing provider in config', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
          async (providerName) => {
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
            const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

            try {
              // Create empty config
              const config = {
                schema_version: '1.0.0',
                providers: [],
              };
              await writeFile(configPath, JSON.stringify(config), 'utf-8');

              await handleChatCommand('test', {
                config: configPath,
                provider: providerName,
              });

              // Property: Missing provider should exit with code 1
              expect(exitSpy).toHaveBeenCalledWith(1);
            } finally {
              exitSpy.mockRestore();
              stderrSpy.mockRestore();
            }
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  // Feature: pai-cli-tool, Property 22: Error Message Context
  describe('Property 22: Error Message Context', () => {
    it('should include provider name in missing provider errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 2, maxLength: 20 })
            .filter(s => s.trim().length > 1)
            .filter(s => !/[!"$]/.test(s)), // Filter out problematic special chars
          async (providerName) => {
            const stderrWrites: string[] = [];
            const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
              stderrWrites.push(String(chunk));
              return true;
            });
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

            try {
              const config = {
                schema_version: '1.0.0',
                providers: [],
              };
              await writeFile(configPath, JSON.stringify(config), 'utf-8');

              await handleChatCommand('test', {
                config: configPath,
                provider: providerName,
              });

              // Property: Error should mention the provider name
              const allErrors = stderrWrites.join('');
              
              expect(allErrors).toContain(providerName);
            } finally {
              stderrSpy.mockRestore();
              exitSpy.mockRestore();
            }
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  // Feature: pai-cli-tool, Property 23: Provider Existence Validation
  describe('Property 23: Provider Existence Validation', () => {
    it('should validate provider exists in config when specified', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            configuredProvider: fc.string({ minLength: 2, maxLength: 15 })
              .filter(s => s.trim().length > 1)
              .filter(s => !/[!"$]/.test(s)), // Filter out problematic special chars
            requestedProvider: fc.string({ minLength: 2, maxLength: 15 })
              .filter(s => s.trim().length > 1)
              .filter(s => !/[!"$]/.test(s)), // Filter out problematic special chars
          }).filter(({ configuredProvider, requestedProvider }) => 
            configuredProvider !== requestedProvider
          ),
          async ({ configuredProvider, requestedProvider }) => {
            const stderrWrites: string[] = [];
            const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
              stderrWrites.push(String(chunk));
              return true;
            });
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

            try {
              // Create config with one provider
              const config = {
                schema_version: '1.0.0',
                providers: [{ name: configuredProvider, apiKey: 'test-key' }],
              };
              await writeFile(configPath, JSON.stringify(config), 'utf-8');

              // Request different provider
              await handleChatCommand('test', {
                config: configPath,
                provider: requestedProvider,
              });

              // Property: Should exit with code 1 for non-existent provider
              expect(exitSpy).toHaveBeenCalledWith(1);
              
              // Property: Error should mention the provider
              const allErrors = stderrWrites.join('');
              expect(allErrors).toContain(requestedProvider);
            } finally {
              stderrSpy.mockRestore();
              exitSpy.mockRestore();
            }
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  // Feature: pai-cli-tool, Property 19: Invalid Parameter Rejection
  describe('Property 19: Invalid Parameter Rejection', () => {
    it('should reject invalid temperature values', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.double({ min: -10, max: -0.01 }), // Negative temperature
            fc.double({ min: 2.01, max: 10 }), // Temperature > 2
            fc.constant(NaN),
            fc.constant(Infinity),
            fc.constant(-Infinity)
          ),
          async (invalidTemp) => {
            const stderrWrites: string[] = [];
            const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
              stderrWrites.push(String(chunk));
              return true;
            });
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

            try {
              const config = {
                schema_version: '1.0.0',
                providers: [{ name: 'test-provider', apiKey: 'test-key' }],
              };
              await writeFile(configPath, JSON.stringify(config), 'utf-8');

              await handleChatCommand('test', {
                config: configPath,
                provider: 'test-provider',
                temperature: invalidTemp,
              });

              // Property: Should exit with code 1 for invalid parameters
              expect(exitSpy).toHaveBeenCalledWith(1);
              
              // Property: Error message should be written to stderr
              const allErrors = stderrWrites.join('');
              expect(allErrors.length).toBeGreaterThan(0);
            } finally {
              stderrSpy.mockRestore();
              exitSpy.mockRestore();
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should reject invalid maxTokens values', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.integer({ min: -1000, max: -1 }), // Negative maxTokens
            fc.constant(0), // Zero maxTokens
            fc.constant(NaN)
          ),
          async (invalidMaxTokens) => {
            const stderrWrites: string[] = [];
            const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
              stderrWrites.push(String(chunk));
              return true;
            });
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

            try {
              const config = {
                schema_version: '1.0.0',
                providers: [{ name: 'test-provider', apiKey: 'test-key' }],
              };
              await writeFile(configPath, JSON.stringify(config), 'utf-8');

              await handleChatCommand('test', {
                config: configPath,
                provider: 'test-provider',
                maxTokens: invalidMaxTokens,
              });

              // Property: Should exit with code 1 for invalid parameters
              expect(exitSpy).toHaveBeenCalledWith(1);
              
              // Property: Error message should be written to stderr
              const allErrors = stderrWrites.join('');
              expect(allErrors.length).toBeGreaterThan(0);
            } finally {
              stderrSpy.mockRestore();
              exitSpy.mockRestore();
            }
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});
