# PAI — Next Actions

Comprehensive improvement roadmap based on full repo audit.
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

**DECISION**
keep for future

### 2. Error Object Format Doesn't Match SPEC

**WHY:** SPEC defines error JSON as `{ code, message, detail, trace_id }`. Current `OutputFormatter.writeError()` emits `{ type, message, context }` — a completely different shape. Any downstream tooling relying on the SPEC contract will break.

**HOW:**
- Define `ErrorObject` type in `types.ts` matching SPEC: `{ code: string, message: string, detail: object|null, trace_id: string|null }`
- Update `OutputFormatter.writeError()` to emit this shape in `--json` mode
- Map `PAIError.exitCode` → string code (e.g. `"PARAMETER_ERROR"`, `"IO_ERROR"`)
- Generate `trace_id` (nanoid or uuid) per invocation for traceability

**DECISION**
修改 SPEC，使之符合目前的实现，stderr里输出的最好都是shape一样的，我们把 { type, message, context } 这种 shape里的 type 扩展一个 "error" 值就可以了。

### 3. Non-Streaming Mode Writes Incrementally to stdout

**WHY:** SPEC says "无 `--stream` 参数时 … stdout 将在正常结束时一次性输出整个模型响应的结果". But `chat.ts` non-streaming path calls `outputFormatter.writeModelOutput(response.content)` which does `process.stdout.write(content)` — same incremental write as streaming. If content arrives in one chunk today it works by accident, but the contract is violated.

**HOW:**
- In `chat.ts` non-streaming branch, buffer the full `response.content`
- Write to stdout only once after the tool-calling loop finishes (or after final assistant message with no tool calls)
- Streaming branch stays as-is

**DECISION**
保持实现不变，更改相应的文档描述。
--stream 参数主要影响: 内部调用LLM时是否用stream模式，往stderr输出时是否流式。
stdout的输出流式没问题(如果模型流式输出， stdout就是真流式，如果模型输出不是流式，stdout就是假流式)，反正不影响调用者的行为(因为stdout本就不像文件，可以一次性读完)。

### 4. Session Append Saves ALL Messages (Including Pre-existing)

**WHY:** `chat.ts` calls `sessionManager.appendMessages(messages)` where `messages` is the full array including messages loaded from the session file. This duplicates the entire history every turn. Should only append new messages.

**HOW:**
- Track the index of messages before the chat loop starts (e.g. `const baseCount = messages.length` after loading + adding user message)
- After the loop, only append `messages.slice(baseCount)` (the new assistant/tool messages)
- Also need to handle the case where user message was added/replaced — if it's new, include it in the slice

**DECISION**
需要FIX。

## P1 — Important Gaps

### 5. Atomic Session File Writes

**WHY:** SPEC requires "原子追加或失败" for concurrent session writes. Current implementation uses plain `appendFile` — no file locking, no atomic rename. Two concurrent `pai chat --session same.jsonl` invocations can interleave partial JSON lines.

**HOW:**
- Use write-to-temp-then-rename pattern for new files
- For appends, use `flock` (Unix) or `lockfile` (cross-platform npm package)
- On lock failure, throw `PAIError` with exit code 4
- Add TODO comment acknowledging Windows limitations

**DECISION**
keep for future

### 6. Log File Missing Tool Call Details and Request Summary

**WHY:** SPEC requires log to contain "请求参数摘要、关键事件、错误信息、结果摘要". Current log only records user/assistant/system text. Tool calls, tool results, model name, provider, temperature — none of these are logged.

**HOW:**
- Add `logToolCall(name, args)` and `logToolResult(name, result)` methods to `OutputFormatter`
- Call them from the tool-calling loop in `chat.ts`
- Add a `logRequestSummary(provider, model, params)` method, call at start of chat
- Add `logError(error)` for error events

**DECISION**
需要FIX。

### 7. `--model` Is Optional in Code but SPEC Says Required for Chat

**WHY:** SPEC syntax shows `--model <name>` as required for chat. Implementation falls back to `provider.defaultModel || provider.models?.[0]`. This is arguably better UX, but it's a SPEC deviation. Either update SPEC or enforce it.

**HOW (recommended: update SPEC):**
- Update SPEC to document the fallback: `--model <name>` (optional if provider has defaultModel configured)
- This matches actual user expectation — nobody wants to type `--model` every time if they configured a default

**DECISION**
需要更改相应的SPEC描述。

### 8. No Tests for OAuth Login Flow

