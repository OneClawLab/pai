import { execSync, spawn } from 'node:child_process';
import { platform, setPriority } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Tool, BashExecArgs, BashExecResult, BashExecOutputInfo } from '../types.js';
import { detectDangers, type DangerDetectionOptions } from './bash-danger.js';
import { processStream, DEFAULT_OUTPUT_CAP, type OutputCapConfig } from './bash-output.js';

export interface BashExecToolOptions {
  /** Extra environment variables to inject into the spawned shell */
  extraEnv?: Record<string, string>
  /** Callback invoked on each stdout/stderr chunk during execution */
  onOutput?: BashExecOutputCallback
  /** Override the default tool description sent to the LLM */
  description?: string
  /**
   * AST-based danger detection. Enabled by default (catastrophic commands are
   * blocked, risky commands are annotated). Set `{ enabled: false }` to disable,
   * or `{ mode: 'warn-only' }` to never block.
   */
  dangerDetection?: DangerDetectionOptions
  /**
   * Large-output truncation. By default, per-stream output is capped (~8KB /
   * 200 lines) and the full output is spilled to a temp file. Pass a partial
   * config to tune, or `{ ... , spillToFile: false }` to disable spilling.
   * Set the whole option to `false` to return raw, uncapped output (legacy).
   */
  outputCap?: Partial<OutputCapConfig> | false
  /**
   * Lower the spawned process's scheduling priority so the human's interactive
   * work always wins CPU contention. Default: true.
   */
  lowerPriority?: boolean
  /** Niceness applied when lowerPriority is true. Default: 10. */
  niceness?: number
}

/**
 * Callback invoked on each stdout/stderr chunk during bash_exec execution.
 * Enables real-time output monitoring without waiting for command completion.
 */
export type BashExecOutputCallback = (stream: 'stdout' | 'stderr', chunk: string) => void;

// Hard in-memory buffer ceiling per stream (safety valve against runaway
// output like `yes`). Output beyond this is dropped from the buffer; the
// timeout still bounds total runtime. This caps how much can be spilled too.
const BASH_EXEC_MAX_BUFFER_MB = 8;
// Per-invocation timeout bounds (seconds)
const BASH_EXEC_DEFAULT_TIMEOUT_S = 60;   // 1 minutes
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

/**
 * Lower the scheduling priority of a spawned process so the human's
 * interactive work (editor, terminal, the agent front-end) always wins CPU
 * contention. Best-effort: failures are ignored, and child processes spawned
 * later mostly inherit the priority (Unix nice; Windows priority class).
 *
 * This is a fairness measure, not isolation — the process keeps full access
 * to the machine, it just yields the CPU when the human needs it.
 */
function lowerChildPriority(pid: number, niceness: number): void {
  try {
    setPriority(pid, niceness);
  } catch {
    // Not permitted / process already gone — ignore.
  }
}

