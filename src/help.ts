import type { Command } from 'commander';

// ── Help text data ──────────────────────────────────────────

const MAIN_EXAMPLES = `
Examples:
  $ pai chat "Hello, how are you?"                    # 简单对话
  $ echo "Explain this" | pai chat                    # stdin 输入
  $ pai chat "Write a story" --stream                 # 流式输出
  $ pai model config --add --name openai --provider openai --set apiKey=sk-...
  $ pai model list                                    # 查看已配置 provider
  $ pai model default --name openai                   # 设置默认 provider`;

const MAIN_VERBOSE = `
Prerequisites:
  使用前需先配置至少一个 provider:
    pai model config --add --name <name> --provider <type> --set apiKey=<key>
  或使用 OAuth 登录:
    pai model login --name github-copilot

Config:
  默认配置文件: ~/config/pai/default.json
  可通过 --config <path> 或 PAI_CONFIG 环境变量覆盖

Exit Codes:
  0  成功
  1  参数/用法错误
  2  本地运行时错误
  3  外部 API/Provider 错误
  4  IO/文件错误`;

const CHAT_EXAMPLES = `
Examples:
  $ pai chat "What is the capital of France?"
  $ echo "Summarize this" | pai chat                  # stdin 输入
  $ cat doc.txt | pai chat "Summarize this document"
  $ pai chat "Hello" --session chat.jsonl             # 多轮对话
  $ pai chat "Describe this" --image photo.jpg        # 图片分析
  $ pai chat --dry-run --provider openai              # 查看配置不调用 LLM

Stdin:
  支持通过管道传入用户消息，与 --input-file 和位置参数互斥。

JSON output (--json):
  进度信息以 NDJSON 输出到 stderr，LLM 回复输出到 stdout。`;

const EMBED_EXAMPLES = `
Examples:
  $ pai embed "hello world" --provider openai --model text-embedding-3-small
  $ echo "hello" | pai embed                          # stdin 输入
  $ pai embed --input-file doc.txt                    # 文件输入
  $ pai embed --batch '["hello","world"]'             # 批量模式

Stdin:
  支持通过管道传入文本。与位置参数和 --input-file 互斥。

JSON output (--json):
  单条: {"embedding":[...],"model":"...","usage":{...}}
  批量: {"embeddings":[[...],[...]],"model":"...","usage":{...}}`;

const MODEL_LIST_EXAMPLES = `
Examples:
  $ pai model list                                    # 已配置 provider
  $ pai model list --all                              # 所有支持的 provider
  $ pai model list --json                             # JSON 输出`;

const MODEL_CONFIG_EXAMPLES = `
Examples:
  $ pai model config --add --name openai --provider openai --set apiKey=sk-...
  $ pai model config --update --name openai --set defaultModel=gpt-4o
  $ pai model config --show --name openai             # 查看配置（敏感信息脱敏）
  $ pai model config --delete --name openai

Note:
  --add 对同名 provider 执行 upsert（幂等操作）。`;

const MODEL_DEFAULT_EXAMPLES = `
Examples:
  $ pai model default                                 # 查看当前默认
  $ pai model default --name openai                   # 设置默认 provider
  $ pai model default --embed-provider openai --embed-model text-embedding-3-small`;

const MODEL_LOGIN_EXAMPLES = `
Examples:
  $ pai model login --name github-copilot             # OAuth 登录
  $ pai model login --name anthropic                  # Anthropic OAuth

Supported: github-copilot, anthropic, google-gemini-cli, google-antigravity, openai-codex`;

// ── Verbose help data (keyed by command name path) ──────────

const VERBOSE_HELP: Record<string, string> = {
  'pai': MAIN_VERBOSE,
};

// ── Setup functions ─────────────────────────────────────────

/**
 * Install --help --verbose support and examples on a command tree.
 */
export function installHelp(program: Command): void {
  // Main program
  program.addHelpText('after', MAIN_EXAMPLES);

  // We need to intercept --verbose for help
  installVerboseHelp(program);
}

/**
 * Add examples to a specific subcommand by name.
 */
export function addSubcommandExamples(cmd: Command, name: string): void {
  const examples: Record<string, string> = {
    'chat': CHAT_EXAMPLES,
    'embed': EMBED_EXAMPLES,
    'list': MODEL_LIST_EXAMPLES,
    'config': MODEL_CONFIG_EXAMPLES,
    'default': MODEL_DEFAULT_EXAMPLES,
    'login': MODEL_LOGIN_EXAMPLES,
  };
  const text = examples[name];
  if (text) {
    cmd.addHelpText('after', text);
  }
}

/**
 * Install verbose help support. When --verbose is present alongside --help,
 * output extended information.
 */
function installVerboseHelp(program: Command): void {
  // Add a hidden --verbose option
  program.option('--verbose', '(与 --help 一起使用) 显示完整帮助信息');
  program.on('option:verbose', () => {
    // Mark that verbose was requested
    (program as unknown as Record<string, boolean>).__verboseHelp = true;
  });

  // Hook into the help display
  program.addHelpText('afterAll', () => {
    if ((program as unknown as Record<string, boolean>).__verboseHelp) {
      return MAIN_VERBOSE;
    }
    return '';
  });
}
