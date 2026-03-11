# PAI
pai is a linux command to interact with LLMs (with only one bash_exec tool and basic session support).

## 概述
PAI 是面向终端用户的 Unix 风格命令行工具，用于：
- 调用 LLM；
- 管理 provider 与模型配置；
- 维护会话历史；
- 通过内置工具 `bash_exec` 调用本地 shell 能力。

PAI 仅直接支持一个内置工具：`bash_exec`。LLM可以使用这个工具发现命令/操作本地资源。

PAI 同时提供两类输出：
- 人类可读输出（默认）；
- 机器可解析输出（`--json` / `--stream --json`）。

## 全局约定

### 配置优先级（高到低）
1. CLI 显式参数（如 `--config`、`--model`、`--system_instruction_text`）
2. 环境变量（如 `PAI_CONFIG`、`PAI_LANG`）
3. 默认配置文件
4. Provider 默认值

### 默认路径与运行环境
- 默认配置文件：`~/config/pai/default.json`
- 可通过 `--config <path>` 或 `PAI_CONFIG` 覆盖。
- 在多环境（dev/staging/prod）场景，推荐每个环境独立配置文件并通过 `PAI_CONFIG` 选择。

### 输出与信息分级
- 默认输出人类可读文本。
- 指定 `--json` 后输出稳定的机器可解析结构。
- 敏感信息（API key、token、secret 原文）不得输出到 stdout/stderr。


## 配置与凭证

### 配置文件要求
- 配置文件格式为 JSON。
- 必须包含 `schema_version` 字段。
- provider 配置至少包含：`name`、`provider`、认证信息引用（不要求明文）。

### 凭证来源优先级
1. CLI 参数（如 `--secret-file`）
2. 环境变量
3. 配置文件

## CLI 命令规范

### model
用途：管理 providers 与模型别名。

#### `model list`
语法：
- `pai model list [--all] [--json]`

行为：
- 默认仅列出已配置 providers。
- `--all` 列出所有支持 providers（包含未配置项）。
- `--json` 输出稳定数组结构。

JSON 输出字段：
`[{ "name": string, "provider": string, "configured": boolean, "models": string[] }]`

#### `model config --add`
语法：
- `pai model config --add --name <name> --provider <provider> [--secret-file <path>] [--set <k>=<v> ...]`

行为：
- `--add` 同时支持新增或替换同名配置。

参数校验：
- `--name` 非空；
- `--provider` 必须在支持列表中；
- `--secret-file` 存在且可读；
- `--set` 必须满足 `key=value` 格式。

#### `model config --delete`
语法：
- `pai model config --delete --name <name>`

行为：
- 删除指定名称配置；
- 指定项不存在时返回可解析错误（见错误章节）。


### chat
用途：提交一次人机对话请求(可内含多轮tool call)，支持 stdin/pipe、session file 和流式输出。

语法：
- `pai chat [prompt] --model <name> [flags...]`

核心参数：
- `--model <name>`（必填，必须是已配置模型）
- `--model_params '<json-string>'` 或 `--model_params_file <path>`
- `--system_instruction_text <text>` 或 `--system_instruction_file <path>`（二选一）
- `--user_input_text <text>` 或 `--user_input_file <path>`（二选一）
- `--session_file <path>`
- `--no-append`（禁用本轮结果回写 session）
- `--stream`
- `--json`
- `--log_file <path>`（可选；指定时将本轮日志写入该文件，`.md` 格式）

模型参数优先级：
`--model_params` > `--model_params_file` > provider default

stdin 行为（必须一致）：
1. 无 stdin：仅使用 CLI 参数或 session file。
2. 有 stdin 且提供 `prompt`：stdin 作为额外上下文。
3. 有 stdin 且不提供 `prompt`：stdin 作为用户输入。


## 输入优先级与覆盖规则

当 `--session_file` 存在时：

### system 指令
- 若 session 第一条为 `system`：
  - 未提供系统指令参数：沿用该条；
  - 提供系统指令参数：覆盖该条。
- 若 session 不含首条 `system`：采用 CLI/文件输入。

### user 输入
- 若 session 最后一条为 `user`：
  - 未提供 user 输入参数：沿用该条；
  - 提供 user 输入参数：覆盖该条。
- 若 session 不含末条 `user`：采用 CLI/文件/stdin 输入。

覆盖语义统一定义为“替换目标消息内容，不保留旧内容”。

## 输出方式

### stdout / stderr 契约
- `stdout`：最终结果文本或可拼接的结果增量。
- `stderr`：进度、调试、元事件、告警信息。
- 用户若要获得完整回答，必须读取 `stdout` 全量内容。

### 人/机 可读性
无 --json 参数时，为面向人类可读的输出。
有 --json 参数时，为面向机器可读的输出。

对于 stdout: 输出总是模型的输出，和 --json 参数 无关。
因此 --json 参数实际只影响 stderr的输出格式:
  有 --json 时，输出为NDJSON行的事件流。
  无 --json 时，输出为人类可读的文本行事件流。

### 流式/非流式
无 --stream 参数时，为非流式调用:
  stderr 将在特定的时间点，按事件输出进度信息。
  stdout 将在正常结束时一次性输出整个模型响应的结果。
有 --stream 参数时，为流式调用:
  stderr 同上，将在特定的时间点，按事件输出进度信息。
  stdout 将会流式输出模型响应的结果。

## session file（JSONL）规范

### 基本格式
- 文件格式：JSONL（每行一个 JSON 对象）。

### 消息对象
- 必需字段：
  - `role`：`"system" | "user" | "assistant" | "tool"`
  - `content`：`string | object | array`
- 可选字段：
  - `timestamp`（ISO8601）
  - `id`

### content 兼容格式
- 简单文本：字符串，或 `{ "type": "text", "text": "..." }`
- 多模态片段示例：
  - `{ "type": "image_url", "image_url": { "url": "https://..." } }`

### 写入与并发
- 指定 `--session_file` 时，默认在调用成功后追加本轮 `assistant`/`tool` 消息。
- 可通过 `--no-append` 禁用追加。
- 并发写入要求：
  - 实现需保证“原子追加或失败”；
  - 锁竞争失败返回 IO 错误（退出码见下）。

示例（单行 JSONL）：
`{"role":"system","content":"...","timestamp":"2026-03-11T12:00:00Z"}`
`{"role":"user","content":[{"type":"text","text":"what is in this image"},{"type":"image_url","image_url":{"url":"https://example.com/image.png"}}]}`

JSON Schema（简化示例）：
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

## 错误与退出码

退出码：
- `0` 成功
- `1` 参数或用法错误
- `2` 本地运行时错误
- `3` 外部 API / provider 错误
- `4` IO / 文件读写错误（含 session 追加失败）

错误输出约定：
- 默认（无 `--json`）：人类可读错误写入 `stderr`。
- `--json`：输出单个错误 JSON 对象到 `stderr`，`stdout` 不输出成功结果体。

错误对象结构：
`{ "code": string, "message": string, "detail": object|null, "trace_id": string|null }`

## 可观测性与调试
标准参数：
- `--log_file <path>`：开启本轮日志落盘。

日志要求：
- 仅在指定 `--log_file` 时写日志文件；
- 日志文件格式固定为 Markdown（`.md`）；
- 记录内容为本轮调用日志（请求参数摘要、关键事件、错误信息、结果摘要）；
- 日志内容必须脱敏，不得包含明文凭证。
