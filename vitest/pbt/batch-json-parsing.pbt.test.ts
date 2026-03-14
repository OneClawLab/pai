/**
 * Feature: embed-command, Property 2: 批量 JSON 解析有效性
 *
 * **Validates: Requirements 2.1, 2.6**
 *
 * For any string, when it is a valid JSON string array, the batch parser should
 * correctly extract all string elements without loss or addition; when it is not
 * a valid JSON string array (invalid JSON, non-array, array with non-string elements),
 * the batch parser should return an error.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseBatchInput } from '../../src/embed-io.js';
import { PAIError } from '../../src/types.js';

describe('Property 2: 批量 JSON 解析有效性', () => {
  // Feature: embed-command, Property 2: 批量 JSON 解析有效性
  // **Validates: Requirements 2.1, 2.6**

  it('valid JSON string arrays are parsed without loss or addition', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { minLength: 0, maxLength: 50 }),
        (strings) => {
          const raw = JSON.stringify(strings);
          const result = parseBatchInput(raw);

          // Exact same length — no elements lost or added
          expect(result).toHaveLength(strings.length);

          // Every element matches in order
          expect(result).toEqual(strings);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('invalid JSON strings cause PAIError', () => {
    const invalidJsonArb = fc.string({ minLength: 1 }).filter((s) => {
      try {
        JSON.parse(s);
        return false;
      } catch {
        return true;
      }
    });

    fc.assert(
      fc.property(invalidJsonArb, (raw) => {
        expect(() => parseBatchInput(raw)).toThrow(PAIError);
      }),
      { numRuns: 100 },
    );
  });

  it('valid JSON but not an array causes PAIError', () => {
    const nonArrayJsonArb = fc.oneof(
      fc.double({ noNaN: true, noDefaultInfinity: true }).map((n) => JSON.stringify(n)),
      fc.string().map((s) => JSON.stringify(s)),
      fc.boolean().map((b) => JSON.stringify(b)),
      fc.constant('null'),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.string()).map((o) =>
        JSON.stringify(o),
      ),
    );

    fc.assert(
      fc.property(nonArrayJsonArb, (raw) => {
        expect(() => parseBatchInput(raw)).toThrow(PAIError);
      }),
      { numRuns: 100 },
    );
  });

  it('array with non-string elements causes PAIError', () => {
    // Generate arrays that contain at least one non-string element
    const nonStringElement = fc.oneof(
      fc.integer(),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.boolean(),
      fc.constant(null),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 5 }), fc.string()),
      fc.array(fc.integer(), { minLength: 0, maxLength: 3 }),
    );

    const mixedArrayArb = fc
      .tuple(
        fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
        nonStringElement,
        fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
      )
      .map(([before, bad, after]) => JSON.stringify([...before, bad, ...after]));

    fc.assert(
      fc.property(mixedArrayArb, (raw) => {
        expect(() => parseBatchInput(raw)).toThrow(PAIError);
      }),
      { numRuns: 100 },
    );
  });

  it('empty array returns empty array', () => {
    const result = parseBatchInput('[]');
    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });
});
