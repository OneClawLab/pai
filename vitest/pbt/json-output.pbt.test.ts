/**
 * Feature: embed-command, Property 5: JSON 输出格式
 *
 * **Validates: Requirements 3.2**
 *
 * For any embedding result, the JSON formatter should output a valid JSON object.
 * Single mode contains an `embedding` field (hex string array), batch mode contains
 * an `embeddings` field (array of hex string arrays), and both include `model` and
 * `usage` fields. Hex-encoded vectors must decode back to the original float32 values.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { formatEmbeddingOutput } from '../../src/embed-io.js';
import type { EmbeddingResponse } from '../../src/embedding-client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToVector(hexArr: string[]): number[] {
  const result: number[] = new Array(hexArr.length);
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  for (let i = 0; i < hexArr.length; i++) {
    const h = hexArr[i]!;
    for (let b = 0; b < 4; b++) {
      view.setUint8(b, parseInt(h.substring(b * 2, b * 2 + 2), 16));
    }
    result[i] = view.getFloat32(0, false);
  }
  return result;
}

function f32(n: number): number {
  const buf = new Float32Array(1);
  buf[0] = n;
  return buf[0];
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const finiteFloat = fc
  .double({ noNaN: true, noDefaultInfinity: true })
  .map((v) => (Object.is(v, -0) ? 0 : v));

const embeddingVec = fc.array(finiteFloat, { minLength: 1, maxLength: 20 });
const tokenCount = fc.nat({ max: 100_000 });

const modelName = fc
  .array(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_.'.split('')),
    { minLength: 1, maxLength: 40 },
  )
  .map((chars) => chars.join(''));

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
  it('single mode: output is valid JSON with `embedding` (hex string array), `model`, and `usage`', () => {
    fc.assert(
      fc.property(embeddingResponseArb, (response) => {
        const output = formatEmbeddingOutput(response, { json: true, batch: false });
        const parsed = JSON.parse(output);

        expect(parsed).toHaveProperty('embedding');
        expect(Array.isArray(parsed.embedding)).toBe(true);
        for (const h of parsed.embedding) {
          expect(typeof h).toBe('string');
          expect(h).toMatch(/^[0-9a-f]{8}$/);
        }
        expect(parsed).not.toHaveProperty('embeddings');
        expect(parsed).toHaveProperty('model');
        expect(parsed).toHaveProperty('usage');
      }),
      { numRuns: 100 },
    );
  });

  it('batch mode: output is valid JSON with `embeddings` (array of hex string arrays), `model`, and `usage`', () => {
    fc.assert(
      fc.property(embeddingResponseArb, (response) => {
        const output = formatEmbeddingOutput(response, { json: true, batch: true });
        const parsed = JSON.parse(output);

        expect(parsed).toHaveProperty('embeddings');
        expect(Array.isArray(parsed.embeddings)).toBe(true);
        for (const arr of parsed.embeddings) {
          expect(Array.isArray(arr)).toBe(true);
          for (const h of arr) {
            expect(typeof h).toBe('string');
            expect(h).toMatch(/^[0-9a-f]{8}$/);
          }
        }
        expect(parsed).not.toHaveProperty('embedding');
        expect(parsed).toHaveProperty('model');
        expect(parsed).toHaveProperty('usage');
      }),
      { numRuns: 100 },
    );
  });

  it('usage fields are converted to snake_case (prompt_tokens, total_tokens)', () => {
    fc.assert(
      fc.property(embeddingResponseArb, (response) => {
        for (const batch of [true, false]) {
          const output = formatEmbeddingOutput(response, { json: true, batch });
          const parsed = JSON.parse(output);
          expect(parsed.usage).toHaveProperty('prompt_tokens');
          expect(parsed.usage).toHaveProperty('total_tokens');
          expect(parsed.usage).not.toHaveProperty('promptTokens');
          expect(parsed.usage).not.toHaveProperty('totalTokens');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('all field values match the original data (hex decodes to float32 of original)', () => {
    fc.assert(
      fc.property(embeddingResponseArb, (response) => {
        // --- Single mode ---
        const singleOutput = formatEmbeddingOutput(response, { json: true, batch: false });
        const single = JSON.parse(singleOutput);

        const decodedSingle = hexToVector(single.embedding);
        const expectedSingle = response.embeddings[0]!.map(f32);
        expect(decodedSingle).toEqual(expectedSingle);
        expect(single.model).toBe(response.model);
        expect(single.usage.prompt_tokens).toBe(response.usage.promptTokens);
        expect(single.usage.total_tokens).toBe(response.usage.totalTokens);

        // --- Batch mode ---
        const batchOutput = formatEmbeddingOutput(response, { json: true, batch: true });
        const batch = JSON.parse(batchOutput);

        for (let i = 0; i < response.embeddings.length; i++) {
          const decoded = hexToVector(batch.embeddings[i]);
          const expected = response.embeddings[i]!.map(f32);
          expect(decoded).toEqual(expected);
        }
        expect(batch.model).toBe(response.model);
        expect(batch.usage.prompt_tokens).toBe(response.usage.promptTokens);
        expect(batch.usage.total_tokens).toBe(response.usage.totalTokens);
      }),
      { numRuns: 100 },
    );
  });
});
