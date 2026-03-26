# pai SPECv2 - CLI/LIB 双接口模块

本文档描述 pai 从纯 CLI 改造为 CLI/LIB 双接口模块的设计。CLI 行为与 v1 完全兼容，新增 LIB 接口供 xar 等模块直接 import 使用。

模块类型：**CLI/LIB**（见 [CLI-LIB-Module-Spec.md](../TheClaw/CLI-LIB-Module-Spec.md)）

---

## 变更概要

| 方面 | v1 | v2 |
|------|----|----|
| 模块类型 | CLI Only | CLI/LIB |
| 入口文件 | `src/index.ts`（CLI） | `src/index.ts`（LIB）+ `src/cli.ts`（CLI） |
| LLM 调用 | 仅通过 CLI | 可通过 LIB 直接调用 |
| Streaming chunk | 写 stdout | 写入调用者传入的 `Writable` |
| 进度事件 | 写 stderr | 返回 `AsyncIterable<ChatEvent>` |
| Session 管理 | CLI 内部 | CLI 层保留；LIB 调用者自管理 messages |
| tool call | 内置 bash_exec | `createBashExecTool()` export，调用者按需传入 |

---

## 目录结构（v2）

```
pai/
├── src/
│   ├── lib/                      ← 核心业务逻辑（无 CLI 依赖）
│   │   ├── chat.ts               ← chat() 主函数
│   │   ├── llm-client.ts         ← LLMClient（现有，迁移）
│   │   ├── config.ts             ← loadConfig / resolveProvider（从 config-manager 提取）
│   │   ├── model-resolver.ts     ← 现有，迁移
│   │   ├── embedding-client.ts   ← 现有，迁移
│   │   └── types.ts              ← 所有共享类型（现有 types.ts 迁移）
│   ├── tools/
│   │   └── bash-exec.ts          ← createBashExecTool()（现有，保持位置）
│   ├── commands/                 ← CLI 子命令（薄包装，调用 lib/）
│   │   ├── chat.ts
│   │   ├── embed.ts
│   │   └── model.ts
│   ├── session-manager.ts        ← CLI 层使用，不进入 lib/
│   ├── input-resolver.ts         ← CLI 层使用，不进入 lib/
│   ├── output-formatter.ts       ← CLI 层使用，不进入 lib/
│   ├── index.ts                  ← LIB 入口：export lib/ 公开接口
│   ├── cli.ts                    ← CLI 入口：argv 解析 + dispatch
│   └── help.ts
├── vitest/
├── package.json
├── tsconfig.json
├── tsup.config.ts                ← 双 entry 构建
├── SPEC.md                       ← v1（保留）
├── SPECv2.md                     ← 本文档
└── USAGE.md
```

---

## LIB 接口定义

### 主入口（`src/index.ts`）

```typescript
// 核心 chat 函数
export { chat } from './lib/chat.js'

// 工具
export { createBashExecTool } from './tools/bash-exec.js'

// 配置加载
export { loadConfig, resolveProvider } from './lib/config.js'

// 类型
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

---

### `chat()` 函数

```typescript
import type { Writable } from 'node:stream'

