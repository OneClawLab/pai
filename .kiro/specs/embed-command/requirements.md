# 需求文档：pai embed 子命令

## 简介

为 PAI CLI 工具新增 `pai embed` 子命令，用于调用 LLM Provider 的嵌入向量（Embedding）API，将文本转换为向量表示。支持单条和批量输入，遵循现有 CLI 的输出约定（stdout/stderr 分离、`--json` 模式等）。由于底层 pi-ai 库不支持 Embedding API，需直接调用各 Provider 的 HTTP 端点。同时需要在配置中支持全局默认嵌入模型的设定。

## 术语表

- **Embed_Command**: `pai embed` 子命令，负责接收文本输入并返回嵌入向量
- **Embedding_Client**: 嵌入向量 API 客户端，负责直接调用各 Provider 的 Embedding HTTP 端点
- **PAIConfig**: PAI 全局配置对象，存储于 `~/.config/pai/default.json`
- **ProviderConfig**: 单个 Provider 的配置，包含认证信息、模型列表等
- **Embedding_Vector**: 嵌入向量，一个浮点数数组，表示文本的语义表示
- **Batch_Input**: 批量输入，一个包含多条文本的数组

## 需求

### 需求 1：单条文本嵌入

**用户故事：** 作为开发者，我希望通过 `pai embed` 命令将单条文本转换为嵌入向量，以便在下游任务中使用。

#### 验收标准

1. WHEN 用户通过命令行参数提供单条文本（如 `pai embed "hello world"`），THE Embed_Command SHALL 调用 Embedding API 并将嵌入向量输出到 stdout
2. WHEN 用户通过 stdin 管道提供单条文本（如 `echo "hello" | pai embed`），THE Embed_Command SHALL 读取 stdin 内容并返回对应的嵌入向量
3. WHEN 用户通过 `--input-file <path>` 提供文本文件，THE Embed_Command SHALL 读取文件内容作为单条文本并返回嵌入向量
4. IF 用户同时提供了多个输入源（如同时提供参数和 stdin），THEN THE Embed_Command SHALL 返回参数错误（退出码 1）

### 需求 2：批量文本嵌入

**用户故事：** 作为开发者，我希望一次性提交多条文本进行嵌入计算，以便提高效率。

#### 验收标准

1. WHEN 用户指定 `--batch` 标志时，THE Embed_Command SHALL 将输入内容解析为 JSON 字符串数组（而非单条文本），输入来源与单条模式一致（位置参数、stdin、`--input-file`）
2. WHEN 用户通过位置参数提供 JSON 数组字符串并指定 `--batch`（如 `pai embed --batch '["hello","world"]'`），THE Embed_Command SHALL 解析该 JSON 数组并对每条文本计算嵌入向量
3. WHEN 用户通过 stdin 管道提供 JSON 数组并指定 `--batch`，THE Embed_Command SHALL 读取 stdin 内容并解析为 JSON 数组，对每条文本计算嵌入向量
4. WHEN 用户通过 `--input-file` 提供包含 JSON 数组的文件并指定 `--batch`，THE Embed_Command SHALL 读取文件内容并解析为 JSON 数组，对每条文本计算嵌入向量
5. THE Embed_Command SHALL 将批量结果按输入顺序输出
6. IF 批量输入的 JSON 格式不合法或不是字符串数组，THEN THE Embed_Command SHALL 返回参数错误（退出码 1）并在 stderr 输出描述性错误信息
7. IF 批量输入数组为空，THEN THE Embed_Command SHALL 返回空结果数组

### 需求 3：输出格式

**用户故事：** 作为开发者，我希望嵌入向量的输出格式清晰且可被程序解析，以便集成到自动化流程中。

#### 验收标准

1. WHEN 未指定 `--json` 标志时，THE Embed_Command SHALL 将嵌入向量以每行一个 JSON 数组的格式输出到 stdout（单条模式输出一行，批量模式输出多行）
2. WHEN 指定 `--json` 标志时，THE Embed_Command SHALL 将完整结果以 JSON 对象格式输出到 stdout，包含 `embedding`（单条）或 `embeddings`（批量）字段，以及 `model`、`usage` 等元信息
3. THE Embed_Command SHALL 将进度和诊断信息输出到 stderr，遵循现有 stdout/stderr 分离约定
4. WHEN 指定 `--json` 标志时，THE Embed_Command SHALL 将 stderr 的进度信息以 NDJSON 事件格式输出

### 需求 4：全局默认嵌入模型配置

**用户故事：** 作为开发者，我希望在配置中设定全局默认嵌入模型，以便每次使用 `pai embed` 时无需重复指定模型。

#### 验收标准

1. THE PAIConfig SHALL 支持顶层 `defaultEmbedProvider` 字段，用于指定默认的嵌入 Provider
2. THE PAIConfig SHALL 支持顶层 `defaultEmbedModel` 字段，用于指定默认的嵌入模型名称
3. WHEN 用户未通过 CLI 参数指定 `--provider` 和 `--model` 时，THE Embed_Command SHALL 依次使用 `defaultEmbedProvider`/`defaultEmbedModel` 配置、`defaultProvider` 配置作为回退
4. WHEN 用户通过 CLI 参数指定 `--provider` 或 `--model` 时，THE Embed_Command SHALL 使用 CLI 参数覆盖配置文件中的默认值
5. WHEN 用户通过 `pai model config --update --name <provider> --set defaultEmbedModel=<model>` 更新配置时，THE ConfigurationManager SHALL 持久化该配置

