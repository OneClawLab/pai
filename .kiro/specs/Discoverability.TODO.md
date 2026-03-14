# PAI 可发现性整改清单

基于 ProgressiveDiscovery.md 规范逐项检查。

## 高优先级 (MUST 违规)

### 1. 缺少 `--help --verbose` 支持
- 规范要求: MUST 支持 `--help --verbose` 输出当前命令层级的完整信息
- 现状: 使用 commander 默认 --help，不支持 --verbose 参数
- 影响: 所有命令和子命令（pai, pai chat, pai embed, pai model, pai model config 等）
- 整改: 自定义 helpOption 处理逻辑，检测 `--help --verbose` 时输出完整 USAGE（含所有选项详细说明、完整 examples 等）

### 2. USAGE 缺少 examples
- 规范要求: MUST 有 examples
- 现状: `--help` 输出中没有任何 examples（USAGE.md 有，但 --help 没有）
- 影响: 所有命令和子命令
- 整改: 在 commander 的 `addHelpText('after', ...)` 中添加 examples 段

### 3. 退出码不符合规范
- 规范要求: MUST 遵循 0=成功, 1=一般错误, 2=参数/用法错误
- 现状: pai 定义了自己的退出码体系 (1=参数错误, 2=运行时错误, 3=API错误, 4=IO错误)，参数错误用的是 1 而非 2
- 整改: 将退出码映射调整为 0=成功, 2=参数/用法错误, 1=其他错误。或在 USAGE 中明确说明自定义退出码（规范允许自定义但 MUST 说明）
- 注意: 当前 --help 输出中没有列出退出码，USAGE.md 中有但 --help 中没有引用

### 4. 自动 --help 时退出码应为 2
- 规范要求: 因参数错误触发自动 --help 时退出码 MUST 为 2
- 现状: `pai` 无参数时显示 help 并退出码为 0（这个没问题，无参数 = 显示帮助）。但 commander 默认参数错误时退出码为 1
- 整改: 配置 commander 的 exitOverride，参数错误时退出码改为 2

### 5. stdin/管道支持未在 --help 中标注
- 规范要求: 如果支持 stdin，MUST 在 USAGE 中明确标注
- 现状: `pai chat` 和 `pai embed` 都支持 stdin，但 --help 输出中没有提及
- 整改: 在 chat 和 embed 的 help text 中标注 stdin 支持

### 6. 环境与前置依赖未在 --help 中说明
- 规范要求: 如果依赖外部服务，MUST 在 USAGE 中说明
- 现状: pai 依赖 provider 配置（API key 等），但 --help 中没有提及前置条件
- 整改: 至少在主命令 --help 中提示需要先配置 provider（`pai model config --add ...`）

### 7. 机器可读输出未在所有支持的子命令 --help 中说明
- 规范要求: 如果支持 --json，MUST 在 USAGE 中说明
- 现状: --json 作为 option 列出了，但没有说明其输出格式（NDJSON vs JSON）
- 整改: 在支持 --json 的子命令 help 中简要说明输出格式

## 中优先级 (SHOULD 违规)

### 8. 错误输出缺少修复建议
- 规范要求: 错误信息 SHOULD 包含"什么错了"+"怎么修"
- 现状: 部分错误有修复建议（如 "No credentials found" 场景），但不是所有错误都有
- 整改: 审查所有错误路径，补充修复建议

### 9. --json 模式下错误未以 JSON 输出
- 规范要求: `--json` 模式下错误 MUST 也以 JSON 格式输出
- 现状: --json 模式下错误仍然是纯文本输出到 stderr
- 整改: 当 --json 启用时，错误也输出为 `{"error": "...", "suggestion": "..."}`
- 注意: 这个虽然规范写的 MUST，但实现复杂度较高，列为中优先级

### 10. 配置文件路径未在 --help 中提及
- 规范要求: SHOULD 告诉使用者配置数据在哪里
- 现状: --help 中有 `--config <path>` 选项但没说默认路径
- 整改: 在 help text 中注明默认配置路径 `~/config/pai/default.json`

### 11. --version 信息丰富但格式可以更好
- 现状: `pai 1.0.0 (pi-ai 0.57.1, Node v22.17.0)` — 这个做得不错
- 无需整改

### 12. 幂等性与 --dry-run
- 规范要求: SHOULD 标注幂等性，SHOULD 提供 --dry-run
- 现状: `pai chat --dry-run` 已实现。`pai model config --add` 是 upsert（幂等），但未标注
- 整改: 在 model config 的 help 中标注 --add 是 upsert 行为

## 低优先级 (MAY / 建议)

### 13. examples 格式统一
- 规范要求: SHOULD 使用 `$` 前缀并附带注释
- 现状: USAGE.md 中的 examples 格式良好，但 --help 中没有 examples
- 整改: 随高优先级 #2 一起处理

### 14. USAGE.md 与 --help 的关联
- 现状: USAGE.md 内容非常详尽，但 --help 中没有引用它
- 建议: 在 --help 末尾加一行 `Full documentation: see USAGE.md or https://...`