/**
 * 执行一次完整的 chat（一轮 QA，含多轮 LLM 调用 + tool call 循环）。
 *
 * @param input       对话输入（system prompt、user message、历史消息）
 * @param config      provider/model/temperature 等配置（已解析，含 apiKey）
 * @param chunkWriter LLM 输出文字片段的写入目标。
 *                    CLI 传 process.stdout，xar 传 IpcChunkWriter，不关心 chunk 传 null。
 * @param tools       可用工具列表，传空数组则无 tool call
 * @param signal      AbortSignal，用于取消（对应 SIGTERM/SIGINT）
 * @param maxTurns    tool call 最大轮数，默认 100（对应 --max-turns）
 * @returns           AsyncIterable<ChatEvent>，只含进度事件（不含 chunk）
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

**ChatInput**：

```typescript
interface ChatInput {
  // 对应 --system / --system-file（调用者已读取为字符串）
  system?: string

  // 对应 [prompt] / --input-file / stdin（调用者已读取）
  // 支持多模态：string 或 MessageContent 数组（含图片等）
  userMessage: MessageContent

  // 对应 --session 加载的历史消息（不含本轮 system/user）
  // xar 传入从 thread 读取的历史消息
  history?: Message[]
}
```

**ChatConfig**：

```typescript
interface ChatConfig {
  provider: string          // provider name（对应 PAIConfig.providers[].name）
  model: string             // model name（对应 --model）
  apiKey: string            // 已解析的 API key
  stream?: boolean          // 是否使用 streaming LLM API，默认 true（对应 --stream）
  temperature?: number      // 对应 --temperature
  maxTokens?: number        // 对应 --max-tokens
  // provider-specific（从 ProviderConfig 透传）
  api?: string
  baseUrl?: string
  reasoning?: boolean
  contextWindow?: number
  providerOptions?: Record<string, unknown>
}
```

**ChatEvent**（仅进度事件，chunk 通过 chunkWriter 写出）：

```typescript
type ChatEvent =
  // 单次 LLM 调用开始（tool call 循环中可能触发多次）
  | { type: 'start';          provider: string; model: string; messageCount: number; toolCount: number }
  // thinking 模型的推理过程（非 output，不写 chunkWriter）
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_end';   thinking: string }   // 完整 thinking 内容
  // tool call 发起
  | { type: 'tool_call';      callId: string; name: string; args: unknown }
  // tool call 结果
  | { type: 'tool_result';    callId: string; name: string; result: unknown }
  // 单次 LLM 调用完成
  | { type: 'complete';       finishReason: string; usage?: Usage }
  // 整轮 QA 完成，携带本轮所有新增 messages（assistant + tool results）
  | { type: 'chat_end';       newMessages: Message[] }
```

**thinking vs output 的区分**：

- `text_delta`（模型回复文字）→ 写入 `chunkWriter`，是给用户的 output
- `thinking_delta`（模型推理过程）→ 作为 `ChatEvent` 进度事件，不写 `chunkWriter`

调用者对 thinking 事件的处理策略：
- CLI：`--verbose` 模式下输出到 stderr，默认忽略
- xar：可选写入 thread 作为 `record` 事件（供可观测性），不转发给 xgw

**事件流示例**（含 tool call）：

```
// --- chunkWriter.write('我来帮你查一下') ← 直接写入，不经过事件 ---
{ type: 'start',       provider: 'openai', model: 'gpt-4o', messageCount: 3, toolCount: 1 }
{ type: 'complete',    finishReason: 'tool_use', usage: { input: 120, output: 15 } }
{ type: 'tool_call',   callId: 'c1', name: 'bash_exec', args: { cmd: 'ls -la' } }
{ type: 'tool_result', callId: 'c1', name: 'bash_exec', result: 'total 8\n...' }
{ type: 'start',       provider: 'openai', model: 'gpt-4o', messageCount: 5, toolCount: 1 }
// --- chunkWriter.write('根据结果，目录下有 3 个文件。') ---
{ type: 'complete',    finishReason: 'stop', usage: { input: 200, output: 30 } }
{ type: 'chat_end',    newMessages: [ assistantMsg, toolResultMsg, assistantMsg2 ] }
```

**调用者职责对照**：

| 调用者 | chunkWriter | ChatEvent 消费 | chat_end 消费 |
|--------|-------------|---------------|--------------|
| CLI | `process.stdout` | `outputFormatter.writeProgress()` → stderr | 写入 session 文件 |
| xar | `new IpcChunkWriter(conn, sessionId)` | 写入 thread（record 事件） | 写入 thread（message 事件） |
| 测试/不关心 chunk | `null` | 按需断言 | 按需断言 |

---

### `createBashExecTool()`

```typescript
/**
 * 创建 bash_exec tool 实例。
 * 调用者按需传入 chat() 的 tools 参数。
 */
export function createBashExecTool(): Tool

