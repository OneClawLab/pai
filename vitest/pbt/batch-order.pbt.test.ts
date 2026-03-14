/**
 * Feature: embed-command, Property 3: 批量结果顺序保持
 *
 * **Validates: Requirements 2.5**
 *
 * For any text array input, the i-th embedding vector in the batch output
 * should correspond to the i-th input text (output order matches input order).
 *
 * The EmbeddingClient.embed() method sorts response data by the `index` field,
 * so even if the API returns results out of order, they are re-ordered to match
 * the input order. This test verifies that property by mocking fetch to return
 * shuffled indices with unique/distinguishable embeddings per input.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { EmbeddingClient } from '../../src/embedding-client.js';
import type { EmbeddingRequest } from '../../src/embedding-client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fisher-Yates shuffle (returns a new array). */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Build a mock fetch that returns an OpenAI-compatible embedding response
 * with the `data` array shuffled (indices still correct, but order randomised).
 *
 * Each input text at position `i` gets a unique embedding: [i, i, i] so we
 * can verify the mapping after sorting.
 */
function buildMockFetch(texts: string[], seed: number) {
  // Deterministic-ish RNG from seed
  let s = seed | 0 || 1;
  const rng = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };

  // Build ordered data entries
  const ordered = texts.map((_, i) => ({
    object: 'embedding' as const,
    index: i,
    embedding: [i, i, i], // unique per position
  }));

  // Shuffle the data array (indices stay attached to their embeddings)
  const shuffled = shuffle(ordered, rng);

  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      object: 'list',
      data: shuffled,
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: texts.length, total_tokens: texts.length },
    }),
  } as unknown as Response);
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Non-empty array of non-empty strings (1–20 items). */
const textsArb = fc.array(fc.string({ minLength: 1, maxLength: 50 }), {
  minLength: 1,
  maxLength: 20,
});

/** Seed for shuffling. */
const seedArb = fc.integer({ min: 1, max: 2_000_000_000 });

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Property 3: 批量结果顺序保持', () => {
  // Feature: embed-command, Property 3: 批量结果顺序保持
  // **Validates: Requirements 2.5**

  it('output embeddings preserve input order regardless of API response order', async () => {
    const client = new EmbeddingClient({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'text-embedding-3-small',
    });

    await fc.assert(
      fc.asyncProperty(textsArb, seedArb, async (texts, seed) => {
        // Mock fetch with shuffled response
        globalThis.fetch = buildMockFetch(texts, seed);

        const request: EmbeddingRequest = {
          texts,
          model: 'text-embedding-3-small',
        };

        const result = await client.embed(request);

        // The number of embeddings must match the number of inputs
        expect(result.embeddings).toHaveLength(texts.length);

        // The i-th embedding should be [i, i, i] — proving order is preserved
        for (let i = 0; i < texts.length; i++) {
          expect(result.embeddings[i]).toEqual([i, i, i]);
        }
      }),
      { numRuns: 100 },
    );
  });
});
