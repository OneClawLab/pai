/**
 * Feature: embed-command, Property 5: JSON 输出格式
 *
 * **Validates: Requirements 3.2**
 *
 * For any embedding result (containing vectors, model name, usage info), the JSON
 * formatter should output a valid JSON object. Single mode contains an `embedding`
 * field, batch mode contains an `embeddings` field, and both include `model` and
 * `usage` fields. All field values must match the original data.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { formatEmbeddingOutput } from '../../src/embed-io.js';
import type { EmbeddingResponse } from '../../src/embedding-client.js';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Finite float that survives JSON round-trip (no NaN, ±Infinity, -0). */
const finiteFloat = fc
  .double({ noNaN: true, noDefaultInfinity: true })
  .map((v) => (Object.is(v, -0) ? 0 : v));

/** A single embedding vector (1–20 dimensions). */
const embeddingVec = fc.array(finiteFloat, { minLength: 1, maxLength: 20 });

/** Non-negative integer for token counts. */
const tokenCount = fc.nat({ max: 100_000 });

/** Model name – non-empty alphanumeric-ish string. */
const modelName = fc
  .array(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_.'.split('')),
    { minLength: 1, maxLength: 40 },
  )
  .map((chars) => chars.join(''));

/** Arbitrary for a full EmbeddingResponse with at least one embedding. */
const embeddingResponseArb = fc
  .tuple(
    fc.array(embeddingVec, { minLength: 1, maxLength: 10 }),
    modelName,
    tokenCount,
    tokenCount,
  )
  .map(([embeddings, model, promptTokens, totalTokens]): EmbeddingResponse => ({
    embeddings,
    model,
    usage: { promptTokens, totalTokens },
  }));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Property 5: JSON 输出格式', () => {
  // Feature: embed-command, Property 5: JSON 输出格式
  // **Validates: Requirements 3.2**

  it('single mode: output is valid JSON with `embedding`, `model`, and `usage` fields', () => {
    fc.assert(
      fc.property(embeddingResponseArb, (response) => {
        const output = formatEmbeddingOutput(response, { json: true, batch: false });

        // Must be valid JSON
        const parsed = JSON.parse(output);

        // Must have `embedding` (singular), NOT `embeddings`
        expect(parsed).toHaveProperty('embedding');
        expect(parsed).not.toHaveProperty('embeddings');

        // Must have `model` and `usage`
        expect(parsed).toHaveProperty('model');
        expect(parsed).toHaveProperty('usage');
      }),
      { numRuns: 100 },
    );
  });

  it('batch mode: output is valid JSON with `embeddings`, `model`, and `usage` fields', () => {
    fc.assert(
      fc.property(embeddingResponseArb, (response) => {
        const output = formatEmbeddingOutput(response, { json: true, batch: true });

        const parsed = JSON.parse(output);

        // Must have `embeddings` (plural), NOT `embedding`
        expect(parsed).toHaveProperty('embeddings');
        expect(parsed).not.toHaveProperty('embedding');

        // Must have `model` and `usage`
        expect(parsed).toHaveProperty('model');
        expect(parsed).toHaveProperty('usage');
      }),
      { numRuns: 100 },
    );
  });

  it('usage fields are converted to snake_case (prompt_tokens, total_tokens)', () => {
    fc.assert(
      fc.property(embeddingResponseArb, (response) => {
        // Test both modes
        for (const batch of [true, false]) {
          const output = formatEmbeddingOutput(response, { json: true, batch });
          const parsed = JSON.parse(output);

          expect(parsed.usage).toHaveProperty('prompt_tokens');
          expect(parsed.usage).toHaveProperty('total_tokens');

          // Should NOT have camelCase keys
          expect(parsed.usage).not.toHaveProperty('promptTokens');
          expect(parsed.usage).not.toHaveProperty('totalTokens');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('all field values match the original data', () => {
    fc.assert(
      fc.property(embeddingResponseArb, (response) => {
        // --- Single mode ---
        const singleOutput = formatEmbeddingOutput(response, { json: true, batch: false });
        const single = JSON.parse(singleOutput);

        expect(single.embedding).toEqual(response.embeddings[0]);
        expect(single.model).toBe(response.model);
        expect(single.usage.prompt_tokens).toBe(response.usage.promptTokens);
        expect(single.usage.total_tokens).toBe(response.usage.totalTokens);

        // --- Batch mode ---
        const batchOutput = formatEmbeddingOutput(response, { json: true, batch: true });
        const batch = JSON.parse(batchOutput);

        expect(batch.embeddings).toEqual(response.embeddings);
        expect(batch.model).toBe(response.model);
        expect(batch.usage.prompt_tokens).toBe(response.usage.promptTokens);
        expect(batch.usage.total_tokens).toBe(response.usage.totalTokens);
      }),
      { numRuns: 100 },
    );
  });
});
