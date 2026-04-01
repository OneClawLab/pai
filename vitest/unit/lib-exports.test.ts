import { describe, it, expect } from 'vitest'

describe('src/index.ts - LIB exports', () => {
  it('should export initPai as a function', async () => {
    const { initPai } = await import('../../src/index.js')
    expect(typeof initPai).toBe('function')
  })

  it('should export createBashExecTool as a function', async () => {
    const { createBashExecTool } = await import('../../src/index.js')
    expect(typeof createBashExecTool).toBe('function')
  })

  it('should NOT export chat, loadConfig, resolveProvider (now internal)', async () => {
    const module = await import('../../src/index.js') as Record<string, unknown>
    expect(module['chat']).toBeUndefined()
    expect(module['loadConfig']).toBeUndefined()
    expect(module['resolveProvider']).toBeUndefined()
  })

  it('should have no side effects when imported', async () => {
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
