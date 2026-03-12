# PAI Usage Guide

PAI is a Unix-style command-line tool for interacting with Large Language Models (LLMs).

## Installation

```bash
npm install
npm run build
npm link  # or use: node dist/index.js
```

## Quick Start

### 1. Configure a Provider

PAI supports many providers via `@mariozechner/pi-ai`. Different providers use different authentication methods.

```bash
# API Key providers (e.g. OpenAI)
pai model config --add --name openai --provider openai --set apiKey=sk-...

# OAuth providers (e.g. GitHub Copilot) — interactive browser login
pai model login --name github-copilot
```

### 2. List Available Providers

```bash
# List configured providers
pai model list

# List all supported providers
pai model list --all
```

### 3. Chat with an LLM

```bash
# Simple chat
pai chat "Hello, how are you?" --provider openai --model gpt-4o-mini

# Using stdin
echo "Explain quantum computing" | pai chat --provider openai --model gpt-4o-mini

# With streaming output
pai chat "Write a story" --stream --provider openai --model gpt-4o
```

## Provider Configuration

PAI providers fall into several authentication categories. All configuration is done through `pai` CLI commands — no external config files needed.

### Category 1: API Key Providers

These providers require a simple API key. Configure with `--set apiKey=<key>`.

#### OpenAI

```bash
pai model config --add --name openai --provider openai \
  --set apiKey=sk-... \
  --set defaultModel=gpt-4o-mini
```

Environment variable alternative: `OPENAI_API_KEY`

#### Anthropic (API Key)

```bash
pai model config --add --name anthropic --provider anthropic \
  --set apiKey=sk-ant-... \
  --set defaultModel=claude-sonnet-4-20250514
```

Environment variable alternative: `ANTHROPIC_API_KEY`

#### Google Gemini (API Key)

```bash
pai model config --add --name google --provider google \
  --set apiKey=AIza... \
  --set defaultModel=gemini-2.5-flash
```

Environment variable alternative: `GEMINI_API_KEY`

#### Groq

```bash
pai model config --add --name groq --provider groq \
  --set apiKey=gsk_... \
  --set defaultModel=llama-3.3-70b-versatile
```

Environment variable alternative: `GROQ_API_KEY`

#### xAI (Grok)

```bash
pai model config --add --name xai --provider xai \
  --set apiKey=xai-... \
  --set defaultModel=grok-3-mini
```

Environment variable alternative: `XAI_API_KEY`

#### Cerebras

```bash
pai model config --add --name cerebras --provider cerebras \
  --set apiKey=csk-...
```

Environment variable alternative: `CEREBRAS_API_KEY`

#### Mistral

```bash
pai model config --add --name mistral --provider mistral \
  --set apiKey=... \
  --set defaultModel=mistral-large-latest
```

Environment variable alternative: `MISTRAL_API_KEY`

#### OpenRouter

```bash
pai model config --add --name openrouter --provider openrouter \
  --set apiKey=sk-or-... \
  --set defaultModel=anthropic/claude-sonnet-4
```

Environment variable alternative: `OPENROUTER_API_KEY`

#### HuggingFace

```bash
pai model config --add --name huggingface --provider huggingface \
  --set apiKey=hf_...
```

Environment variable alternative: `HF_TOKEN`

#### MiniMax / MiniMax CN

```bash
pai model config --add --name minimax --provider minimax \
  --set apiKey=...

pai model config --add --name minimax-cn --provider minimax-cn \
  --set apiKey=...
```

Environment variable alternatives: `MINIMAX_API_KEY` / `MINIMAX_CN_API_KEY`

#### Kimi Coding

```bash
pai model config --add --name kimi-coding --provider kimi-coding \
  --set apiKey=...
```

Environment variable alternative: `KIMI_API_KEY`

---

### Category 2: OAuth Providers (Interactive Login)

These providers use OAuth device code or browser-based login flows. Use `pai model login` to authenticate interactively. Credentials (refresh token, access token, expiry) are stored in the PAI config file and automatically refreshed when expired.

