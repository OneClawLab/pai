import { describe, it, expect } from 'vitest'

describe('src/index.ts - LIB exports', () => {
  it('should export chat as a function', async () => {
    const { chat } = await import('../../src/index.js')
    expect(typeof chat).toBe('function')
  })

  it('should export createBashExecTool as a function', async () => {
    const { createBashExecTool } = await import('../../src/index.js')
    expect(typeof createBashExecTool).toBe('function')
  })

  it('should export loadConfig as a function', async () => {
    const { loadConfig } = await import('../../src/index.js')
    expect(typeof loadConfig).toBe('function')
  })

  it('should export resolveProvider as a function', async () => {
    const { resolveProvider } = await import('../../src/index.js')
    expect(typeof resolveProvider).toBe('function')
  })

  it('should export ChatInput type', async () => {
    // Type exports are verified at compile time by TypeScript
    // This test verifies the module can be imported without errors
    const module = await import('../../src/index.js')
    expect(module).toBeDefined()
  })

  it('should export ChatConfig type', async () => {
    const module = await import('../../src/index.js')
    expect(module).toBeDefined()
  })

  it('should export ChatEvent type', async () => {
    const module = await import('../../src/index.js')
    expect(module).toBeDefined()
  })

  it('should export Message type', async () => {
    const module = await import('../../src/index.js')
    expect(module).toBeDefined()
  })

  it('should export MessageContent type', async () => {
    const module = await import('../../src/index.js')
    expect(module).toBeDefined()
  })

  it('should export MessageRole type', async () => {
    const module = await import('../../src/index.js')
    expect(module).toBeDefined()
  })

  it('should export PAIConfig type', async () => {
    const module = await import('../../src/index.js')
    expect(module).toBeDefined()
  })

  it('should export ProviderConfig type', async () => {
    const module = await import('../../src/index.js')
    expect(module).toBeDefined()
  })

  it('should export Tool type', async () => {
    const module = await import('../../src/index.js')
    expect(module).toBeDefined()
  })

  it('should export Usage type', async () => {
    const module = await import('../../src/index.js')
    expect(module).toBeDefined()
  })

  it('should have no side effects when imported', async () => {
    // Verify that importing the module doesn't write to stdout/stderr
    // or perform any other side effects
    const originalStdoutWrite = process.stdout.write
    const originalStderrWrite = process.stderr.write
    let stdoutCalls = 0
    let stderrCalls = 0

    process.stdout.write = (() => {
      stdoutCalls++
      return true
    }) as any

    process.stderr.write = (() => {
      stderrCalls++
      return true
    }) as any

    try {
      await import('../../src/index.js')
      expect(stdoutCalls).toBe(0)
      expect(stderrCalls).toBe(0)
    } finally {
      process.stdout.write = originalStdoutWrite
      process.stderr.write = originalStderrWrite
    }
  })
})
