import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { PAIConfig, ProviderConfig } from '../../src/lib/types.js';
import { PAIError, ExitCode } from '../../src/lib/types.js';
import { resolveProvider } from '../../src/lib/config.js';

// ============================================================================
// Generators for fast-check
// ============================================================================

/**
 * Generate random provider names (valid format)
 */
const providerNameArb = fc.stringMatching(/^[a-z][a-z0-9-]*$/);

/**
 * Generate random ProviderConfig objects
 */
const providerConfigArb = fc.record({
  name: providerNameArb,
  apiKey: fc.option(fc.string({ minLength: 10, maxLength: 50 }), { nil: undefined }),
  models: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }), { nil: undefined }),
  defaultModel: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  temperature: fc.option(fc.float({ min: 0, max: 2 }), { nil: undefined }),
  maxTokens: fc.option(fc.integer({ min: 100, max: 4000 }), { nil: undefined }),
  api: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  baseUrl: fc.option(fc.webUrl(), { nil: undefined }),
  reasoning: fc.option(fc.boolean(), { nil: undefined }),
  contextWindow: fc.option(fc.integer({ min: 1000, max: 100000 }), { nil: undefined }),
  providerOptions: fc.option(fc.record({ key: fc.string() }), { nil: undefined }),
});

/**
 * Generate random PAIConfig objects with a list of providers
 */
const paiConfigArb = fc.record({
  schema_version: fc.constant('1.0.0'),
  defaultProvider: fc.option(providerNameArb, { nil: undefined }),
  defaultEmbedProvider: fc.option(providerNameArb, { nil: undefined }),
  defaultEmbedModel: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  providers: fc.array(providerConfigArb, { minLength: 0, maxLength: 10 }),
});

// ============================================================================
// Property Tests
// ============================================================================

describe('resolveProvider() - Property-Based Tests', () => {
  // ========================================================================
  // Property 6: resolveProvider 对不存在的 provider throw PAIError
  // ========================================================================

  it('Property 6: resolveProvider 对不存在的 provider throw PAIError - should throw PAIError when provider does not exist', async () => {
    await fc.assert(
      fc.asyncProperty(paiConfigArb, providerNameArb, async (config, nonExistentProviderName) => {
        // Cast to PAIConfig (fast-check generates compatible structure)
        const paiConfig = config as PAIConfig;

        // Ensure the provider name does NOT exist in the config
        const existingNames = new Set(paiConfig.providers.map(p => p.name));
        let testProviderName: string = nonExistentProviderName;

        // Keep generating until we find a name that doesn't exist
        let attempts = 0;
        while (existingNames.has(testProviderName) && attempts < 100) {
          const samples = fc.sample(providerNameArb, 1);
          testProviderName = samples[0] ?? nonExistentProviderName;
          attempts++;
        }

        // Skip if we couldn't find a non-existent provider name
        if (existingNames.has(testProviderName)) {
          return;
        }

        // Call resolveProvider with non-existent provider name
        let errorThrown: Error | undefined;
        try {
          await resolveProvider(paiConfig, testProviderName);
        } catch (err) {
          errorThrown = err as Error;
        }

        // Verify that PAIError was thrown
        expect(errorThrown).toBeDefined();
        expect(errorThrown).toBeInstanceOf(PAIError);

        if (errorThrown instanceof PAIError) {
          // Verify the error has the correct exitCode (PARAMETER_ERROR = 1)
          expect(errorThrown.exitCode).toBe(1 as ExitCode);
          // Verify error message mentions the provider name
          expect(errorThrown.message).toContain(testProviderName);
        }
      }),
      { numRuns: 50 },
    );
  });

  // Validates: Requirements 6.4, 6.6

  // ========================================================================
  // Additional Property Tests
  // ========================================================================

  it('Property: resolveProvider with existing provider should not throw', async () => {
    await fc.assert(
      fc.asyncProperty(paiConfigArb, async (config) => {
        const paiConfig = config as PAIConfig;

        // Skip if no providers exist
        if (paiConfig.providers.length === 0) {
          return;
        }

        // Pick the first existing provider
        const existingProvider = paiConfig.providers[0];
        if (!existingProvider) {
          return;
        }

        const providerName = existingProvider.name;

        // Set an API key to avoid credential resolution errors
        const configWithKey: PAIConfig = {
          ...paiConfig,
          providers: paiConfig.providers.map(p =>
            p.name === providerName ? { ...p, apiKey: 'test-key-12345' } : p
          ),
        };

        // Call resolveProvider with existing provider name
        let errorThrown: Error | undefined;
        let result: { provider: ProviderConfig; apiKey: string } | undefined;

        try {
          result = await resolveProvider(configWithKey, providerName);
        } catch (err) {
          errorThrown = err as Error;
        }

        // Verify no error was thrown (or only credential-related errors)
        if (errorThrown) {
          // Only credential errors are acceptable
          expect(errorThrown).toBeInstanceOf(PAIError);
          if (errorThrown instanceof PAIError) {
            expect(errorThrown.message).toContain('credentials');
          }
        } else {
          // Verify result structure
          expect(result).toBeDefined();
          expect(result?.provider).toBeDefined();
          expect(result?.provider.name).toBe(providerName);
          expect(result?.apiKey).toBeDefined();
        }
      }),
      { numRuns: 30 },
    );
  });

  // Validates: Requirements 6.3

  it('Property: resolveProvider error always has exitCode = 1 for missing provider', async () => {
    await fc.assert(
      fc.asyncProperty(paiConfigArb, providerNameArb, async (config, nonExistentProviderName) => {
        const paiConfig = config as PAIConfig;

        // Ensure the provider name does NOT exist in the config
        const existingNames = new Set(paiConfig.providers.map(p => p.name));
        let testProviderName: string = nonExistentProviderName;

        let attempts = 0;
        while (existingNames.has(testProviderName) && attempts < 100) {
          const samples = fc.sample(providerNameArb, 1);
          testProviderName = samples[0] ?? nonExistentProviderName;
          attempts++;
        }

        if (existingNames.has(testProviderName)) {
          return;
        }

        // Call resolveProvider with non-existent provider name
        let errorThrown: Error | undefined;
        try {
          await resolveProvider(paiConfig, testProviderName);
        } catch (err) {
          errorThrown = err as Error;
        }

        // Verify error is PAIError with exitCode = 1
        expect(errorThrown).toBeInstanceOf(PAIError);
        if (errorThrown instanceof PAIError) {
          expect(errorThrown.exitCode).toBe(1 as ExitCode);
        }
      }),
      { numRuns: 40 },
    );
  });

  // Validates: Requirements 6.6

  it('Property: resolveProvider with no provider specified and no default should throw', async () => {
    await fc.assert(
      fc.asyncProperty(paiConfigArb, async (config) => {
        // Create a config with no defaultProvider
        const configWithoutDefault: PAIConfig = {
          ...config,
          defaultProvider: undefined,
        } as unknown as PAIConfig;

        // Call resolveProvider without specifying a provider name
        let errorThrown: Error | undefined;
        try {
          await resolveProvider(configWithoutDefault);
        } catch (err) {
          errorThrown = err as Error;
        }

        // Verify that PAIError was thrown
        expect(errorThrown).toBeDefined();
        expect(errorThrown).toBeInstanceOf(PAIError);

        if (errorThrown instanceof PAIError) {
          // Verify the error has the correct exitCode (PARAMETER_ERROR = 1)
          expect(errorThrown.exitCode).toBe(1 as ExitCode);
        }
      }),
      { numRuns: 30 },
    );
  });

  // Validates: Requirements 6.4
});
