# PAI — Next Actions

Remaining improvement items. Completed items removed (see git history).
Priority: P0 (blocking/broken) → P1 (important gap) → P2 (quality/polish) → P3 (nice-to-have).

---

## P0 — Blocking / Broken

### 1. `--model_params` / `--model_params_file` Not Implemented

**WHY:** SPEC explicitly defines these parameters for chat command, but neither is registered in Commander.js nor handled anywhere. Users cannot pass provider-specific model parameters (top_p, frequency_penalty, etc.) as the SPEC promises.

**HOW:**
- Add `modelParams` and `modelParamsFile` to `ChatOptions` in `types.ts`
- Register `--model_params` and `--model_params_file` in `index.ts` chat command
- In `chat.ts`, parse JSON string / read JSON file, merge into LLM client options
- In `llm-client.ts` `buildOptions()`, spread the extra params
- Add unit tests for parsing, mutual exclusivity, and invalid JSON handling

**DECISION:** keep for future

---

## P1 — Important Gaps

### 2. Atomic Session File Writes

**WHY:** SPEC requires "原子追加或失败" for concurrent session writes. Current implementation uses plain `appendFile` — no file locking, no atomic rename. Two concurrent `pai chat --session same.jsonl` invocations can interleave partial JSON lines.

**HOW:**
- Use write-to-temp-then-rename pattern for new files
- For appends, use `flock` (Unix) or `lockfile` (cross-platform npm package)
- On lock failure, throw `PAIError` with exit code 4

**DECISION:** keep for future

### 3. Bedrock / Vertex Credential Handling

**WHY:** USAGE.md documents Amazon Bedrock and Google Vertex AI configuration, but `resolveCredentials()` only handles API key and OAuth. These providers will fail at runtime.

**HOW:**
- Update `resolveCredentials` to not throw when provider uses non-apiKey auth (check providerOptions)
- Add integration tests with mocked pi-ai

**DECISION:** keep for future

---

## P2 — Quality / Polish

### 4. README.md Is Empty

**WHY:** README is a single line. No installation instructions, no usage examples, no architecture overview.

**HOW:**
- Add: project description, installation, quick start, link to USAGE.md, dev setup, license

**DECISION:** keep for future

### 5. No CI/CD Pipeline

**WHY:** No GitHub Actions, no automated testing on push/PR.

**HOW:**
- Add `.github/workflows/ci.yml`: type-check, unit tests, build

**DECISION:** keep for future

### 6. `any` Types in LLM Client

**WHY:** `llm-client.ts` uses `any` extensively in `buildContext`, `buildOptions`, `buildAssistantMessage`.

**HOW:**
- 仅给 `buildAssistantMessage` 的 content blocks 加自定义 union type（`TextBlock | ToolCallBlock`）
- 不碰 pi-ai 的输入输出类型（0.x 阶段，强绑定 coupling 代价高于收益）

**DECISION:** 仅作最小改动，待实施。

### 7. bash_exec Safety Documentation

**WHY:** bash_exec 无安全限制，需在文档中明确说明安全模型。

**HOW:**
- 在 README/USAGE 中说明："bash_exec 以当前用户权限执行，无沙箱。生产环境请用容器隔离。"
- 不加应用层限制（超时/黑名单/输出限制），在图灵完备的 shell 上永远可绕过。

**DECISION:** 仅补文档，keep for future。

### 8. Credential Plaintext in Config File

**WHY:** API keys 和 OAuth tokens 明文存储在配置文件中。

**HOW:**
- 未来在 provider config 中支持 `credentialCommand` 字段
- `resolveCredentials` 执行该命令取 stdout 作为凭证
- PAI 只提供抽象扩展点，具体 secret backend 由上层决定

**DECISION:** keep for future，方向已定（`credentialCommand` 抽象）。

---

## P3 — Nice-to-Have

### 9. E2E Test Script Is Bash-Only

**WHY:** `test-e2e.sh` won't run on Windows.

**HOW:**
- Rewrite e2e tests in TypeScript using vitest + `child_process`

**DECISION:** keep for future
