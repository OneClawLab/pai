import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';
import type { Tool, BashExecArgs, BashExecResult } from '../types.js';

const execAsync = promisify(exec);

/**
 * Create bash_exec tool for LLM to execute shell commands
 * 
 * This tool allows the LLM to run shell commands with full support for:
 * - Pipes and redirections
 * - xargs (on Unix)
 * - Heredoc (on Unix)
 * - Shell scripts
 * - Working directory (cwd parameter)
 * 
 * On Windows, uses cmd.exe instead of bash
 * No security restrictions are implemented - user responsibility
 * Interactive commands are not supported
 */
export function createBashExecTool(): Tool {
  const isWindows = platform() === 'win32';
  const shellName = isWindows ? 'cmd.exe' : 'bash';

  return {
    name: 'bash_exec',
    description: `Execute a shell command and return the result. Supports pipes, redirections, and shell scripts. Use cwd parameter to set working directory. Running on ${shellName}.`,
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: `The shell command to execute. Supports ${isWindows ? 'cmd.exe' : 'bash'} syntax including pipes, redirections, etc.`,
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory for command execution',
        },
      },
      required: ['command'],
    },
    handler: async (args: BashExecArgs): Promise<BashExecResult> => {
      try {
        const options: { shell: string; cwd?: string; maxBuffer?: number } = {
          shell: shellName,
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
        };

        if (args.cwd) {
          options.cwd = args.cwd;
        }

        const { stdout, stderr } = await execAsync(args.command, options);

        return {
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: 0,
        };
      } catch (error: any) {
        // exec throws on non-zero exit codes
        return {
          stdout: error.stdout || '',
          stderr: error.stderr || '',
          exitCode: error.code || 1,
        };
      }
    },
  };
}