#### GitHub Copilot

Requires a GitHub Copilot subscription. Uses OAuth device code flow — a browser window opens for GitHub authorization.

```bash
# Step 1: Login (interactive — opens browser)
pai model login --name github-copilot

# The flow will:
#   1. Ask for GitHub Enterprise URL (press Enter for github.com)
#   2. Open a browser URL for device code authorization
#   3. Display a user code to enter in the browser
#   4. After authorization, save credentials to PAI config

# Step 2: Chat
pai chat "Hello" --provider github-copilot --model gpt-4o
```

After login, the config file will contain the OAuth credentials under the `github-copilot` provider:

```json
{
  "schema_version": "1.0.0",
  "providers": [
    {
      "name": "github-copilot",
      "oauth": {
        "refresh": "ghu_...",
        "access": "tid=...;exp=...;proxy-ep=...",
        "expires": 1773219099000
      }
    }
  ]
}
```

For GitHub Enterprise:

```bash
pai model login --name github-copilot
# When prompted for "GitHub Enterprise URL/domain", enter: company.ghe.com
```

Environment variable alternative: `COPILOT_GITHUB_TOKEN` or `GH_TOKEN` or `GITHUB_TOKEN`

#### Anthropic (Claude Pro/Max via OAuth)

For Claude Pro/Max subscription users. Uses PKCE OAuth flow — opens a browser for Anthropic authorization, then you paste the authorization code back.

```bash
# Step 1: Login (interactive — opens browser)
pai model login --name anthropic

# The flow will:
#   1. Open a browser URL for Anthropic OAuth authorization
#   2. After authorizing, you'll get a code (format: code#state)
#   3. Paste the code back into the terminal
#   4. Credentials saved to PAI config

# Step 2: Chat
pai chat "Hello" --provider anthropic --model claude-sonnet-4-20250514
```

Note: If you have an Anthropic API key (not a subscription), use the API Key method instead:

```bash
pai model config --add --name anthropic --provider anthropic --set apiKey=sk-ant-...
```

Environment variable alternative: `ANTHROPIC_OAUTH_TOKEN` (takes precedence over `ANTHROPIC_API_KEY`)

#### Google Gemini CLI (Google Cloud Code Assist)

Free tier available. Uses Google OAuth with a local callback server — a browser window opens for Google account authorization.

```bash
# Step 1: Login (interactive — opens browser)
pai model login --name google-gemini-cli

# The flow will:
#   1. Start a local server on port 8085 for OAuth callback
#   2. Open a browser URL for Google account authorization
#   3. After authorization, automatically discover/provision a Cloud project
#   4. Credentials (including projectId) saved to PAI config

# Step 2: Chat
pai chat "Hello" --provider google-gemini-cli --model gemini-2.5-flash
```

For workspace/enterprise users, set the project ID via environment variable before login:

```bash
export GOOGLE_CLOUD_PROJECT=my-project-id
pai model login --name google-gemini-cli
```

#### Google Antigravity (Gemini 3, Claude, GPT-OSS via Google Cloud)

Access to additional models (Gemini 3, Claude, GPT-OSS) through Google Cloud. Uses a different OAuth flow than google-gemini-cli.

```bash
# Step 1: Login (interactive — opens browser)
pai model login --name google-antigravity

# The flow will:
#   1. Start a local server on port 51121 for OAuth callback
#   2. Open a browser URL for Google account authorization
#   3. Discover/provision a Cloud project
#   4. Credentials saved to PAI config

# Step 2: Chat
pai chat "Hello" --provider google-antigravity --model <model-id>
```

#### OpenAI Codex (ChatGPT Plus/Pro Subscription)

For ChatGPT Plus/Pro subscribers. Uses PKCE OAuth with a local callback server.

```bash
# Step 1: Login (interactive — opens browser)
pai model login --name openai-codex

# The flow will:
#   1. Start a local server on port 1455 for OAuth callback
#   2. Open a browser URL for OpenAI authorization
#   3. After authorization, extract accountId from JWT token
#   4. Credentials saved to PAI config

# Step 2: Chat
pai chat "Hello" --provider openai-codex --model codex-mini
```

