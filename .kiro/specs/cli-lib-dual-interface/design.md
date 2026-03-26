# 设计文档：CLI/LIB 双接口模块

## 概述

本设计将 pai 从纯 CLI 工具改造为 CLI/LIB 双接口模块。核心思路是将业务逻辑下沉到 `src/lib/` 层，CLI 层变为薄包装。

改造后的模块结构：
- `src/lib/`：纯业务逻辑，无 CLI 依赖，可被外部 import
- `src/index.ts`：LIB 入口，export 公开接口和类型
- `src/cli.ts`：CLI 入口（原 `src/index.ts` 重命名），薄包装调用 lib/
- `src/tools/`：工具实现，位置不变
- `src/commands/`：CLI 子命令，调用 lib/ 层

## 架构

```mermaid
graph TD
    subgraph "外部调用者"
        EXT[xar / 其他模块]
        CLI_USER[CLI 用户]
    end

    subgraph "LIB 层（src/index.ts）"
        LIB_ENTRY[src/index.ts<br/>export chat, loadConfig,<br/>resolveProvider, createBashExecTool, types]
    end

    subgraph "CLI 层"
        CLI_ENTRY[src/cli.ts<br/>argv 解析 + dispatch]
        COMMANDS[src/commands/<br/>chat.ts / embed.ts / model.ts]
        SESSION[src/session-manager.ts]
        INPUT[src/input-resolver.ts]
        OUTPUT[src/output-formatter.ts]
    end

    subgraph "src/lib/（核心业务逻辑）"
        CHAT[lib/chat.ts<br/>chat() 主函数]
        LLM[lib/llm-client.ts<br/>LLMClient]
        CONFIG[lib/config.ts<br/>loadConfig / resolveProvider]
        MODEL_RES[lib/model-resolver.ts]
        EMBED[lib/embedding-client.ts]
        TYPES[lib/types.ts<br/>共享类型]
    end

    subgraph "src/tools/"
        BASH[tools/bash-exec.ts<br/>createBashExecTool]
    end

    EXT --> LIB_ENTRY
    CLI_USER --> CLI_ENTRY
    CLI_ENTRY --> COMMANDS
    COMMANDS --> SESSION
    COMMANDS --> INPUT
    COMMANDS --> OUTPUT
    COMMANDS --> CHAT
    LIB_ENTRY --> CHAT
    LIB_ENTRY --> CONFIG
    LIB_ENTRY --> BASH
    LIB_ENTRY --> TYPES
    CHAT --> LLM
    CHAT --> TYPES
    CONFIG --> TYPES
    LLM --> TYPES
```

### 关键设计决策

1. **lib/ 层无副作用**：import `src/index.ts` 时不执行任何代码，不注册信号处理器，不读取文件
2. **配置注入而非加载**：`chat()` 接受已解析的 `ChatConfig`，不从文件系统加载
3. **Writable 注入**：streaming chunk 写入调用者传入的 `Writable`，CLI 传 `process.stdout`，LIB 调用者可传任意 Writable 或 null
4. **AsyncIterable 进度事件**：`chat()` 返回 `AsyncIterable<ChatEvent>`，调用者按需消费
5. **错误边界**：lib/ 层 throw `PAIError`，CLI 层 catch 后转 exit code

## 组件与接口

### `src/lib/chat.ts`

核心 `chat()` 函数，实现多轮对话和 tool calling 循环。

```typescript
export async function* chat(
  input: ChatInput,
  config: ChatConfig,
  chunkWriter: Writable | null,
  tools: Tool[],
  signal: AbortSignal,
  maxTurns?: number,
): AsyncGenerator<ChatEvent>
```

内部流程：
1. 构建初始 messages 数组（system + history + userMessage）
2. 创建 `LLMClient` 实例
3. 进入 tool calling 循环（最多 `maxTurns` 轮，默认 100）
4. yield `start` 事件
5. 调用 LLMClient，streaming chunk 写入 `chunkWriter`
6. yield `complete` 事件
7. 若有 tool calls，执行工具，yield `tool_call` / `tool_result` 事件
8. 循环直到无 tool calls 或达到轮次上限
9. yield `chat_end` 事件，携带所有新消息

### `src/lib/config.ts`

从 `config-manager.ts` 提取的纯函数接口，去除 class 包装。

```typescript
export async function loadConfig(configPath?: string): Promise<PAIConfig>
export async function resolveProvider(
  config: PAIConfig,
  providerName?: string,
): Promise<{ provider: ProviderConfig; apiKey: string }>
```