### 需求 5：模型管理命令集成

**用户故事：** 作为开发者，我希望通过 `pai model` 命令查看和管理嵌入模型的配置状态，以便了解当前的默认嵌入 Provider 和模型。

#### 验收标准

1. WHEN 用户执行 `pai model list` 时，THE Model_Command SHALL 在输出中显示当前配置的 `defaultEmbedProvider` 和 `defaultEmbedModel`（如果已配置）
2. WHEN 用户执行 `pai model default` 时，THE Model_Command SHALL 同时显示 `defaultProvider` 和 `defaultEmbedProvider`/`defaultEmbedModel` 的当前值
3. WHEN 用户执行 `pai model default --embed-provider <name> --embed-model <model>` 时，THE Model_Command SHALL 更新全局配置中的 `defaultEmbedProvider` 和 `defaultEmbedModel`
4. WHEN 用户执行 `pai model list --json` 时，THE Model_Command SHALL 在 JSON 输出中包含 `defaultEmbedProvider` 和 `defaultEmbedModel` 字段
5. WHEN 用户执行 `pai model default --json` 时，THE Model_Command SHALL 在 JSON 输出中包含 `defaultEmbedProvider` 和 `defaultEmbedModel` 字段

### 需求 6：Provider 嵌入 API 调用

**用户故事：** 作为开发者，我希望 `pai embed` 能够直接调用各 Provider 的嵌入 API，以便在 pi-ai 库不支持嵌入的情况下正常工作。

#### 验收标准

1. THE Embedding_Client SHALL 支持 OpenAI 兼容的嵌入 API 端点（`/v1/embeddings`）
2. WHEN 调用嵌入 API 时，THE Embedding_Client SHALL 使用与 chat 命令相同的凭证解析机制（CLI 参数 > 环境变量 > 配置文件）
3. THE Embedding_Client SHALL 支持通过 `baseUrl` 配置自定义 API 端点，以兼容自托管或代理服务
4. IF Provider 返回 API 错误（如认证失败、模型不支持嵌入），THEN THE Embedding_Client SHALL 返回 API 错误（退出码 3）并在 stderr 输出描述性错误信息
5. IF 网络请求失败（如超时、连接拒绝），THEN THE Embedding_Client SHALL 返回运行时错误（退出码 2）并在 stderr 输出描述性错误信息

### 需求 7：输入文本截断

**用户故事：** 作为开发者，我希望当输入文本超过嵌入模型的最大 token 限制时，系统能自动截断文本，以避免 API 调用失败。

#### 验收标准

1. THE Embed_Command SHALL 内置常用嵌入模型的最大 token 限制数据（如 OpenAI text-embedding-3-small: 8191 tokens）
2. WHEN 输入文本超过当前模型的最大 token 限制时，THE Embed_Command SHALL 自动截断文本至限制范围内
3. WHEN 文本被截断时，THE Embed_Command SHALL 在 stderr 输出警告信息，告知用户文本已被截断
4. WHEN 指定 `--json` 标志且文本被截断时，THE Embed_Command SHALL 在 stderr 以 NDJSON 警告事件输出截断信息
5. IF 当前模型不在内置限制数据中，THEN THE Embed_Command SHALL 跳过截断检查，直接发送原始文本

### 需求 8：CLI 参数与选项

**用户故事：** 作为开发者，我希望 `pai embed` 支持与现有命令一致的参数风格，以便保持使用体验的一致性。

#### 验收标准

1. THE Embed_Command SHALL 支持 `--provider <name>` 参数指定 Provider
2. THE Embed_Command SHALL 支持 `--model <name>` 参数指定嵌入模型
3. THE Embed_Command SHALL 支持 `--config <path>` 参数指定配置文件路径
4. THE Embed_Command SHALL 支持 `--json` 参数切换为机器可读输出模式
5. THE Embed_Command SHALL 支持 `--quiet` 参数抑制 stderr 进度输出
6. THE Embed_Command SHALL 支持 `--batch` 参数启用批量嵌入模式
7. THE Embed_Command SHALL 支持 `--input-file <path>` 参数从文件读取输入

### 需求 9：错误处理

**用户故事：** 作为开发者，我希望在出错时获得清晰的错误信息和正确的退出码，以便在脚本中正确处理异常。

#### 验收标准

1. IF 未配置任何 Provider 且未通过 CLI 指定，THEN THE Embed_Command SHALL 返回参数错误（退出码 1）并提示用户配置 Provider
2. IF 指定的 Provider 不存在于配置中，THEN THE Embed_Command SHALL 返回参数错误（退出码 1）
3. IF 未提供任何输入文本（无参数、无 stdin、无 --input-file），THEN THE Embed_Command SHALL 返回参数错误（退出码 1）
4. IF 输入文件不存在或不可读，THEN THE Embed_Command SHALL 返回 IO 错误（退出码 4）
5. WHEN 发生错误且指定了 `--json` 标志时，THE Embed_Command SHALL 以 NDJSON 错误事件格式输出到 stderr
