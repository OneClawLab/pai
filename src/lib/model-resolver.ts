import { getModels } from '../pi-ai.js';
import type { ProviderConfig } from './types.js';

export interface ResolvedModel {
  provider: string;
  model: string;
  contextWindow: number | undefined;
  maxTokens: number | undefined;
  temperature: number | undefined;
}

export interface ResolveModelOptions {
  /** Explicit model override (e.g. from --model CLI flag) */
  model?: string | undefined;
  /** Explicit temperature override */
  temperature?: number | undefined;
  /** Explicit maxTokens override */
  maxTokens?: number | undefined;
}

/**
 * Resolve the effective model for a given provider config.
 * Resolution order:
 *   1. options.model (CLI flag)
 *   2. provider.defaultModel
 *   3. provider.models[0]
 *   4. pi-ai registry getModels(provider)[0]
 *
 * Returns null for model if none can be resolved.
 */
export function resolveModel(
  provider: ProviderConfig,
  options: ResolveModelOptions = {}
): ResolvedModel & { modelSource: 'cli' | 'providerDefault' | 'providerModels' | 'registry' | 'none' } {
  let model: string | undefined;
  let modelSource: 'cli' | 'providerDefault' | 'providerModels' | 'registry' | 'none' = 'none';

  if (options.model) {
    model = options.model;
    modelSource = 'cli';
  } else if (provider.defaultModel) {
    model = provider.defaultModel;
    modelSource = 'providerDefault';
  } else if (provider.models && provider.models.length > 0) {
    model = provider.models[0];
    modelSource = 'providerModels';
  } else {
    try {
      const knownModels = getModels(provider.name as any);
      if (knownModels.length > 0) {
        model = knownModels[0]!.id;
        modelSource = 'registry';
      }
    } catch {
      // Provider not recognized by pi-ai
    }
  }

  return {
    provider: provider.name,
    model: model ?? '',
    modelSource,
    contextWindow: provider.contextWindow,
    maxTokens: options.maxTokens ?? provider.maxTokens,
    temperature: options.temperature ?? provider.temperature,
  };
}

/**
 * Get available models for a provider from pi-ai registry.
 * Returns empty array if provider is not in registry.
 */
export function getRegistryModels(providerName: string): string[] {
  try {
    return getModels(providerName as any).map((m) => m.id);
  } catch {
    return [];
  }
}

/**
 * Validate that a model id is usable for the provider.
 * Returns a user-facing error message if invalid, or null when it is valid.
 */
export function validateModelId(
  modelId: string,
  provider: ProviderConfig
): string | null {
  // Custom API providers can use deployment-specific model ids that are not
  // present in pi-ai's built-in registry.
  if (provider.api) return null;

  // Check configured models list first
  if (provider.models && provider.models.length > 0) {
    if (!provider.models.includes(modelId)) {
      return `Unsupported model "${modelId}" for provider "${provider.name}". Configured models: [${provider.models.join(', ')}]`;
    }
    return null;
  }

  // Fall back to registry check
  const registryModels = getRegistryModels(provider.name);
  if (registryModels.length > 0 && !registryModels.includes(modelId)) {
    return `Unsupported model "${modelId}" for provider "${provider.name}". Available models: [${registryModels.join(', ')}]`;
  }

  return null;
}
