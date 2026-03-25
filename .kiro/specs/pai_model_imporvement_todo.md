# PAI model/provider configuration improvements — TODO

This document captures issues and proposed improvements for `pai` provider/model configuration, with a focus on making downstream callers (e.g. `agent`) able to reliably discover available models and resolve a stable default model.

---

## 1) Current status (confirmed)

### 1.1 Provider config supports model-related fields, but only per-provider

In `pai/src/commands/model.ts`, `pai model config --add/--update --set` recognizes the following model-related keys:

- `defaultModel`
- `models`
- plus other runtime knobs: `temperature`, `maxTokens`, `contextWindow`, etc.

So `pai` **can** store model information, but it is:
- scoped to a provider entry, not global
- stringly-typed at the CLI boundary (`--set key=value`), and may need parsing/validation

### 1.2 Global defaults exist only for provider (and embedding), not chat model

`pai model default` can set/show:
- `defaultProvider`
- `defaultEmbedProvider`, `defaultEmbedModel`

There is **no global default chat model** (e.g. `defaultChatModel`).

### 1.3 Model resolution during `pai chat`

`pai chat` resolves model roughly in this order:

1. `--model` CLI flag
2. provider config `defaultModel`
3. provider config `models[0]`
4. fallback to pi-ai registry `getModels(provider)[0]` (if available)

Implication: if callers don’t specify `--model` and provider config doesn’t set `defaultModel`, the final model choice can be implicit/unpredictable.

### 1.4 Listing models

- `pai model list --all` can list all supported providers and their models via pi-ai registry.
- `pai model list` prints configured providers and shows `defaultModel` / `models` if present in config.

But there is no single command that answers: **“given my current config + overrides, what model will you actually use, and what is its context window/maxTokens?”**

---

## 2) Problems observed (especially for agent)

1) **Downstream callers can’t reliably discover a stable default model**
- `agent` needs a deterministic provider+model.
- If `agent` config only specifies provider (or nothing), it falls back to `pai` resolution, which may choose a different model over time.

2) **No machine-friendly “resolved model info” API**
- Callers want: resolved provider, resolved model, `contextWindow`, `maxTokens`, and list of available models.
- Today they have to re-implement `pai chat`’s resolution logic or parse human output.

3) **Stringly-typed `--set models=...` is fragile**
- It’s unclear/implicit whether `models` is stored as a string or parsed as an array.
- Even if parsed, validation is weak: typos silently become unusable defaults.

4) **No validation that `defaultModel` is in the available model set**
- Misconfiguration errors show up only at runtime.

5) **Context window is configured but not surfaced**
- `provider.contextWindow` exists but is not exposed as a resolved value for callers to plan session compaction.

---

## 3) Proposed improvements (recommended)

### 3.1 Add `pai model resolve` (JSON-first, stable contract)

Add a new command:

```bash
pai model resolve [--provider <name>] [--model <id>] [--json]
```

Behavior:
- Uses the same resolution logic as `pai chat`.
- Outputs machine-friendly JSON (even without `--json`, at least allow `--json`):

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "contextWindow": 128000,
  "maxTokens": 16384,
  "temperature": 0.7,
  "configured": {
    "defaultProvider": "openai",
    "providerDefaultModel": "gpt-4o-mini",
    "providerModels": ["gpt-4o-mini", "gpt-4o"],
    "embed": {"provider": "openai", "model": "text-embedding-3-small"}
  },
  "availableModels": {
    "source": "pi-ai",
    "models": ["gpt-4o-mini", "gpt-4o", "..."]
  }
}
```

Why:
- `agent` can call this to get deterministic runtime settings.
- It also becomes the canonical place to expose `contextWindow`.

### 3.2 Add global default chat model (optional but useful)

Extend `pai model default` to support:

- `--chat-model <id>` (or `--default-model <id>`) stored globally.

Resolution order becomes:

1. `--model`
2. provider config `defaultModel`
3. global `defaultChatModel`
4. provider config `models[0]`
5. pi-ai `getModels()[0]`

This makes “default provider + default model” a coherent pair.

### 3.3 Make `models` a first-class, typed option (avoid `--set`)

Add explicit flags:

```bash
pai model config --add --name openai --provider openai \
  --api-key ... \
  --default-model gpt-4o-mini \
  --models gpt-4o-mini,gpt-4o
```

Or allow multiple:

```bash
--model gpt-4o-mini --model gpt-4o
```

Benefits:
- parse/validate consistently
- better UX
- can validate against pi-ai registry if available

(You can keep `--set` for extensibility, but provide typed shortcuts for common keys.)

### 3.4 Validate models at config time

When setting `defaultModel` / `models`:
- If provider is known to pi-ai, validate that model ids exist.
- Otherwise warn (not error) to allow custom endpoints.

Also validate:
- `defaultModel` ∈ `models` (if models list is set)

### 3.5 Surface context window/maxTokens in listing

Enhance:
- `pai model list --json`

Include resolved `contextWindow` and `maxTokens` per configured provider.

### 3.6 Provide an API for downstream tools (agent) to self-configure

Recommended agent flow:
- On `agent init`, if user doesn’t specify provider/model:
  - call `pai model resolve --json`
  - write resolved provider/model into agent config

This avoids runtime drift.

---

## 4) Implementation sketch (files & steps)

- [ ] `pai/src/commands/model.ts`
  - add `handleModelResolve()` and CLI wiring
  - implement model resolution in one shared helper used by both `chat` and `resolve`

- [ ] `pai/src/config-manager.ts`
  - add fields for global default chat model (optional)
  - add typed getters for resolved provider config

- [ ] `pai/src/commands/chat.ts`
  - refactor model selection logic into shared function to prevent divergence

- [ ] `pai/USAGE.md`
  - document `model resolve`
  - document new default model semantics

- [ ] tests
  - resolve order and outputs
  - validation behavior for known providers

---

## 5) Quick wins (minimal changes)

If you want the smallest changes with maximum immediate benefit:

1) Implement `pai model resolve --json`.
2) Ensure it outputs `contextWindow` and `maxTokens`.

This alone unblocks `agent` session compaction and deterministic startup.