**WHY:** `handleModelLogin` is completely untested. It's the most complex user-facing flow (interactive prompts, OAuth callbacks, credential storage). Any regression here means users can't authenticate with GitHub Copilot, Anthropic, etc.

**HOW:**
- Mock `getOAuthProvider` and `getOAuthProviders` from `@mariozechner/pi-ai/oauth`
- Mock `createInterface` for readline prompts
- Test: successful login stores credentials in config
- Test: non-OAuth provider gives clear error
- Test: refresh token flow when credentials expire

**DECISION**
keep for future

### 9. No Tests for Tool Calling Loop in Chat

**WHY:** The multi-turn tool calling loop in `chat.ts` (LLM → bash_exec → LLM → …) is the core differentiator of PAI. It's tested only at integration level with full mocks. No unit-level test verifies: max iteration guard, error tool results fed back, session append correctness after tool calls.

**HOW:**
- Add focused tests in `vitest/integration/chat-command.test.ts` or a new file
- Mock LLMClient to return tool calls on first response, then final text
- Verify messages array grows correctly
- Verify max iteration (10) guard triggers and doesn't infinite-loop
- Verify tool errors are captured as tool result messages

**DECISION**
需要FIX。

### 10. No Tests for Image/Multimodal End-to-End

**WHY:** `--image` is fully wired but never tested beyond `input-resolver.test.ts` unit tests. No test verifies that an image flows from CLI → InputResolver → LLMClient → pi-ai correctly.

**HOW:**
- Add integration test: provide a small test PNG fixture
- Mock LLMClient, verify the messages array contains `{ type: "image", data: ..., mimeType: "image/png" }` content block
- Verify session file preserves multimodal content structure

**DECISION**
需要FIX。

### 11. TypeScript Strict Mode Issues

**WHY:** Multiple `exactOptionalPropertyTypes` errors visible in `chat.ts` and `session-manager.ts`. These are real type-safety gaps — passing `undefined` where the type doesn't allow it.

**HOW:**
- In `types.ts`, add `| undefined` to optional properties in `LLMClientConfig`, `InputSource` where needed
- Or use explicit undefined checks before passing values
- Fix unused `readFile` import in `session-manager.ts`
- Run `getDiagnostics` on all source files and fix remaining issues

**DECISION**
需要FIX。

### 12. Bedrock / Vertex Credential Handling

**WHY:** USAGE.md documents Amazon Bedrock and Google Vertex AI configuration, but `resolveCredentials()` only handles API key and OAuth. Bedrock uses AWS IAM (access key + secret + region), Vertex uses Google ADC / service account. These providers will fail at runtime because `apiKey` will be empty or wrong.

**HOW:**
- For Bedrock: pass `awsAccessKeyId`, `awsSecretAccessKey`, `awsRegion` through `providerOptions` → pi-ai handles the rest
- For Vertex: pass `googleProjectId`, `googleRegion` through `providerOptions`, rely on ADC or service account JSON
- Update `resolveCredentials` to not throw when provider uses non-apiKey auth (check if providerOptions has sufficient credentials)
- Add integration tests with mocked pi-ai

**DECISION**
keep for future

## P2 — Quality / Polish

### 13. README.md Is Empty

**WHY:** README is a single line. This is the first thing anyone sees on GitHub. No installation instructions, no usage examples, no architecture overview.

**HOW:**
- Add: project description, installation (`npm install -g`), quick start examples
- Link to USAGE.md for detailed provider configuration
- Add: architecture overview (one paragraph + component list)
- Add: development setup (clone, install, build, test)
- Add: license section

**DECISION**
keep for future

### 14. No CI/CD Pipeline

**WHY:** No GitHub Actions, no automated testing on push/PR. Regressions can be merged silently. For a CLI tool that manages credentials and executes shell commands, this is risky.

**HOW:**
- Add `.github/workflows/ci.yml`: lint, type-check, unit tests, build
- Run on push to main and all PRs
- Add test coverage reporting (vitest v8 provider is already configured)
- Consider adding e2e tests with a mock provider in CI

**DECISION**
keep for future

### 15. `any` Types in LLM Client

**WHY:** `llm-client.ts` uses `any` extensively: `buildContext` returns `any`, `buildOptions` returns `any`, `buildAssistantMessage` has `any[]` content blocks. This defeats TypeScript's purpose and hides bugs.

**HOW:**
- Define proper interfaces for pi-ai context, options, and message types
- Import types from `@mariozechner/pi-ai` where available
- Replace `any` with specific types or `unknown` + type guards
- This will likely surface real bugs

**DECISION**
need discuss later

