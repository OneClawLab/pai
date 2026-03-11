import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 获取 package.json 信息 (用于版本号显示)
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf8')
);

const program = new Command();

program
  .name('pai')
  .description('PAI: A Unix-style AI CLI tool for Cognitive Offloading')
  .version(packageJson.version);

/**
 * 示例命令：chat (支持管道输入)
 * 比如：cat note.md | pai chat "summarize this"
 */
program
  .command('chat')
  .description('Process input through LLM')
  .argument('[prompt]', 'instruction for the AI')
  .option('-s, --system <role>', 'specify system prompt', 'assistant')
  .action(async (prompt, options) => {
    // 检查是否有标准输入 (stdin)
    if (!process.stdin.isTTY) {
      let stdinData = '';
      process.stdin.on('data', chunk => stdinData += chunk);
      process.stdin.on('end', () => {
        console.log('Processing stdin with prompt:', prompt);
        // 执行逻辑...
      });
    } else {
      console.log('No stdin detected. Running direct prompt...');
    }
  });

// 错误处理：监听未知命令
program.on('command:*', () => {
  console.error('\nInvalid command: %s\nSee --help for a list of available commands.', program.args.join(' '));
  process.exit(1);
});

// 解析命令行参数
program.parse(process.argv);

// 如果没有输入任何参数，显示帮助信息
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
