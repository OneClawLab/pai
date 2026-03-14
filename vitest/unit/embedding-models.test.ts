import { describe, it, expect } from 'vitest';
import {
  EMBEDDING_MODEL_LIMITS,
  truncateText,
  estimateTokens,
} from '../../src/embedding-models.js';

describe('embedding-models', () => {
  describe('EMBEDDING_MODEL_LIMITS', () => {
    it('should contain OpenAI models', () => {
      expect(EMBEDDING_MODEL_LIMITS['text-embedding-3-small']).toBe(8191);
      expect(EMBEDDING_MODEL_LIMITS['text-embedding-3-large']).toBe(8191);
      expect(EMBEDDING_MODEL_LIMITS['text-embedding-ada-002']).toBe(8191);
    });

    it('should contain Google models', () => {
      expect(EMBEDDING_MODEL_LIMITS['text-embedding-004']).toBe(2048);
    });

    it('should contain Cohere models', () => {
      expect(EMBEDDING_MODEL_LIMITS['embed-english-v3.0']).toBe(512);
      expect(EMBEDDING_MODEL_LIMITS['embed-multilingual-v3.0']).toBe(512);
      expect(EMBEDDING_MODEL_LIMITS['embed-english-light-v3.0']).toBe(512);
      expect(EMBEDDING_MODEL_LIMITS['embed-multilingual-light-v3.0']).toBe(512);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate 1 token per 4 characters', () => {
      expect(estimateTokens('abcd')).toBe(1);
      expect(estimateTokens('abcdefgh')).toBe(2);
    });

    it('should ceil partial tokens', () => {
      expect(estimateTokens('ab')).toBe(1);   // 2/4 = 0.5 → ceil = 1
      expect(estimateTokens('abcde')).toBe(2); // 5/4 = 1.25 → ceil = 2
    });

    it('should return 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });
  });

  describe('truncateText', () => {
    it('should not truncate text within model limit', () => {
      const text = 'hello world'; // 11 chars → ~3 tokens, well under 8191
      const result = truncateText(text, 'text-embedding-3-small');

      expect(result.text).toBe(text);
      expect(result.truncated).toBe(false);
      expect(result.originalTokens).toBe(estimateTokens(text));
    });

    it('should truncate text exceeding model limit', () => {
      // Cohere embed-english-v3.0 has 512 token limit → 2048 chars max
      const text = 'a'.repeat(3000); // 3000 chars → 750 tokens > 512
      const result = truncateText(text, 'embed-english-v3.0');

      expect(result.truncated).toBe(true);
      expect(result.text.length).toBe(512 * 4); // 2048 chars
      expect(result.originalTokens).toBe(750);
    });

    it('should skip truncation for unknown models', () => {
      const text = 'a'.repeat(100000);
      const result = truncateText(text, 'unknown-model-xyz');

      expect(result.text).toBe(text);
      expect(result.truncated).toBe(false);
      expect(result.originalTokens).toBe(estimateTokens(text));
    });

    it('should handle empty text', () => {
      const result = truncateText('', 'text-embedding-3-small');

      expect(result.text).toBe('');
      expect(result.truncated).toBe(false);
      expect(result.originalTokens).toBe(0);
    });

    it('should handle text exactly at the limit', () => {
      // 512 tokens * 4 chars = 2048 chars exactly
      const text = 'a'.repeat(2048);
      const result = truncateText(text, 'embed-english-v3.0');

      expect(result.text).toBe(text);
      expect(result.truncated).toBe(false);
      expect(result.originalTokens).toBe(512);
    });

    it('should handle text one char over the limit', () => {
      // 2049 chars → ceil(2049/4) = 513 tokens > 512 limit
      const text = 'a'.repeat(2049);
      const result = truncateText(text, 'embed-english-v3.0');

      expect(result.truncated).toBe(true);
      expect(result.text.length).toBe(2048);
      expect(result.originalTokens).toBe(513);
    });

    it('should preserve text content when truncating', () => {
      const text = 'abcdefgh'.repeat(400); // 3200 chars → 800 tokens > 512
      const result = truncateText(text, 'embed-english-v3.0');

      expect(result.truncated).toBe(true);
      expect(result.text).toBe(text.slice(0, 2048));
    });
  });
});
