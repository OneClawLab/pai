/**
 * Feature: embed-command, Property 4: 纯文本输出格式
 *
 * **Validates: Requirements 3.1**
 *
 * For any embedding vectors, the plain text formatter should output one JSON hex
 * string array per line (single mode = one line, batch mode = one line per embedding),
 * and the decoded float32 values must match the original vectors at float32 precision.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { formatEmbeddingOutput } from '../../src/embed-io.js';
import type { EmbeddingResponse } from '../../src/embedding-client.js';

function makeResponse(embeddings: number[][]): EmbeddingResponse {
  return {
    embeddings,
    model: 'test-model',
    usage: { promptTokens: 1, totalTokens: 1 },
  };
}

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

const finiteFloat = fc
  .double({ noNaN: true, noDefaultInfinity: true })
  .map((v) => (Object.is(v, -0) ? 0 : v));

const embeddingVec = fc.array(finiteFloat, { minLength: 1, maxLength: 20 });

describe('Property 4: 纯文本输出格式', () => {
  it('single embedding produces exactly one line that is a valid JSON hex string array', () => {
    fc.assert(
      fc.property(embeddingVec, (vec) => {
        const output = formatEmbeddingOutput(makeResponse([vec]), {
          json: false,
          batch: false,
        });

        const lines = output.split('\n');
        expect(lines).toHaveLength(1);

        const parsed: string[] = JSON.parse(lines[0]!);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toHaveLength(vec.length);
        for (const h of parsed) {
          expect(h).toMatch(/^[0-9a-f]{8}$/);
        }

        const decoded = hexToVector(parsed);
        for (let i = 0; i < vec.length; i++) {
          expect(decoded[i]).toBe(f32(vec[i]!));
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

        for (let i = 0; i < vecs.length; i++) {
          const parsed: string[] = JSON.parse(lines[i]!);
          expect(Array.isArray(parsed)).toBe(true);
          expect(parsed).toHaveLength(vecs[i]!.length);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('decoded float32 values from hex output match the original embedding values', () => {
    const batchArb = fc.array(embeddingVec, { minLength: 1, maxLength: 10 });

    fc.assert(
      fc.property(batchArb, (vecs) => {
        const output = formatEmbeddingOutput(makeResponse(vecs), {
          json: false,
          batch: true,
        });

        const lines = output.split('\n');

        for (let i = 0; i < vecs.length; i++) {
          const parsed: string[] = JSON.parse(lines[i]!);
          const decoded = hexToVector(parsed);
          for (let j = 0; j < vecs[i]!.length; j++) {
            expect(decoded[j]).toBe(f32(vecs[i]![j]!));
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
