import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Message } from '../../src/lib/types.js'

// ── Mock LLMClient ────────────────────────────────────────────────────────────

type MockInstance = {
  chat: ReturnType<typeof vi.fn>
  chatComplete: ReturnType<typeof vi.fn>
}

let _mock: MockInstance

/**
 * Two-turn scenario: first call returns a tool call, second returns plain text.
 */
function makeTwoTurnMock(): MockInstance {
  let call = 0
  return {
    chat: vi.fn(),
    chatComplete: vi.fn(async () => {
      call++
      if (call === 1) {
        return {
          content: '',
          finishReason: 'tool_calls',
          usage: { input: 10, output: 2 },
          toolCalls: [{ id: 'tc-1', name: 'noop', arguments: {} }],
        }
      }
      return { content: 'Final answer', finishReason: 'stop', usage: { input: 15, output: 5 } }
    }),
  }
}

vi.mock('../../src/lib/llm-client.js', () => {
  class LLMClient {
    chat(...args: unknown[]) { return (_mock.chat as Function)(...args) }
    chatComplete(...args: unknown[]) { return (_mock.chatComplete as Function)(...args) }
  }
  return { LLMClient }
})

import { chat } from '../../src/lib/chat.js'
import type { ChatConfig, ChatHooks, Tool } from '../../src/lib/types.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const config: ChatConfig = { provider: 'openai', model: 'gpt-4', apiKey: 'sk-test' }
const signal = new AbortController().signal

const noopTool: Tool = {
  name: 'noop',
  description: 'no-op',
  parameters: {},
  handler: async () => ({ ok: true }),
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('chat() - onBeforeNextTurn hook', () => {
  beforeEach(() => {
    _mock = makeTwoTurnMock()
  })

  it('hook is called once between the two LLM turns', async () => {
    const hookCalls: number[] = []
    const hooks: ChatHooks = {
      onBeforeNextTurn: async (_msgs) => {
        hookCalls.push(Date.now())
        return []
      },
    }

    for await (const _ of chat({ userMessage: 'hi' }, config, null, [noopTool], signal, undefined, hooks)) { /* consume */ }

    expect(hookCalls).toHaveLength(1)
  })

  it('hook receives the current messages array (read-only snapshot)', async () => {
    let capturedLen = 0
    const hooks: ChatHooks = {
      onBeforeNextTurn: async (msgs) => {
        capturedLen = msgs.length
        return []
      },
    }

    for await (const _ of chat({ userMessage: 'hi' }, config, null, [noopTool], signal, undefined, hooks)) { /* consume */ }

    // system is absent, so: user + assistant(tool_call) + tool_result = 3
    expect(capturedLen).toBe(3)
  })

  it('messages returned by hook are injected before the next LLM call', async () => {
    const injected: Message = { role: 'user', content: 'mid-turn update' }
    const hooks: ChatHooks = {
      onBeforeNextTurn: async () => [injected],
    }

    const allNewMessages: Message[] = []
    for await (const event of chat({ userMessage: 'hi' }, config, null, [noopTool], signal, undefined, hooks)) {
      if (event.type === 'chat_end') allNewMessages.push(...event.newMessages)
    }

    // The injected message must appear in newMessages
    expect(allNewMessages.some(m => m.content === 'mid-turn update')).toBe(true)
  })

  it('second LLM call receives the injected message in its input', async () => {
    const injected: Message = { role: 'user', content: 'injected' }
    const hooks: ChatHooks = {
      onBeforeNextTurn: async () => [injected],
    }

    for await (const _ of chat({ userMessage: 'hi' }, config, null, [noopTool], signal, undefined, hooks)) { /* consume */ }

    // chatComplete is called twice; the second call's messages array should include the injected one
    expect(_mock.chatComplete).toHaveBeenCalledTimes(2)
    const secondCallMessages = (_mock.chatComplete as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as Message[]
    expect(secondCallMessages.some((m: Message) => m.content === 'injected')).toBe(true)
  })

  it('hook returning [] does not inject anything', async () => {
    const hooks: ChatHooks = {
      onBeforeNextTurn: async () => [],
    }

    const allNewMessages: Message[] = []
    for await (const event of chat({ userMessage: 'hi' }, config, null, [noopTool], signal, undefined, hooks)) {
      if (event.type === 'chat_end') allNewMessages.push(...event.newMessages)
    }

    // Only assistant + tool_result + final assistant — no extra user messages
    const userMessages = allNewMessages.filter(m => m.role === 'user')
    expect(userMessages).toHaveLength(0)
  })

  it('hook throwing does not crash the chat loop', async () => {
    // hook errors should propagate (caller decides how to handle)
    const hooks: ChatHooks = {
      onBeforeNextTurn: async () => { throw new Error('hook error') },
    }

    await expect(async () => {
      for await (const _ of chat({ userMessage: 'hi' }, config, null, [noopTool], signal, undefined, hooks)) { /* consume */ }
    }).rejects.toThrow('hook error')
  })

  it('no hook provided — chat completes normally without error', async () => {
    const events: string[] = []
    for await (const event of chat({ userMessage: 'hi' }, config, null, [noopTool], signal)) {
      events.push(event.type)
    }

    expect(events[0]).toBe('start')
    expect(events[events.length - 1]).toBe('chat_end')
  })
})