`resolveProvider` 内部处理凭证解析优先级：
1. 环境变量 `PAI_<PROVIDER>_API_KEY`
2. config 文件中的 `apiKey`
3. OAuth credentials（自动刷新）

### `src/lib/llm-client.ts`

从 `src/llm-client.ts` 迁移，接口不变，仅移动位置。

### `src/lib/model-resolver.ts`

从 `src/model-resolver.ts` 迁移，接口不变。

### `src/lib/embedding-client.ts`

从 `src/embedding-client.ts` 迁移，接口不变。

### `src/lib/types.ts`

从 `src/types.ts` 迁移，新增 LIB 专用类型：`ChatInput`、`ChatConfig`、`ChatEvent`、`Usage`。

### `src/index.ts`（LIB 入口）

```typescript
export { chat } from './lib/chat.js'
export { createBashExecTool } from './tools/bash-exec.js'
export { loadConfig, resolveProvider } from './lib/config.js'
export type {
  ChatInput, ChatConfig, ChatEvent, Message, MessageContent,
  MessageRole, PAIConfig, ProviderConfig, Tool, Usage,
} from './lib/types.js'
```

### `src/cli.ts`（CLI 入口）

原 `src/index.ts` 重命名，内容基本不变，但 `commands/chat.ts` 改为调用 `chat()` 函数。

### `src/commands/chat.ts`（更新）

改为调用 lib/ 层的 `chat()` 函数：

```typescript
// 1. loadConfig + resolveProvider 加载配置
// 2. InputResolver 解析用户输入，构建 ChatInput
// 3. SessionManager 加载历史，填入 ChatInput.history
// 4. 调用 chat(input, config, process.stdout, tools, signal, maxTurns)
// 5. 消费 ChatEvent：进度事件通过 OutputFormatter 写 stderr
// 6. 收到 chat_end 后，SessionManager.appendMessages(newMessages)
```

## 数据模型

### `ChatInput`

```typescript
interface ChatInput {
  system?: string           // system prompt（可选）
  userMessage: MessageContent  // 用户消息（必填）
  history?: Message[]       // 历史对话记录（可选）
}
```

### `ChatConfig`

```typescript
interface ChatConfig {
  provider: string
  model: string
  apiKey: string
  stream?: boolean
  temperature?: number
  maxTokens?: number
  api?: string
  baseUrl?: string
  reasoning?: boolean
  contextWindow?: number
  providerOptions?: Record<string, unknown>
}
```

### `ChatEvent`

```typescript
type ChatEvent =
  | { type: 'start'; provider: string; model: string; messageCount: number; toolCount: number }
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_end'; thinking: string }
  | { type: 'tool_call'; callId: string; name: string; args: unknown }
  | { type: 'tool_result'; callId: string; name: string; result: unknown }
  | { type: 'complete'; finishReason: string; usage?: Usage }
  | { type: 'chat_end'; newMessages: Message[] }
```

### `Usage`

```typescript
interface Usage {
  input: number
  output: number
  cost?: { total: number }
}
```

### `Message`（不变）

```typescript
interface Message {
  role: MessageRole
  content: MessageContent
  name?: string
  tool_call_id?: string
  timestamp?: string
  id?: string
}
```

### `tsup.config.ts`（双 entry）

```typescript
export default defineConfig([
  {
    // LIB 入口：生成类型声明，无 shebang
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node22',
    clean: true,
    sourcemap: true,
    dts: true,
  },
  {
    // CLI 入口：注入 shebang，不生成类型声明
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'node22',
    sourcemap: true,
    dts: false,
    banner: { js: '#!/usr/bin/env node' },
  },
])
```

## 正确性属性

*属性（Property）是在系统所有有效执行中都应成立的特征或行为——本质上是对系统应做什么的形式化陈述。属性是人类可读规范与机器可验证正确性保证之间的桥梁。*

### Property 1：LIB 入口无副作用

*对于任意* import `src/index.ts` 的操作，不应向 stdout/stderr 写入任何内容，不应读取文件系统，不应注册任何进程信号处理器。

**Validates: Requirements 2.5**

### Property 2：chat() 事件序列不变量

*对于任意* 有效的 `ChatInput` 和 `ChatConfig`（使用 mock LLM），`chat()` 返回的事件序列必须满足：
- 第一个事件的 `type` 为 `'start'`
- 最后一个事件的 `type` 为 `'chat_end'`
- `chat_end` 事件的 `newMessages` 数组至少包含一条 assistant 消息

**Validates: Requirements 3.4, 3.5, 3.7**

### Property 3：streaming chunk 写入 Writable

