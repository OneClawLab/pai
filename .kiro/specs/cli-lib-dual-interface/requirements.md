# 需求文档

## 简介

本文档描述将 pai 从纯 CLI 工具改造为 CLI/LIB 双接口模块的需求。改造后，pai 既保持原有 CLI 行为完全兼容，又新增可供外部模块（如 xar）直接 import 使用的 LIB 接口。

核心变更：
- 新增 `src/lib/` 目录，存放与 CLI 无关的核心业务逻辑
- 新增 `src/index.ts` 作为 LIB 入口，export 公开接口
- 将现有 `src/index.ts` 重命名为 `src/cli.ts`，作为 CLI 入口
- `chat()` 函数通过 `AsyncIterable<ChatEvent>` 返回进度事件，通过调用者传入的 `Writable` 写入 streaming chunk

## 词汇表

- **LIB 接口**：可供外部 TypeScript 模块 import 使用的公开 API
- **CLI 接口**：通过命令行参数调用的接口，行为与 v1 完全兼容
- **ChatEvent**：`chat()` 函数通过 `AsyncIterable` 返回的进度事件类型
- **ChatInput**：传入 `chat()` 的输入参数，包含 system prompt、用户消息和历史记录
- **ChatConfig**：传入 `chat()` 的配置参数，包含 provider、model、apiKey 等
- **PAIConfig**：pai 配置文件的结构类型（`~/.config/pai/default.json`）
- **ProviderConfig**：单个 provider 的配置结构
- **Tool**：LLM 可调用的工具，包含 name、description、parameters 和 handler
- **Usage**：LLM 调用的 token 用量统计
- **Message**：对话历史中的单条消息
- **Writable**：Node.js `stream.Writable`，用于接收 streaming chunk 输出
- **PAIError**：pai 自定义错误类，携带 exitCode 字段
- **SessionManager**：管理 session 文件（JSONL 格式）的 CLI 层组件
- **LLMClient**：封装 pi-ai 库调用的客户端类

## 需求

### 需求 1：目录结构重组

**用户故事：** 作为开发者，我希望 pai 的核心业务逻辑与 CLI 逻辑分离，以便可以独立 import 核心功能而不引入 CLI 依赖。

#### 验收标准

1. THE System SHALL 在 `src/lib/` 目录下存放所有与 CLI 无关的核心业务逻辑文件
2. THE System SHALL 将 `llm-client.ts`、`model-resolver.ts`、`embedding-client.ts` 迁移至 `src/lib/` 目录
3. THE System SHALL 将共享类型定义迁移至 `src/lib/types.ts`
4. THE System SHALL 新建 `src/lib/chat.ts` 实现 `chat()` 主函数
5. THE System SHALL 新建 `src/lib/config.ts` 提供 `loadConfig()` 和 `resolveProvider()` 函数
6. THE System SHALL 保持 `src/tools/bash-exec.ts` 位置不变
7. THE System SHALL 保持 `src/session-manager.ts`、`src/input-resolver.ts`、`src/output-formatter.ts` 在 CLI 层，不迁移至 `src/lib/`

### 需求 2：LIB 入口文件

**用户故事：** 作为外部模块开发者，我希望通过 `import pai from 'pai'` 或 `import { chat } from 'pai'` 使用 pai 的核心功能，以便在自己的程序中直接调用 LLM。

#### 验收标准

1. THE System SHALL 提供 `src/index.ts` 作为 LIB 入口，export `chat` 函数
2. THE System SHALL 从 `src/index.ts` export `createBashExecTool` 函数
3. THE System SHALL 从 `src/index.ts` export `loadConfig` 和 `resolveProvider` 函数
4. THE System SHALL 从 `src/index.ts` export 所有公开类型：`ChatInput`、`ChatConfig`、`ChatEvent`、`Message`、`MessageContent`、`MessageRole`、`PAIConfig`、`ProviderConfig`、`Tool`、`Usage`
5. WHEN `src/index.ts` 被 import 时，THE System SHALL 不产生任何副作用（不写 stdout/stderr，不读取文件，不注册信号处理器）

### 需求 3：`chat()` 函数接口

**用户故事：** 作为外部模块开发者，我希望调用 `chat()` 函数与 LLM 对话，以便在自己的程序中集成 LLM 能力。

#### 验收标准

1. THE Chat_Function SHALL 接受 `ChatInput`、`ChatConfig`、`Writable | null`、`Tool[]`、`AbortSignal`、可选的 `maxTurns` 参数
2. WHEN streaming chunk 产生时，THE Chat_Function SHALL 将 chunk 写入调用者传入的 `Writable`（若非 null）
3. THE Chat_Function SHALL 返回 `AsyncIterable<ChatEvent>`，通过事件流传递进度信息
4. WHEN LLM 开始响应时，THE Chat_Function SHALL yield `{ type: 'start', provider, model, messageCount, toolCount }` 事件
5. WHEN LLM 完成一轮响应时，THE Chat_Function SHALL yield `{ type: 'complete', finishReason, usage? }` 事件
6. WHEN tool 被调用时，THE Chat_Function SHALL yield `{ type: 'tool_call', callId, name, args }` 事件
7. WHEN tool 执行完成时，THE Chat_Function SHALL yield `{ type: 'tool_result', callId, name, result }` 事件
8. WHEN 所有对话轮次结束时，THE Chat_Function SHALL yield `{ type: 'chat_end', newMessages }` 事件，其中 `newMessages` 包含本次对话产生的所有新消息
9. WHEN LLM 支持 thinking/reasoning 时，THE Chat_Function SHALL yield `thinking_start`、`thinking_delta`、`thinking_end` 事件
10. WHEN `AbortSignal` 被触发时，THE Chat_Function SHALL 中止当前 LLM 调用和 tool 执行
11. IF `chat()` 发生错误，THEN THE Chat_Function SHALL throw `PAIError`，不直接调用 `process.exit()`

