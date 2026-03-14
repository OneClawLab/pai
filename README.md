# pai

Unix-style CLI for interacting with LLMs. One built-in tool (`bash_exec`), basic session support, and text embedding.

## Features

- 20+ providers (OpenAI, Anthropic, Google, GitHub Copilot, Azure, Bedrock, etc.)
- API Key, OAuth, and cloud credential authentication
- Streaming and non-streaming output
- Session files (JSONL) for multi-turn conversations
- `bash_exec` tool — LLM can run shell commands
- `embed` command — generate text embeddings
- Human-readable (default) and machine-parseable (`--json`) output

## Install

```bash
npm install
npm run build
npm link
```

## Quick Start

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

## Commands

| Command | Description |
|---------|-------------|
| `pai chat [prompt]` | Chat with an LLM (supports tool calling, streaming, sessions) |
| `pai embed [text]` | Generate text embeddings (single or batch) |
| `pai model list` | List configured/available providers |
| `pai model config` | Add, update, delete, or show provider configuration |
| `pai model default` | View or set default provider and embedding model |
| `pai model login` | Interactive OAuth login for supported providers |

## Documentation

- **[USAGE.md](USAGE.md)** — Full usage guide with all providers, options, and examples