#### List All OAuth Providers

```bash
# See which providers support OAuth login
pai model login --name help
# Supported: github-copilot, anthropic, google-gemini-cli, google-antigravity, openai-codex
```

---

### Category 3: Azure OpenAI (API Key + Endpoint Configuration)

Azure OpenAI requires an API key plus Azure-specific endpoint configuration (resource name or base URL, deployment name, API version).

```bash
# Method 1: Using azureBaseUrl (recommended)
pai model config --add --name my-azure --provider azure-openai-responses \
  --set apiKey=your-azure-api-key \
  --set defaultModel=gpt-4o \
  --set api=azure-openai-responses \
  --set baseUrl=https://my-resource.openai.azure.com/openai/v1 \
  --set "providerOptions.azureApiVersion=v1" \
  --set "providerOptions.azureDeploymentName=gpt-4o"

# Method 2: Using environment variables
export AZURE_OPENAI_API_KEY=your-azure-api-key
export AZURE_OPENAI_BASE_URL=https://my-resource.openai.azure.com/openai/v1
export AZURE_OPENAI_API_VERSION=v1

pai model config --add --name my-azure --provider azure-openai-responses \
  --set defaultModel=gpt-4o \
  --set api=azure-openai-responses \
  --set "providerOptions.azureDeploymentName=gpt-4o"

# Chat
pai chat "Hello" --provider my-azure --model gpt-4o
```

Full Azure config file example:

```json
{
  "schema_version": "1.0.0",
  "defaultProvider": "my-azure",
  "providers": [
    {
      "name": "my-azure",
      "defaultModel": "gpt-4o",
      "apiKey": "your-azure-api-key",
      "api": "azure-openai-responses",
      "baseUrl": "https://my-resource.openai.azure.com/openai/v1",
      "reasoning": false,
      "input": ["text", "image"],
      "contextWindow": 128000,
      "maxTokens": 16384,
      "providerOptions": {
        "azureApiVersion": "v1",
        "azureDeploymentName": "gpt-4o"
      }
    }
  ]
}
```

Azure-specific environment variables:
- `AZURE_OPENAI_API_KEY` — API key
- `AZURE_OPENAI_BASE_URL` — Full base URL (e.g. `https://my-resource.openai.azure.com/openai/v1`)
- `AZURE_OPENAI_RESOURCE_NAME` — Resource name (alternative to base URL, constructs `https://<name>.openai.azure.com/openai/v1`)
- `AZURE_OPENAI_API_VERSION` — API version (default: `v1`)
- `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` — Comma-separated model-to-deployment mapping (e.g. `gpt-4o=my-gpt4o-deployment,gpt-4o-mini=my-mini-deployment`)

---

### Category 4: Amazon Bedrock (AWS Credentials)

Amazon Bedrock uses AWS IAM credentials instead of API keys. No `apiKey` is needed — authentication is handled through standard AWS credential mechanisms.

```bash
# Method 1: AWS Profile
export AWS_PROFILE=my-profile
export AWS_REGION=us-east-1
pai model config --add --name bedrock --provider amazon-bedrock \
  --set defaultModel=anthropic.claude-sonnet-4-20250514-v1:0

# Method 2: IAM Access Keys
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=us-east-1
pai model config --add --name bedrock --provider amazon-bedrock \
  --set defaultModel=anthropic.claude-sonnet-4-20250514-v1:0

# Method 3: Bedrock API Keys (Bearer Token)
export AWS_BEARER_TOKEN_BEDROCK=...
pai model config --add --name bedrock --provider amazon-bedrock \
  --set defaultModel=anthropic.claude-sonnet-4-20250514-v1:0

# Chat
pai chat "Hello" --provider bedrock --model anthropic.claude-sonnet-4-20250514-v1:0
```

