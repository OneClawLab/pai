import { describe, it, expect } from 'vitest';
import { resolveImageModel } from '../../src/image-model-resolver.js';
import type { ImageOptions, PAIConfig } from '../../src/types.js';
import { PAIError, ExitCode } from '../../src/types.js';

function makeConfig(overrides: Partial<PAIConfig> = {}): PAIConfig {
  return {
    schema_version: '1.0.0',
    providers: [],
    ...overrides,
  };
}

describe('resolveImageModel', () => {
  // ---------------------------------------------------------------
  // Priority 1: CLI --provider / --model override everything
  // ---------------------------------------------------------------
  describe('CLI parameters (highest priority)', () => {
    it('should use CLI --provider and --model when both provided', () => {
      const options: ImageOptions = { provider: 'cli-provider', model: 'cli-model' };
      const config = makeConfig({
        defaultImageProvider: 'config-image-provider',
        defaultImageModel: 'config-image-model',
        defaultProvider: 'config-default-provider',
      });

      const result = resolveImageModel(options, config);
      expect(result).toEqual({ provider: 'cli-provider', model: 'cli-model' });
    });

    it('should use CLI --provider with config defaultImageModel', () => {
      const options: ImageOptions = { provider: 'cli-provider' };
      const config = makeConfig({
        defaultImageModel: 'config-image-model',
      });

      const result = resolveImageModel(options, config);
      expect(result).toEqual({ provider: 'cli-provider', model: 'config-image-model' });
    });

    it('should use CLI --model with config defaultImageProvider', () => {
      const options: ImageOptions = { model: 'cli-model' };
      const config = makeConfig({
        defaultImageProvider: 'config-image-provider',
      });

      const result = resolveImageModel(options, config);
      expect(result).toEqual({ provider: 'config-image-provider', model: 'cli-model' });
    });
  });

  // ---------------------------------------------------------------
  // Priority 2: defaultImageProvider / defaultImageModel
  // ---------------------------------------------------------------
  describe('config defaultImage* (second priority)', () => {
    it('should use defaultImageProvider and defaultImageModel from config', () => {
      const options: ImageOptions = {};
      const config = makeConfig({
        defaultImageProvider: 'image-provider',
        defaultImageModel: 'image-model',
        defaultProvider: 'fallback-provider',
      });

      const result = resolveImageModel(options, config);
      expect(result).toEqual({ provider: 'image-provider', model: 'image-model' });
    });
  });

  // ---------------------------------------------------------------
  // Priority 3: defaultProvider fallback (provider only)
  // ---------------------------------------------------------------
  describe('config defaultProvider fallback (third priority)', () => {
    it('should fall back to defaultProvider when no image-specific provider', () => {
      const options: ImageOptions = {};
      const config = makeConfig({
        defaultProvider: 'fallback-provider',
        defaultImageModel: 'image-model',
      });

      const result = resolveImageModel(options, config);
      expect(result).toEqual({ provider: 'fallback-provider', model: 'image-model' });
    });
  });

  // ---------------------------------------------------------------
  // Error cases
  // ---------------------------------------------------------------
  describe('error handling', () => {
    it('should throw PAIError when no provider can be resolved', () => {
      const options: ImageOptions = { model: 'some-model' };
      const config = makeConfig();

      expect(() => resolveImageModel(options, config)).toThrow(PAIError);
      try {
        resolveImageModel(options, config);
      } catch (e) {
        expect(e).toBeInstanceOf(PAIError);
        expect((e as PAIError).exitCode).toBe(ExitCode.ARGUMENT_ERROR);
      }
    });

    it('should throw PAIError when no model can be resolved', () => {
      const options: ImageOptions = { provider: 'some-provider' };
      const config = makeConfig();

      expect(() => resolveImageModel(options, config)).toThrow(PAIError);
      try {
        resolveImageModel(options, config);
      } catch (e) {
        expect(e).toBeInstanceOf(PAIError);
        expect((e as PAIError).exitCode).toBe(ExitCode.ARGUMENT_ERROR);
      }
    });

    it('should throw PAIError when config has defaultProvider but no model', () => {
      const options: ImageOptions = {};
      const config = makeConfig({ defaultProvider: 'openai' });

      expect(() => resolveImageModel(options, config)).toThrow(PAIError);
      try {
        resolveImageModel(options, config);
      } catch (e) {
        expect(e).toBeInstanceOf(PAIError);
        expect((e as PAIError).exitCode).toBe(ExitCode.ARGUMENT_ERROR);
        expect((e as PAIError).message).toContain('model');
      }
    });

    it('should throw PAIError when completely empty options and config', () => {
      const options: ImageOptions = {};
      const config = makeConfig();

      expect(() => resolveImageModel(options, config)).toThrow(PAIError);
      try {
        resolveImageModel(options, config);
      } catch (e) {
        expect(e).toBeInstanceOf(PAIError);
        expect((e as PAIError).exitCode).toBe(ExitCode.ARGUMENT_ERROR);
      }
    });
  });

  // ---------------------------------------------------------------
  // Mixed priority scenarios
  // ---------------------------------------------------------------
  describe('mixed priority scenarios', () => {
    it('CLI --provider overrides defaultImageProvider and defaultProvider', () => {
      const options: ImageOptions = { provider: 'cli-p' };
      const config = makeConfig({
        defaultImageProvider: 'image-p',
        defaultProvider: 'default-p',
        defaultImageModel: 'image-m',
      });

      const result = resolveImageModel(options, config);
      expect(result.provider).toBe('cli-p');
    });

    it('CLI --model overrides defaultImageModel', () => {
      const options: ImageOptions = { model: 'cli-m' };
      const config = makeConfig({
        defaultImageProvider: 'image-p',
        defaultImageModel: 'image-m',
      });

      const result = resolveImageModel(options, config);
      expect(result.model).toBe('cli-m');
    });

    it('defaultImageProvider takes precedence over defaultProvider', () => {
      const options: ImageOptions = {};
      const config = makeConfig({
        defaultImageProvider: 'image-p',
        defaultProvider: 'default-p',
        defaultImageModel: 'image-m',
      });

      const result = resolveImageModel(options, config);
      expect(result.provider).toBe('image-p');
    });
  });
});
