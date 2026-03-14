# 实现计划：pai embed 子命令

## 概述

基于设计文档，将 `pai embed` 子命令的实现分解为增量式编码任务。每个任务构建在前一个任务之上，最终完成完整功能的集成。使用 TypeScript 实现，测试使用 vitest + fast-check。

## 任务

- [x] 1. 扩展类型定义和配置支持
  - [x] 1.1 扩展 PAIConfig 和 EmbedOptions 类型
    - 在 `src/types.ts` 中为 `PAIConfig` 接口添加 `defaultEmbedProvider?: string` 和 `defaultEmbedModel?: string` 字段
    - 新增 `EmbedOptions` 接口（extends CLIOptions），包含 `provider?`, `model?`, `inputFile?`, `batch?` 字段
    - _Requirements: 4.1, 4.2, 8.1-8.7_
  - [ ]* 1.2 编写配置 round-trip 属性测试
    - **Property 6: 配置 round-trip**
    - **Validates: Requirements 4.1, 4.2**

- [x] 2. 实现嵌入模型 token 限制和截断逻辑
  - [x] 2.1 创建 `src/embedding-models.ts`
    - 定义 `EMBEDDING_MODEL_LIMITS` 常量（内置常用嵌入模型的最大 token 限制）
    - 实现 `truncateText(text: string, model: string): { text: string; truncated: boolean; originalTokens: number }` 函数
    - 使用简单字符级估算（1 token ≈ 4 字符）
    - _Requirements: 7.1, 7.2, 7.5_
  - [ ]* 2.2 编写文本截断属性测试
    - **Property 10: 文本截断正确性**
    - **Validates: Requirements 7.1, 7.2**

- [x] 3. 实现 EmbeddingClient
  - [x] 3.1 创建 `src/embedding-client.ts`
    - 实现 `EmbeddingClient` 类，构造函数接收 `{ provider, apiKey, model, baseUrl? }`
    - 实现 `embed(request: EmbeddingRequest): Promise<EmbeddingResponse>` 方法
    - 使用 Node.js 原生 `fetch` 调用 OpenAI 兼容的 `/v1/embeddings` 端点
    - 实现 Provider 默认端点映射（openai → `https://api.openai.com`）
    - 将 API 错误转换为 PAIError（退出码 3），网络错误转换为 PAIError（退出码 2）
    - _Requirements: 6.1, 6.3, 6.4, 6.5_
  - [ ]* 3.2 编写 baseUrl 端点构建属性测试
    - **Property 8: baseUrl 端点构建**
    - **Validates: Requirements 6.3**
  - [ ]* 3.3 编写 API 错误映射属性测试
    - **Property 9: API 错误映射**
    - **Validates: Requirements 6.4**

- [x] 4. Checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [x] 5. 实现嵌入模型解析逻辑
  - [x] 5.1 创建 `src/embed-model-resolver.ts`
    - 实现 `resolveEmbedModel(options: EmbedOptions, config: PAIConfig): { provider: string; model: string }` 函数
    - 优先级：CLI `--provider`/`--model` > `defaultEmbedProvider`/`defaultEmbedModel` > `defaultProvider` 回退
    - 当无法解析到模型时抛出 PAIError（退出码 1）
    - _Requirements: 4.3, 4.4_
  - [ ]* 5.2 编写嵌入模型解析优先级属性测试
    - **Property 7: 嵌入模型解析优先级**
    - **Validates: Requirements 4.3, 4.4**

- [x] 6. 实现批量输入解析和输出格式化
  - [x] 6.1 创建 `src/embed-io.ts`
    - 实现 `parseBatchInput(raw: string): string[]` 函数，解析 JSON 字符串数组
    - 实现 `formatEmbeddingOutput(result: EmbeddingResponse, options: { json: boolean; batch: boolean }): string` 函数
    - 纯文本模式：每行一个 JSON 数组
    - JSON 模式：完整 JSON 对象（含 embedding/embeddings、model、usage）
    - _Requirements: 2.1, 2.6, 2.7, 3.1, 3.2_
  - [ ]* 6.2 编写批量 JSON 解析属性测试
    - **Property 2: 批量 JSON 解析有效性**
    - **Validates: Requirements 2.1, 2.6**
  - [ ]* 6.3 编写纯文本输出格式属性测试
    - **Property 4: 纯文本输出格式**
    - **Validates: Requirements 3.1**
  - [ ]* 6.4 编写 JSON 输出格式属性测试
    - **Property 5: JSON 输出格式**
    - **Validates: Requirements 3.2**

- [x] 7. 实现 embed 命令处理器
  - [x] 7.1 创建 `src/commands/embed.ts`
    - 实现 `handleEmbedCommand(text: string | undefined, options: EmbedOptions): Promise<void>`
    - 复用 ConfigurationManager 加载配置和解析凭证
    - 复用 InputResolver 读取 stdin/文件输入
    - 调用 resolveEmbedModel 解析 Provider 和模型
    - 在 `--batch` 模式下调用 parseBatchInput 解析输入
    - 调用 truncateText 截断超长文本，在 stderr 输出警告
    - 调用 EmbeddingClient.embed 获取嵌入向量
    - 调用 formatEmbeddingOutput 格式化输出
    - 使用 OutputFormatter 输出进度和错误信息
    - _Requirements: 1.1-1.4, 2.1-2.7, 3.3, 3.4, 7.3, 7.4, 9.1-9.5_
  - [ ]* 7.2 编写多输入源互斥属性测试
    - **Property 1: 多输入源互斥**
    - **Validates: Requirements 1.4**
  - [ ]* 7.3 编写批量结果顺序保持属性测试
    - **Property 3: 批量结果顺序保持**
    - **Validates: Requirements 2.5**

- [x] 8. 注册 CLI 命令和扩展 model 命令
  - [x] 8.1 在 `src/index.ts` 中注册 `pai embed` 命令
    - 使用 Commander.js 添加 embed 命令及所有选项
    - 连接到 handleEmbedCommand 处理器
    - _Requirements: 8.1-8.7_
  - [x] 8.2 扩展 `src/commands/model.ts` 中的 model default 和 model list 命令
    - model default：新增 `--embed-provider` 和 `--embed-model` 选项，支持查看和设置
    - model list：在输出中显示 defaultEmbedProvider/defaultEmbedModel
    - JSON 输出中包含对应字段
    - _Requirements: 5.1-5.5_

- [x] 9. Final checkpoint - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

## 备注

- 标记 `*` 的任务为可选任务（测试），可跳过以加速 MVP
- 每个任务引用了具体的需求编号以便追溯
- Checkpoint 任务用于增量验证
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
