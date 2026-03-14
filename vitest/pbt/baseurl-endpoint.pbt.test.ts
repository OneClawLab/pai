/**
 * Feature: embed-command, Property 8: baseUrl 端点构建
 *
 * **Validates: Requirements 6.3**
 *
 * For any baseUrl string, EmbeddingClient's resolved API endpoint should be
 * `${baseUrl}/v1/embeddings`; when no baseUrl is provided, the provider's
 * default endpoint should be used.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { EmbeddingClient } from '../../src/embedding-client.js';
import { PAIError, ExitCode } from '../../src/types.js';

// --- Smart generators ---

/** Generate a valid base URL (scheme + host, optionally with path segments) */
const baseUrlArb = fc
  .tuple(
    fc.constantFrom('https://', 'http://'),
    fc.webUrl({ withFragments: false, withQueryParameters: false }),
  )
  .map(([_scheme, url]) => url);

/** Generate a base URL with trailing slashes to test stripping */
const baseUrlWithTrailingSlashesArb = baseUrlArb.chain((url) =>
  fc
    .integer({ min: 1, max: 5 })
    .map((n) => url.replace(/\/+$/, '') + '/'.repeat(n)),
);

/** Generate a provider name that is NOT 'openai' (i.e. has no default base URL) */
const unknownProviderArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => /^[a-zA-Z]/.test(s))
  .filter((s) => s !== 'openai');

// --- Tests ---

describe('Property 8: baseUrl 端点构建', () => {
  // Feature: embed-command, Property 8: baseUrl 端点构建
  // **Validates: Requirements 6.3**

  it('with any baseUrl, endpoint is always ${baseUrl}/v1/embeddings (trailing slashes stripped)', () => {
    fc.assert(
      fc.property(baseUrlArb, (baseUrl) => {
        const endpoint = EmbeddingClient.resolveEndpoint('any-provider', baseUrl);
        const expected = `${baseUrl.replace(/\/+$/, '')}/v1/embeddings`;
        expect(endpoint).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });

  it('trailing slashes on baseUrl are stripped before appending /v1/embeddings', () => {
    fc.assert(
      fc.property(baseUrlWithTrailingSlashesArb, (baseUrl) => {
        const endpoint = EmbeddingClient.resolveEndpoint('any-provider', baseUrl);
        // Should not contain double slashes between base and path
        const expected = `${baseUrl.replace(/\/+$/, '')}/v1/embeddings`;
        expect(endpoint).toBe(expected);
        // Endpoint must always end with /v1/embeddings
        expect(endpoint.endsWith('/v1/embeddings')).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('without baseUrl, openai provider uses default endpoint https://api.openai.com/v1/embeddings', () => {
    // This is a concrete property — the openai default is deterministic
    const endpoint = EmbeddingClient.resolveEndpoint('openai');
    expect(endpoint).toBe('https://api.openai.com/v1/embeddings');
  });

  it('without baseUrl and unknown provider, throws PAIError with PARAMETER_ERROR', () => {
    fc.assert(
      fc.property(unknownProviderArb, (provider) => {
        try {
          EmbeddingClient.resolveEndpoint(provider);
          // Should not reach here
          expect.unreachable('Expected PAIError to be thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(PAIError);
          expect((e as PAIError).exitCode).toBe(ExitCode.PARAMETER_ERROR);
        }
      }),
      { numRuns: 100 },
    );
  });
});
