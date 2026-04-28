import type { ImageOptions, PAIConfig } from './types.js';
import { PAIError, ExitCode } from './types.js';

/**
 * Resolve the image provider and model from CLI options and config.
 *
 * Priority:
 *   1. CLI --provider / --model
 *   2. PAIConfig.defaultImageProvider / defaultImageModel
 *   3. PAIConfig.defaultProvider (fallback, but model must be explicitly specified)
 *
 * Throws PAIError (exitCode 2) when provider or model cannot be resolved.
 */
export function resolveImageModel(
  options: ImageOptions,
  config: PAIConfig
): { provider: string; model: string } {
  // --- Resolve provider ---
  const provider =
    options.provider ??
    config.defaultImageProvider ??
    config.defaultProvider;

  if (!provider) {
    throw new PAIError(
      'No image provider specified and no default provider configured',
      ExitCode.ARGUMENT_ERROR
    );
  }

  // --- Resolve model ---
  const model =
    options.model ??
    config.defaultImageModel;

  if (!model) {
    throw new PAIError(
      'No image model specified and no default image model configured',
      ExitCode.ARGUMENT_ERROR
    );
  }

  return { provider, model };
}
