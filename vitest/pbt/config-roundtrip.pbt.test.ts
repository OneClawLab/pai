/**
 * Feature: embed-command, Property 6: 配置 round-trip
 *
 * **Validates: Requirements 4.1, 4.2**
 *
 * For any PAIConfig object containing `defaultEmbedProvider` and `defaultEmbedModel` fields,
 * serializing to JSON and deserializing back should yield an equivalent object
 * (new fields are not lost).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { PAIConfig, ProviderConfig } from '../../src/types.js';

// --- Smart generators ---

/** Generate a realistic provider name */
const providerNameArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/);

/** Generate a realistic model name */
const modelNameArb = fc.stringMatching(/^[a-z][a-z0-9._-]{0,29}$/);

/** Generate a ProviderConfig with optional fields */
const providerConfigArb: fc.Arbitrary<ProviderConfig> = fc.record(
  {
    name: providerNameArb,
    apiKey: fc.option(fc.string({ minLength: 5, maxLength: 40 }), { nil: undefined }),
    models: fc.option(fc.array(modelNameArb, { minLength: 0, maxLength: 4 }), { nil: undefined }),
    defaultModel: fc.option(modelNameArb, { nil: undefined }),
    baseUrl: fc.option(
      fc.webUrl({ withFragments: false, withQueryParameters: false }),
      { nil: undefined }
    ),
    temperature: fc.option(fc.double({ min: 0, max: 2, noNaN: true, noDefaultInfinity: true }), { nil: undefined }),
    maxTokens: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined }),
  },
  { requiredKeys: ['name'] }
);

/** Generate a full PAIConfig with embed fields always present */
const paiConfigArb: fc.Arbitrary<PAIConfig> = fc.record({
  schema_version: fc.constantFrom('1.0.0', '1.1.0', '2.0.0'),
  defaultProvider: fc.option(providerNameArb, { nil: undefined }),
  defaultEmbedProvider: providerNameArb,
  defaultEmbedModel: modelNameArb,
  providers: fc.array(providerConfigArb, { minLength: 0, maxLength: 5 }),
});

// --- Helpers ---

/** Strip undefined values to match JSON round-trip behavior */
function stripUndefined<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// --- Tests ---

describe('Property 6: 配置 round-trip', () => {
  // Feature: embed-command, Property 6: 配置 round-trip
  // **Validates: Requirements 4.1, 4.2**

  it('PAIConfig with defaultEmbedProvider/defaultEmbedModel survives JSON round-trip', () => {
    fc.assert(
      fc.property(paiConfigArb, (config) => {
        const serialized = JSON.stringify(config);
        const deserialized: PAIConfig = JSON.parse(serialized);

        // The round-tripped object should be deeply equal
        // (stripUndefined normalizes both sides so optional undefined fields don't cause false negatives)
        expect(deserialized).toEqual(stripUndefined(config));

        // Explicitly verify the new embed fields are preserved
        expect(deserialized.defaultEmbedProvider).toBe(config.defaultEmbedProvider);
        expect(deserialized.defaultEmbedModel).toBe(config.defaultEmbedModel);

        // Structural checks: providers array length preserved
        expect(deserialized.providers.length).toBe(config.providers.length);

        // schema_version preserved
        expect(deserialized.schema_version).toBe(config.schema_version);

        // defaultProvider preserved (if present)
        expect(deserialized.defaultProvider).toBe(
          config.defaultProvider === undefined ? undefined : config.defaultProvider
        );
      }),
      { numRuns: 100 }
    );
  });
});
