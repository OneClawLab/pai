import { describe, it, expect } from 'vitest';
import { parseBatchInput, formatEmbeddingOutput, vectorToHex } from '../../src/embed-io.js';
import type { EmbeddingResponse } from '../../src/embedding-client.js';
import { PAIError, ExitCode } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Helper: decode hex string array back to number[] for verification
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

/** Round-trip a number through float32 to get the expected precision */
function f32(n: number): number {
  const buf = new Float32Array(1);
  buf[0] = n;
  return buf[0];
}

// ---------------------------------------------------------------------------
// parseBatchInput
// ---------------------------------------------------------------------------

describe('parseBatchInput', () => {
  it('should parse a valid JSON string array', () => {
    expect(parseBatchInput('["hello","world"]')).toEqual(['hello', 'world']);
  });

  it('should parse a single-element array', () => {
    expect(parseBatchInput('["only"]')).toEqual(['only']);
  });

  it('should return empty array for empty JSON array', () => {
    expect(parseBatchInput('[]')).toEqual([]);
  });

  it('should throw on invalid JSON', () => {
    expect(() => parseBatchInput('not json')).toThrow(PAIError);
    try {
      parseBatchInput('not json');
    } catch (e) {
      expect((e as PAIError).exitCode).toBe(ExitCode.ARGUMENT_ERROR);
    }
  });

  it('should throw when JSON is not an array', () => {
    expect(() => parseBatchInput('{"a":1}')).toThrow(PAIError);
    expect(() => parseBatchInput('"just a string"')).toThrow(PAIError);
    expect(() => parseBatchInput('42')).toThrow(PAIError);
  });

  it('should throw when array contains non-strings', () => {
    expect(() => parseBatchInput('[1, 2]')).toThrow(PAIError);
    expect(() => parseBatchInput('["ok", 123]')).toThrow(PAIError);
    expect(() => parseBatchInput('[null]')).toThrow(PAIError);
    expect(() => parseBatchInput('["a", true]')).toThrow(PAIError);
  });
});

// ---------------------------------------------------------------------------
// vectorToHex
// ---------------------------------------------------------------------------

describe('vectorToHex', () => {
  it('should encode a vector as a hex string array with 8 chars per element', () => {
    const hex = vectorToHex([1.0, -1.0, 0.0]);
    expect(Array.isArray(hex)).toBe(true);
    expect(hex).toHaveLength(3);
    for (const h of hex) {
      expect(h).toHaveLength(8);
      expect(h).toMatch(/^[0-9a-f]{8}$/);
    }
    // Verify round-trip
    const decoded = hexToVector(hex);
    expect(decoded).toEqual([1.0, -1.0, 0.0]);
  });

  it('should produce lowercase hex', () => {
    const hex = vectorToHex([0.5]);
    expect(hex[0]).toMatch(/^[0-9a-f]{8}$/);
  });

  it('should handle empty vector', () => {
    expect(vectorToHex([])).toEqual([]);
  });

  it('should round-trip through float32 precision', () => {
    const original = [0.0023064255, -0.009327292, 0.015797347];
    const hex = vectorToHex(original);
    const decoded = hexToVector(hex);
    for (let i = 0; i < original.length; i++) {
      expect(decoded[i]).toBe(f32(original[i]!));
    }
  });
});

// ---------------------------------------------------------------------------
// formatEmbeddingOutput
// ---------------------------------------------------------------------------

const singleResult: EmbeddingResponse = {
  embeddings: [[0.0023064255, -0.009327292, 0.015797347]],
  model: 'text-embedding-3-small',
  usage: { promptTokens: 2, totalTokens: 2 },
};

const batchResult: EmbeddingResponse = {
  embeddings: [
    [0.0023064255, -0.009327292, 0.015797347],
    [0.0112345678, -0.023456789, 0.03456789],
  ],
  model: 'text-embedding-3-small',
  usage: { promptTokens: 4, totalTokens: 4 },
};

describe('formatEmbeddingOutput', () => {
  // -- Plain text mode --

  describe('plain text mode', () => {
    it('should output single embedding as one JSON hex-array line', () => {
      const out = formatEmbeddingOutput(singleResult, { json: false, batch: false });
      expect(out.split('\n')).toHaveLength(1);
      // Should parse as a JSON array of hex strings
      const parsed: string[] = JSON.parse(out);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(singleResult.embeddings[0]!.length);
      for (const h of parsed) {
        expect(h).toMatch(/^[0-9a-f]{8}$/);
      }
      const decoded = hexToVector(parsed);
      for (let i = 0; i < decoded.length; i++) {
        expect(decoded[i]).toBe(f32(singleResult.embeddings[0]![i]!));
      }
    });

    it('should output batch embeddings as one hex-array line per embedding', () => {
      const out = formatEmbeddingOutput(batchResult, { json: false, batch: true });
      const lines = out.split('\n');
      expect(lines).toHaveLength(2);
      for (let li = 0; li < lines.length; li++) {
        const parsed: string[] = JSON.parse(lines[li]!);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toHaveLength(batchResult.embeddings[li]!.length);
        const decoded = hexToVector(parsed);
        for (let i = 0; i < decoded.length; i++) {
          expect(decoded[i]).toBe(f32(batchResult.embeddings[li]![i]!));
        }
      }
    });
  });

  // -- JSON mode --

  describe('JSON mode', () => {
    it('should output single embedding with "embedding" key as hex string array', () => {
      const out = formatEmbeddingOutput(singleResult, { json: true, batch: false });
      const parsed = JSON.parse(out);
      expect(parsed).toHaveProperty('embedding');
      expect(Array.isArray(parsed.embedding)).toBe(true);
      for (const h of parsed.embedding) {
        expect(typeof h).toBe('string');
        expect(h).toMatch(/^[0-9a-f]{8}$/);
      }
      expect(parsed).not.toHaveProperty('embeddings');
      expect(parsed.model).toBe('text-embedding-3-small');
      expect(parsed.usage).toEqual({ prompt_tokens: 2, total_tokens: 2 });
    });

    it('should output batch embeddings with "embeddings" key as array of hex string arrays', () => {
      const out = formatEmbeddingOutput(batchResult, { json: true, batch: true });
      const parsed = JSON.parse(out);
      expect(parsed).toHaveProperty('embeddings');
      expect(Array.isArray(parsed.embeddings)).toBe(true);
      expect(parsed.embeddings).toHaveLength(2);
      for (const arr of parsed.embeddings) {
        expect(Array.isArray(arr)).toBe(true);
        for (const h of arr) {
          expect(typeof h).toBe('string');
          expect(h).toMatch(/^[0-9a-f]{8}$/);
        }
      }
      expect(parsed).not.toHaveProperty('embedding');
      expect(parsed.model).toBe('text-embedding-3-small');
      expect(parsed.usage).toEqual({ prompt_tokens: 4, total_tokens: 4 });
    });

    it('should convert usage field names to snake_case', () => {
      const out = formatEmbeddingOutput(singleResult, { json: true, batch: false });
      const parsed = JSON.parse(out);
      expect(parsed.usage).toHaveProperty('prompt_tokens');
      expect(parsed.usage).toHaveProperty('total_tokens');
      expect(parsed.usage).not.toHaveProperty('promptTokens');
      expect(parsed.usage).not.toHaveProperty('totalTokens');
    });
  });
});
