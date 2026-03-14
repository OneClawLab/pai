import { describe, it, expect } from 'vitest';
import { parseBatchInput, formatEmbeddingOutput } from '../../src/embed-io.js';
import type { EmbeddingResponse } from '../../src/embedding-client.js';
import { PAIError, ExitCode } from '../../src/types.js';

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
      expect((e as PAIError).exitCode).toBe(ExitCode.PARAMETER_ERROR);
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
    it('should output single embedding as one JSON array line', () => {
      const out = formatEmbeddingOutput(singleResult, { json: false, batch: false });
      expect(out).toBe(JSON.stringify(singleResult.embeddings[0]));
      // No newline at end, single line
      expect(out.split('\n')).toHaveLength(1);
    });

    it('should output batch embeddings as one line per embedding', () => {
      const out = formatEmbeddingOutput(batchResult, { json: false, batch: true });
      const lines = out.split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!)).toEqual(batchResult.embeddings[0]);
      expect(JSON.parse(lines[1]!)).toEqual(batchResult.embeddings[1]);
    });
  });

  // -- JSON mode --

  describe('JSON mode', () => {
    it('should output single embedding with "embedding" key', () => {
      const out = formatEmbeddingOutput(singleResult, { json: true, batch: false });
      const parsed = JSON.parse(out);
      expect(parsed).toEqual({
        embedding: singleResult.embeddings[0],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 2, total_tokens: 2 },
      });
      // Must NOT have "embeddings" key
      expect(parsed).not.toHaveProperty('embeddings');
    });

    it('should output batch embeddings with "embeddings" key', () => {
      const out = formatEmbeddingOutput(batchResult, { json: true, batch: true });
      const parsed = JSON.parse(out);
      expect(parsed).toEqual({
        embeddings: batchResult.embeddings,
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 4, total_tokens: 4 },
      });
      // Must NOT have singular "embedding" key
      expect(parsed).not.toHaveProperty('embedding');
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
