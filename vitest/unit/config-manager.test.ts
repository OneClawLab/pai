import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigurationManager } from '../../src/config-manager.js';
import { PAIError } from '../../src/types.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as fc from 'fast-check';

describe('ConfigurationManager', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = await mkdtemp(join(tmpdir(), 'pai-test-'));
    configPath = join(tempDir, 'config.json');
  });

  afterEach(async () => {
    // Clean up temporary directory
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('loadConfig', () => {
    it('should return default config when file does not exist', async () => {
      const manager = new ConfigurationManager({ config: configPath });
      const config = await manager.loadConfig();

      expect(config).toHaveProperty('schema_version');
      expect(config.providers).toEqual([]);
    });

    it('should load valid config file', async () => {
      const testConfig = {
        schema_version: '1.0.0',
        defaultProvider: 'openai',
        providers: [
          {
            name: 'openai',
            apiKey: 'test-key',
            models: ['gpt-4'],
          },
        ],
      };

      await writeFile(configPath, JSON.stringify(testConfig), 'utf-8');

      const manager = new ConfigurationManager({ config: configPath });
      const config = await manager.loadConfig();

      expect(config).toEqual(testConfig);
    });

    it('should throw PAIError with exit code 4 for malformed JSON', async () => {
      await writeFile(configPath, '{ invalid json }', 'utf-8');

      const manager = new ConfigurationManager({ config: configPath });

      await expect(manager.loadConfig()).rejects.toThrow(PAIError);
      await expect(manager.loadConfig()).rejects.toMatchObject({
        exitCode: 4,
        message: expect.stringContaining('malformed'),
      });
    });

    it('should throw PAIError with exit code 4 for missing schema_version', async () => {
      await writeFile(
        configPath,
        JSON.stringify({ providers: [] }),
        'utf-8'
      );

      const manager = new ConfigurationManager({ config: configPath });

      await expect(manager.loadConfig()).rejects.toThrow(PAIError);
      await expect(manager.loadConfig()).rejects.toMatchObject({
        exitCode: 4,
        message: expect.stringContaining('schema_version'),
      });
    });
  });

  describe('malformed config handling', () => {
    it('should handle empty file', async () => {
      await writeFile(configPath, '', 'utf-8');

      const manager = new ConfigurationManager({ config: configPath });

      await expect(manager.loadConfig()).rejects.toThrow(PAIError);
      await expect(manager.loadConfig()).rejects.toMatchObject({
        exitCode: 4,
      });
    });

    it('should handle file with only whitespace', async () => {
      await writeFile(configPath, '   \n\t  ', 'utf-8');

      const manager = new ConfigurationManager({ config: configPath });

      await expect(manager.loadConfig()).rejects.toThrow(PAIError);
      await expect(manager.loadConfig()).rejects.toMatchObject({
        exitCode: 4,
      });
    });

    it('should handle incomplete JSON object', async () => {
      await writeFile(configPath, '{"schema_version": "1.0.0", "providers":', 'utf-8');

      const manager = new ConfigurationManager({ config: configPath });

      await expect(manager.loadConfig()).rejects.toThrow(PAIError);
      await expect(manager.loadConfig()).rejects.toMatchObject({
        exitCode: 4,
      });
    });

    it('should handle JSON with trailing comma', async () => {
      await writeFile(
        configPath,
        '{"schema_version": "1.0.0", "providers": [],}',
        'utf-8'
      );

      const manager = new ConfigurationManager({ config: configPath });

      await expect(manager.loadConfig()).rejects.toThrow(PAIError);
      await expect(manager.loadConfig()).rejects.toMatchObject({
        exitCode: 4,
      });
    });

    it('should handle JSON with single quotes instead of double quotes', async () => {
      await writeFile(
        configPath,
        "{'schema_version': '1.0.0', 'providers': []}",
        'utf-8'
      );

      const manager = new ConfigurationManager({ config: configPath });

      await expect(manager.loadConfig()).rejects.toThrow(PAIError);
      await expect(manager.loadConfig()).rejects.toMatchObject({
        exitCode: 4,
      });
    });

    it('should handle JSON with unquoted keys', async () => {
      await writeFile(
        configPath,
        '{schema_version: "1.0.0", providers: []}',
        'utf-8'
      );

      const manager = new ConfigurationManager({ config: configPath });

      await expect(manager.loadConfig()).rejects.toThrow(PAIError);
      await expect(manager.loadConfig()).rejects.toMatchObject({
        exitCode: 4,
      });
    });

    it('should handle JSON array instead of object', async () => {
      await writeFile(configPath, '[]', 'utf-8');

      const manager = new ConfigurationManager({ config: configPath });

      await expect(manager.loadConfig()).rejects.toThrow(PAIError);
      await expect(manager.loadConfig()).rejects.toMatchObject({
        exitCode: 4,
      });
    });

    it('should handle JSON string instead of object', async () => {
      await writeFile(configPath, '"not an object"', 'utf-8');

      const manager = new ConfigurationManager({ config: configPath });

      await expect(manager.loadConfig()).rejects.toThrow(PAIError);
      await expect(manager.loadConfig()).rejects.toMatchObject({
        exitCode: 4,
      });
    });

    it('should handle JSON number instead of object', async () => {
      await writeFile(configPath, '42', 'utf-8');

      const manager = new ConfigurationManager({ config: configPath });

      await expect(manager.loadConfig()).rejects.toThrow(PAIError);
      await expect(manager.loadConfig()).rejects.toMatchObject({
        exitCode: 4,
      });
    });

    it('should handle config with invalid provider structure', async () => {
      await writeFile(
        configPath,
        JSON.stringify({
          schema_version: '1.0.0',
          providers: 'not an array',
        }),
        'utf-8'
      );

      const manager = new ConfigurationManager({ config: configPath });

      await expect(manager.loadConfig()).rejects.toThrow(PAIError);
      await expect(manager.loadConfig()).rejects.toMatchObject({
        exitCode: 4,
      });
    });

    it('should handle config with null providers', async () => {
      await writeFile(
        configPath,
        JSON.stringify({
          schema_version: '1.0.0',
          providers: null,
        }),
        'utf-8'
      );

      const manager = new ConfigurationManager({ config: configPath });

      await expect(manager.loadConfig()).rejects.toThrow(PAIError);
      await expect(manager.loadConfig()).rejects.toMatchObject({
        exitCode: 4,
      });
    });

    it('should handle config with missing providers field', async () => {
      await writeFile(
        configPath,
        JSON.stringify({
          schema_version: '1.0.0',
        }),
        'utf-8'
      );

      const manager = new ConfigurationManager({ config: configPath });

      await expect(manager.loadConfig()).rejects.toThrow(PAIError);
      await expect(manager.loadConfig()).rejects.toMatchObject({
        exitCode: 4,
      });
    });

    it('should include file path in error context', async () => {
      await writeFile(configPath, '{ invalid }', 'utf-8');

      const manager = new ConfigurationManager({ config: configPath });

      try {
        await manager.loadConfig();
        expect(false).toBe(true); // Should not reach here
      } catch (error: any) {
        expect(error.context).toBeDefined();
        // Context is an object with path property
        expect(error.context.path).toBe(configPath);
      }
    });
  });

  describe('saveConfig', () => {
    it('should save config with schema_version', async () => {
      const manager = new ConfigurationManager({ config: configPath });
      const config = {
        schema_version: '1.0.0',
        providers: [{ name: 'test', apiKey: 'key' }],
      };

      await manager.saveConfig(config);

      const loaded = await manager.loadConfig();
      expect(loaded).toEqual(config);
    });

    it('should add schema_version if missing', async () => {
      const manager = new ConfigurationManager({ config: configPath });
      const config = {
        schema_version: '',
        providers: [{ name: 'test' }],
      };

      await manager.saveConfig(config);

      const loaded = await manager.loadConfig();
      expect(loaded.schema_version).toBeTruthy();
    });

    it('should create directory if it does not exist', async () => {
      const nestedPath = join(tempDir, 'nested', 'dir', 'config.json');
      const manager = new ConfigurationManager({ config: nestedPath });

      await manager.saveConfig({
        schema_version: '1.0.0',
        providers: [],
      });

      const loaded = await manager.loadConfig();
      expect(loaded.schema_version).toBe('1.0.0');
    });
  });

  describe('getProvider', () => {
    beforeEach(async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'openai',
        providers: [
          { name: 'openai', apiKey: 'key1' },
          { name: 'anthropic', apiKey: 'key2' },
        ],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');
    });

    it('should return provider by name', async () => {
      const manager = new ConfigurationManager({ config: configPath });
      const provider = await manager.getProvider('anthropic');

      expect(provider.name).toBe('anthropic');
      expect(provider.apiKey).toBe('key2');
    });

    it('should return default provider when no name specified', async () => {
      const manager = new ConfigurationManager({ config: configPath });
      const provider = await manager.getProvider();

      expect(provider.name).toBe('openai');
    });

    it('should throw PAIError with exit code 1 when provider not found', async () => {
      const manager = new ConfigurationManager({ config: configPath });

      await expect(manager.getProvider('nonexistent')).rejects.toThrow(
        PAIError
      );
      await expect(manager.getProvider('nonexistent')).rejects.toMatchObject({
        exitCode: 1,
      });
    });

    it('should throw PAIError with exit code 1 when no default provider', async () => {
      const config = {
        schema_version: '1.0.0',
        providers: [{ name: 'test' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const manager = new ConfigurationManager({ config: configPath });

      await expect(manager.getProvider()).rejects.toThrow(PAIError);
      await expect(manager.getProvider()).rejects.toMatchObject({
        exitCode: 1,
      });
    });
  });

  describe('addProvider', () => {
    it('should add new provider', async () => {
      const manager = new ConfigurationManager({ config: configPath });
      await manager.addProvider({ name: 'openai', apiKey: 'test-key' });

      const config = await manager.loadConfig();
      expect(config.providers).toHaveLength(1);
      expect(config.providers[0]?.name).toBe('openai');
    });

    it('should update existing provider', async () => {
      const manager = new ConfigurationManager({ config: configPath });
      await manager.addProvider({ name: 'openai', apiKey: 'key1' });
      await manager.addProvider({ name: 'openai', apiKey: 'key2' });

      const config = await manager.loadConfig();
      expect(config.providers).toHaveLength(1);
      expect(config.providers[0]?.apiKey).toBe('key2');
    });
  });

  describe('deleteProvider', () => {
    beforeEach(async () => {
      const manager = new ConfigurationManager({ config: configPath });
      await manager.addProvider({ name: 'openai', apiKey: 'key1' });
      await manager.addProvider({ name: 'anthropic', apiKey: 'key2' });
    });

    it('should delete existing provider', async () => {
      const manager = new ConfigurationManager({ config: configPath });
      await manager.deleteProvider('openai');

      const config = await manager.loadConfig();
      expect(config.providers).toHaveLength(1);
      expect(config.providers[0]?.name).toBe('anthropic');
    });

    it('should throw PAIError with exit code 1 when provider not found', async () => {
      const manager = new ConfigurationManager({ config: configPath });

      await expect(manager.deleteProvider('nonexistent')).rejects.toThrow(
        PAIError
      );
      await expect(
        manager.deleteProvider('nonexistent')
      ).rejects.toMatchObject({
        exitCode: 1,
      });
    });
  });

  describe('config path resolution', () => {
    it('should use --config flag when provided', () => {
      const manager = new ConfigurationManager({ config: '/custom/path.json' });
      expect(manager.getConfigPath()).toBe('/custom/path.json');
    });

    it('should use PAI_CONFIG env var when --config not provided', () => {
      const originalEnv = process.env.PAI_CONFIG;
      process.env.PAI_CONFIG = '/env/path.json';

      const manager = new ConfigurationManager({});
      expect(manager.getConfigPath()).toBe('/env/path.json');

      // Restore original env
      if (originalEnv) {
        process.env.PAI_CONFIG = originalEnv;
      } else {
        delete process.env.PAI_CONFIG;
      }
    });

    it('should use default path when no overrides', () => {
      const originalEnv = process.env.PAI_CONFIG;
      delete process.env.PAI_CONFIG;

      const manager = new ConfigurationManager({});
      const path = manager.getConfigPath();
      // Check path contains the expected segments (works on both Unix and Windows)
      expect(path).toContain('config');
      expect(path).toContain('pai');
      expect(path).toContain('default.json');

      // Restore original env
      if (originalEnv) {
        process.env.PAI_CONFIG = originalEnv;
      }
    });
  });

  describe('resolveCredentials', () => {
    it('should use CLI parameter when provided', async () => {
      const manager = new ConfigurationManager({ config: configPath });
      const creds = await manager.resolveCredentials('openai', 'cli-key');

      expect(creds).toBe('cli-key');
    });

    it('should use environment variable when CLI param not provided', async () => {
      const originalEnv = process.env.PAI_OPENAI_API_KEY;
      process.env.PAI_OPENAI_API_KEY = 'env-key';

      const manager = new ConfigurationManager({ config: configPath });
      const creds = await manager.resolveCredentials('openai');

      expect(creds).toBe('env-key');

      // Restore
      if (originalEnv) {
        process.env.PAI_OPENAI_API_KEY = originalEnv;
      } else {
        delete process.env.PAI_OPENAI_API_KEY;
      }
    });

    it('should use config file when CLI and env not provided', async () => {
      const config = {
        schema_version: '1.0.0',
        providers: [{ name: 'openai', apiKey: 'config-key' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const originalEnv = process.env.PAI_OPENAI_API_KEY;
      delete process.env.PAI_OPENAI_API_KEY;

      const manager = new ConfigurationManager({ config: configPath });
      const creds = await manager.resolveCredentials('openai');

      expect(creds).toBe('config-key');

      // Restore
      if (originalEnv) {
        process.env.PAI_OPENAI_API_KEY = originalEnv;
      }
    });

    it('should use auth.json when other sources not available', async () => {
      const authPath = join(tempDir, 'auth.json');
      const authData = {
        'github-copilot': {
          type: 'oauth',
          access: 'auth-token',
          expires: Date.now() + 10000,
        },
      };
      await writeFile(authPath, JSON.stringify(authData), 'utf-8');

      // Change working directory to tempDir for this test
      const originalCwd = process.cwd();
      process.chdir(tempDir);

      const manager = new ConfigurationManager({ config: configPath });
      const creds = await manager.resolveCredentials('github-copilot');

      expect(creds).toBe('auth-token');

      // Restore
      process.chdir(originalCwd);
    });

    it('should throw PAIError with exit code 1 when no credentials found', async () => {
      const originalEnv = process.env.PAI_OPENAI_API_KEY;
      delete process.env.PAI_OPENAI_API_KEY;

      const manager = new ConfigurationManager({ config: configPath });

      await expect(manager.resolveCredentials('openai')).rejects.toThrow(
        PAIError
      );
      await expect(manager.resolveCredentials('openai')).rejects.toMatchObject({
        exitCode: 1,
        message: expect.stringContaining('No credentials found'),
      });

      // Restore
      if (originalEnv) {
        process.env.PAI_OPENAI_API_KEY = originalEnv;
      }
    });

    it('should handle provider names with hyphens in env var', async () => {
      const originalEnv = process.env.PAI_GITHUB_COPILOT_API_KEY;
      process.env.PAI_GITHUB_COPILOT_API_KEY = 'env-key';

      const manager = new ConfigurationManager({ config: configPath });
      const creds = await manager.resolveCredentials('github-copilot');

      expect(creds).toBe('env-key');

      // Restore
      if (originalEnv) {
        process.env.PAI_GITHUB_COPILOT_API_KEY = originalEnv;
      } else {
        delete process.env.PAI_GITHUB_COPILOT_API_KEY;
      }
    });
  });
});

  // Property-Based Tests
  describe('Property-Based Tests', () => {
    // Feature: pai-cli-tool, Property 7: Config Path Resolution Priority
    it('should resolve config path with correct priority (--config > PAI_CONFIG > default)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            cliPath: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
            envPath: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
          }),
          async ({ cliPath, envPath }) => {
            // Save original env
            const originalEnv = process.env.PAI_CONFIG;
            
            try {
              // Set env if provided
              if (envPath) {
                process.env.PAI_CONFIG = envPath;
              } else {
                delete process.env.PAI_CONFIG;
              }

              const manager = new ConfigurationManager(
                cliPath ? { config: cliPath } : {}
              );
              const resolvedPath = manager.getConfigPath();

              // Verify priority
              if (cliPath) {
                expect(resolvedPath).toBe(cliPath);
              } else if (envPath) {
                expect(resolvedPath).toBe(envPath);
              } else {
                // Should use default path
                expect(resolvedPath).toContain('config');
                expect(resolvedPath).toContain('pai');
                expect(resolvedPath).toContain('default.json');
              }
            } finally {
              // Restore env
              if (originalEnv) {
                process.env.PAI_CONFIG = originalEnv;
              } else {
                delete process.env.PAI_CONFIG;
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    // Feature: pai-cli-tool, Property 8: Config Schema Version Invariant
    it('should always include schema_version in saved configs', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            defaultProvider: fc.option(fc.string(), { nil: undefined }),
            providers: fc.array(
              fc.record({
                name: fc.string({ minLength: 1 }),
                apiKey: fc.option(fc.string(), { nil: undefined }),
                models: fc.option(fc.array(fc.string()), { nil: undefined }),
                defaultModel: fc.option(fc.string(), { nil: undefined }),
              }),
              { maxLength: 5 }
            ),
          }),
          async (configData) => {
            const testDir = await mkdtemp(join(tmpdir(), 'pai-pbt-'));
            const testPath = join(testDir, 'config.json');

            try {
              const manager = new ConfigurationManager({ config: testPath });
              
              // Save config (may or may not have schema_version)
              await manager.saveConfig({
                schema_version: '', // Empty or missing
                ...configData,
              });

              // Load it back
              const loaded = await manager.loadConfig();

              // Property: schema_version must always be present and non-empty
              expect(loaded).toHaveProperty('schema_version');
              expect(loaded.schema_version).toBeTruthy();
              expect(typeof loaded.schema_version).toBe('string');
            } finally {
              await rm(testDir, { recursive: true, force: true });
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    // Feature: pai-cli-tool, Property 3: Configuration Persistence Round-Trip
    it('should preserve all config details through save/load round-trip', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }),
            apiKey: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
            models: fc.option(
              fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 3 }),
              { nil: undefined }
            ),
            defaultModel: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
            temperature: fc.option(fc.double({ min: 0, max: 2, noNaN: true }), { nil: undefined }),
            maxTokens: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: undefined }),
          }),
          async (providerConfig) => {
            const testDir = await mkdtemp(join(tmpdir(), 'pai-pbt-'));
            const testPath = join(testDir, 'config.json');

            try {
              const manager = new ConfigurationManager({ config: testPath });

              // Add provider
              await manager.addProvider(providerConfig);

              // Load config back
              const loaded = await manager.loadConfig();
              const loadedProvider = loaded.providers.find(
                (p) => p.name === providerConfig.name
              );

              // Property: All specified details must be preserved
              expect(loadedProvider).toBeDefined();
              expect(loadedProvider?.name).toBe(providerConfig.name);
              
              if (providerConfig.apiKey !== undefined) {
                expect(loadedProvider?.apiKey).toBe(providerConfig.apiKey);
              }
              
              if (providerConfig.models !== undefined) {
                expect(loadedProvider?.models).toEqual(providerConfig.models);
              }
              
              if (providerConfig.defaultModel !== undefined) {
                expect(loadedProvider?.defaultModel).toBe(providerConfig.defaultModel);
              }
              
              if (providerConfig.temperature !== undefined) {
                expect(loadedProvider?.temperature).toBe(providerConfig.temperature);
              }
              
              if (providerConfig.maxTokens !== undefined) {
                expect(loadedProvider?.maxTokens).toBe(providerConfig.maxTokens);
              }
            } finally {
              await rm(testDir, { recursive: true, force: true });
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    // Feature: pai-cli-tool, Property 9: Credential Resolution Priority
    it('should resolve credentials with correct priority (CLI > env > config > auth.json)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            provider: fc.constantFrom('openai', 'anthropic', 'github-copilot'),
            cliKey: fc.option(fc.string({ minLength: 10 }), { nil: undefined }),
            envKey: fc.option(fc.string({ minLength: 10 }), { nil: undefined }),
            configKey: fc.option(fc.string({ minLength: 10 }), { nil: undefined }),
          }),
          async ({ provider, cliKey, envKey, configKey }) => {
            const testDir = await mkdtemp(join(tmpdir(), 'pai-pbt-'));
            const testPath = join(testDir, 'config.json');

            // Save original env
            const envVarName = `PAI_${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
            const originalEnv = process.env[envVarName];

            try {
              // Set up config file if configKey provided
              if (configKey) {
                const config = {
                  schema_version: '1.0.0',
                  providers: [{ name: provider, apiKey: configKey }],
                };
                await writeFile(testPath, JSON.stringify(config), 'utf-8');
              }

              // Set env var if envKey provided
              if (envKey) {
                process.env[envVarName] = envKey;
              } else {
                delete process.env[envVarName];
              }

              const manager = new ConfigurationManager({ config: testPath });

              // Property: Priority should be CLI > env > config
              if (cliKey || envKey || configKey) {
                const resolved = await manager.resolveCredentials(provider, cliKey);

                if (cliKey) {
                  expect(resolved).toBe(cliKey);
                } else if (envKey) {
                  expect(resolved).toBe(envKey);
                } else if (configKey) {
                  expect(resolved).toBe(configKey);
                }
              }
            } finally {
              // Restore env
              if (originalEnv) {
                process.env[envVarName] = originalEnv;
              } else {
                delete process.env[envVarName];
              }
              await rm(testDir, { recursive: true, force: true });
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    // Feature: pai-cli-tool, Property 10: Sensitive Data Exclusion
    it('should not expose API keys or tokens in error messages', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 20, maxLength: 50 }), // Simulate API key
          async (apiKey) => {
            const testDir = await mkdtemp(join(tmpdir(), 'pai-pbt-'));
            const testPath = join(testDir, 'config.json');

            try {
              const config = {
                schema_version: '1.0.0',
                providers: [{ name: 'test-provider', apiKey }],
              };
              await writeFile(testPath, JSON.stringify(config), 'utf-8');

              const manager = new ConfigurationManager({ config: testPath });

              // Try to get non-existent provider - should error without exposing keys
              try {
                await manager.getProvider('nonexistent');
                // Should not reach here
                expect(false).toBe(true);
              } catch (error: any) {
                // Property: Error message should NOT contain the API key
                expect(error.message).not.toContain(apiKey);
                if (error.context) {
                  const contextStr = JSON.stringify(error.context);
                  expect(contextStr).not.toContain(apiKey);
                }
              }
            } finally {
              await rm(testDir, { recursive: true, force: true });
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });
