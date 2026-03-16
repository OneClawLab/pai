import { exec, execSync } from 'node:child_process';
import { platform } from 'node:os';
import type { Tool, BashExecArgs, BashExecResult } from '../types.js';

// MAX LENGTH in MB that bash_exec tool can output to LLM
const BASH_EXEC_TOOL_MAX_OUTPUT_MB = 8;
// MAX TIMEOUT in seconds for bash_exec tool
const BASH_EXEC_TOOL_MAX_TIMEOUT_S = 3600;

/**
 * Detect the bash shell path.
 *
 * On non-Windows platforms, always returns 'bash'.
 *
 * On Windows (platform() === 'win32'), the process may still be running
 * inside a bash-compatible environment (Git Bash, MSYS2, Cygwin, WSL, etc.).
 * Detection order:
 *   1. SHELL env var — set by Git Bash / MSYS2 / Cygwin (e.g. '/usr/bin/bash')
 *   2. Probe 'bash --version' — catches bash on PATH without SHELL being set
 *   3. Throw — cmd.exe is NOT supported; user must install bash
 */
export function detectShell(): string {
  const isWin32 = platform() === 'win32';

  if (!isWin32) {
    return 'bash';
  }

  // 1. Check SHELL env (Git Bash / MSYS2 / Cygwin set this)
  const shellEnv = process.env.SHELL;
  if (shellEnv && /bash/i.test(shellEnv)) {
    return shellEnv;
  }

  // 2. Probe for bash on PATH
  try {
    execSync('bash --version', { stdio: 'ignore', timeout: 3000 });
    return 'bash';
  } catch {
    // bash not available
  }

  // 3. No bash found — refuse to fall back to cmd.exe
  throw new Error(
    'bash is required but was not found on this Windows system. ' +
    'Please install one of: Git Bash, MSYS2, Cygwin, or use WSL2.',
  );
}

const BASH_EXEC_DESCRIPTION = 
'Execute a shell command and return the result. Supports pipes, redirections, xargs, heredocs, and shell scripts. Use cwd parameter to set working directory. Running on bash.'

/**
 * Create bash_exec tool for LLM to execute shell commands
 *
 * This tool allows the LLM to run shell commands with full support for:
 * - Pipes and redirections
 * - xargs
 * - Heredoc
 * - Shell scripts
 * - Working directory (cwd parameter)
 *
 * Shell: always bash (including on Windows via Git Bash / MSYS2 / Cygwin / WSL2).
 * cmd.exe is NOT supported.
 *
 * No security restrictions are implemented - user responsibility
 * Interactive commands are not supported
 */
export function createBashExecTool(): Tool {
  const shell = detectShell();

  return {
    name: 'bash_exec',
    description: BASH_EXEC_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            'The shell command to execute. Supports bash syntax including pipes, redirections, xargs, heredocs, etc.',
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory for command execution',
        },
        comment: {
          type: 'string',
          description:
            'very short briefing about intention and reason of this tool call, improve observability and auditability to the user.'
        }
      },
      required: ['command','comment'],
    },
    handler: async (args: BashExecArgs): Promise<BashExecResult> => {
      // Guard against empty command
      if (!args.command) {
        return {
          stdout: '',
          stderr: 'Error: empty command',
          exitCode: 1,
        };
      }

      return new Promise((resolve) => {
        const options: any = {
          shell,
          maxBuffer: BASH_EXEC_TOOL_MAX_OUTPUT_MB * 1024 * 1024,
          timeout: BASH_EXEC_TOOL_MAX_TIMEOUT_S * 1000,
          encoding: 'buffer',
        };

        if (args.cwd) {
          options.cwd = args.cwd;
        }

        exec(args.command, options, (error: any, stdout: Buffer, stderr: Buffer) => {
          const stdoutBuf = stdout || Buffer.alloc(0);
          const stderrBuf = stderr || Buffer.alloc(0);

          resolve({
            stdout: stdoutBuf.toString('utf-8'),
            stderr: stderrBuf.toString('utf-8'),
            exitCode: error ? (error.code ?? 1) : 0,
          });
        });
      });
    },
  };
}