Supported AWS credential sources (checked in order):
1. `AWS_PROFILE` — Named profile from `~/.aws/credentials`
2. `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` — Standard IAM keys
3. `AWS_BEARER_TOKEN_BEDROCK` — Bedrock API keys (bearer token)
4. `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` — ECS task roles
5. `AWS_CONTAINER_CREDENTIALS_FULL_URI` — ECS task roles (full URI)
6. `AWS_WEB_IDENTITY_TOKEN_FILE` — IRSA (IAM Roles for Service Accounts)

---

### Category 5: Google Vertex AI (Application Default Credentials)

Google Vertex AI uses Google Cloud Application Default Credentials (ADC) instead of API keys.

```bash
# Step 1: Set up ADC (one-time)
gcloud auth application-default login

# Step 2: Set required environment variables
export GOOGLE_CLOUD_PROJECT=my-project-id
export GOOGLE_CLOUD_LOCATION=us-central1

# Step 3: Configure provider
pai model config --add --name vertex --provider google-vertex \
  --set defaultModel=gemini-2.5-flash

# Chat
pai chat "Hello" --provider vertex --model gemini-2.5-flash
```

Alternatively, use a service account key file:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
export GOOGLE_CLOUD_PROJECT=my-project-id
export GOOGLE_CLOUD_LOCATION=us-central1
pai model config --add --name vertex --provider google-vertex
```

Required environment variables:
- `GOOGLE_CLOUD_PROJECT` or `GCLOUD_PROJECT` — GCP project ID
- `GOOGLE_CLOUD_LOCATION` — GCP region (e.g. `us-central1`)
- ADC credentials via `gcloud auth application-default login` or `GOOGLE_APPLICATION_CREDENTIALS`

---

### Provider Authentication Summary

| Provider | Auth Type | Config Method |
|---|---|---|
| `openai` | API Key | `--set apiKey=sk-...` |
| `anthropic` | API Key or OAuth | `--set apiKey=...` or `pai model login` |
| `google` | API Key | `--set apiKey=AIza...` |
| `github-copilot` | OAuth | `pai model login --name github-copilot` |
| `google-gemini-cli` | OAuth | `pai model login --name google-gemini-cli` |
| `google-antigravity` | OAuth | `pai model login --name google-antigravity` |
| `openai-codex` | OAuth | `pai model login --name openai-codex` |
| `azure-openai-responses` | API Key + Endpoint | `--set apiKey=... --set baseUrl=...` |
| `amazon-bedrock` | AWS Credentials | AWS env vars (`AWS_PROFILE`, etc.) |
| `google-vertex` | ADC | `gcloud auth` + env vars |
| `groq` | API Key | `--set apiKey=gsk_...` |
| `cerebras` | API Key | `--set apiKey=csk-...` |
| `xai` | API Key | `--set apiKey=xai-...` |
| `mistral` | API Key | `--set apiKey=...` |
| `openrouter` | API Key | `--set apiKey=sk-or-...` |
| `huggingface` | API Key | `--set apiKey=hf_...` |
| `minimax` | API Key | `--set apiKey=...` |
| `minimax-cn` | API Key | `--set apiKey=...` |
| `kimi-coding` | API Key | `--set apiKey=...` |
| `opencode` | API Key | `--set apiKey=...` |
| `opencode-go` | API Key | `--set apiKey=...` |
| `vercel-ai-gateway` | API Key | `--set apiKey=...` |
| `zai` | API Key | `--set apiKey=...` |

## Commands

### `pai chat`

Chat with an LLM. Supports tool calling (bash_exec is built-in).

**Options:**
- `--config <path>` - Config file path (default: ~/config/pai/default.json)
- `--session <path>` - Session file for conversation history (JSONL format)
- `--system <text>` - System instruction
- `--system-file <path>` - System instruction from file
- `--input-file <path>` - User input from file
- `--image <path...>` - Image file(s) to include
- `--provider <name>` - Provider name
- `--model <name>` - Model name
- `--temperature <number>` - Temperature (0-2)
- `--max-tokens <number>` - Max tokens
- `--stream` - Enable streaming output
- `--no-append` - Do not append to session file
- `--json` - Output progress as NDJSON
- `--quiet` - Suppress progress output
- `--log <path>` - Log file path (Markdown)

### `pai model list`

List providers and models.

**Options:**
- `--all` - Show all supported providers
- `--json` - Output as JSON

### `pai model config`

Configure providers (add/update/delete).

**Options:**
- `--add` - Add or update provider
- `--delete` - Delete provider
- `--name <name>` - Provider name
- `--provider <type>` - Provider type
- `--set <key=value...>` - Set configuration values

### `pai model login`

Interactive OAuth login for providers that require browser-based authentication.

**Options:**
- `--name <name>` - Provider name (required)
- `--config <path>` - Config file path

**Supported providers:** `github-copilot`, `anthropic`, `google-gemini-cli`, `google-antigravity`, `openai-codex`

## Configuration

### Config File

Default location: `~/config/pai/default.json`

```json
{
  "schema_version": "1.0.0",
  "defaultProvider": "openai",
  "providers": [
    {
      "name": "openai",
      "apiKey": "sk-...",
      "models": ["gpt-4o", "gpt-4o-mini"],
      "defaultModel": "gpt-4o-mini",
      "temperature": 0.7,
      "maxTokens": 2000
    }
  ]
}
```

### Provider Config Fields

| Field | Type | Description |
|---|---|---|
| `name` | string | Provider name (used with `--provider`) |
| `apiKey` | string | API key (for API key providers) |
| `oauth` | object | OAuth credentials (for OAuth providers, managed by `pai model login`) |
| `defaultModel` | string | Default model when `--model` is not specified |
| `models` | string[] | List of available models |
| `temperature` | number | Default temperature (0-2) |
| `maxTokens` | number | Default max tokens |
| `api` | string | pi-ai API type (e.g. `azure-openai-responses`) |
| `baseUrl` | string | Base URL for custom/self-hosted endpoints |
| `reasoning` | boolean | Whether the model supports reasoning/thinking |
| `input` | string[] | Input modalities: `["text"]` or `["text", "image"]` |
| `contextWindow` | number | Context window size in tokens |
| `providerOptions` | object | Provider-specific options (e.g. Azure deployment config) |

### Authentication Priority

Credentials are resolved in this order (highest priority first):

1. CLI parameters
2. Environment variables (`PAI_<PROVIDER>_API_KEY` or provider-specific env vars)
3. Config file (`apiKey` field or `oauth` credentials)

Provider-specific environment variables:

| Provider | Environment Variable |
|---|---|
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` |
| `google` | `GEMINI_API_KEY` |
| `github-copilot` | `COPILOT_GITHUB_TOKEN` or `GH_TOKEN` or `GITHUB_TOKEN` |
| `azure-openai-responses` | `AZURE_OPENAI_API_KEY` |
| `groq` | `GROQ_API_KEY` |
| `cerebras` | `CEREBRAS_API_KEY` |
| `xai` | `XAI_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `mistral` | `MISTRAL_API_KEY` |
| `huggingface` | `HF_TOKEN` |
| `vercel-ai-gateway` | `AI_GATEWAY_API_KEY` |
| `zai` | `ZAI_API_KEY` |
| `minimax` | `MINIMAX_API_KEY` |
| `minimax-cn` | `MINIMAX_CN_API_KEY` |
| `kimi-coding` | `KIMI_API_KEY` |
| `opencode` / `opencode-go` | `OPENCODE_API_KEY` |

### Session Files

Session files use JSONL format (one JSON object per line):

```jsonl
{"role":"system","content":"You are helpful","timestamp":"2024-01-01T00:00:00Z"}
{"role":"user","content":"Hello","timestamp":"2024-01-01T00:00:01Z"}
{"role":"assistant","content":"Hi there!","timestamp":"2024-01-01T00:00:02Z"}
```

## Built-in Tools

### bash_exec

The LLM can execute shell commands using the `bash_exec` tool.

```bash
pai chat "What files are in the current directory?" --provider openai --model gpt-4o
```

The LLM will use `bash_exec` to run `ls` (or `dir` on Windows) and return the results.

**Security Note:** bash_exec has no security restrictions. The LLM can execute any command. Use with caution.

## Output Modes

### Human-Readable (Default)

```bash
pai chat "Hello"
# Output: Hi there! How can I help you today?
```

### JSON Mode

```bash
pai chat "Hello" --json
# stderr: {"type":"start","data":{},"timestamp":1234567890}
# stdout: Hi there! How can I help you today?
# stderr: {"type":"complete","data":{},"timestamp":1234567891}
```

### Streaming Mode

```bash
pai chat "Write a story" --stream
# Output appears incrementally as the model generates it
```

## Examples

### Simple Q&A

```bash
pai chat "What is the capital of France?" --provider openai --model gpt-4o-mini
```

### Multi-turn Conversation

```bash
pai chat "My name is Alice" --session chat.jsonl --provider openai --model gpt-4o
pai chat "What's my name?" --session chat.jsonl --provider openai --model gpt-4o
```

### Code Generation with Execution

```bash
pai chat "Write a Python script to calculate fibonacci numbers and run it" \
  --provider openai --model gpt-4o
```

### Image Analysis

```bash
pai chat "Describe this image in detail" \
  --image photo.jpg \
  --provider openai --model gpt-4o
```

### Piping Input

```bash
cat document.txt | pai chat "Summarize this document" \
  --provider openai --model gpt-4o-mini
```

### System Instructions

```bash
pai chat "What is 2+2?" \
  --system "You are a math tutor. Explain your reasoning step by step." \
  --provider openai --model gpt-4o
```

## Exit Codes

- `0` - Success
- `1` - Parameter or usage error
- `2` - Local runtime error
- `3` - External API/provider error
- `4` - IO/file error

## Troubleshooting

### "No credentials found"

Make sure you've configured authentication for your provider:

```bash
# For API Key providers
pai model config --add --name openai --provider openai --set apiKey=sk-...

# For OAuth providers
pai model login --name github-copilot

# Or use environment variables
export OPENAI_API_KEY=sk-...
```

### "Provider not found"

List available providers and configure one:

```bash
pai model list --all
pai model config --add --name <provider> --provider <provider> --set apiKey=...
```

### "Model not specified"

Specify the model explicitly or set a default:

```bash
pai chat "Hello" --provider openai --model gpt-4o-mini

# Or set a default model
pai model config --add --name openai --provider openai --set defaultModel=gpt-4o-mini
```

### OAuth token expired

Re-login to refresh credentials:

```bash
pai model login --name github-copilot
```

PAI will also attempt to automatically refresh expired OAuth tokens using the stored refresh token.

## Advanced Usage

### Custom Config Location

```bash
pai chat "Hello" --config /path/to/config.json --provider openai --model gpt-4o
```

Or use environment variable:

```bash
export PAI_CONFIG=/path/to/config.json
```

### Logging

```bash
pai chat "Hello" --log conversation.md --provider openai --model gpt-4o
```

### Quiet Mode

```bash
pai chat "Hello" --quiet --provider openai --model gpt-4o
```

### JSON Output for Scripting

```bash
pai chat "Hello" --json --provider openai --model gpt-4o 2>progress.jsonl 1>response.txt
```

## Supported Providers

Use `pai model list --all` to see the complete list. PAI supports all providers from `@mariozechner/pi-ai`:

- OpenAI, Anthropic, Google (Gemini), GitHub Copilot, Azure OpenAI
- Amazon Bedrock, Google Vertex AI, Google Gemini CLI, Google Antigravity
- OpenAI Codex (ChatGPT Plus/Pro)
- Groq, Cerebras, xAI, Mistral, OpenRouter, Vercel AI Gateway
- MiniMax, HuggingFace, OpenCode, Kimi Coding, ZAI
