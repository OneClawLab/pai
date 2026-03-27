# pai - LLM Interaction CLI/LIB Module

A Unix-style CLI tool and library for interacting with LLMs. Supports provider/model configuration, session history, streaming output, and a built-in `bash_exec` tool for local shell access. LLM can use this tool to discover commands and operate local resources.

## Design Principles

1. **Single Built-in Tool**: PAI directly supports one built-in tool `bash_exec`. LLM discovers commands/operates local resources through this tool, keeping the toolchain simple.
2. **Dual Output Mode**: Provides both human-readable output (default) and machine-parseable output (`--json` / `--stream --json`). The `--json` flag affects stderr format only; stdout always contains model output.
3. **Session Files as JSONL**: Conversation history stored in JSONL format (one message per line), supporting multimodal content. Concurrent writes must guarantee "atomic append or fail".
4. **Clear Configuration Priority**: CLI args > environment variables > config file > provider defaults. Credential resolution follows the same hierarchy.
5. **Logging on Demand**: Log files only written when `--log_file` is specified, format fixed as Markdown, content must be sanitized.
6. **CLI/LIB Dual Interface**: Core logic separated into library layer (no CLI dependencies), with CLI as a thin wrapper. Enables direct import by other modules like xar.

## 1. Role

- **LLM Interaction**: Submit chat requests with support for multi-turn tool calls.
- **Provider Management**: Configure and manage multiple LLM providers and model aliases.
- **Session Management**: Maintain conversation history via JSONL session files.
- **Tool Execution**: Built-in `bash_exec` tool for local shell access.
- **Library Interface**: Export core functions for programmatic use by other modules.

## 2. Tech Stack & Project Structure

- **TypeScript + ESM** (Node 22+)
- **Build**: tsup (ESM, shebang banner for CLI)
- **Testing**: vitest (unit, pbt, fixtures)
- **CLI Parsing**: commander

### Directory Structure

```
pai/
├── src/
│   ├── lib/                      ← Core business logic (no CLI dependencies)
│   │   ├── chat.ts               ← chat() main function
│   │   ├── llm-client.ts         ← LLMClient
│   │   ├── config.ts             ← loadConfig / resolveProvider
│   │   ├── model-resolver.ts     ← Model resolution logic
│   │   ├── embedding-client.ts   ← Embedding support
│   │   └── types.ts              ← Shared type definitions
│   ├── tools/
│   │   └── bash-exec.ts          ← createBashExecTool()
│   ├── commands/                 ← CLI subcommands (thin wrappers)
│   │   ├── chat.ts
│   │   ├── embed.ts
│   │   └── model.ts
│   ├── session-manager.ts        ← CLI layer only
│   ├── input-resolver.ts         ← CLI layer only
│   ├── output-formatter.ts       ← CLI layer only
│   ├── index.ts                  ← LIB entry: export lib/ public API
│   ├── cli.ts                    ← CLI entry: argv parsing + dispatch
│   └── help.ts
├── vitest/
├── package.json
├── tsconfig.json
├── tsup.config.ts                ← Dual entry build
├── SPEC.md                       ← This document
└── USAGE.md
```

## 3. Data Directory Layout

```
~/.config/pai/
└── default.json    # Default config file (JSON, must contain schema_version)
```

- Override via `--config <path>` or `PAI_CONFIG` environment variable.
- For multi-environment scenarios (dev/staging/prod), use separate config files per environment and select via `PAI_CONFIG`.

## 4. Configuration & Credentials

### 4.1 Config File Requirements

- Format: JSON, must include `schema_version` field.
- Provider config must include: `name`, `provider`, authentication info reference (not required to be plaintext).

### 4.2 Config Priority (high → low)

1. CLI explicit args (`--config`, `--model`, `--system_instruction_text`)
2. Environment variables (`PAI_CONFIG`, `PAI_LANG`)
3. Default config file
4. Provider defaults

### 4.3 Credential Source Priority

1. CLI args (`--set apiKey=...`)
2. Environment variables
3. Config file

**Future**: Integrate OS keyring, 1Password CLI, or other unified secret management solutions.

## 5. CLI Commands

### 5.1 `pai model`

Manage providers and model aliases.

#### `pai model list [--all] [--json]`

- Default: list configured providers only.
- `--all`: list all supported providers (including unconfigured).
- `--json`: output stable array structure.

JSON output: `[{ "name": string, "provider": string, "configured": boolean, "models": string[] }]`

#### `pai model config --add --name <name> --provider <provider> [--set <k>=<v> ...]`

