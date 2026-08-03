/**
 * Internal adapter (anti-corruption layer) over @earendil-works/pi-ai.
 *
 * pai talks to pi-ai's LLM surface only through this module (auth goes through
 * oauth-provider.ts). pi-ai 0.83 split its old global API: static catalog reads
 * moved to `providers/all`, and low-level streaming lives in the per-api modules
 * under `api/*` (each exports `stream`/`streamSimple`, satisfying
 * `ProviderStreams`). Concentrating that surface here keeps the rest of pai
 * insulated from further upstream churn and avoids the deprecated `/compat`
 * entrypoint entirely.
 */
import { lazyStream } from '@earendil-works/pi-ai';
import {
  getBuiltinModel,
  getBuiltinModels,
  getBuiltinProviders,
} from '@earendil-works/pi-ai/providers/all';
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  ProviderStreams,
  StreamOptions,
} from '@earendil-works/pi-ai';

// ---------------------------------------------------------------------------
// Static catalog reads (were global `getModel`/`getModels`/`getProviders`).
// pai passes provider/model as free-form strings; the built-in catalog readers
// are strongly typed over the generated `MODELS` map, so we widen here.
// ---------------------------------------------------------------------------

export function getModel(provider: string, modelId: string): Model<Api> {
  return getBuiltinModel(provider as never, modelId as never) as Model<Api>;
}

export function getModels(provider: string): Model<Api>[] {
  return getBuiltinModels(provider as never) as Model<Api>[];
}

export function getProviders(): string[] {
  return getBuiltinProviders();
}

// ---------------------------------------------------------------------------
// Streaming: dispatch on `model.api` to the matching per-api implementation.
// Module name === api id; the module namespace satisfies `ProviderStreams`.
// ---------------------------------------------------------------------------

type ProviderStreamsLoader = () => Promise<ProviderStreams>;

const API_LOADERS: Record<string, ProviderStreamsLoader> = {
  'openai-completions': () => import('@earendil-works/pi-ai/api/openai-completions'),
  'openai-responses': () => import('@earendil-works/pi-ai/api/openai-responses'),
  'azure-openai-responses': () => import('@earendil-works/pi-ai/api/azure-openai-responses'),
  'openai-codex-responses': () => import('@earendil-works/pi-ai/api/openai-codex-responses'),
  'anthropic-messages': () => import('@earendil-works/pi-ai/api/anthropic-messages'),
  'bedrock-converse-stream': () => import('@earendil-works/pi-ai/api/bedrock-converse-stream'),
  'google-generative-ai': () => import('@earendil-works/pi-ai/api/google-generative-ai'),
  'google-vertex': () => import('@earendil-works/pi-ai/api/google-vertex'),
  'mistral-conversations': () => import('@earendil-works/pi-ai/api/mistral-conversations'),
  'pi-messages': () => import('@earendil-works/pi-ai/api/pi-messages'),
};

const streamsCache = new Map<string, Promise<ProviderStreams>>();

function resolveProviderStreams(api: Api): Promise<ProviderStreams> {
  const key = String(api);
  const loader = API_LOADERS[key];
  if (!loader) {
    throw new Error(
      `Unsupported pi-ai api "${key}". Supported: ${Object.keys(API_LOADERS).join(', ')}`,
    );
  }
  let cached = streamsCache.get(key);
  if (!cached) {
    cached = loader();
    streamsCache.set(key, cached);
  }
  return cached;
}

/**
 * Stream a model, dispatching on `model.api`. Returns synchronously via
 * `lazyStream` while the per-api implementation loads behind the stream.
 */
export function stream(
  model: Model<Api>,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream {
  return lazyStream(model, async (): Promise<AsyncIterable<AssistantMessageEvent>> => {
    const provider = await resolveProviderStreams(model.api);
    return provider.stream(model, context, options);
  });
}

/** Run a model to completion, returning the final assistant message. */
export function complete(
  model: Model<Api>,
  context: Context,
  options?: StreamOptions,
): Promise<AssistantMessage> {
  return stream(model, context, options).result();
}
