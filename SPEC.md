# pai - LLM interaction CLI command

A Unix-style CLI tool for interacting with LLMs. Supports provider/model configuration, session history, streaming output, and a single built-in tool (`bash_exec`) for local shell access. LLM can use this tool to discover commands and operate local resources.

## 决策记录

1. **单一内置工具**：PAI 仅直接支持一个内置工具 `bash_exec`。LLM 通过这个工具发现命令/操作本地资源，保持工具链简洁。
2. **双输出模式**：同时提供人类可读输出（默认）和机器可解析输出（`--json` / `--stream --json`）。`--json` 实际只影响 stderr 的输出格式，stdout 始终是模型输出。
3. **Session 文件为 JSONL**：会话历史以 JSONL 格式存储，每行一个消息对象，支持多模态内容。并发写入需保证"原子追加或失败"。
4. **配置优先级明确**：CLI 参数 > 环境变量 > 配置文件 > Provider 默认值。凭证来源同理。
5. **日志按需生成**：仅在指定 `--log_file` 时写日志文件，格式固定为 Markdown，内容必须脱敏。

## 1. Role

- **LLM Interaction**: Submit chat requests with support for multi-turn tool calls.
- **Provider Management**: Configure and manage multiple LLM providers and model aliases.
- **Session Management**: Maintain conversation history via JSONL session files.
- **Tool Execution**: Built-in `bash_exec` tool for local shell access.

## 2. Tech Stack & Project Structure

- **TypeScript + ESM** (Node 20+)
- **构建**: tsup (ESM, shebang banner)
- **测试**: vitest (unit, pbt, fixtures)
- **CLI 解析**: commander

## 3. Data Directory Layout

```
~/.config/pai/
└── default.json    # Default config file (JSON, must contain schema_version)
```

- 可通过 `--config <path>` 或 `PAI_CONFIG` 环境变量覆盖。
- 在多环境（dev/staging/prod）场景，推荐每个环境独立配置文件并通过 `PAI_CONFIG` 选择。

## 4. Configuration & Credentials

### 4.1 Config File Requirements

- 配置文件格式为 JSON，必须包含 `schema_version` 字段。
- provider 配置至少包含：`name`、`provider`、认证信息引用（不要求明文）。

### 4.2 Config Priority (high → low)

1. CLI explicit args (`--config`, `--model`, `--system_instruction_text`)
2. Environment variables (`PAI_CONFIG`, `PAI_LANG`)
3. Default config file
4. Provider defaults

### 4.3 Credential Source Priority

1. CLI args (`--set apiKey=...`)
2. Environment variables
3. Config file

> **TODO:** 当前凭证以明文存储在配置文件中。未来考虑集成 OS keyring、1Password CLI 等统一 secret management 方案。

## 5. CLI Commands

### 5.1 `pai model`

Manage providers and model aliases.

#### `pai model list [--all] [--json]`

- 默认仅列出已配置 providers。
- `--all` 列出所有支持 providers（包含未配置项）。
- `--json` 输出稳定数组结构。

JSON output: `[{ "name": string, "provider": string, "configured": boolean, "models": string[] }]`

#### `pai model config --add --name <name> --provider <provider> [--set <k>=<v> ...]`

- `--add` 同时支持新增或替换同名配置。
- 参数校验：`--name` 非空；`--provider` 必须在支持列表中；`--set` 必须满足 `key=value` 格式。

#### `pai model config --delete --name <name>`

- 删除指定名称配置；指定项不存在时返回可解析错误。

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

当 `--session_file` 存在时：

### 6.1 System Instruction

- 若 session 第一条为 `system`：
  - 未提供系统指令参数：沿用该条；
  - 提供系统指令参数：覆盖该条。
- 若 session 不含首条 `system`：采用 CLI/文件输入。

### 6.2 User Input

- 若 session 最后一条为 `user`：
  - 未提供 user 输入参数：沿用该条；
  - 提供 user 输入参数：覆盖该条。
- 若 session 不含末条 `user`：采用 CLI/文件/stdin 输入。

覆盖语义统一定义为"替换目标消息内容，不保留旧内容"。

## 7. Output Format

### 7.1 stdout / stderr Contract

- `stdout`: Final result text or streamable result increments.
- `stderr`: Progress, debug, meta-events, warnings.
- 用户若要获得完整回答，必须读取 `stdout` 全量内容。
- 敏感信息（API key、token、secret 原文）不得输出到 stdout/stderr。

### 7.2 Human / Machine Readability

- Without `--json`: human-readable output.
- With `--json`: machine-parseable output.

对于 stdout: 输出总是模型的输出，和 `--json` 参数无关。
因此 `--json` 参数实际只影响 stderr 的输出格式：
- 有 `--json` 时，stderr 输出为 NDJSON 行的事件流。
- 无 `--json` 时，stderr 输出为人类可读的文本行事件流。

### 7.3 Streaming / Non-streaming

`--stream` 参数主要影响：
1. 内部调用 LLM 时是否使用流式 API；
2. stderr 进度事件是否实时输出。

stdout 始终以流式方式写出（`process.stdout.write`）。当 LLM 以流式返回时，stdout 为真流式；当 LLM 以非流式返回时，stdout 为"假流式"（一次性写出完整内容）。这不影响调用者行为，因为调用者总是需要读取到 EOF。

## 8. Data Protocol

### 8.1 Session File (JSONL)

- 文件格式：JSONL（每行一个 JSON 对象）。

**Message object required fields**:
- `role`: `"system" | "user" | "assistant" | "tool"`
- `content`: `string | object | array`

**Optional fields**: `timestamp` (ISO 8601), `id`

**Content formats**:
- Simple text: string, or `{ "type": "text", "text": "..." }`
- Multimodal: `{ "type": "image_url", "image_url": { "url": "https://..." } }`

**Write & concurrency**:
- 指定 `--session_file` 时，默认在调用成功后追加本轮 `assistant`/`tool` 消息。
- 可通过 `--no-append` 禁用追加。
- 并发写入要求：实现需保证"原子追加或失败"；锁竞争失败返回 IO 错误（退出码 4）。

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
| `1` | Argument or usage error |
| `2` | Local runtime error |
| `3` | External API / provider error |
| `4` | IO / file read-write error (including session append failure) |

### 9.2 Error Output

- Default (no `--json`): human-readable error to `stderr`.
- `--json`: error event to `stderr` (same NDJSON shape as other events), no success body on `stdout`.

Error event structure (unified with all stderr events):
`{ "type": "error", "message": string, "context": object|null, "timestamp": number }`

## 10. Logging

**Args**: `--log_file <path>` — enable per-turn log file.

**Requirements**:
- 仅在指定 `--log_file` 时写日志文件。
- 日志文件格式固定为 Markdown（`.md`）。
- 记录内容为本轮调用日志（请求参数摘要、关键事件、错误信息、结果摘要）。
- 日志内容必须脱敏，不得包含明文凭证。

## 11. Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PAI_CONFIG` | Config file path | `~/.config/pai/default.json` |
| `PAI_LANG` | Output language preference | (system default) |