- `--add`: add or replace configuration with same name.
- Validation: `--name` non-empty; `--provider` in supported list; `--set` matches `key=value` format.

#### `pai model config --delete --name <name>`

- Delete specified configuration; return parseable error if not found.

#### `pai model resolve [--provider <name>] [--model <id>] [--json]`

- Resolve final provider/model using same logic as `pai chat`.
- Output machine-friendly JSON with resolved settings, context window, available models.

### 5.2 `pai chat`

Submit a chat request (may contain multiple tool-call rounds). Supports stdin/pipe, session files, and streaming.

```
pai chat [prompt] [--model <name>] [flags...]
```

**Core Args**:
- `--model <name>` — optional; falls back to provider's `defaultModel`, then first in `models` list, then error
- `--model_params '<json-string>'` or `--model_params_file <path>`
- `--system_instruction_text <text>` or `--system_instruction_file <path>` (mutually exclusive)
- `--user_input_text <text>` (i.e. positional `[prompt]`) or `--user_input_file <path>` (mutually exclusive)
- `--session_file <path>`
- `--no-append` — disable writing results back to session
- `--stream`
- `--json`
- `--log_file <path>` — optional; write this turn's log to file (.md format)

**Model params priority**: `--model_params` > `--model_params_file` > provider default

**stdin behavior** (must be consistent):
1. No stdin: use CLI args or session file only.
2. stdin + `prompt`: stdin as additional context.
3. stdin + no `prompt`: stdin as user input.

## 6. Input Priority & Override Rules

When `--session_file` is present:

### 6.1 System Instruction

- If session's first message is `system`:
  - No system instruction parameter provided: use existing.
  - System instruction parameter provided: override.
- If session has no initial `system`: use CLI/file input.

### 6.2 User Input

- If session's last message is `user`:
  - No user input parameter provided: use existing.
  - User input parameter provided: override.
- If session has no final `user`: use CLI/file/stdin input.

Override semantics: replace target message content, discard old content.

## 7. Output Format

### 7.1 stdout / stderr Contract

- `stdout`: Final result text or streamable result increments.
- `stderr`: Progress, debug, meta-events, warnings.
- Users must read full `stdout` content to get complete answer.
- Sensitive information (API keys, tokens, secrets) must not appear in stdout/stderr.

### 7.2 Human / Machine Readability

- Without `--json`: human-readable output.
- With `--json`: machine-parseable output.

For stdout: always model output, independent of `--json` flag.
The `--json` flag affects stderr format only:
- With `--json`: stderr outputs NDJSON event stream.
- Without `--json`: stderr outputs human-readable text event stream.

### 7.3 Streaming / Non-streaming

`--stream` flag affects:
1. Whether LLM API calls use streaming.
2. Whether stderr progress events output in real-time.

stdout always writes in streaming fashion (`process.stdout.write`). When LLM returns streaming, stdout is true streaming; when LLM returns non-streaming, stdout is "fake streaming" (write complete content at once). This doesn't affect caller behavior since caller must read to EOF.

## 8. Data Protocol

### 8.1 Session File (JSONL)

- Format: JSONL (one JSON object per line).

**Message object required fields**:
- `role`: `"system" | "user" | "assistant" | "tool"`
- `content`: `string | object | array`

**Optional fields**: `timestamp` (ISO 8601), `id`

**Content formats**:
- Simple text: string, or `{ "type": "text", "text": "..." }`
- Multimodal: `{ "type": "image_url", "image_url": { "url": "https://..." } }`

**Write & concurrency**:
- When `--session_file` specified, default behavior appends `assistant`/`tool` messages after successful call.
- Disable via `--no-append`.
- Concurrent writes must guarantee "atomic append or fail"; lock contention failure returns IO error (exit code 4).

**Examples** (single JSONL lines):
```
{"role":"system","content":"...","timestamp":"2026-03-11T12:00:00Z"}
{"role":"user","content":[{"type":"text","text":"what is in this image"},{"type":"image_url","image_url":{"url":"https://example.com/image.png"}}]}
```

**JSON Schema** (simplified):
```json
{
  "type": "object",
  "required": ["role", "content"],
  "properties": {
    "role": { "type": "string", "enum": ["system", "user", "assistant", "tool"] },
    "content": {},
    "timestamp": { "type": "string", "format": "date-time" },
    "id": { "type": "string" }
  }
}
```

## 9. Error Handling & Exit Codes

### 9.1 Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Runtime error (local execution, API call, IO, etc.) |
| `2` | Argument or usage error |
| `3` | External API / provider error (optional, subset of 1) |
| `4` | IO / file read-write error (optional, subset of 1) |