*对于任意* 有效的 `ChatInput` 和启用 streaming 的 `ChatConfig`（使用 mock LLM），当传入非 null 的 `Writable` 时，该 Writable 应收到至少一次写入。

**Validates: Requirements 3.2**

### Property 4：tool 事件配对

*对于任意* 导致 tool call 的 LLM 响应（使用 mock LLM），`chat()` 产生的事件序列中，每个 `tool_call` 事件后必须跟随一个对应 `callId` 的 `tool_result` 事件。

**Validates: Requirements 3.6**

### Property 5：错误时 throw PAIError

*对于任意* 会导致 LLM 调用失败的配置（如无效 apiKey），`chat()` 应 throw `PAIError` 而非其他类型的错误，且不调用 `process.exit()`。

**Validates: Requirements 3.9**

### Property 6：resolveProvider 对不存在的 provider throw PAIError

*对于任意* 不包含指定 `providerName` 的 `PAIConfig`，调用 `resolveProvider(config, providerName)` 应 throw `PAIError`。

**Validates: Requirements 6.4**

## 错误处理

### lib/ 层错误处理原则

- `chat()` 内部所有错误统一包装为 `PAIError`，携带对应 `exitCode`
- LLM API 错误 → `ExitCode.API_ERROR` (3)
- 配置错误 → `ExitCode.PARAMETER_ERROR` (1)
- IO 错误 → `ExitCode.IO_ERROR` (4)
- 其他运行时错误 → `ExitCode.RUNTIME_ERROR` (2)
- lib/ 层**不调用** `process.exit()`，由 CLI 层负责

### CLI 层错误处理

- `commands/chat.ts` catch `PAIError`，调用 `process.exit(error.exitCode)`
- 非 `PAIError` 错误 → `process.exit(2)`
- 错误信息写 stderr，通过 `OutputFormatter.writeError()`

### AbortSignal 处理

- `chat()` 接受 `AbortSignal`，在每次 LLM 调用前检查 `signal.aborted`
- tool 执行时将 signal 传入 tool handler
- signal 触发时，当前 LLM 调用和 tool 执行立即中止

## 测试策略

### 测试框架

- 单元测试：vitest（`vitest/unit/`）
- 属性测试：vitest + fast-check（`vitest/pbt/`）
- 测试文件命名：`<module>.test.ts`（单元）、`<topic>.pbt.test.ts`（属性）

### Mock 策略

由于 `chat()` 依赖 LLM API，测试中需要 mock `LLMClient`：

```typescript
// mock LLMClient，返回预设响应
const mockLLMClient = {
  chat: async function*() {
    yield { content: 'hello', finishReason: 'streaming' }
    yield { content: '', finishReason: 'stop', usage: { input: 10, output: 5 } }
  },
  chatComplete: async () => ({
    content: 'hello',
    finishReason: 'stop',
    usage: { input: 10, output: 5 },
  }),
}
```

### 单元测试覆盖

- `lib/config.ts`：`loadConfig()` 默认配置、文件不存在、格式错误；`resolveProvider()` 正常路径、provider 不存在
- `lib/chat.ts`：事件序列、tool calling 循环、maxTurns 限制、AbortSignal
- `lib/types.ts`：类型结构验证（通过 TypeScript 编译）
- `src/index.ts`：export 完整性检查

### 属性测试覆盖

每个属性测试使用 fast-check，最少 100 次迭代：

| 测试文件 | 属性 | 说明 |
|---------|------|------|
| `vitest/pbt/chat.pbt.test.ts` | Property 1 | LIB 入口无副作用 |
| `vitest/pbt/chat.pbt.test.ts` | Property 2 | 事件序列不变量 |
| `vitest/pbt/chat.pbt.test.ts` | Property 3 | streaming chunk 写入 Writable |
| `vitest/pbt/chat.pbt.test.ts` | Property 4 | tool 事件配对 |
| `vitest/pbt/chat.pbt.test.ts` | Property 5 | 错误时 throw PAIError |
| `vitest/pbt/config.pbt.test.ts` | Property 6 | resolveProvider 错误处理 |

### 属性测试标注格式

每个属性测试用注释标注：

```typescript
// Feature: cli-lib-dual-interface, Property 2: chat() 事件序列不变量
it.prop([fc.record({ ... })])('事件序列以 start 开始，以 chat_end 结束', async (input) => {
  // ...
})
```

### 双重测试策略

- 单元测试：验证具体例子（默认配置、特定错误场景、export 完整性）
- 属性测试：验证通用属性（事件序列、错误类型、副作用）
- 两者互补，共同保证正确性
