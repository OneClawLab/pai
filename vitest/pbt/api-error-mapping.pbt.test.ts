/**
 * Feature: embed-command, Property 9: API 错误映射
 *
 * **Validates: Requirements 6.4**
 *
 * For any HTTP error response (status 4xx/5xx), EmbeddingClient should throw
 * PAIError with exitCode 3 (API_ERROR).
 *
 * Additionally, network errors (fetch throws) should produce PAIError with
 * exitCode 2 (RUNTIME_ERROR).
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { EmbeddingClient } from '../../src/embedding-client.js';
import { PAIError, ExitCode } from '../../src/types.js';

// --- Smart generators ---

/** Generate HTTP client error status codes (400-499) */
const clientErrorStatusArb = fc.integer({ min: 400, max: 499 });

/** Generate HTTP server error status codes (500-599) */
const serverErrorStatusArb = fc.integer({ min: 500, max: 599 });

/** Generate any HTTP error status code (400-599) */
const httpErrorStatusArb = fc.integer({ min: 400, max: 599 });

/** Generate a random error body string */
const errorBodyArb = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 1, maxLength: 200 }),
  fc.record({ error: fc.record({ message: fc.string() }) }).map((o) => JSON.stringify(o)),
);

/** Generate a random network error message */
const networkErrorArb = fc.oneof(
  fc.constant('fetch failed'),
  fc.constant('ECONNREFUSED'),
  fc.constant('ETIMEDOUT'),
  fc.constant('DNS lookup failed'),
  fc.string({ minLength: 1, maxLength: 100 }),
);

/** Generate a random non-empty texts array for the embed request */
const textsArb = fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 });

// --- Helpers ---

const originalFetch = globalThis.fetch;

function mockFetchWithStatus(status: number, body: string) {
  globalThis.fetch = (async () => ({
    ok: false,
    status,
    statusText: `Error ${status}`,
    text: async () => body,
    json: async () => {
      try { return JSON.parse(body); } catch { return {}; }
    },
  })) as unknown as typeof fetch;
}

function mockFetchRejection(errorMessage: string) {
  globalThis.fetch = (async () => {
    throw new Error(errorMessage);
  }) as unknown as typeof fetch;
}

// --- Tests ---

describe('Property 9: API 错误映射', () => {
  // Feature: embed-command, Property 9: API 错误映射
  // **Validates: Requirements 6.4**

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('any HTTP 4xx status throws PAIError with exitCode API_ERROR (3)', async () => {
    await fc.assert(
      fc.asyncProperty(clientErrorStatusArb, errorBodyArb, textsArb, async (status, body, texts) => {
        mockFetchWithStatus(status, body);

        const client = new EmbeddingClient({
          provider: 'openai',
          apiKey: 'sk-test',
          model: 'text-embedding-3-small',
        });

        try {
          await client.embed({ texts, model: 'text-embedding-3-small' });
          expect.unreachable('Expected PAIError to be thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(PAIError);
          expect((e as PAIError).exitCode).toBe(ExitCode.API_ERROR);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('any HTTP 5xx status throws PAIError with exitCode API_ERROR (3)', async () => {
    await fc.assert(
      fc.asyncProperty(serverErrorStatusArb, errorBodyArb, textsArb, async (status, body, texts) => {
        mockFetchWithStatus(status, body);

        const client = new EmbeddingClient({
          provider: 'openai',
          apiKey: 'sk-test',
          model: 'text-embedding-3-small',
        });

        try {
          await client.embed({ texts, model: 'text-embedding-3-small' });
          expect.unreachable('Expected PAIError to be thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(PAIError);
          expect((e as PAIError).exitCode).toBe(ExitCode.API_ERROR);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('any HTTP error status (400-599) includes the status code in the error', async () => {
    await fc.assert(
      fc.asyncProperty(httpErrorStatusArb, errorBodyArb, async (status, body) => {
        mockFetchWithStatus(status, body);

        const client = new EmbeddingClient({
          provider: 'openai',
          apiKey: 'sk-test',
          model: 'text-embedding-3-small',
        });

        try {
          await client.embed({ texts: ['test'], model: 'text-embedding-3-small' });
          expect.unreachable('Expected PAIError to be thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(PAIError);
          const err = e as PAIError;
          expect(err.exitCode).toBe(ExitCode.API_ERROR);
          expect(err.message).toContain(String(status));
        }
      }),
      { numRuns: 100 },
    );
  });

  it('network errors (fetch rejection) throw PAIError with exitCode RUNTIME_ERROR (2)', async () => {
    await fc.assert(
      fc.asyncProperty(networkErrorArb, textsArb, async (errorMsg, texts) => {
        mockFetchRejection(errorMsg);

        const client = new EmbeddingClient({
          provider: 'openai',
          apiKey: 'sk-test',
          model: 'text-embedding-3-small',
        });

        try {
          await client.embed({ texts, model: 'text-embedding-3-small' });
          expect.unreachable('Expected PAIError to be thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(PAIError);
          expect((e as PAIError).exitCode).toBe(ExitCode.RUNTIME_ERROR);
        }
      }),
      { numRuns: 100 },
    );
  });
});
