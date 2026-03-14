import { describe, it, expect } from 'vitest';
import { resolveEmbedModel } from '../../src/embed-model-resolver.js';
import type { EmbedOptions, PAIConfig } from '../../src/types.js';
import { PAIError, ExitCode } from '../../src/types.js';

function makeConfig(overrides: Partial<PAIConfig> = {}): PAIConfig {
  return {
    schema_version: '1.0.0',
    providers: [],
    ...overrides,
  };
}

describe('resolveEmbedModel', () => {
  // ---------------------------------------------------------------
  // Priority 1: CLI --provider / --model override everything
  // ---------------------------------------------------------------
  describe('CLI parameters (highest priority)', () => {
    it('should use CLI --provider and --model when both provided', () => {
      const options: EmbedOptions = { provider: 'cli-provider', model: 'cli-model' };
      const config = makeConfig({
        defaultEmbedProvider: 'config-embed-provider',
        defaultEmbedModel: 'config-embed-model',
        defaultProvider: 'config-default-provider',
      });

      const result = resolveEmbedModel(options, config);
      expect(result).toEqual({ provider: 'cli-provider', model: 'cli-model' });
    });

    it('should use CLI --provider with config defaultEmbedModel', () => {
      const options: EmbedOptions = { provider: 'cli-provider' };
      const config = makeConfig({
        defaultEmbedModel: 'config-embed-model',
      });

      const result = resolveEmbedModel(options, config);
      expect(result).toEqual({ provider: 'cli-provider', model: 'config-embed-model' });
    });

    it('should use CLI --model with config defaultEmbedProvider', () => {
      const options: EmbedOptions = { model: 'cli-model' };
      const config = makeConfig({
        defaultEmbedProvider: 'config-embed-provider',
      });

      const result = resolveEmbedModel(options, config);
      expect(result).toEqual({ provider: 'config-embed-provider', model: 'cli-model' });
    });
  });

  // ---------------------------------------------------------------
  // Priority 2: defaultEmbedProvider / defaultEmbedModel
  // ---------------------------------------------------------------
  describe('config defaultEmbed* (second priority)', () => {
    it('should use defaultEmbedProvider and defaultEmbedModel from config', () => {
      const options: EmbedOptions = {};
      const config = makeConfig({
        defaultEmbedProvider: 'embed-provider',
        defaultEmbedModel: 'embed-model',
        defaultProvider: 'fallback-provider',
      });

      const result = resolveEmbedModel(options, config);
      expect(result).toEqual({ provider: 'embed-provider', model: 'embed-model' });
    });
  });

  // ---------------------------------------------------------------
  // Priority 3: defaultProvider fallback (provider only)
  // ---------------------------------------------------------------
  describe('config defaultProvider fallback (third priority)', () => {
    it('should fall back to defaultProvider when no embed-specific provider', () => {
      const options: EmbedOptions = {};
      const config = makeConfig({
        defaultProvider: 'fallback-provider',
        defaultEmbedModel: 'embed-model',
      });

      const result = resolveEmbedModel(options, config);
      expect(result).toEqual({ provider: 'fallback-provider', model: 'embed-model' });
    });
  });

  // ---------------------------------------------------------------
  // Error cases
  // ---------------------------------------------------------------
  describe('error handling', () => {
    it('should throw PAIError when no provider can be resolved', () => {
      const options: EmbedOptions = { model: 'some-model' };
      const config = makeConfig(); // no providers at all

      expect(() => resolveEmbedModel(options, config)).toThrow(PAIError);
      try {
        resolveEmbedModel(options, config);
      } catch (e) {
        expect(e).toBeInstanceOf(PAIError);
        expect((e as PAIError).exitCode).toBe(ExitCode.PARAMETER_ERROR);
      }
    });

    it('should throw PAIError when no model can be resolved', () => {
      const options: EmbedOptions = { provider: 'some-provider' };
      const config = makeConfig(); // no defaultEmbedModel

      expect(() => resolveEmbedModel(options, config)).toThrow(PAIError);
      try {
        resolveEmbedModel(options, config);
      } catch (e) {
        expect(e).toBeInstanceOf(PAIError);
        expect((e as PAIError).exitCode).toBe(ExitCode.PARAMETER_ERROR);
      }
    });

    it('should throw PAIError when config has defaultProvider but no model', () => {
      const options: EmbedOptions = {};
      const config = makeConfig({ defaultProvider: 'openai' });

      expect(() => resolveEmbedModel(options, config)).toThrow(PAIError);
      try {
        resolveEmbedModel(options, config);
      } catch (e) {
        expect(e).toBeInstanceOf(PAIError);
        expect((e as PAIError).exitCode).toBe(ExitCode.PARAMETER_ERROR);
        expect((e as PAIError).message).toContain('model');
      }
    });

    it('should throw PAIError when completely empty options and config', () => {
      const options: EmbedOptions = {};
      const config = makeConfig();

      expect(() => resolveEmbedModel(options, config)).toThrow(PAIError);
      try {
        resolveEmbedModel(options, config);
      } catch (e) {
        expect(e).toBeInstanceOf(PAIError);
        expect((e as PAIError).exitCode).toBe(ExitCode.PARAMETER_ERROR);
      }
    });
  });

  // ---------------------------------------------------------------
  // Mixed priority scenarios
  // ---------------------------------------------------------------
  describe('mixed priority scenarios', () => {
    it('CLI --provider overrides defaultEmbedProvider and defaultProvider', () => {
      const options: EmbedOptions = { provider: 'cli-p' };
      const config = makeConfig({
        defaultEmbedProvider: 'embed-p',
        defaultProvider: 'default-p',
        defaultEmbedModel: 'embed-m',
      });

      const result = resolveEmbedModel(options, config);
      expect(result.provider).toBe('cli-p');
    });

    it('CLI --model overrides defaultEmbedModel', () => {
      const options: EmbedOptions = { model: 'cli-m' };
      const config = makeConfig({
        defaultEmbedProvider: 'embed-p',
        defaultEmbedModel: 'embed-m',
      });

      const result = resolveEmbedModel(options, config);
      expect(result.model).toBe('cli-m');
    });

    it('defaultEmbedProvider takes precedence over defaultProvider', () => {
      const options: EmbedOptions = {};
      const config = makeConfig({
        defaultEmbedProvider: 'embed-p',
        defaultProvider: 'default-p',
        defaultEmbedModel: 'embed-m',
      });

      const result = resolveEmbedModel(options, config);
      expect(result.provider).toBe('embed-p');
    });
  });
});