export const BASH_EXEC_TOOL_DESC = `
Execute a shell command on bash and return stdout, stderr, and exitCode.
Supports full bash syntax: pipes, redirections, xargs, heredocs, shell scripts.
Use cwd parameter to set working directory.

## Enhanced Commands (TheClaw)

Beyond standard GNU/Linux commands, this system has these CLI tools:

- **cmds** — Command discovery. Use \`cmds find "<intent>"\` to search for any command by natural language, \`cmds info <cmd>\` for usage details. Start here when you need a tool you're unsure about.
- **xweb** — Internet access. \`xweb search "<query>"\` for web search, \`xweb fetch "<url>"\` to grab page content as Markdown, \`xweb explore "<url>"\` to discover site links.
- **notifier** — Task scheduler. \`notifier task add\` for immediate tasks, \`notifier timer add\` for cron-based recurring tasks. 
- **xdb** — Data collections. \`xdb col init <name> --policy hybrid\` to create a searchable collection, \`xdb put <col> '<json>'\` to write, \`xdb find <col> "<query>"\` for semantic/hybrid search. Backed by LanceDB + SQLite.
- **pai** — LLM interface. \`pai chat "<msg>"\` for LLM calls (supports tool use, streaming, sessions). \`pai embed "<text>"\` for embeddings. Can implement sub-agents via session files.

Use \`<cmd> --help\` for quick reference, or \`cmds find\` / \`cmds info\` for progressive discovery of all available commands.

## Output handling

Large output is truncated before it reaches you: you receive the head and tail
plus a banner with the total line/byte counts and a spill-file path holding the
COMPLETE output. To read the rest, \`grep\`/\`sed\`/\`head\` that spill file.

## Safety

Never-legitimate, irreversible commands (e.g. \`rm -rf /\`, \`rm -rf ~\`, \`mkfs\`,
writing a raw disk device, fork bombs) are refused before running. Risky but
legitimate commands (e.g. \`git reset --hard\`, \`curl ... | bash\`) run normally
but are flagged in the result.
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
 * Timeout: LLM may specify timeout_seconds (default 60, max 3600).
 * A per-invocation AbortController combines the invocation timeout with the
 * session-level signal so either source can trigger cleanup.
 */
export function createBashExecTool(options?: BashExecToolOptions): Tool {
  const {
    extraEnv,
    onOutput,
    description = BASH_EXEC_TOOL_DESC,
    dangerDetection,
    outputCap,
    lowerPriority = true,
    niceness = 10,
  } = options ?? {};
  const shell = detectShell();

  // Resolve the output cap once. `false` disables capping entirely.
  const cap: OutputCapConfig | null =
    outputCap === false
      ? null
      : { ...DEFAULT_OUTPUT_CAP, ...(outputCap ?? {}) };

  return {
    name: 'bash_exec',
    description,
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
            'very short briefing about why and how of this tool call, improve observability and auditability.',
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

      // ── Danger detection (pre-spawn) ──────────────────────────────────────
      // Parse the command into an AST and run preset rules. Catastrophic,
      // never-legitimate commands are blocked before any process is spawned;
      // risky-but-legitimate commands are annotated and allowed to run.
      const danger = detectDangers(args.command, dangerDetection);
      if (danger.blocked) {
        const denied = danger.violations.filter((v) => v.severity === 'deny');
        const msg = denied.map((v) => `[blocked: ${v.code}] ${v.message}`).join('\n');
        return {
          stdout: '',
          stderr: `Refused to execute — command blocked by danger detection.\n${msg}`,
          exitCode: 1,
          violations: danger.violations.map((v) => ({ code: v.code, severity: v.severity, message: v.message })),
        };
      }
      const warnViolations = danger.violations.map((v) => ({
        code: v.code, severity: v.severity, message: v.message,
      }));

      const runId = randomUUID();

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
        const maxBytes = BASH_EXEC_MAX_BUFFER_MB * 1024 * 1024;

        // detached: true on Unix → bash becomes process group leader (pgid === bash.pid)
        // Lets us kill the entire tree with kill(-pid) on Unix.
        // On Windows we use taskkill /F /T instead, so detached is not needed
        // (and causes Node.js to spawn keepalive helper processes on Windows).
        const proc = spawn(shell, ['-c', args.command], {
          cwd: args.cwd,
          detached: !IS_WIN32,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          env: extraEnv ? { ...process.env, ...extraEnv } : undefined,
        });

        // Lower priority so the human always wins CPU contention (best-effort).
        if (lowerPriority && proc.pid !== undefined) {
          lowerChildPriority(proc.pid, niceness);
        }

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let stdoutLen = 0;
        let stderrLen = 0;

        proc.stdout!.on('data', (chunk: Buffer) => {
          stdoutLen += chunk.length;
          if (stdoutLen <= maxBytes) stdoutChunks.push(chunk);
          if (onOutput) onOutput('stdout', chunk.toString('utf-8'));
        });
        proc.stderr!.on('data', (chunk: Buffer) => {
          stderrLen += chunk.length;
          if (stderrLen <= maxBytes) stderrChunks.push(chunk);
          if (onOutput) onOutput('stderr', chunk.toString('utf-8'));
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

        const finish = (result: BashExecResult): void => {
          if (warnViolations.length > 0) result.violations = warnViolations;
          resolve(result);
        };

        proc.on('error', (err) => {
          cleanup();
          finish({ stdout: '', stderr: err.message, exitCode: 1 });
        });

        proc.on('close', (code) => {
          cleanup();
          const rawStdout = Buffer.concat(stdoutChunks).toString('utf-8');
          const rawStderr = Buffer.concat(stderrChunks).toString('utf-8');
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

          // ── Output truncation + spill ─────────────────────────────────────
          if (cap === null) {
            finish({
              stdout: rawStdout,
              stderr: aborted ? rawStderr + abortSuffix : rawStderr,
              exitCode: code ?? (aborted ? 130 : 1),
            });
            return;
          }

          const outProcessed = processStream(rawStdout, 'stdout', runId, cap);
          const errProcessed = processStream(rawStderr, 'stderr', runId, cap);
          const stderrText = aborted ? errProcessed.text + abortSuffix : errProcessed.text;

          const result: BashExecResult = {
            stdout: outProcessed.text,
            stderr: stderrText,
            exitCode: code ?? (aborted ? 130 : 1),
          };

          if (outProcessed.truncated || errProcessed.truncated) {
            const info: BashExecOutputInfo = {
              truncated: true,
              stdoutTotalBytes: outProcessed.totalBytes,
              stderrTotalBytes: errProcessed.totalBytes,
            };
            if (outProcessed.spillPath !== undefined) info.stdoutSpillPath = outProcessed.spillPath;
            if (errProcessed.spillPath !== undefined) info.stderrSpillPath = errProcessed.spillPath;
            result.output = info;
          }

          finish(result);
        });
      });
    },
  };
}