interface Tool {
  name: string
  description: string
  parameters: object          // JSON Schema
  handler: (args: unknown, signal?: AbortSignal) => Promise<unknown>
}
```

---

### `loadConfig()` / `resolveProvider()`

```typescript
/**
 * 从文件加载 PAIConfig。
 * configPath 优先级：参数 > PAI_CONFIG 环境变量 > ~/.config/pai/default.json
 */
export async function loadConfig(configPath?: string): Promise<PAIConfig>

/**
 * 从 PAIConfig 中解析指定 provider，并解析 API key。
 * providerName 为空时使用 defaultProvider。
 * 返回可直接传入 ChatConfig 的 provider 信息和 apiKey。
 */
export async function resolveProvider(
  config: PAIConfig,
  providerName?: string,
): Promise<{ provider: ProviderConfig; apiKey: string }>
```

---

## CLI 接口（v2，与 v1 完全兼容）

CLI 行为不变，`src/cli.ts` 作为薄包装：

1. 用 `loadConfig` + `resolveProvider` 加载配置
2. 用 `InputResolver` 解析 argv/文件/stdin，构建 `ChatInput`
3. 用 `SessionManager` 加载 session 文件，填入 `ChatInput.history`
4. 调用 `chat(input, config, process.stdout, tools, signal, maxTurns)`
5. 消费 `ChatEvent`：全部通过 `outputFormatter.writeProgress()` 写 stderr
6. 消费 `chat_end`：用 `SessionManager` 追加 `newMessages` 到 session 文件

`pai chat` 命令参数与 v1 完全一致，不新增、不删除任何参数。

---

## `tsup.config.ts`（v2）

```typescript
import { defineConfig } from 'tsup'

export default defineConfig([
  {
    // LIB 入口：无 shebang，生成类型声明
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'node22',
    clean: true,
    sourcemap: true,
    dts: true,
  },
  {
    // CLI 入口：带 shebang，不生成类型声明
    entry: ['src/cli.ts'],
    format: ['esm'],
    target: 'node22',
    sourcemap: true,
    dts: false,
    banner: { js: '#!/usr/bin/env node' },
  },
])
```

---

## `package.json` 变更

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

---

## LIB 层设计约定

遵循 [CLI-LIB-Module-Spec.md](../TheClaw/CLI-LIB-Module-Spec.md) 的四条约定：

1. **错误处理**：`chat()` throw `PAIError`，CLI 层 catch 后转 exit code
2. **Streaming**：chunk 写入调用者传入的 `Writable`，进度通过 `AsyncIterable<ChatEvent>` 返回
3. **配置注入**：`chat()` 接受已解析的 `ChatConfig` 对象，不从文件系统加载
4. **无副作用**：import pai 时不产生任何副作用

---

## 迁移步骤

1. 新建 `src/lib/` 目录，将 `llm-client.ts`、`model-resolver.ts`、`embedding-client.ts`、`types.ts` 迁移进去
2. 新建 `src/lib/chat.ts`，实现 `chat()` 函数（从现有 `commands/chat.ts` 的 tool call 循环提取，加入 chunkWriter 参数）
3. 新建 `src/lib/config.ts`，从 `config-manager.ts` 提取 `loadConfig` / `resolveProvider`
4. 新建 `src/index.ts`（LIB 入口），export lib/ 公开接口
5. 将现有 `src/index.ts` 重命名为 `src/cli.ts`，改为调用 lib/
6. 更新 `tsup.config.ts` 为双 entry 构建
7. 更新 `package.json` exports/bin

`session-manager.ts`、`input-resolver.ts`、`output-formatter.ts` 保持在 `src/` 根目录，不进入 lib/，仅供 CLI 层使用。

---

## 不变的部分

- 所有 `pai chat` / `pai model` / `pai embed` CLI 命令行为
- Session 文件格式（JSONL）
- 配置文件格式（`~/.config/pai/default.json`）
- 错误码约定（0/1/2/3/4）
- 环境变量（`PAI_CONFIG`、`PAI_LANG`）
