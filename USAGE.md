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

First, you need to configure an LLM provider. PAI uses the `@mariozechner/pi-ai` library, which supports many providers.

```bash
# Add GitHub Copilot (if you have auth.json from pi-ai)
pai model config --add --name github-copilot --provider github-copilot

# Or configure OpenAI
pai model config --add --name openai --provider openai --set apiKey=sk-...
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
pai chat "Hello, how are you?" --provider github-copilot --model gpt-4o

# With system instruction
pai chat "What is 2+2?" --system "You are a math tutor"

# Using stdin
echo "Explain quantum computing" | pai chat --provider openai --model gpt-4o-mini

# With session file (maintains conversation history)
pai chat "Hello" --session conversation.jsonl --provider openai --model gpt-4o
pai chat "What did I just say?" --session conversation.jsonl --provider openai --model gpt-4o

# With streaming output
pai chat "Write a story" --stream --provider openai --model gpt-4o

# With images (multimodal)
pai chat "What's in this image?" --image photo.jpg --provider openai --model gpt-4o

# Save conversation log
pai chat "Hello" --log chat.md --provider openai --model gpt-4o
```

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

Configure providers.

**Options:**
- `--add` - Add or update provider
- `--delete` - Delete provider
- `--name <name>` - Provider name
- `--provider <type>` - Provider type
- `--set <key=value...>` - Set configuration values

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

### Authentication

PAI supports multiple authentication methods (in priority order):

1. **CLI parameters** (not recommended for security)
2. **Environment variables**: `PAI_<PROVIDER>_API_KEY`
3. **Config file**: `apiKey` field in provider config
4. **auth.json**: OAuth credentials from pi-ai (for GitHub Copilot, etc.)

Example with environment variables:

```bash
export PAI_OPENAI_API_KEY=sk-...
export PAI_ANTHROPIC_API_KEY=sk-ant-...
pai chat "Hello" --provider openai --model gpt-4o-mini
```

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

**Example:**

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

The LLM will:
1. Generate the Python code
2. Use bash_exec to save it to a file
3. Use bash_exec to run it
4. Return the results

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

Make sure you've configured authentication:

```bash
# Option 1: Environment variable
export PAI_OPENAI_API_KEY=sk-...

# Option 2: Config file
pai model config --add --name openai --provider openai --set apiKey=sk-...

# Option 3: Use auth.json from pi-ai
# Place auth.json in current directory
```

### "Provider not found"

List available providers:

```bash
pai model list --all
```

Then configure the provider:

```bash
pai model config --add --name <provider> --provider <provider>
```

### "Model not specified"

Either specify the model explicitly:

```bash
pai chat "Hello" --provider openai --model gpt-4o-mini
```

Or set a default model in your config:

```bash
pai model config --add --name openai --provider openai --set defaultModel=gpt-4o-mini
```

## Advanced Usage

### Custom Config Location

```bash
pai chat "Hello" --config /path/to/config.json --provider openai --model gpt-4o
```

Or use environment variable:

```bash
export PAI_CONFIG=/path/to/config.json
pai chat "Hello" --provider openai --model gpt-4o
```

### Logging

```bash
pai chat "Hello" --log conversation.md --provider openai --model gpt-4o
```

The log file will contain:
- Timestamps
- All messages (system, user, assistant)
- Tool calls and results
- Formatted in Markdown

### Quiet Mode

```bash
pai chat "Hello" --quiet --provider openai --model gpt-4o
# Only outputs the model's response, no progress information
```

### JSON Output for Scripting

```bash
pai chat "Hello" --json --provider openai --model gpt-4o 2>progress.jsonl 1>response.txt
# stderr (progress.jsonl): NDJSON event stream
# stdout (response.txt): Model response
```

## Supported Providers

PAI supports all providers from `@mariozechner/pi-ai`:

- OpenAI
- Anthropic
- Google (Gemini)
- GitHub Copilot (OAuth)
- Groq
- Cerebras
- xAI
- Mistral
- OpenRouter
- And many more...

Use `pai model list --all` to see the complete list.
