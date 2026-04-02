import { describe, it, expect } from 'vitest'
import { sanitizeString, sanitizeContent } from '../../src/sanitize.js'

describe('sanitizeString', () => {
  it('redacts OpenAI key (sk-...)', () => {
    const input = 'key is sk-abcdefghijklmnopqrstuvwxyz1234567890'
    const { sanitized, secrets } = sanitizeString(input)
    expect(sanitized).not.toContain('sk-abcdefghijklmnopqrstuvwxyz1234567890')
    expect(secrets.length).toBeGreaterThan(0)
  })

  it('redacts Anthropic key (sk-ant-...)', () => {
    const input = 'Authorization: sk-ant-api03-abcdefghijklmnop'
    const { sanitized } = sanitizeString(input)
    expect(sanitized).not.toContain('sk-ant-api03-abcdefghijklmnop')
  })

  it('redacts Bearer token', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9'
    const { sanitized } = sanitizeString(input)
    expect(sanitized).toContain('Bearer ***REDACTED***')
  })

  it('redacts URL query param api_key', () => {
    const input = 'https://api.example.com/v1?api_key=supersecretvalue123&other=ok'
    const { sanitized } = sanitizeString(input)
    expect(sanitized).not.toContain('supersecretvalue123')
    expect(sanitized).toContain('***REDACTED***')
  })

  it('does not modify strings without sensitive info', () => {
    const input = 'Hello, world! This is a normal string.'
    const { sanitized, secrets } = sanitizeString(input)
    expect(sanitized).toBe(input)
    expect(secrets.length).toBe(0)
  })

  it('returns original when input is empty', () => {
    const { sanitized } = sanitizeString('')
    expect(sanitized).toBe('')
  })
})

describe('sanitizeContent', () => {
  it('redacts sensitive key apiKey', () => {
    const obj = { apiKey: 'sk-supersecret', name: 'openai' }
    const { sanitized } = sanitizeContent(obj)
    expect(sanitized.apiKey).toBe('***REDACTED***')
    expect(sanitized.name).toBe('openai')
  })

  it('redacts sensitive key token', () => {
    const obj = { token: 'mytoken123', user: 'alice' }
    const { sanitized } = sanitizeContent(obj)
    expect(sanitized.token).toBe('***REDACTED***')
    expect(sanitized.user).toBe('alice')
  })

  it('redacts sensitive key password', () => {
    const obj = { password: 'hunter2', host: 'localhost' }
    const { sanitized } = sanitizeContent(obj)
    expect(sanitized.password).toBe('***REDACTED***')
    expect(sanitized.host).toBe('localhost')
  })

  it('recursively processes nested objects', () => {
    const obj = { outer: { inner: { apiKey: 'sk-nested', safe: 'value' } } }
    const { sanitized } = sanitizeContent(obj)
    expect(sanitized.outer.inner.apiKey).toBe('***REDACTED***')
    expect(sanitized.outer.inner.safe).toBe('value')
  })

  it('recursively processes arrays', () => {
    const obj = { providers: [{ apiKey: 'sk-one' }, { apiKey: 'sk-two' }] }
    const { sanitized } = sanitizeContent(obj)
    expect(sanitized.providers[0].apiKey).toBe('***REDACTED***')
    expect(sanitized.providers[1].apiKey).toBe('***REDACTED***')
  })

  it('does not modify non-sensitive fields', () => {
    const obj = { name: 'test', version: '1.0.0', count: 42 }
    const { sanitized } = sanitizeContent(obj)
    expect(sanitized).toEqual(obj)
  })

  it('handles null and undefined gracefully', () => {
    expect(sanitizeContent(null).sanitized).toBeNull()
    expect(sanitizeContent(undefined).sanitized).toBeUndefined()
  })
})
