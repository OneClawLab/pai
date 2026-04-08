/**
 * Pai instance — encapsulates provider config so callers never touch
 * apiKey / baseUrl / api / providerOptions directly.
 *
 * Usage:
 *   const pai = await initPai()
 *   for await (const ev of pai.chat(input)) { ... }
 *   for await (const ev of pai.chat(input, { model: 'gpt-4.1-mini', stream: false })) { ... }
 */

import type { Writable } from 'node:stream'
import type { ChatInput, ChatEvent, Tool, ChatHooks, PAIConfig, ProviderConfig } from './types.js'
import { chat } from './chat.js'
import { loadConfig, resolveProvider } from './config.js'

export interface ChatOptions {
  provider?: string | undefined
  model?: string | undefined
  stream?: boolean | undefined
  temperature?: number | undefined
  maxTokens?: number | undefined
  maxTurns?: number | undefined
}

export interface ProviderInfo {
  name: string
  defaultModel?: string | undefined
  contextWindow?: number | undefined
  maxTokens?: number | undefined
}

export interface Pai {
  chat(
    input: ChatInput,
    opts?: ChatOptions,
    chunkWriter?: Writable | null,
    tools?: Tool[],
    signal?: AbortSignal,
    hooks?: ChatHooks,
  ): AsyncGenerator<ChatEvent>

  /** Get resolved provider info (for context window / budget calculations) */
  getProviderInfo(providerName?: string): Promise<ProviderInfo>
}

export async function initPai(configPath?: string): Promise<Pai> {
  const config: PAIConfig = await loadConfig(configPath)

  // Cache resolved providers to avoid re-resolving on every call
  const resolvedCache = new Map<string, { provider: ProviderConfig; apiKey: string }>()

  async function resolve(providerName?: string): Promise<{ provider: ProviderConfig; apiKey: string }> {
    const key = providerName ?? config.defaultProvider ?? '__default__'
    const cached = resolvedCache.get(key)
    if (cached) return cached
    const result = await resolveProvider(config, providerName)
    resolvedCache.set(key, result)
    return result
  }

  return {
    async *chat(
      input: ChatInput,
      opts?: ChatOptions,
      chunkWriter?: Writable | null,
      tools?: Tool[],
      signal?: AbortSignal,
      hooks?: ChatHooks,
    ): AsyncGenerator<ChatEvent> {
      const { provider, apiKey } = await resolve(opts?.provider)

      const modelName = opts?.model ?? provider.defaultModel

      if (!modelName) {
        throw new Error(
          `No model specified and no default model configured for provider "${provider.name}"`,
        )
      }

      const chatConfig = {
        provider: provider.name,
        model: modelName,
        apiKey,
        ...(opts?.stream !== undefined && { stream: opts.stream }),
        ...(opts?.temperature !== undefined && { temperature: opts.temperature }),
        ...(opts?.maxTokens !== undefined && { maxTokens: opts.maxTokens }),
        ...(provider.api !== undefined && { api: provider.api }),
        ...(provider.baseUrl !== undefined && { baseUrl: provider.baseUrl }),
        ...(provider.reasoning !== undefined && { reasoning: provider.reasoning }),
        ...(provider.contextWindow !== undefined && { contextWindow: provider.contextWindow }),
        ...(provider.providerOptions !== undefined && { providerOptions: provider.providerOptions }),
      }

      yield* chat(input, chatConfig, chunkWriter ?? null, tools ?? [], signal ?? new AbortController().signal, opts?.maxTurns, hooks)
    },

    async getProviderInfo(providerName?: string): Promise<ProviderInfo> {
      const { provider } = await resolve(providerName)
      return {
        name: provider.name,
        defaultModel: provider.defaultModel,
        contextWindow: provider.contextWindow,
        maxTokens: provider.maxTokens,
      }
    },
  }
}
