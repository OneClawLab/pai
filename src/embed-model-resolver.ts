import type { EmbedOptions, PAIConfig } from './types.js';
import { PAIError, ExitCode } from './types.js';

/**
 * Resolve the embed provider and model from CLI options and config.
 *
 * Priority:
 *   1. CLI --provider / --model
 *   2. PAIConfig.defaultEmbedProvider / defaultEmbedModel
 *   3. PAIConfig.defaultProvider (fallback, but model must be explicitly specified)
 *
 * Throws PAIError (exitCode 1) when provider or model cannot be resolved.
 */
export function resolveEmbedModel(
  options: EmbedOptions,
  config: PAIConfig
): { provider: string; model: string } {
  // --- Resolve provider ---
  const provider =
    options.provider ??
    config.defaultEmbedProvider ??
    config.defaultProvider;

  if (!provider) {
    throw new PAIError(
      'No embed provider specified and no default provider configured',
      ExitCode.ARGUMENT_ERROR
    );
  }

  // --- Resolve model ---
  const model =
    options.model ??
    config.defaultEmbedModel;

  if (!model) {
    throw new PAIError(
      'No embed model specified and no default embed model configured',
      ExitCode.ARGUMENT_ERROR
    );
  }

  return { provider, model };
}
