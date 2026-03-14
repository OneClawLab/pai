/**
 * Feature: embed-command, Property 10: 文本截断正确性
 *
 * **Validates: Requirements 7.1, 7.2**
 *
 * For any embedding model (in the built-in limits data) and any length of input text,
 * the estimated token count of the truncated text should not exceed the model's max token limit;
 * when the input text does not exceed the limit, the truncation function should return the
 * original text unchanged.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  EMBEDDING_MODEL_LIMITS,
  estimateTokens,
  truncateText,
} from '../../src/embedding-models.js';

// --- Smart generators ---

/** Pick a known model name from the built-in limits */
const knownModelArb = fc.constantFrom(...Object.keys(EMBEDDING_MODEL_LIMITS));

/** Generate arbitrary text of any length (including empty) */
const textArb = fc.string({ minLength: 0, maxLength: 100_000 });

/** Generate text guaranteed to be within a given model's token limit */
function textWithinLimit(model: string): fc.Arbitrary<string> {
  const limit = EMBEDDING_MODEL_LIMITS[model]!;
  // limit * 4 chars = max chars that fit within the token limit
  // Subtract 1 to ensure estimateTokens(text) <= limit even with Math.ceil rounding
  const maxChars = Math.max(0, limit * 4);
  return fc.string({ minLength: 0, maxLength: maxChars });
}

/** Generate text guaranteed to exceed a given model's token limit */
function textExceedingLimit(model: string): fc.Arbitrary<string> {
  const limit = EMBEDDING_MODEL_LIMITS[model]!;
  // Need more than limit * 4 chars so estimateTokens > limit
  const minChars = limit * 4 + 1;
  return fc.string({ minLength: minChars, maxLength: minChars + 10_000 });
}

/** Generate a model name that is NOT in the built-in limits */
const unknownModelArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !(s in EMBEDDING_MODEL_LIMITS));

// --- Tests ---

describe('Property 10: 文本截断正确性', () => {
  // Feature: embed-command, Property 10: 文本截断正确性
  // **Validates: Requirements 7.1, 7.2**

  it('truncated text estimated tokens never exceed the model limit', () => {
    fc.assert(
      fc.property(knownModelArb, textArb, (model, text) => {
        const result = truncateText(text, model);
        const limit = EMBEDDING_MODEL_LIMITS[model]!;
        const truncatedTokens = estimateTokens(result.text);

        // Core property: after truncation, tokens must be within limit
        expect(truncatedTokens).toBeLessThanOrEqual(limit);
      }),
      { numRuns: 200 },
    );
  });

  it('text within the limit is returned unchanged with truncated=false', () => {
    fc.assert(
      fc.property(
        knownModelArb.chain((model) =>
          textWithinLimit(model).map((text) => ({ model, text })),
        ),
        ({ model, text }) => {
          const result = truncateText(text, model);

          // When text fits within the limit, it should be returned as-is
          expect(result.text).toBe(text);
          expect(result.truncated).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('text exceeding the limit is truncated with truncated=true', () => {
    fc.assert(
      fc.property(
        knownModelArb.chain((model) =>
          textExceedingLimit(model).map((text) => ({ model, text })),
        ),
        ({ model, text }) => {
          const result = truncateText(text, model);
          const limit = EMBEDDING_MODEL_LIMITS[model]!;

          expect(result.truncated).toBe(true);
          expect(estimateTokens(result.text)).toBeLessThanOrEqual(limit);
          // Truncated text should be a prefix of the original
          expect(text.startsWith(result.text)).toBe(true);
          // originalTokens should reflect the original text
          expect(result.originalTokens).toBe(estimateTokens(text));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('unknown models skip truncation and return original text', () => {
    fc.assert(
      fc.property(unknownModelArb, textArb, (model, text) => {
        const result = truncateText(text, model);

        expect(result.text).toBe(text);
        expect(result.truncated).toBe(false);
        expect(result.originalTokens).toBe(estimateTokens(text));
      }),
      { numRuns: 100 },
    );
  });
});
