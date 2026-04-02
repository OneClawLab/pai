import { describe, it, expect, vi } from 'vitest'
import { validateModelId, getRegistryModels, resolveModel } from '../../src/model-resolver.js'
import type { ProviderConfig } from '../../src/types.js'

// Mock pi-ai so tests don't need real network
vi.mock('@mariozechner/pi-ai', () => ({
  getModels: (provider: string) => {
    if (provider === 'openai') return [{ id: 'gpt-4o' }, { id: 'gpt-4-turbo' }]
    if (provider === 'anthropic') return [{ id: 'claude-3-5-sonnet' }]
    throw new Error(`Unknown provider: ${provider}`)
  },
}))

const baseProvider: ProviderConfig = {
  name: 'openai',
  models: ['gpt-4o', 'gpt-4-turbo'],
}

describe('validateModelId', () => {
  it('returns null when model is in configured models list', () => {
    expect(validateModelId('gpt-4o', baseProvider)).toBeNull()
  })

  it('returns warning string when model is not in configured models list', () => {
    const result = validateModelId('gpt-99-unknown', baseProvider)
    expect(typeof result).toBe('string')
    expect(result).toContain('gpt-99-unknown')
    expect(result).toContain('openai')
  })

  it('falls back to registry when no models list configured', () => {
    const provider: ProviderConfig = { name: 'openai' }
    // gpt-4o is in registry mock
    expect(validateModelId('gpt-4o', provider)).toBeNull()
  })

  it('returns warning when model not in registry and no models list', () => {
    const provider: ProviderConfig = { name: 'openai' }
    const result = validateModelId('gpt-99-unknown', provider)
    expect(typeof result).toBe('string')
  })

  it('returns null for unknown provider (registry throws, no list)', () => {
    const provider: ProviderConfig = { name: 'unknown-provider' }
    // registry throws → no registry models → returns null (can't validate)
    expect(validateModelId('any-model', provider)).toBeNull()
  })
})

describe('getRegistryModels', () => {
  it('returns model ids for known provider', () => {
    const models = getRegistryModels('openai')
    expect(models).toContain('gpt-4o')
    expect(models).toContain('gpt-4-turbo')
  })

  it('returns empty array for unknown provider', () => {
    const models = getRegistryModels('totally-unknown-xyz')
    expect(models).toEqual([])
  })
})

describe('resolveModel', () => {
  it('uses CLI model option when provided', () => {
    const result = resolveModel(baseProvider, { model: 'gpt-4-turbo' })
    expect(result.model).toBe('gpt-4-turbo')
    expect(result.modelSource).toBe('cli')
  })

  it('uses provider defaultModel when no CLI option', () => {
    const provider: ProviderConfig = { name: 'openai', defaultModel: 'gpt-4o' }
    const result = resolveModel(provider)
    expect(result.model).toBe('gpt-4o')
    expect(result.modelSource).toBe('providerDefault')
  })

  it('uses first model from models list when no default', () => {
    const result = resolveModel(baseProvider)
    expect(result.model).toBe('gpt-4o')
    expect(result.modelSource).toBe('providerModels')
  })

  it('falls back to registry when no models configured', () => {
    const provider: ProviderConfig = { name: 'anthropic' }
    const result = resolveModel(provider)
    expect(result.model).toBe('claude-3-5-sonnet')
    expect(result.modelSource).toBe('registry')
  })
})
