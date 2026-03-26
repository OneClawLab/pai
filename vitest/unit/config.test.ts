import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, resolveProvider } from '../../src/lib/config.js';
import { PAIError, ExitCode } from '../../src/lib/types.js';

describe('config.ts', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = join(tmpdir(), `pai-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    const fs = await import('node:fs/promises');
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('loadConfig()', () => {
    it('should return default config when file does not exist', async () => {
      const nonExistentPath = join(tempDir, 'nonexistent.json');
      const config = await loadConfig(nonExistentPath);

      expect(config).toEqual({
        schema_version: '1.0.0',
        providers: [],
      });
    });

    it('should read and parse valid config file', async () => {
      const configPath = join(tempDir, 'config.json');
      const validConfig = {
        schema_version: '1.0.0',
        defaultProvider: 'openai',
        providers: [
          {
            name: 'openai',
            apiKey: 'sk-test-key',
            models: ['gpt-4'],
            defaultModel: 'gpt-4',
          },
        ],
      };

      await writeFile(configPath, JSON.stringify(validConfig));
      const loaded = await loadConfig(configPath);

      expect(loaded).toEqual(validConfig);
      expect(loaded.defaultProvider).toBe('openai');
      expect(loaded.providers).toHaveLength(1);
      expect(loaded.providers[0]?.name).toBe('openai');
    });

    it('should throw PAIError when config file is malformed JSON', async () => {
      const configPath = join(tempDir, 'malformed.json');
      await writeFile(configPath, '{invalid json}');

      await expect(loadConfig(configPath)).rejects.toThrow(PAIError);
      try {
        await loadConfig(configPath);
      } catch (error) {
        expect(error).toBeInstanceOf(PAIError);
        if (error instanceof PAIError) {
          expect(error.exitCode).toBe(ExitCode.IO_ERROR);
          expect(error.message).toContain('malformed');
        }
      }
    });

    it('should throw PAIError when config file is missing schema_version', async () => {
      const configPath = join(tempDir, 'no-schema.json');
      const invalidConfig = {
        providers: [],
      };

      await writeFile(configPath, JSON.stringify(invalidConfig));

      await expect(loadConfig(configPath)).rejects.toThrow(PAIError);
      try {
        await loadConfig(configPath);
      } catch (error) {
        expect(error).toBeInstanceOf(PAIError);
        if (error instanceof PAIError) {
          expect(error.exitCode).toBe(ExitCode.IO_ERROR);
          expect(error.message).toContain('schema_version');
        }
      }
    });

    it('should throw PAIError when config file is missing providers field', async () => {
      const configPath = join(tempDir, 'no-providers.json');
      const invalidConfig = {
        schema_version: '1.0.0',
      };

      await writeFile(configPath, JSON.stringify(invalidConfig));

      await expect(loadConfig(configPath)).rejects.toThrow(PAIError);
      try {
        await loadConfig(configPath);
      } catch (error) {
        expect(error).toBeInstanceOf(PAIError);
        if (error instanceof PAIError) {
          expect(error.exitCode).toBe(ExitCode.IO_ERROR);
          expect(error.message).toContain('providers');
        }
      }
    });

    it('should throw PAIError when providers field is not an array', async () => {
      const configPath = join(tempDir, 'invalid-providers.json');
      const invalidConfig = {
        schema_version: '1.0.0',
        providers: 'not-an-array',
      };

      await writeFile(configPath, JSON.stringify(invalidConfig));

      await expect(loadConfig(configPath)).rejects.toThrow(PAIError);
      try {
        await loadConfig(configPath);
      } catch (error) {
        expect(error).toBeInstanceOf(PAIError);
        if (error instanceof PAIError) {
          expect(error.exitCode).toBe(ExitCode.IO_ERROR);
          expect(error.message).toContain('array');
        }
      }
    });
  });

  describe('resolveProvider()', () => {
    it('should resolve provider and apiKey from config', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'openai',
        providers: [
          {
            name: 'openai',
            apiKey: 'sk-test-key',
            models: ['gpt-4'],
          },
        ],
      };

      const result = await resolveProvider(config, 'openai');

      expect(result.provider.name).toBe('openai');
      expect(result.apiKey).toBe('sk-test-key');
    });

    it('should use default provider when providerName is not specified', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'openai',
        providers: [
          {
            name: 'openai',
            apiKey: 'sk-test-key',
          },
        ],
      };

      const result = await resolveProvider(config);

      expect(result.provider.name).toBe('openai');
      expect(result.apiKey).toBe('sk-test-key');
    });

    it('should throw PAIError when provider is not found', async () => {
      const config = {
        schema_version: '1.0.0',
        providers: [
          {
            name: 'openai',
            apiKey: 'sk-test-key',
          },
        ],
      };

      await expect(resolveProvider(config, 'nonexistent')).rejects.toThrow(PAIError);
      try {
        await resolveProvider(config, 'nonexistent');
      } catch (error) {
        expect(error).toBeInstanceOf(PAIError);
        if (error instanceof PAIError) {
          expect(error.exitCode).toBe(ExitCode.PARAMETER_ERROR);
          expect(error.message).toContain('not found');
          expect(error.message).toContain('nonexistent');
        }
      }
    });

    it('should throw PAIError when no provider is specified and no default provider is configured', async () => {
      const config = {
        schema_version: '1.0.0',
        providers: [
          {
            name: 'openai',
            apiKey: 'sk-test-key',
          },
        ],
      };

      await expect(resolveProvider(config)).rejects.toThrow(PAIError);
      try {
        await resolveProvider(config);
      } catch (error) {
        expect(error).toBeInstanceOf(PAIError);
        if (error instanceof PAIError) {
          expect(error.exitCode).toBe(ExitCode.PARAMETER_ERROR);
          expect(error.message).toContain('No provider specified');
        }
      }
    });

    it('should prioritize environment variable over config apiKey', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'openai',
        providers: [
          {
            name: 'openai',
            apiKey: 'sk-config-key',
          },
        ],
      };

      // Set environment variable
      const envVarName = 'PAI_OPENAI_API_KEY';
      const originalValue = process.env[envVarName];
      process.env[envVarName] = 'sk-env-key';

      try {
        const result = await resolveProvider(config, 'openai');
        expect(result.apiKey).toBe('sk-env-key');
      } finally {
        // Restore original environment variable
        if (originalValue !== undefined) {
          process.env[envVarName] = originalValue;
        } else {
          delete process.env[envVarName];
        }
      }
    });

    it('should throw PAIError when no credentials are found for provider', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'openai',
        providers: [
          {
            name: 'openai',
            // No apiKey, no oauth
          },
        ],
      };

      // Ensure environment variable is not set
      const envVarName = 'PAI_OPENAI_API_KEY';
      const originalValue = process.env[envVarName];
      delete process.env[envVarName];

      try {
        await expect(resolveProvider(config, 'openai')).rejects.toThrow(PAIError);
        try {
          await resolveProvider(config, 'openai');
        } catch (error) {
          expect(error).toBeInstanceOf(PAIError);
          if (error instanceof PAIError) {
            expect(error.exitCode).toBe(ExitCode.PARAMETER_ERROR);
            expect(error.message).toContain('No credentials found');
          }
        }
      } finally {
        // Restore original environment variable
        if (originalValue !== undefined) {
          process.env[envVarName] = originalValue;
        }
      }
    });

    it('should handle provider names with hyphens in environment variable', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'my-provider',
        providers: [
          {
            name: 'my-provider',
            apiKey: 'sk-config-key',
          },
        ],
      };

      // Set environment variable with underscores (hyphens converted to underscores)
      const envVarName = 'PAI_MY_PROVIDER_API_KEY';
      const originalValue = process.env[envVarName];
      process.env[envVarName] = 'sk-env-key';

      try {
        const result = await resolveProvider(config, 'my-provider');
        expect(result.apiKey).toBe('sk-env-key');
      } finally {
        // Restore original environment variable
        if (originalValue !== undefined) {
          process.env[envVarName] = originalValue;
        } else {
          delete process.env[envVarName];
        }
      }
    });
  });
});
