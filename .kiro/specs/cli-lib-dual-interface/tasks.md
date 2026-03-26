# 实现计划：CLI/LIB 双接口模块

## 概述

将 pai 从纯 CLI 工具改造为 CLI/LIB 双接口模块。按照"先建 lib/ 层，再接 CLI 层，最后更新构建配置"的顺序逐步推进，确保每步都可验证。

## 任务

- [ ] 1. 新建 `src/lib/types.ts`，迁移并扩展类型定义
  - 将 `src/types.ts` 的所有类型复制到 `src/lib/types.ts`
  - 新增 `ChatInput`、`ChatConfig`、`ChatEvent`、`Usage` 类型
  - `ChatEvent` 为 discriminated union，包含 `start`、`thinking_start`、`thinking_delta`、`thinking_end`、`tool_call`、`tool_result`、`complete`、`chat_end` 八种类型
  - `ChatConfig` 包含 `provider`、`model`、`apiKey`（必填）及所有可选字段
  - `ChatInput` 包含 `system?`、`userMessage`、`history?`
  - _Requirements: 3.1, 4.1, 4.2, 4.3, 5.1, 5.2_

- [ ] 2. 迁移核心模块到 `src/lib/`
  - [ ] 2.1 将 `src/llm-client.ts` 复制为 `src/lib/llm-client.ts`，更新 import 路径指向 `./types.js`
    - _Requirements: 1.2_
  - [ ] 2.2 将 `src/model-resolver.ts` 复制为 `src/lib/model-resolver.ts`，更新 import 路径
    - _Requirements: 1.2_
  - [ ] 2.3 将 `src/embedding-client.ts` 复制为 `src/lib/embedding-client.ts`，更新 import 路径
    - _Requirements: 1.2_

- [ ] 3. 新建 `src/lib/config.ts`，提取配置加载逻辑
  - 从 `src/config-manager.ts` 提取 `loadConfig()` 和 `resolveProvider()` 为独立函数（非 class）
  - `loadConfig(configPath?: string): Promise<PAIConfig>`：优先级 configPath > PAI_CONFIG 环境变量 > `~/.config/pai/default.json`，文件不存在时返回默认空配置
  - `resolveProvider(config: PAIConfig, providerName?: string): Promise<{ provider: ProviderConfig; apiKey: string }>`：处理凭证解析（env var > apiKey > OAuth）
  - IF provider 不存在，throw `PAIError`
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [ ] 4. 新建 `src/lib/chat.ts`，实现 `chat()` 主函数
  - 函数签名：`async function* chat(input: ChatInput, config: ChatConfig, chunkWriter: Writable | null, tools: Tool[], signal: AbortSignal, maxTurns?: number): AsyncGenerator<ChatEvent>`
  - 构建 messages 数组：system（若有）+ history（若有）+ userMessage
  - 创建 `LLMClient` 实例（使用 `config` 中的参数）
  - 实现 tool calling 循环（默认最多 100 轮）
  - 每轮开始 yield `{ type: 'start', provider, model, messageCount, toolCount }`
  - streaming chunk 写入 `chunkWriter`（若非 null）
  - 每轮结束 yield `{ type: 'complete', finishReason, usage? }`
  - tool call 时 yield `{ type: 'tool_call', callId, name, args }` 和 `{ type: 'tool_result', callId, name, result }`
  - 所有轮次结束后 yield `{ type: 'chat_end', newMessages }`
  - 错误统一包装为 `PAIError`，不调用 `process.exit()`
  - 在每次 LLM 调用前检查 `signal.aborted`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11_

- [ ] 5. 新建 `src/index.ts`（LIB 入口）
  - export `chat` from `./lib/chat.js`
  - export `createBashExecTool` from `./tools/bash-exec.js`
  - export `loadConfig`, `resolveProvider` from `./lib/config.js`
  - export type `ChatInput`, `ChatConfig`, `ChatEvent`, `Message`, `MessageContent`, `MessageRole`, `PAIConfig`, `ProviderConfig`, `Tool`, `Usage` from `./lib/types.js`
  - 文件本身不包含任何可执行代码（纯 export，无副作用）
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 6. 检查点 - 确保所有测试通过，向用户确认无问题后继续

