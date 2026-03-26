# pai

Unix-style CLI for interacting with LLMs, plus a TypeScript library for programmatic access. One built-in tool (`bash_exec`), basic session support, and text embedding.

Note: 
pai is a thin wrapper around @mariozechner/pi-ai (https://github.com/badlogic/pi-mono/tree/main/packages/ai).
Thanks to Mario Zechner for providing this amazing work.

## Features

- **CLI**: Unix-style command-line interface for chat, embeddings, and provider management
- **LIB**: TypeScript library for programmatic LLM access (async generator-based streaming)
- 20+ providers (OpenAI, Anthropic, Google, GitHub Copilot, Azure, Bedrock, etc.)
- API Key, OAuth, and cloud credential authentication
- Streaming and non-streaming output
- Session files (JSONL) for multi-turn conversations
- `bash_exec` tool — LLM can run shell commands
- `embed` command — generate text embeddings
- Human-readable (default) and machine-parseable (`--json`) output

## Install

### From npm

```bash
npm install -g @theclawlab/pai
```

### From source

```bash
npm install
npm run build
npm link
```

## Quick Start

### CLI Usage

```bash
# Configure a provider
pai model config --add --name openai --provider openai --set apiKey=sk-...

# Set as default
pai model default --name openai

# Chat
pai chat "Hello"

# Generate embeddings
pai model default --embed-provider openai --embed-model text-embedding-3-small
pai embed "hello world" --json
```

### Library Usage

```typescript
import { chat, loadConfig, resolveProvider } from '@theclawlab/pai';

// Load configuration
const config = await loadConfig();
const { provider, apiKey } = await resolveProvider(config, 'openai');

// Build chat config
const chatConfig = {
  provider: provider.name,
  model: 'gpt-4o-mini',
  apiKey,
};

// Chat with streaming events
for await (const event of chat(
  { userMessage: 'Hello!' },
  chatConfig,
  process.stdout,  // streaming chunks
  [],              // tools
  new AbortController().signal,
)) {
  switch (event.type) {
    case 'start':
      console.log(`Starting chat with ${event.model}`);
      break;
    case 'complete':
      console.log(`Finished: ${event.finishReason}`);
      break;
    case 'chat_end':
      console.log(`New messages: ${event.newMessages.length}`);
      break;
  }
}
```

## Commands

| Command | Description |
|---------|-------------|
| `pai chat [prompt]` | Chat with an LLM (supports tool calling, streaming, sessions) |
| `pai embed [text]` | Generate text embeddings (single or batch) |
| `pai model list` | List configured/available providers |
| `pai model config` | Add, update, delete, or show provider configuration |
| `pai model default` | View or set default provider and embedding model |
| `pai model login` | Interactive OAuth login for supported providers |

## Library API

### `chat(input, config, chunkWriter, tools, signal, maxTurns?)`

Main chat function. Returns an async generator of `ChatEvent` objects.

**Parameters:**
- `input: ChatInput` — `{ system?, userMessage, history? }`
- `config: ChatConfig` — `{ provider, model, apiKey, stream?, temperature?, ... }`
- `chunkWriter: Writable | null` — Stream for writing chunks (e.g. `process.stdout`)
- `tools: Tool[]` — Available tools (e.g. `[createBashExecTool()]`)
- `signal: AbortSignal` — For cancellation
- `maxTurns?: number` — Max tool-calling turns (default: 100)

**Returns:** `AsyncGenerator<ChatEvent>`

**Events:**
- `{ type: 'start', provider, model, messageCount, toolCount }`
- `{ type: 'complete', finishReason, usage? }`
- `{ type: 'tool_call', callId, name, args }`
- `{ type: 'tool_result', callId, name, result }`
- `{ type: 'chat_end', newMessages }`

### `loadConfig(configPath?)`

Load PAI configuration from file.

**Parameters:**
- `configPath?: string` — Config file path (priority: arg > `PAI_CONFIG` env > `~/.config/pai/default.json`)

**Returns:** `Promise<PAIConfig>`

### `resolveProvider(config, providerName?)`

Resolve provider and API key from config.

**Parameters:**
- `config: PAIConfig` — Configuration object
- `providerName?: string` — Provider name (uses default if omitted)

**Returns:** `Promise<{ provider: ProviderConfig; apiKey: string }>`

### `createBashExecTool()`

Create a bash execution tool for LLM use.

**Returns:** `Tool`

## Documentation

- **[USAGE.md](USAGE.md)** — Full usage guide with all providers, options, and examples