### 需求 4：`ChatInput` 类型

**用户故事：** 作为外部模块开发者，我希望通过结构化的输入类型传递对话内容，以便清晰地表达 system prompt、用户消息和历史记录。

#### 验收标准

1. THE ChatInput_Type SHALL 包含可选的 `system` 字段（string 类型，system prompt）
2. THE ChatInput_Type SHALL 包含必填的 `userMessage` 字段（`MessageContent` 类型）
3. THE ChatInput_Type SHALL 包含可选的 `history` 字段（`Message[]` 类型，历史对话记录）

### 需求 5：`ChatConfig` 类型

**用户故事：** 作为外部模块开发者，我希望通过结构化的配置类型传递 LLM 调用参数，以便灵活控制模型行为。

#### 验收标准

1. THE ChatConfig_Type SHALL 包含必填的 `provider`、`model`、`apiKey` 字段
2. THE ChatConfig_Type SHALL 包含可选的 `stream`、`temperature`、`maxTokens`、`api`、`baseUrl`、`reasoning`、`contextWindow`、`providerOptions` 字段
3. THE Chat_Function SHALL 接受已解析的 `ChatConfig` 对象，不从文件系统加载配置

### 需求 6：`loadConfig()` 和 `resolveProvider()` 函数

**用户故事：** 作为外部模块开发者，我希望使用 pai 的配置加载逻辑，以便复用 pai 的配置文件格式和凭证解析机制。

#### 验收标准

1. THE LoadConfig_Function SHALL 接受可选的 `configPath` 参数，返回 `Promise<PAIConfig>`
2. WHEN `configPath` 未提供时，THE LoadConfig_Function SHALL 按优先级查找：`PAI_CONFIG` 环境变量 > `~/.config/pai/default.json`
3. THE ResolveProvider_Function SHALL 接受 `PAIConfig` 和可选的 `providerName`，返回 `Promise<{ provider: ProviderConfig; apiKey: string }>`
4. WHEN `providerName` 未提供时，THE ResolveProvider_Function SHALL 使用 `PAIConfig.defaultProvider`
5. IF 配置文件不存在，THEN THE LoadConfig_Function SHALL 返回默认空配置（`{ schema_version: '1.0.0', providers: [] }`）
6. IF provider 不存在，THEN THE ResolveProvider_Function SHALL throw `PAIError`

### 需求 7：CLI 入口迁移

**用户故事：** 作为 CLI 用户，我希望 `pai` 命令的行为与 v1 完全兼容，以便无需修改现有脚本和工作流。

#### 验收标准

1. THE CLI_Entry SHALL 位于 `src/cli.ts`，包含所有 argv 解析和 dispatch 逻辑
2. THE CLI_Entry SHALL 调用 `loadConfig` 和 `resolveProvider` 加载配置
3. THE CLI_Entry SHALL 调用 `chat()` 函数，传入 `process.stdout` 作为 `chunkWriter`
4. THE CLI_Entry SHALL 消费 `ChatEvent` 流，通过 `OutputFormatter` 将进度事件写入 stderr
5. THE CLI_Entry SHALL 在收到 `chat_end` 事件后，通过 `SessionManager` 将 `newMessages` 追加到 session 文件
6. THE System SHALL 保持所有 `pai chat`、`pai model`、`pai embed` 命令的行为与 v1 完全一致
7. THE System SHALL 保持 session 文件格式（JSONL）不变
8. THE System SHALL 保持配置文件格式（`~/.config/pai/default.json`）不变
9. THE System SHALL 保持错误码约定（0/1/2/3/4）不变
10. THE System SHALL 保持环境变量（`PAI_CONFIG`、`PAI_LANG`）不变

### 需求 8：构建配置更新

**用户故事：** 作为开发者，我希望构建产物同时包含 LIB 入口和 CLI 入口，以便外部模块可以 import，同时 CLI 可以直接执行。

#### 验收标准

1. THE Build_System SHALL 使用双 entry 构建：`src/index.ts`（LIB）和 `src/cli.ts`（CLI）
2. THE LIB_Entry SHALL 生成类型声明文件（`.d.ts`），不注入 shebang
3. THE CLI_Entry SHALL 注入 shebang（`#!/usr/bin/env node`），不生成类型声明文件
4. THE Package_JSON SHALL 设置 `"exports": { ".": "./dist/index.js" }`
5. THE Package_JSON SHALL 设置 `"main": "./dist/index.js"` 和 `"types": "./dist/index.d.ts"`
6. THE Package_JSON SHALL 设置 `"bin": { "pai": "./dist/cli.js" }`

### 需求 9：`createBashExecTool()` export

**用户故事：** 作为外部模块开发者，我希望可以按需使用 `bash_exec` 工具，以便在调用 `chat()` 时选择性地启用 shell 执行能力。

#### 验收标准

1. THE System SHALL 从 `src/index.ts` export `createBashExecTool` 函数
2. THE CreateBashExecTool_Function SHALL 返回符合 `Tool` 接口的对象
3. WHEN 调用者不传入任何 tools 时，THE Chat_Function SHALL 在无工具模式下运行，不执行任何 shell 命令
