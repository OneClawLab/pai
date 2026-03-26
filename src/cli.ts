import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleChatCommand } from './commands/chat.js';
import { handleEmbedCommand } from './commands/embed.js';
import { handleModelList, handleModelConfig, handleModelDefault, handleModelLogin, handleModelResolve } from './commands/model.js';
import { installHelp, addSubcommandExamples } from './help.js';
import type { ChatOptions, EmbedOptions, ModelConfigOptions } from './types.js';

// Gracefully handle EPIPE (e.g. `pai embed "x" | head` or broken pipe)
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});
process.stderr.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

// Get package.json info for version
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf8')
);

// Read pi-ai version
let piAiVersion = 'unknown';
try {
  const piAiPkg = JSON.parse(
    readFileSync(join(__dirname, '../node_modules/@mariozechner/pi-ai/package.json'), 'utf8')
  );
  piAiVersion = piAiPkg.version;
} catch {
  // pi-ai package.json not found
}

const versionString = `pai ${packageJson.version} (pi-ai ${piAiVersion}, Node ${process.version})`;

const program = new Command();

program
  .name('pai')
  .description('PAI - A Unix-style CLI tool for interacting with LLMs')
  .version(versionString)
  .showHelpAfterError(true)
  .configureOutput({
    writeErr: (str) => process.stderr.write(str),
    writeOut: (str) => process.stdout.write(str),
  });

program.exitOverride();

// Install help system (examples + --verbose support)
installHelp(program);

// Chat command
const chatCmd = program
  .command('chat')
  .description('Chat with an LLM')
  .argument('[prompt]', 'User message (or use stdin/--input-file)')
  .option('--config <path>', 'Config file path')
  .option('--session <path>', 'Session file path (JSONL)')
  .option('--system <text>', 'System instruction')
  .option('--system-file <path>', 'System instruction from file')
  .option('--input-file <path>', 'User input from file')
  .option('--image <path...>', 'Image file(s) to include')
  .option('--provider <name>', 'Provider name')
  .option('--model <name>', 'Model name')
  .option('--temperature <number>', 'Temperature (0-2)', parseFloat)
  .option('--max-tokens <number>', 'Max tokens', parseInt)
  .option('--stream', 'Enable streaming output')
  .option('--no-append', 'Do not append to session file')
  .option('--json', 'Output progress as NDJSON')
  .option('--quiet', 'Suppress progress output')
  .option('--log <path>', 'Log file path (Markdown)')
  .option('--max-turns <number>', 'Max tool-call turns (default: 100)', parseInt)
  .option('--dry-run', 'Show resolved config without calling LLM')
  .action(async (prompt: string | undefined, options: ChatOptions) => {
    await handleChatCommand(prompt, options);
  });
addSubcommandExamples(chatCmd, 'chat');

// Embed command
const embedCmd = program
  .command('embed')
  .description('Generate text embeddings')
  .argument('[text]', 'Text to embed (or use stdin/--input-file)')
  .option('--provider <name>', 'Provider name')
  .option('--model <name>', 'Embedding model name')
  .option('--config <path>', 'Config file path')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Suppress progress output')
  .option('--batch', 'Enable batch embedding mode (input is JSON string array)')
  .option('--input-file <path>', 'Read input from file')
  .action(async (text: string | undefined, options: EmbedOptions) => {
    await handleEmbedCommand(text, options);
  });
addSubcommandExamples(embedCmd, 'embed');

// Model list command
const modelCommand = program
  .command('model')
  .description('Manage model configurations');

modelCommand
  .command('list')
  .description('List providers and models')
  .option('--config <path>', 'Config file path')
  .option('--all', 'Show all supported providers')
  .option('--json', 'Output as JSON')
  .action(async (options: ModelConfigOptions) => {
    await handleModelList(options);
  });
addSubcommandExamples(modelCommand.commands.find(c => c.name() === 'list')!, 'list');

// Model config command
modelCommand
  .command('config')
  .description('Configure providers')
  .option('--config <path>', 'Config file path')
  .option('--add', 'Add or update provider')
  .option('--update', 'Update fields on an existing provider')
  .option('--delete', 'Delete provider')
  .option('--show', 'Show provider configuration')
  .option('--name <name>', 'Provider name')
  .option('--provider <type>', 'Provider type')
  .option('--set <key=value...>', 'Set configuration values')
  .option('--default', 'Set as default provider (with --add or --update)')
  .option('--json', 'Output as JSON')
  .action(async (options: ModelConfigOptions) => {
    await handleModelConfig(options);
  });
addSubcommandExamples(modelCommand.commands.find(c => c.name() === 'config')!, 'config');

// Model login command (OAuth providers)
modelCommand
  .command('login')
  .description('Login to an OAuth provider (github-copilot, anthropic, google-gemini-cli, etc.)')
  .option('--config <path>', 'Config file path')
  .option('--name <name>', 'Provider name')
  .action(async (options: ModelConfigOptions) => {
    await handleModelLogin(options);
  });
addSubcommandExamples(modelCommand.commands.find(c => c.name() === 'login')!, 'login');

// Model default command (view/set default provider)
modelCommand
  .command('default')
  .description('View or set the default provider')
  .option('--config <path>', 'Config file path')
  .option('--name <name>', 'Provider name to set as default')
  .option('--embed-provider <name>', 'Set default embed embed provider')
  .option('--embed-model <model>', 'Set default embed model')
  .option('--json', 'Output as JSON')
  .action(async (options: ModelConfigOptions) => {
    await handleModelDefault(options);
  });
addSubcommandExamples(modelCommand.commands.find(c => c.name() === 'default')!, 'default');

// Model resolve command
modelCommand
  .command('resolve')
  .description('Show the effective provider/model that would be used (machine-friendly JSON)')
  .option('--config <path>', 'Config file path')
  .option('--provider <name>', 'Provider name (uses default if omitted)')
  .option('--model <name>', 'Model override')
  .action(async (options: ModelConfigOptions & { model?: string }) => {
    await handleModelResolve(options);
  });

// Error handling for unknown commands
program.on('command:*', () => {
  process.stderr.write(`Invalid command: ${program.args.join(' ')}\nSee --help for available commands.\n`);
  process.exit(2);
});

// Parse arguments
(async () => {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    // commander throws CommanderError on exitOverride
    if (err && typeof err === 'object' && 'exitCode' in err) {
      const exitCode = (err as { exitCode: number }).exitCode;
      // Map commander's exit code 1 (argument errors) to 2 per spec
      process.exitCode = exitCode === 1 ? 2 : exitCode;
    } else {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 2;
    }
  }
})();
