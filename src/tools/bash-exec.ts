import { exec, execSync } from 'node:child_process';
import { platform } from 'node:os';
import type { Tool, BashExecArgs, BashExecResult } from '../types.js';

/**
 * Detect the best available shell.
 *
 * On non-Windows platforms, always use 'bash'.
 *
 * On Windows (platform() === 'win32'), the process may still be running
 * inside a bash-compatible environment (Git Bash, MSYS2, Cygwin, etc.).
 * Detection order:
 *   1. SHELL env var — set by Git Bash / MSYS2 / Cygwin (e.g. '/usr/bin/bash')
 *   2. Probe 'bash --version' — catches bash on PATH without SHELL being set
 *   3. Fall back to 'cmd.exe'
 *
 * Returns { shell, isCmdExe } so callers know whether to expect
 * OEM-encoded output.
 */
export function detectShell(): { shell: string; isCmdExe: boolean } {
  const isWin32 = platform() === 'win32';

  if (!isWin32) {
    return { shell: 'bash', isCmdExe: false };
  }

  // 1. Check SHELL env (Git Bash / MSYS2 / Cygwin set this)
  const shellEnv = process.env.SHELL;
  if (shellEnv && /bash/i.test(shellEnv)) {
    return { shell: shellEnv, isCmdExe: false };
  }

  // 2. Probe for bash on PATH
  try {
    execSync('bash --version', { stdio: 'ignore', timeout: 3000 });
    return { shell: 'bash', isCmdExe: false };
  } catch {
    // bash not available
  }

  // 3. Fall back to cmd.exe
  return { shell: 'cmd.exe', isCmdExe: true };
}

/**
 * Decode a Buffer, handling Windows OEM codepage when using cmd.exe.
 * When using bash (even on Windows), output is UTF-8.
 */
function decodeOutput(buf: Buffer, isCmdExe: boolean): string {
  if (!isCmdExe) return buf.toString('utf-8');

  // Try UTF-8 first; if it looks clean, use it
  const utf8 = buf.toString('utf-8');
  if (!utf8.includes('\ufffd')) return utf8;

  // Fallback: try common Windows CJK codepages via TextDecoder
  for (const encoding of ['gbk', 'gb18030', 'shift_jis', 'euc-kr', 'big5']) {
    try {
      return new TextDecoder(encoding).decode(buf);
    } catch {
      continue;
    }
  }

  return utf8;
}

/**
 * Create bash_exec tool for LLM to execute shell commands
 *
 * This tool allows the LLM to run shell commands with full support for:
 * - Pipes and redirections
 * - xargs (on Unix/bash)
 * - Heredoc (on Unix/bash)
 * - Shell scripts
 * - Working directory (cwd parameter)
 *
 * Shell detection:
 * - Unix: always uses bash
 * - Windows: prefers bash (Git Bash / MSYS2 / Cygwin) if available,
 *   falls back to cmd.exe
 *
 * No security restrictions are implemented - user responsibility
 * Interactive commands are not supported
 */
export function createBashExecTool(): Tool {
  const { shell: shellName, isCmdExe } = detectShell();
  const shellLabel = isCmdExe ? 'cmd.exe' : 'bash';

  return {
    name: 'bash_exec',
    description: `Execute a shell command and return the result. Supports pipes, redirections, and shell scripts. Use cwd parameter to set working directory. Running on ${shellLabel}.`,
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: `The shell command to execute. Supports ${shellLabel} syntax including pipes, redirections, etc.`,
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory for command execution',
        },
      },
      required: ['command'],
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
          shell: shellName,
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
          encoding: 'buffer',
        };

        if (args.cwd) {
          options.cwd = args.cwd;
        }

        exec(args.command, options, (error: any, stdout: Buffer, stderr: Buffer) => {
          const stdoutBuf = stdout || Buffer.alloc(0);
          const stderrBuf = stderr || Buffer.alloc(0);

          resolve({
            stdout: decodeOutput(stdoutBuf, isCmdExe),
            stderr: decodeOutput(stderrBuf, isCmdExe),
            exitCode: error ? (error.code ?? 1) : 0,
          });
        });
      });
    },
  };
}
