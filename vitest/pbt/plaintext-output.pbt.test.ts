/**
 * Feature: embed-command, Property 4: 纯文本输出格式
 *
 * **Validates: Requirements 3.1**
 *
 * For any embedding vectors (arrays of floats), the plain text formatter should
 * output one JSON array per line (single mode = one line, batch mode = one line
 * per embedding), and the parsed float values must match the original vectors.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { formatEmbeddingOutput } from '../../src/embed-io.js';
import type { EmbeddingResponse } from '../../src/embedding-client.js';

/**
 * Helper: build a minimal EmbeddingResponse from a list of embedding vectors.
 */
function makeResponse(embeddings: number[][]): EmbeddingResponse {
  return {
    embeddings,
    model: 'test-model',
    usage: { promptTokens: 1, totalTokens: 1 },
  };
}

/** Arbitrary for a single finite float (no NaN / ±Infinity / -0, since JSON cannot distinguish -0 from +0). */
const finiteFloat = fc
  .double({ noNaN: true, noDefaultInfinity: true })
  .map((v) => (Object.is(v, -0) ? 0 : v));

/** Arbitrary for a single embedding vector (1–20 dimensions). */
const embeddingVec = fc.array(finiteFloat, { minLength: 1, maxLength: 20 });

describe('Property 4: 纯文本输出格式', () => {
  // Feature: embed-command, Property 4: 纯文本输出格式
  // **Validates: Requirements 3.1**

  it('single embedding produces exactly one line that is a valid JSON array matching the input', () => {
    fc.assert(
      fc.property(embeddingVec, (vec) => {
        const output = formatEmbeddingOutput(makeResponse([vec]), {
          json: false,
          batch: false,
        });

        // Exactly one line (no newline characters inside)
        const lines = output.split('\n');
        expect(lines).toHaveLength(1);

        // The line parses as a JSON array of numbers
        const parsed: number[] = JSON.parse(lines[0]);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toHaveLength(vec.length);

        // Every value matches the original
        for (let i = 0; i < vec.length; i++) {
          expect(parsed[i]).toBe(vec[i]);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('batch embeddings produce exactly N lines, one per embedding', () => {
    const batchArb = fc.array(embeddingVec, { minLength: 1, maxLength: 10 });

    fc.assert(
      fc.property(batchArb, (vecs) => {
        const output = formatEmbeddingOutput(makeResponse(vecs), {
          json: false,
          batch: true,
        });

        const lines = output.split('\n');
        expect(lines).toHaveLength(vecs.length);

        // Each line is a valid JSON array
        for (let i = 0; i < vecs.length; i++) {
          const parsed: number[] = JSON.parse(lines[i]);
          expect(Array.isArray(parsed)).toBe(true);
          expect(parsed).toHaveLength(vecs[i].length);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('parsed float values from plain text output match the original embedding values', () => {
    const batchArb = fc.array(embeddingVec, { minLength: 1, maxLength: 10 });

    fc.assert(
      fc.property(batchArb, (vecs) => {
        const output = formatEmbeddingOutput(makeResponse(vecs), {
          json: false,
          batch: true,
        });

        const lines = output.split('\n');

        for (let i = 0; i < vecs.length; i++) {
          const parsed: number[] = JSON.parse(lines[i]);
          for (let j = 0; j < vecs[i].length; j++) {
            expect(parsed[j]).toBe(vecs[i][j]);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
