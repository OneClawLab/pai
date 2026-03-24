/**
 * Feature: embed-command, Property 7: 嵌入模型解析优先级
 *
 * **Validates: Requirements 4.3, 4.4**
 *
 * For any configuration state (with or without defaultEmbedProvider/defaultEmbedModel/defaultProvider)
 * and CLI parameter combination, model resolution should follow priority:
 * CLI --provider/--model > defaultEmbedProvider/defaultEmbedModel > defaultProvider fallback.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { resolveEmbedModel } from '../../src/embed-model-resolver.js';
import { PAIError, ExitCode } from '../../src/types.js';
import type { EmbedOptions, PAIConfig } from '../../src/types.js';

// --- Smart generators ---

/** Generate a realistic provider name */
const providerNameArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/);

/** Generate a realistic model name */
const modelNameArb = fc.stringMatching(/^[a-z][a-z0-9._-]{0,29}$/);

/** Generate an optional provider/model string (present or undefined) */
const optionalProviderArb = fc.option(providerNameArb, { nil: undefined }) as fc.Arbitrary<string | undefined>;
const optionalModelArb = fc.option(modelNameArb, { nil: undefined }) as fc.Arbitrary<string | undefined>;

/** Build a minimal PAIConfig with optional embed/default fields */
function buildConfig(opts: {
  defaultProvider?: string;
  defaultEmbedProvider?: string;
  defaultEmbedModel?: string;
}): PAIConfig {
  const config: PAIConfig = {
    schema_version: '1.0.0',
    providers: [],
  };
  if (opts.defaultProvider !== undefined) config.defaultProvider = opts.defaultProvider;
  if (opts.defaultEmbedProvider !== undefined) config.defaultEmbedProvider = opts.defaultEmbedProvider;
  if (opts.defaultEmbedModel !== undefined) config.defaultEmbedModel = opts.defaultEmbedModel;
  return config;
}

/** Build EmbedOptions with optional provider/model */
function buildOptions(opts: { provider?: string; model?: string }): EmbedOptions {
  const options: EmbedOptions = {};
  if (opts.provider !== undefined) options.provider = opts.provider;
  if (opts.model !== undefined) options.model = opts.model;
  return options;
}

// --- Tests ---

describe('Property 7: 嵌入模型解析优先级', () => {
  // Feature: embed-command, Property 7: 嵌入模型解析优先级
  // **Validates: Requirements 4.3, 4.4**

  it('CLI --provider always wins over config.defaultEmbedProvider and config.defaultProvider', () => {
    fc.assert(
      fc.property(
        providerNameArb,
        optionalProviderArb,
        optionalProviderArb,
        modelNameArb,
        (cliProvider, defaultEmbedProvider, defaultProvider, someModel) => {
          const config = buildConfig({ defaultEmbedProvider, defaultProvider, defaultEmbedModel: someModel });
          const options = buildOptions({ provider: cliProvider, model: someModel });

          const result = resolveEmbedModel(options, config);
          expect(result.provider).toBe(cliProvider);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('CLI --model always wins over config.defaultEmbedModel', () => {
    fc.assert(
      fc.property(
        providerNameArb,
        modelNameArb,
        optionalModelArb,
        (someProvider, cliModel, defaultEmbedModel) => {
          const config = buildConfig({ defaultProvider: someProvider, defaultEmbedModel });
          const options = buildOptions({ provider: someProvider, model: cliModel });

          const result = resolveEmbedModel(options, config);
          expect(result.model).toBe(cliModel);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('config.defaultEmbedProvider wins over config.defaultProvider when no CLI --provider', () => {
    fc.assert(
      fc.property(
        providerNameArb,
        providerNameArb,
        modelNameArb,
        (defaultEmbedProvider, defaultProvider, someModel) => {
          const config = buildConfig({ defaultEmbedProvider, defaultProvider, defaultEmbedModel: someModel });
          const options = buildOptions({ model: someModel }); // no CLI --provider

          const result = resolveEmbedModel(options, config);
          expect(result.provider).toBe(defaultEmbedProvider);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('config.defaultProvider is used as fallback when no CLI --provider and no defaultEmbedProvider', () => {
    fc.assert(
      fc.property(
        providerNameArb,
        modelNameArb,
        (defaultProvider, someModel) => {
          const config = buildConfig({ defaultProvider, defaultEmbedModel: someModel });
          const options = buildOptions({ model: someModel }); // no CLI --provider

          const result = resolveEmbedModel(options, config);
          expect(result.provider).toBe(defaultProvider);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('throws PAIError with exitCode 1 when no provider can be resolved', () => {
    fc.assert(
      fc.property(
        optionalModelArb,
        (cliModel) => {
          // No CLI provider, no defaultEmbedProvider, no defaultProvider
          const config = buildConfig({});
          const options = buildOptions({ model: cliModel });

          expect(() => resolveEmbedModel(options, config)).toThrow(PAIError);
          try {
            resolveEmbedModel(options, config);
          } catch (e) {
            expect(e).toBeInstanceOf(PAIError);
            expect((e as PAIError).exitCode).toBe(ExitCode.PARAMETER_ERROR);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('throws PAIError with exitCode 1 when no model can be resolved', () => {
    fc.assert(
      fc.property(
        providerNameArb,
        (someProvider) => {
          // Provider available but no model anywhere
          const config = buildConfig({ defaultProvider: someProvider });
          const options = buildOptions({}); // no CLI --model, no defaultEmbedModel

          expect(() => resolveEmbedModel(options, config)).toThrow(PAIError);
          try {
            resolveEmbedModel(options, config);
          } catch (e) {
            expect(e).toBeInstanceOf(PAIError);
            expect((e as PAIError).exitCode).toBe(ExitCode.PARAMETER_ERROR);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