### 9.2 Error Output

- Default (no `--json`): human-readable error to `stderr`.
- `--json`: error event to `stderr` (NDJSON format), no success body on `stdout`.

Error event structure (unified with all stderr events):
`{ "type": "error", "message": string, "context": object|null, "timestamp": number }`

## 10. Logging

**Args**: `--log_file <path>` — enable per-turn log file.

**Requirements**:
- Log files written only when `--log_file` specified.
- Format: fixed as Markdown (`.md`).
- Content: this turn's call log (request summary, key events, errors, result summary).
- Content must be sanitized, no plaintext credentials.

## 12. Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PAI_CONFIG` | Config file path | `~/.config/pai/default.json` |
| `PAI_LANG` | Output language preference | (system default) |

## 12. Library Interface (LIB)

### 12.1 Main Entry (`src/index.ts`)

```typescript
// Core chat function
export { chat } from './lib/chat.js'

// Tools
export { createBashExecTool } from './tools/bash-exec.js'

// Configuration loading
export { loadConfig, resolveProvider } from './lib/config.js'

// Types
export type {
  ChatInput,
  ChatConfig,
  ChatEvent,
  Message,
  MessageContent,
  MessageRole,
  PAIConfig,
  ProviderConfig,
  Tool,
  Usage,
} from './lib/types.js'
```

### 12.2 `chat()` Function

```typescript
import type { Writable } from 'node:stream'

/**
 * Execute one complete chat (one QA round, may contain multiple LLM calls + tool call loops).
 *
 * @param input       Chat input (system prompt, user message, history)
 * @param config      Provider/model/temperature config (already resolved, includes apiKey)
 * @param chunkWriter LLM output text chunk write target.
 *                    CLI passes process.stdout, xar passes IpcChunkWriter, pass null if not needed.
 * @param tools       Available tools list, pass empty array for no tool calls
 * @param signal      AbortSignal for cancellation (SIGTERM/SIGINT)
 * @param maxTurns    Max tool call rounds, default 100
 * @returns           AsyncIterable<ChatEvent>, contains progress events only (not chunks)
 */
export async function* chat(
  input: ChatInput,
  config: ChatConfig,
  chunkWriter: Writable | null,
  tools: Tool[],
  signal: AbortSignal,
  maxTurns?: number,
): AsyncIterable<ChatEvent>
```

**ChatInput**:

```typescript
interface ChatInput {
  // Corresponds to --system / --system-file (caller already read as string)
  system?: string

  // Corresponds to [prompt] / --input-file / stdin (caller already read)
  // Supports multimodal: string or MessageContent array (with images, etc.)
  userMessage: MessageContent

  // History messages from --session (excludes this turn's system/user)
  // xar passes history read from thread
  history?: Message[]
}
```

**ChatConfig**:

```typescript
interface ChatConfig {
  provider: string          // provider name
  model: string             // model name
  apiKey: string            // resolved API key
  stream?: boolean          // use streaming LLM API, default true
  temperature?: number      // corresponds to --temperature
  maxTokens?: number        // corresponds to --max-tokens
  // provider-specific (pass-through from ProviderConfig)
  api?: string
  baseUrl?: string
  reasoning?: boolean
  contextWindow?: number
  providerOptions?: Record<string, unknown>
}
```

**ChatEvent** (progress events only, chunks written via chunkWriter):

```typescript
type ChatEvent =
  // Single LLM call start (may trigger multiple times in tool call loop)
  | { type: 'start';          provider: string; model: string; messageCount: number; toolCount: number }
  // Thinking model reasoning process (not output, not written to chunkWriter)
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_end';   thinking: string }   // complete thinking content
  // Tool call initiated
  | { type: 'tool_call';      callId: string; name: string; args: unknown }
  // Tool call result
  | { type: 'tool_result';    callId: string; name: string; result: unknown }
  // Single LLM call complete
  | { type: 'complete';       finishReason: string; usage?: Usage }
  // One QA round complete, carries all new messages (assistant + tool results)
  | { type: 'chat_end';       newMessages: Message[] }
```

**thinking vs output distinction**:

- `text_delta` (model reply text) → written to `chunkWriter`, is output for user
- `thinking_delta` (model reasoning) → as `ChatEvent` progress event, not written to `chunkWriter`

Caller handling strategies for thinking events:
- CLI: output to stderr in `--verbose` mode, ignore by default
- xar: optionally write to thread as `record` event (for observability), don't forward to xgw

**Event stream example** (with tool call):

