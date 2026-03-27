import { execSync, spawn } from 'node:child_process';
import { platform } from 'node:os';
import type { Tool, BashExecArgs, BashExecResult } from '../types.js';

// MAX LENGTH in MB that bash_exec tool can output to LLM
const BASH_EXEC_TOOL_MAX_OUTPUT_MB = 8;
// Per-invocation timeout bounds (seconds)
const BASH_EXEC_DEFAULT_TIMEOUT_S = 600;   // 10 minutes
const BASH_EXEC_MAX_TIMEOUT_S     = 3600;  // 60 minutes hard cap

const IS_WIN32 = platform() === 'win32';

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
  if (!IS_WIN32) {
    return 'bash';
  }

  const shellEnv = process.env.SHELL;
  if (shellEnv && /bash/i.test(shellEnv)) {
    return shellEnv;
  }

  try {
    execSync('bash --version', { stdio: 'ignore', timeout: 3000 });
    return 'bash';
  } catch {
    // bash not available
  }

  throw new Error(
    'bash is required but was not found on this Windows system. ' +
    'Please install one of: Git Bash, MSYS2, Cygwin, or use WSL2.',
  );
}

/**
 * Kill an entire process tree rooted at `pid`.
 *
 * Unix:  kill(-pgid, SIGKILL) — sends SIGKILL to the whole process group.
 *        Works because we spawn bash with detached:true, making it the
 *        process group leader (pgid === bash.pid).
 *
 * Windows: `taskkill /F /T /PID <pid>` — recursively terminates the process
 *          tree. This is the only reliable way on Windows since POSIX signals
 *          and process groups are not properly supported.
 */
function killTree(pid: number): void {
  try {
    if (IS_WIN32) {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // Process may have already exited — ignore
  }
}

const BASH_EXEC_TOOL_DESC = `
Execute a shell command and return the result.
Supports pipes, redirections, xargs, heredocs, and shell scripts.
Use cwd parameter to set working directory.
Running on bash.
`.trim();

const BASH_EXEC_ARG_COMMAND_DESC = `
The shell command to execute. 
Supports full bash syntax (pipes, xargs, heredocs, etc.).
For complex logic, prioritize a human-readable multi-line format using line breaks or backslashes (\) instead of concatenating multiple commands with semicolons (;) into a single dense line.
`.trim();

/**
 * Create bash_exec tool for LLM to execute shell commands.
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
 * The handler accepts an optional AbortSignal (per-invocation) passed by
 * ToolRegistry.execute(). When aborted, the entire process tree spawned by
 * bash is killed immediately (Unix: SIGKILL to process group; Windows: taskkill /F /T).
 *
 * Timeout: LLM may specify timeout_seconds (default 600, max 3600).
 * A per-invocation AbortController combines the invocation timeout with the
 * session-level signal so either source can trigger cleanup.
 */
export function createBashExecTool(): Tool {
  const shell = detectShell();

  return {
    name: 'bash_exec',
    description: BASH_EXEC_TOOL_DESC,
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: BASH_EXEC_ARG_COMMAND_DESC,
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory for command execution',
        },
        timeout_seconds: {
          type: 'number',
          description: `Timeout in seconds for this command. Default: ${BASH_EXEC_DEFAULT_TIMEOUT_S}. Max: ${BASH_EXEC_MAX_TIMEOUT_S}.`,
        },
        comment: {
          type: 'string',
          description:
            'very short briefing about intention and reason of this tool call, improve observability and auditability to the user.',
        },
      },
      required: ['command', 'comment'],
    },
    handler: async (args: BashExecArgs, sessionSignal?: AbortSignal): Promise<BashExecResult> => {
      if (!args.command) {
        return { stdout: '', stderr: 'Error: empty command', exitCode: 1 };
      }

      if (sessionSignal?.aborted) {
        return { stdout: '', stderr: '[Aborted: session was terminated externally.]', exitCode: 1 };
      }

      // Clamp LLM-supplied timeout to [1, MAX] range, fall back to default
      const requestedS = args.timeout_seconds ?? BASH_EXEC_DEFAULT_TIMEOUT_S;
      const timeoutMs = Math.min(Math.max(requestedS, 1), BASH_EXEC_MAX_TIMEOUT_S) * 1000;

      // Per-invocation AbortController: fires on timeout OR session abort
      const localAc = new AbortController();
      let abortReason: 'timeout' | 'session' = 'timeout';

      const timeoutTimer = setTimeout(() => {
        abortReason = 'timeout';
        localAc.abort();
      }, timeoutMs);

      const onSessionAbort = (): void => {
        abortReason = 'session';
        localAc.abort();
      };
      sessionSignal?.addEventListener('abort', onSessionAbort);

      return new Promise((resolve) => {
        const maxBytes = BASH_EXEC_TOOL_MAX_OUTPUT_MB * 1024 * 1024;

        // detached: true → bash becomes process group leader (pgid === bash.pid)
        // Lets us kill the entire tree with kill(-pid) on Unix.
        const proc = spawn(shell, ['-c', args.command], {
          cwd: args.cwd,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let stdoutLen = 0;
        let stderrLen = 0;

        proc.stdout!.on('data', (chunk: Buffer) => {
          stdoutLen += chunk.length;
          if (stdoutLen <= maxBytes) stdoutChunks.push(chunk);
        });
        proc.stderr!.on('data', (chunk: Buffer) => {
          stderrLen += chunk.length;
          if (stderrLen <= maxBytes) stderrChunks.push(chunk);
        });

        const onAbort = (): void => {
          if (proc.pid !== undefined) killTree(proc.pid);
          // Also signal Node.js to close its handle so the 'close' event fires.
          // On Windows with detached:true, taskkill kills the OS process tree but
          // Node's ChildProcess handle may not notice until we explicitly kill it.
          try { proc.kill('SIGKILL'); } catch { /* already dead */ }
        };
        localAc.signal.addEventListener('abort', onAbort);

        const cleanup = (): void => {
          clearTimeout(timeoutTimer);
          sessionSignal?.removeEventListener('abort', onSessionAbort);
          localAc.signal.removeEventListener('abort', onAbort);
        };

        proc.on('error', (err) => {
          cleanup();
          resolve({ stdout: '', stderr: err.message, exitCode: 1 });
        });

        proc.on('close', (code) => {
          cleanup();
          const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
          const stderr = Buffer.concat(stderrChunks).toString('utf-8');
          const aborted = localAc.signal.aborted;
          let abortSuffix = '';
          if (aborted) {
            if (abortReason === 'timeout') {
              const actualS = Math.round(timeoutMs / 1000);
              abortSuffix = `\n[Aborted: command timed out after ${actualS}s. To allow more time, retry with a larger timeout_seconds (max ${BASH_EXEC_MAX_TIMEOUT_S}s).]`;
            } else {
              abortSuffix = '\n[Aborted: session was terminated externally.]';
            }
          }
          resolve({
            stdout,
            stderr: aborted ? stderr + abortSuffix : stderr,
            exitCode: code ?? (aborted ? 130 : 1),
          });
        });
      });
    },
  };
}