### 16. bash_exec Has No Safety Guardrails

**WHY:** SPEC says "user responsibility" for security, which is fine for v1. But there's no timeout, no output size limit beyond 10MB buffer, and no way to disable the tool. A malicious or buggy LLM response could run `rm -rf /` or hang forever.

**HOW (incremental, non-breaking):**
- Add configurable timeout (default 30s, override via `--tool-timeout`)
- Add `--no-tools` flag to disable all tools for read-only queries
- Document the security model clearly in README/USAGE
- Future: allowlist/denylist for commands

**DECISION**
need discuss later

### 17. Credential Plaintext in Config File

**WHY:** API keys and OAuth tokens are stored as plaintext JSON in `~/config/pai/default.json`. SPEC already has a TODO for this. Anyone with read access to the file gets all credentials.

**HOW (future, as noted in SPEC TODO):**
- Phase 1: Set file permissions to 600 on creation (`fs.chmod`)
- Phase 2: Integrate OS keyring via `keytar` or similar
- Phase 3: Support 1Password CLI / external secret managers
- For now, at minimum set restrictive file permissions

**DECISION**
need discuss later

### 18. `package.json` Name Is "main"

**WHY:** Package name is literally `"main"`. If published to npm, this would conflict. Even locally, `npm link` creates a confusing global `main` command alongside `pai`.

**HOW:**
- Rename to `"pai-cli"` or `"@yourscope/pai"`
- Update description to be more specific
- Add `author`, `repository`, `homepage` fields

**DECISION**
需要fix。

### 19. Test Coverage Reporting Not Wired

**WHY:** `vitest.config.ts` has coverage configuration but `package.json` has no `test:coverage` script. Coverage is configured but never actually run.

**HOW:**
- Add `"test:coverage": "vitest run --coverage"` to package.json scripts
- Add coverage thresholds to vitest config to prevent regression
- Add coverage output to `.gitignore`

**DECISION**
需要fix。

## P3 — Nice-to-Have

### 20. `--user_input_text` / `--user_input_file` SPEC Aliases

**WHY:** SPEC mentions `--user_input_text <text>` and `--user_input_file <path>` as parameter names, but implementation uses positional `[prompt]` and `--input-file`. Not a bug per se (SPEC could be updated), but worth aligning.

**HOW:**
- Either update SPEC to match implementation (recommended — current CLI is more Unix-idiomatic)
- Or add aliases in Commander.js for backward compatibility

**DECISION**
需要fix(改SPEC使之符合实现)。

### 21. `model config --add` Doesn't Validate `--set` Keys

**WHY:** Users can `--set anyRandomKey=value` and it gets stored. No validation that the key is meaningful for the provider. Typos like `--set apikey=xxx` (lowercase) silently fail.

**HOW:**
- Define known keys per provider type (apiKey, defaultModel, temperature, etc.)
- Warn (not error) on unknown keys to stderr
- This preserves extensibility while catching typos

**DECISION**
需要fix。

### 22. No `model config --show` Command

**WHY:** Users can list all providers but can't inspect a single provider's full configuration (minus secrets). Useful for debugging.

**HOW:**
- Add `pai model config --show --name <name>` subcommand
- Display all fields except apiKey/oauth (mask as `***`)
- Support `--json` output

**DECISION**
需要fix，另外 pai model config 和 pai model list 的输出都加一个输出当前配置文件全路径。

### 23. No `--version` for Subcommands

**WHY:** `pai --version` works (Commander.js), but there's no way to check pi-ai library version or provider API versions. Useful for bug reports.

**HOW:**
- Add `pai --version --verbose` or `pai version` that shows: PAI version, pi-ai version, Node.js version
- Read pi-ai version from its package.json

**DECISION**
需要fix，就用 pai --version 吧。

### 24. E2E Test Script Is Bash-Only

**WHY:** `test-e2e.sh` won't run on Windows. PAI itself supports Windows (bash_exec uses cmd.exe), but the test suite doesn't.

**HOW:**
- Rewrite e2e tests in TypeScript using vitest
- Use `execa` or `child_process` to invoke `pai` CLI
- This also enables running e2e in CI on all platforms

**DECISION**
keep for future

### 25. No `--dry-run` or `--explain` Mode

**WHY:** Users may want to see what PAI would do (which provider, model, credentials source) without actually calling the LLM. Useful for debugging configuration.

**HOW:**
- Add `--dry-run` flag to chat command
- Print resolved config (provider, model, credential source, message count) to stderr
- Exit 0 without making API call

**DECISION**
需要fix。