- [ ] 7. 更新 `src/commands/chat.ts`，改为调用 lib/ 层
  - 使用 `loadConfig` + `resolveProvider` 替换 `ConfigurationManager`
  - 构建 `ChatInput`（system、userMessage、history）
  - 构建 `ChatConfig`（从 provider config 和 CLI options 组合）
  - 调用 `chat(input, chatConfig, process.stdout, tools, signal, maxTurns)`
  - 消费 `ChatEvent`：`start`/`complete`/`tool_call`/`tool_result` 通过 `OutputFormatter.writeProgress()` 写 stderr
  - 收到 `chat_end` 后，调用 `SessionManager.appendMessages(event.newMessages)`
  - 保持 `--dry-run`、`--no-append`、`--json`、`--quiet`、`--log` 等所有 CLI 选项行为不变
  - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ] 8. 将现有 `src/index.ts` 重命名为 `src/cli.ts`
  - 将原 `src/index.ts`（CLI 入口）内容移至 `src/cli.ts`
  - 保持所有 commander 命令注册、EPIPE 处理、exitOverride 逻辑不变
  - _Requirements: 7.1, 7.7, 7.8, 7.9, 7.10_

- [ ] 9. 更新 `tsup.config.ts` 为双 entry 构建
  - LIB entry（`src/index.ts`）：`dts: true`，无 shebang
  - CLI entry（`src/cli.ts`）：`dts: false`，`banner: { js: '#!/usr/bin/env node' }`
  - _Requirements: 8.1, 8.2, 8.3_

- [ ] 10. 更新 `package.json` exports/bin
  - 设置 `"exports": { ".": "./dist/index.js" }`
  - 设置 `"main": "./dist/index.js"` 和 `"types": "./dist/index.d.ts"`
  - 设置 `"bin": { "pai": "./dist/cli.js" }`
  - _Requirements: 8.4, 8.5, 8.6_

- [ ] 11. 检查点 - 确保所有测试通过，向用户确认无问题后继续

- [ ]* 12. 编写单元测试
  - [ ]* 12.1 为 `src/lib/config.ts` 编写单元测试（`vitest/unit/config.test.ts`）
    - 测试 `loadConfig()` 文件不存在时返回默认配置
    - 测试 `loadConfig()` 读取有效配置文件
    - 测试 `loadConfig()` 读取格式错误的配置文件时 throw PAIError
    - 测试 `resolveProvider()` 正常路径
    - _Requirements: 6.1, 6.3, 6.5_
  - [ ]* 12.2 为 `src/index.ts` 编写 export 完整性测试（`vitest/unit/lib-exports.test.ts`）
    - 验证 `chat`、`createBashExecTool`、`loadConfig`、`resolveProvider` 均为函数
    - _Requirements: 2.1, 2.2, 2.3_

- [ ]* 13. 编写属性测试（`vitest/pbt/`）
  - [ ]* 13.1 编写 `vitest/pbt/chat.pbt.test.ts`
    - **Property 1: LIB 入口无副作用**：mock process.stdout/stderr，import src/index.ts，验证无写入
    - **Property 2: chat() 事件序列不变量**：使用 fast-check 生成随机 ChatInput，mock LLMClient，验证第一个事件为 start，最后一个为 chat_end，且 chat_end.newMessages 包含 assistant 消息
    - **Property 3: streaming chunk 写入 Writable**：生成随机 ChatInput，mock streaming LLMClient，验证 Writable 收到写入
    - **Property 4: tool 事件配对**：mock 返回 tool call 的 LLMClient，验证每个 tool_call 后有对应 tool_result
    - **Property 5: 错误时 throw PAIError**：构造会失败的 LLMClient，验证 throw PAIError
    - _Requirements: 2.5, 3.2, 3.4, 3.5, 3.6, 3.7, 3.9_
  - [ ]* 13.2 编写 `vitest/pbt/config.pbt.test.ts`
    - **Property 6: resolveProvider 对不存在的 provider throw PAIError**：使用 fast-check 生成随机 PAIConfig 和不存在的 providerName，验证 throw PAIError
    - _Requirements: 6.4, 6.6_

- [ ] 14. 最终检查点 - 确保所有测试通过，向用户确认无问题后继续

## 备注

- 标有 `*` 的子任务为可选任务，可跳过以加快 MVP 进度
- 每个任务引用了具体的需求条目，便于追溯
- 检查点任务确保增量验证，避免积累问题
- 迁移文件时保持原文件不删除，待 CLI 层更新完成后再清理旧文件（避免中间状态编译失败）
