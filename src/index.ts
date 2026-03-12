import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleChatCommand } from './commands/chat.js';
import { handleModelList, handleModelConfig, handleModelLogin } from './commands/model.js';
import type { ChatOptions, ModelConfigOptions } from './types.js';

// Get package.json info for version
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf8')
);

const program = new Command();

program
  .name('pai')
  .description('PAI - A Unix-style CLI tool for interacting with LLMs')
  .version(packageJson.version);

// Chat command
program
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
  .action(async (prompt: string | undefined, options: ChatOptions) => {
    await handleChatCommand(prompt, options);
  });

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

// Model config command
modelCommand
  .command('config')
  .description('Configure providers')
  .option('--config <path>', 'Config file path')
  .option('--add', 'Add or update provider')
  .option('--delete', 'Delete provider')
  .option('--name <name>', 'Provider name')
  .option('--provider <type>', 'Provider type')
  .option('--set <key=value...>', 'Set configuration values')
  .action(async (options: ModelConfigOptions) => {
    await handleModelConfig(options);
  });

// Model login command (OAuth providers)
modelCommand
  .command('login')
  .description('Login to an OAuth provider (github-copilot, anthropic, google-gemini-cli, etc.)')
  .option('--config <path>', 'Config file path')
  .option('--name <name>', 'Provider name')
  .action(async (options: ModelConfigOptions) => {
    await handleModelLogin(options);
  });

// Error handling for unknown commands
program.on('command:*', () => {
  console.error('Invalid command: %s', program.args.join(' '));
  console.error('See --help for available commands.');
  process.exit(1);
});

// Parse arguments
program.parse(process.argv);

// Show help if no arguments
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
