import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleModelList, handleModelConfig, handleModelDefault, handleModelLogin } from '../../src/commands/model.js';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as fc from 'fast-check';

// Mock @mariozechner/pi-ai/oauth for OAuth login tests
vi.mock('@mariozechner/pi-ai/oauth', () => ({
  getOAuthProviders: vi.fn(),
  getOAuthProvider: vi.fn(),
}));

// Mock node:readline for OAuth login tests
vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((_msg: string, cb: (answer: string) => void) => cb('test-input')),
    close: vi.fn(),
  })),
}));

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

  describe('handleModelDefault', () => {
    it('should show current defaults including embed settings', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'openai',
        defaultEmbedProvider: 'openai',
        defaultEmbedModel: 'text-embedding-3-small',
        providers: [{ name: 'openai' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      await handleModelDefault({ config: configPath });

      const output = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(output).toContain('Default provider: openai');
      expect(output).toContain('Default embed:');
      expect(output).toContain('provider: openai');
      expect(output).toContain('model: text-embedding-3-small');
    });

    it('should show JSON output with embed fields', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'openai',
        defaultEmbedProvider: 'openai',
        defaultEmbedModel: 'text-embedding-3-small',
        providers: [{ name: 'openai' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      await handleModelDefault({ config: configPath, json: true });

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(output.defaultProvider).toBe('openai');
      expect(output.defaultEmbedProvider).toBe('openai');
      expect(output.defaultEmbedModel).toBe('text-embedding-3-small');
    });

    it('should show null for embed fields in JSON when not configured', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'openai',
        providers: [{ name: 'openai' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      await handleModelDefault({ config: configPath, json: true });

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(output.defaultProvider).toBe('openai');
      expect(output.defaultEmbedProvider).toBeNull();
      expect(output.defaultEmbedModel).toBeNull();
    });

    it('should set embed provider and model', async () => {
      const config = {
        schema_version: '1.0.0',
        providers: [{ name: 'openai' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      await handleModelDefault({
        config: configPath,
        embedProvider: 'openai',
        embedModel: 'text-embedding-3-small',
      });

      const output = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(output).toContain('Default embed provider set to "openai"');
      expect(output).toContain('Default embed model set to "text-embedding-3-small"');

      // Verify persisted
      const savedConfig = JSON.parse(await readFile(configPath, 'utf-8'));
      expect(savedConfig.defaultEmbedProvider).toBe('openai');
      expect(savedConfig.defaultEmbedModel).toBe('text-embedding-3-small');
    });

    it('should set embed provider only', async () => {
      const config = {
        schema_version: '1.0.0',
        providers: [{ name: 'openai' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      await handleModelDefault({
        config: configPath,
        embedProvider: 'openai',
      });

      const savedConfig = JSON.parse(await readFile(configPath, 'utf-8'));
      expect(savedConfig.defaultEmbedProvider).toBe('openai');
      expect(savedConfig.defaultEmbedModel).toBeUndefined();
    });

    it('should set embed model only', async () => {
      const config = {
        schema_version: '1.0.0',
        providers: [{ name: 'openai' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      await handleModelDefault({
        config: configPath,
        embedModel: 'text-embedding-3-small',
      });

      const savedConfig = JSON.parse(await readFile(configPath, 'utf-8'));
      expect(savedConfig.defaultEmbedModel).toBe('text-embedding-3-small');
    });

    it('should set both default provider and embed settings simultaneously', async () => {
      const config = {
        schema_version: '1.0.0',
        providers: [{ name: 'openai' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      await handleModelDefault({
        config: configPath,
        name: 'openai',
        embedProvider: 'openai',
        embedModel: 'text-embedding-3-small',
      });

      const savedConfig = JSON.parse(await readFile(configPath, 'utf-8'));
      expect(savedConfig.defaultProvider).toBe('openai');
      expect(savedConfig.defaultEmbedProvider).toBe('openai');
      expect(savedConfig.defaultEmbedModel).toBe('text-embedding-3-small');
    });

    it('should error when setting embed provider that does not exist', async () => {
      const config = {
        schema_version: '1.0.0',
        providers: [{ name: 'openai' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      await handleModelDefault({
        config: configPath,
        embedProvider: 'nonexistent',
      });

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Provider not found: nonexistent')
      );
    });

    it('should not show embed line when no embed defaults configured', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultProvider: 'openai',
        providers: [{ name: 'openai' }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      await handleModelDefault({ config: configPath });

      const output = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(output).toContain('Default provider: openai');
      expect(output).not.toContain('Default embed');
    });
  });

  describe('handleModelList - embed defaults', () => {
    it('should display embed defaults in human-readable output', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultEmbedProvider: 'openai',
        defaultEmbedModel: 'text-embedding-3-small',
        providers: [{ name: 'openai', models: ['gpt-4'] }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      await handleModelList({ config: configPath });

      const output = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(output).toContain('Default Embed: openai/text-embedding-3-small');
    });

    it('should include embed defaults in JSON output', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultEmbedProvider: 'openai',
        defaultEmbedModel: 'text-embedding-3-small',
        providers: [{ name: 'openai', models: ['gpt-4'] }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      await handleModelList({ config: configPath, json: true });

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(output.defaultEmbedProvider).toBe('openai');
      expect(output.defaultEmbedModel).toBe('text-embedding-3-small');
      expect(output.providers).toBeDefined();
    });

    it('should show null for embed fields in JSON when not configured', async () => {
      const config = {
        schema_version: '1.0.0',
        providers: [{ name: 'openai', models: ['gpt-4'] }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      await handleModelList({ config: configPath, json: true });

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(output.defaultEmbedProvider).toBeNull();
      expect(output.defaultEmbedModel).toBeNull();
    });

    it('should not show embed line when no embed defaults configured', async () => {
      const config = {
        schema_version: '1.0.0',
        providers: [{ name: 'openai', models: ['gpt-4'] }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      await handleModelList({ config: configPath });

      const output = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(output).not.toContain('Default Embed');
    });

    it('should include embed defaults in JSON output with --all flag', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultEmbedProvider: 'openai',
        defaultEmbedModel: 'text-embedding-3-small',
        providers: [],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      await handleModelList({ config: configPath, json: true, all: true });

      const output = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(output.defaultEmbedProvider).toBe('openai');
      expect(output.defaultEmbedModel).toBe('text-embedding-3-small');
      expect(output.providers).toBeDefined();
    });

    it('should show embed defaults in human-readable output with --all flag', async () => {
      const config = {
        schema_version: '1.0.0',
        defaultEmbedProvider: 'openai',
        defaultEmbedModel: 'text-embedding-3-small',
        providers: [],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      await handleModelList({ config: configPath, all: true });

      const output = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(output).toContain('Default Embed: openai/text-embedding-3-small');
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

  describe('handleModelLogin', () => {
    let mockGetOAuthProvider: any;
    let mockGetOAuthProviders: any;

    beforeEach(async () => {
      const oauthModule = await import('@mariozechner/pi-ai/oauth');
      mockGetOAuthProvider = vi.mocked(oauthModule.getOAuthProvider);
      mockGetOAuthProviders = vi.mocked(oauthModule.getOAuthProviders);
    });

    afterEach(() => {
      mockGetOAuthProvider.mockReset();
      mockGetOAuthProviders.mockReset();
    });

    it('should error when --name is missing', async () => {
      await handleModelLogin({ config: configPath });

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Provider name is required')
      );
    });

    it('should error for non-OAuth provider', async () => {
      mockGetOAuthProviders.mockReturnValue([{ id: 'github-copilot', name: 'GitHub Copilot' }]);
      mockGetOAuthProvider.mockReturnValue(null);

      await handleModelLogin({ config: configPath, name: 'openai' });

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('does not support OAuth login')
      );
    });

    it('should login successfully and save credentials to config', async () => {
      const mockCredentials = {
        refresh: 'refresh-token-123',
        access: 'access-token-456',
        expires: Date.now() + 3600000,
      };

      mockGetOAuthProviders.mockReturnValue([{ id: 'github-copilot', name: 'GitHub Copilot' }]);
      mockGetOAuthProvider.mockReturnValue({
        name: 'GitHub Copilot',
        login: vi.fn().mockResolvedValue(mockCredentials),
      });

      await handleModelLogin({ config: configPath, name: 'github-copilot' });

      // Should not have exited with error
      expect(processExitSpy).not.toHaveBeenCalled();

      // Verify credentials saved to config file
      const savedConfig = JSON.parse(await readFile(configPath, 'utf-8'));
      const provider = savedConfig.providers.find((p: any) => p.name === 'github-copilot');
      expect(provider).toBeDefined();
      expect(provider.oauth.refresh).toBe('refresh-token-123');
      expect(provider.oauth.access).toBe('access-token-456');
      expect(provider.oauth.expires).toBe(mockCredentials.expires);
    });

    it('should merge OAuth credentials into existing provider config', async () => {
      // Pre-existing provider config
      const config = {
        schema_version: '1.0.0',
        providers: [
          { name: 'github-copilot', defaultModel: 'gpt-4o', models: ['gpt-4o'] },
        ],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const mockCredentials = {
        refresh: 'new-refresh',
        access: 'new-access',
        expires: Date.now() + 7200000,
      };

      mockGetOAuthProviders.mockReturnValue([{ id: 'github-copilot', name: 'GitHub Copilot' }]);
      mockGetOAuthProvider.mockReturnValue({
        name: 'GitHub Copilot',
        login: vi.fn().mockResolvedValue(mockCredentials),
      });

      await handleModelLogin({ config: configPath, name: 'github-copilot' });

      const savedConfig = JSON.parse(await readFile(configPath, 'utf-8'));
      const provider = savedConfig.providers.find((p: any) => p.name === 'github-copilot');

      // Existing fields preserved
      expect(provider.defaultModel).toBe('gpt-4o');
      expect(provider.models).toEqual(['gpt-4o']);
      // OAuth credentials added
      expect(provider.oauth.refresh).toBe('new-refresh');
      expect(provider.oauth.access).toBe('new-access');
    });

    it('should store extra credential fields from OAuth provider', async () => {
      const mockCredentials = {
        refresh: 'r-token',
        access: 'a-token',
        expires: Date.now() + 3600000,
        enterpriseUrl: 'https://github.example.com',
        accountId: 'acc-123',
      };

      mockGetOAuthProviders.mockReturnValue([{ id: 'github-copilot', name: 'GitHub Copilot' }]);
      mockGetOAuthProvider.mockReturnValue({
        name: 'GitHub Copilot',
        login: vi.fn().mockResolvedValue(mockCredentials),
      });

      await handleModelLogin({ config: configPath, name: 'github-copilot' });

      const savedConfig = JSON.parse(await readFile(configPath, 'utf-8'));
      const provider = savedConfig.providers.find((p: any) => p.name === 'github-copilot');

      expect(provider.oauth.enterpriseUrl).toBe('https://github.example.com');
      expect(provider.oauth.accountId).toBe('acc-123');
    });

    it('should call login with onAuth, onPrompt, onProgress callbacks', async () => {
      const loginFn = vi.fn().mockResolvedValue({
        refresh: 'r', access: 'a', expires: Date.now() + 3600000,
      });

      mockGetOAuthProviders.mockReturnValue([{ id: 'test-oauth', name: 'Test OAuth' }]);
      mockGetOAuthProvider.mockReturnValue({
        name: 'Test OAuth',
        login: loginFn,
      });

      await handleModelLogin({ config: configPath, name: 'test-oauth' });

      expect(loginFn).toHaveBeenCalledTimes(1);
      const callArgs = loginFn.mock.calls[0]![0];
      expect(callArgs).toHaveProperty('onAuth');
      expect(callArgs).toHaveProperty('onPrompt');
      expect(callArgs).toHaveProperty('onProgress');
      expect(typeof callArgs.onAuth).toBe('function');
      expect(typeof callArgs.onPrompt).toBe('function');
      expect(typeof callArgs.onProgress).toBe('function');
    });
  });

  describe('resolveOAuthCredentials (via ConfigurationManager)', () => {
    it('should use access token when not expired', async () => {
      const { ConfigurationManager } = await import('../../src/config-manager.js');

      const config = {
        schema_version: '1.0.0',
        providers: [{
          name: 'github-copilot',
          oauth: {
            refresh: 'r-token',
            access: 'a-token',
            expires: Date.now() + 3600000, // 1 hour from now
          },
        }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      // Mock getOAuthProvider to return a provider with getApiKey
      const oauthModule = await import('@mariozechner/pi-ai/oauth');
      vi.mocked(oauthModule.getOAuthProvider).mockReturnValue({
        name: 'GitHub Copilot',
        getApiKey: vi.fn().mockReturnValue('derived-api-key'),
      } as any);

      const cm = new ConfigurationManager({ config: configPath });
      const key = await cm.resolveCredentials('github-copilot');

      expect(key).toBe('derived-api-key');
    });

    it('should refresh expired token and save new credentials', async () => {
      const { ConfigurationManager } = await import('../../src/config-manager.js');

      const config = {
        schema_version: '1.0.0',
        providers: [{
          name: 'github-copilot',
          oauth: {
            refresh: 'old-refresh',
            access: 'expired-access',
            expires: Date.now() - 1000, // Already expired
          },
        }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      const oauthModule = await import('@mariozechner/pi-ai/oauth');
      vi.mocked(oauthModule.getOAuthProvider).mockReturnValue({
        name: 'GitHub Copilot',
        refreshToken: vi.fn().mockResolvedValue({
          refresh: 'new-refresh',
          access: 'new-access',
          expires: Date.now() + 3600000,
        }),
        getApiKey: vi.fn().mockReturnValue('refreshed-api-key'),
      } as any);

      const cm = new ConfigurationManager({ config: configPath });
      const key = await cm.resolveCredentials('github-copilot');

      expect(key).toBe('refreshed-api-key');

      // Verify new credentials were persisted
      const savedConfig = JSON.parse(await readFile(configPath, 'utf-8'));
      const provider = savedConfig.providers.find((p: any) => p.name === 'github-copilot');
      expect(provider.oauth.refresh).toBe('new-refresh');
      expect(provider.oauth.access).toBe('new-access');
    });

    it('should fall back to raw access token when getApiKey unavailable', async () => {
      const { ConfigurationManager } = await import('../../src/config-manager.js');

      const config = {
        schema_version: '1.0.0',
        providers: [{
          name: 'unknown-oauth',
          oauth: {
            refresh: 'r',
            access: 'raw-access-token',
            expires: Date.now() + 3600000,
          },
        }],
      };
      await writeFile(configPath, JSON.stringify(config), 'utf-8');

      // getOAuthProvider returns null — no provider-specific logic
      const oauthModule = await import('@mariozechner/pi-ai/oauth');
      vi.mocked(oauthModule.getOAuthProvider).mockReturnValue(undefined as any);

      const cm = new ConfigurationManager({ config: configPath });
      const key = await cm.resolveCredentials('unknown-oauth');

      expect(key).toBe('raw-access-token');
    });
  });
});