```
// --- chunkWriter.write('I'll check that for you') ← direct write, not via event ---
{ type: 'start',       provider: 'openai', model: 'gpt-4o', messageCount: 3, toolCount: 1 }
{ type: 'complete',    finishReason: 'tool_use', usage: { input: 120, output: 15 } }
{ type: 'tool_call',   callId: 'c1', name: 'bash_exec', args: { cmd: 'ls -la' } }
{ type: 'tool_result', callId: 'c1', name: 'bash_exec', result: 'total 8\n...' }
{ type: 'start',       provider: 'openai', model: 'gpt-4o', messageCount: 5, toolCount: 1 }
// --- chunkWriter.write('Based on results, there are 3 files.') ---
{ type: 'complete',    finishReason: 'stop', usage: { input: 200, output: 30 } }
{ type: 'chat_end',    newMessages: [ assistantMsg, toolResultMsg, assistantMsg2 ] }
```

**Caller responsibility mapping**:

| Caller | chunkWriter | ChatEvent consumption | chat_end consumption |
|--------|-------------|----------------------|----------------------|
| CLI | `process.stdout` | `outputFormatter.writeProgress()` → stderr | write to session file |
| xar | `new IpcChunkWriter(conn, sessionId)` | write to thread (record event) | write to thread (message event) |
| test/no-op | `null` | assert as needed | assert as needed |

### 12.3 `createBashExecTool()`

```typescript
/**
 * Create bash_exec tool instance.
 * Caller passes to chat() tools parameter as needed.
 */
export function createBashExecTool(): Tool

interface Tool {
  name: string
  description: string
  parameters: object          // JSON Schema
  handler: (args: unknown, signal?: AbortSignal) => Promise<unknown>
}
```

### 12.4 `loadConfig()` / `resolveProvider()`

```typescript
/**
 * Load PAIConfig from file.
 * configPath priority: parameter > PAI_CONFIG env var > ~/.config/pai/default.json
 */
export async function loadConfig(configPath?: string): Promise<PAIConfig>

/**
 * Resolve specified provider from PAIConfig and resolve API key.
 * Empty providerName uses defaultProvider.
 * Returns provider info and apiKey ready for ChatConfig.
 */
export async function resolveProvider(
  config: PAIConfig,
  providerName?: string,
): Promise<{ provider: ProviderConfig; apiKey: string }>
```

## 13. Build Configuration

### 13.1 `tsup.config.ts` (Dual Entry)

```typescript
import { defineConfig } from 'tsup'

export default defineConfig([
  {
    // LIB entry: no shebang, generate type declarations
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'node22',
    clean: true,
    sourcemap: true,
    dts: true,
  },
  {
    // CLI entry: with shebang, no type declarations
    entry: ['src/cli.ts'],
    format: ['esm'],
    target: 'node22',
    sourcemap: true,
    dts: false,
    banner: { js: '#!/usr/bin/env node' },
  },
])
```

### 13.2 `package.json` Exports

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "pai": "./dist/cli.js"
  }
}
```

## 14. Design Constraints (CLI/LIB Module Pattern)

Follows [CLI-LIB-Module-Spec.md](../TheClaw/CLI-LIB-Module-Spec.md) conventions:

1. **Error Handling**: `chat()` throws `PAIError`, CLI layer catches and converts to exit code.
2. **Streaming**: Chunks written to caller-provided `Writable`, progress via `AsyncIterable<ChatEvent>`.
3. **Config Injection**: `chat()` accepts already-resolved `ChatConfig`, doesn't load from filesystem.
4. **No Side Effects**: Importing pai produces no side effects.

## 15. Known Limitations & Future Work

### P0 — Blocking

- `--model_params` / `--model_params_file` not yet implemented (SPEC defines but not wired)
- Atomic session file writes need file locking (currently uses plain `appendFile`)
- Bedrock / Vertex AI credential handling incomplete

### P1 — Important

- README.md needs content (installation, quick start, architecture)
- CI/CD pipeline not set up
- bash_exec safety model needs documentation

### P2 — Quality

- Some `any` types in LLM client (minimal changes planned)
- E2E test script is bash-only (not Windows-compatible)

### P3 — Nice-to-Have

- Credential plaintext in config (future: support `credentialCommand` field)
- Global default chat model (optional enhancement)
- Model validation at config time

## 16. Compatibility

- CLI behavior fully backward-compatible with v1.
- All `pai chat` / `pai model` / `pai embed` commands unchanged.
- Session file format (JSONL) unchanged.
- Config file format unchanged.
- Error codes and environment variables unchanged.
