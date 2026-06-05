/**
 * bash-danger.ts — AST-based danger detection for bash_exec.
 *
 * Parses an LLM-issued shell command into a bash AST (via the pure-JS
 * `bash-parser`, chosen over tree-sitter to avoid native builds under
 * Windows/Git Bash), extracts each simple command's "name + args + redirect
 * targets", and runs a set of preset rules to flag high-risk operations.
 *
 * ## Positioning (read this before extending)
 *
 * The AST is a PRECISION tool for *honest* commands — it exists to recognise
 * what a command actually does so we can (a) hard-block the handful of
 * never-legitimate, irreversible catastrophes and (b) surface warnings for
 * merely-risky operations. It is NOT an adversarial security boundary:
 * dynamic `eval`, variable indirection, and encoded payloads can evade it.
 * That trade-off is acceptable for the single-owner, non-adversarial threat
 * model this tool targets.
 *
 * Failure is open: if parsing fails or a target cannot be resolved statically,
 * we do NOT block (blocking valid commands would make the agent useless and,
 * in this phase, there is no reversibility net to justify caution). We only
 * ever block on statically-visible catastrophic targets.
 *
 * Severities:
 *   - 'deny' : never-legitimate + irreversible → command is NOT spawned.
 *   - 'warn' : risky but legitimate → command runs; violation is reported so
 *              the LLM (and the audit trail) can see it.
 */

import parse from 'bash-parser'
import { homedir } from 'node:os'
import { path } from '../repo-utils/path.js'
import { checkPathPolicy, type PathPolicy } from './bash-path-policy.js'

export type DangerSeverity = 'deny' | 'warn'

export interface Violation {
  /** Stable rule identifier, e.g. 'RM_CATASTROPHIC'. */
  code: string
  severity: DangerSeverity
  /** Human-readable explanation. */
  message: string
  /** The offending fragment (command/target) that triggered the rule. */
  evidence?: string
}

/** A flattened simple command extracted from the AST. */
export interface SimpleCommand {
  /** Command name, e.g. 'rm', 'git'. Empty string if it could not be read. */
  name: string
  /** Argument word texts (literal source slices), redirects excluded. */
  args: string[]
  /** Redirection targets found in prefix/suffix, e.g. `> file`. */
  redirects: Array<{ op: string; target: string }>
}

/** A pipeline's direct child command names, e.g. ['curl', 'bash']. */
export interface PipelineInfo {
  names: string[]
}

/** A function definition with a fork-bomb verdict. */
export interface FunctionInfo {
  name: string
  isForkBomb: boolean
}

/** Everything a rule needs to make a verdict. */
export interface DangerContext {
  /** The original command string. */
  command: string
  /** All simple commands anywhere in the AST (including inside functions). */
  commands: SimpleCommand[]
  /** All pipelines and their direct command names. */
  pipelines: PipelineInfo[]
  /** All function definitions. */
  functions: FunctionInfo[]
  /** Resolved home directory (POSIX form). */
  homeDir: string
}

/** A danger rule: a code, a severity, and a pure detector over the context. */
export interface DangerRule {
  code: string
  severity: DangerSeverity
  describe: string
  detect: (ctx: DangerContext) => Violation[]
}

export interface DangerDetectionOptions {
  /** Master switch. Default: true. When false, no parsing/detection happens. */
  enabled?: boolean
  /**
   * 'enforce' (default): 'deny' rules block execution, 'warn' rules annotate.
   * 'warn-only': nothing is ever blocked; every match is downgraded to 'warn'.
   */
  mode?: 'enforce' | 'warn-only'
  /** Preset rule codes to disable. */
  disabledCodes?: string[]
  /** Custom rules appended to the preset set. */
  extraRules?: DangerRule[]
  /**
   * App-injected, path-scoped access policy. Evaluated on top of the preset
   * rules: maps each command's (operation, target) pairs to allow/warn/deny.
   * See bash-path-policy.ts.
   */
  pathPolicy?: PathPolicy
}

export interface DetectResult {
  /** Whether the command parsed successfully (false → detection was skipped). */
  parseOk: boolean
  /** All violations found (empty when parseOk is false). */
  violations: Violation[]
  /** True if any 'deny' violation is present (only in 'enforce' mode). */
  blocked: boolean
}

// ─── AST traversal ───────────────────────────────────────────────────────

type AnyNode = Record<string, unknown>

/** Depth-first visit of every object node in the AST. */
function walk(node: unknown, visit: (n: AnyNode) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  const n = node as AnyNode
  visit(n)
  for (const key of Object.keys(n)) {
    if (key === 'type') continue
    walk(n[key], visit)
  }
}

function wordText(w: unknown): string {
  if (w && typeof w === 'object' && typeof (w as AnyNode).text === 'string') {
    return (w as AnyNode).text as string
  }
  return ''
}

function extractSimpleCommand(n: AnyNode): SimpleCommand {
  const name = wordText(n.name)
  const args: string[] = []
  const redirects: Array<{ op: string; target: string }> = []
  const parts = [
    ...(Array.isArray(n.prefix) ? (n.prefix as unknown[]) : []),
    ...(Array.isArray(n.suffix) ? (n.suffix as unknown[]) : []),
  ]
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue
    const p = part as AnyNode
    if (p.type === 'Redirect') {
      redirects.push({ op: wordText(p.op), target: wordText(p.file) })
    } else if (p.type === 'Word') {
      args.push(typeof p.text === 'string' ? p.text : '')
    }
    // AssignmentWord (prefix env vars) and others are ignored for args.
  }
  return { name, args, redirects }
}

function buildContext(command: string, ast: unknown): DangerContext {
  const commands: SimpleCommand[] = []
  const pipelines: PipelineInfo[] = []
  const functions: FunctionInfo[] = []

  walk(ast, (n) => {
    if (n.type === 'Command') {
      commands.push(extractSimpleCommand(n))
    } else if (n.type === 'Pipeline' && Array.isArray(n.commands)) {
      const names = (n.commands as unknown[])
        .map((c) => (c && typeof c === 'object' ? wordText((c as AnyNode).name) : ''))
        .filter((s) => s.length > 0)
      pipelines.push({ names })
    } else if (n.type === 'Function') {
      const fname = wordText(n.name)
      let selfCall = false
      let hasAsync = false
      walk(n.body, (b) => {
        if (b.type === 'Command' && wordText(b.name) === fname) selfCall = true
        if (b.async === true) hasAsync = true
      })
      functions.push({ name: fname, isForkBomb: fname.length > 0 && selfCall && hasAsync })
    }
  })

  return { command, commands, pipelines, functions, homeDir: path.toPosixPath(homedir()) }
}

// ─── Path classification ───────────────────────────────────────────────────

const SYSTEM_DIRS = new Set([
  '/', '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib32', '/lib64',
  '/boot', '/sys', '/proc', '/dev', '/var', '/root', '/opt', '/srv',
])

/** Whole-disk / block-device targets (writing these is irreversible). */
const RAW_DEVICE_RE = /^\/dev\/(sd[a-z]|nvme\d+n\d+|hd[a-z]|vd[a-z]|xvd[a-z]|mmcblk\d+|disk\d+)$/

/** Strip one layer of surrounding quotes and expand ~ / $HOME. */
export function normalizeTarget(raw: string, homeDir: string): string {
  let t = raw.trim()
  if (t.length >= 2) {
    const first = t[0]
    const last = t[t.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      t = t.slice(1, -1)
    }
  }
  if (t === '~' || t.startsWith('~/')) t = homeDir + t.slice(1)
  t = t.replace(/\$\{HOME\}|\$HOME(?=\/|$)/g, homeDir)
  t = path.toPosixPath(t)
  t = t.replace(/\/{2,}/g, '/')
  if (t.length > 1 && t.endsWith('/')) t = t.slice(0, -1)
  return t
}

/** True when deleting/overwriting this target is a never-legitimate disaster. */
export function isCatastrophicTarget(t: string, homeDir: string): boolean {
  if (t === '/' || t === '/*') return true
  if (t === homeDir || t === homeDir + '/*') return true
  if (/^\/[a-zA-Z]$/.test(t)) return true          // /c — MSYS drive root
  if (/^[a-zA-Z]:\\?$/.test(t)) return true         // C: or C:\
  for (const d of SYSTEM_DIRS) {
    if (t === d || t === d + '/*') return true
  }
  return false
}

export function isRawDevice(t: string): boolean {
  return RAW_DEVICE_RE.test(t)
}

// ─── Helpers for rules ───────────────────────────────────────────────────

function positionalTargets(args: string[]): string[] {
  const out: string[] = []
  let afterDoubleDash = false
  for (const a of args) {
    if (a === '--') { afterDoubleDash = true; continue }
    if (!afterDoubleDash && a.startsWith('-') && a.length > 1) continue
    out.push(a)
  }
  return out
}

function rmFlags(args: string[]): { recursive: boolean; force: boolean } {
  let recursive = false
  let force = false
  for (const a of args) {
    if (a === '--recursive') recursive = true
    else if (a === '--force') force = true
    else if (/^-[a-zA-Z]+$/.test(a)) {
      if (/[rR]/.test(a)) recursive = true
      if (a.includes('f')) force = true
    }
  }
  return { recursive, force }
}

// ─── Preset rules ────────────────────────────────────────────────────────

/** rm/rmdir/shred targeting a catastrophic path → deny. */
const RULE_RM_CATASTROPHIC: DangerRule = {
  code: 'RM_CATASTROPHIC',
  severity: 'deny',
  describe: 'Recursive/forced deletion of root, a system directory, the home directory, or a drive root.',
  detect: (ctx) => {
    const out: Violation[] = []
    for (const c of ctx.commands) {
      if (c.name !== 'rm' && c.name !== 'rmdir' && c.name !== 'shred') continue
      for (const target of positionalTargets(c.args)) {
        const t = normalizeTarget(target, ctx.homeDir)
        if (isCatastrophicTarget(t, ctx.homeDir)) {
          out.push({
            code: 'RM_CATASTROPHIC',
            severity: 'deny',
            message: `Refusing to delete catastrophic path "${t}". This is never legitimate and irreversible.`,
            evidence: `${c.name} ... ${target}`,
          })
        }
      }
    }
    return out
  },
}

/** mkfs.* (filesystem format) → deny. */
const RULE_MKFS: DangerRule = {
  code: 'MKFS',
  severity: 'deny',
  describe: 'Formatting a filesystem (mkfs) destroys all data on the target device.',
  detect: (ctx) => {
    const out: Violation[] = []
    for (const c of ctx.commands) {
      if (/^mkfs(\.|$)/.test(c.name)) {
        out.push({
          code: 'MKFS',
          severity: 'deny',
          message: `Refusing to run "${c.name}" (filesystem format is irreversible).`,
          evidence: c.name,
        })
      }
    }
    return out
  },
}

/** dd of=/dev/sdX or `> /dev/sdX` (raw block-device write) → deny. */
const RULE_WRITE_RAW_DISK: DangerRule = {
  code: 'WRITE_RAW_DISK',
  severity: 'deny',
  describe: 'Writing directly to a raw block device destroys partitions/filesystems.',
  detect: (ctx) => {
    const out: Violation[] = []
    for (const c of ctx.commands) {
      if (c.name === 'dd') {
        for (const a of c.args) {
          if (a.startsWith('of=')) {
            const t = normalizeTarget(a.slice(3), ctx.homeDir)
            if (isRawDevice(t)) {
              out.push({
                code: 'WRITE_RAW_DISK',
                severity: 'deny',
                message: `Refusing dd write to raw device "${t}".`,
                evidence: a,
              })
            }
          }
        }
      }
      for (const r of c.redirects) {
        if (r.op === '>' || r.op === '>>') {
          const t = normalizeTarget(r.target, ctx.homeDir)
          if (isRawDevice(t)) {
            out.push({
              code: 'WRITE_RAW_DISK',
              severity: 'deny',
              message: `Refusing redirect "${r.op}" to raw device "${t}".`,
              evidence: `${r.op} ${r.target}`,
            })
          }
        }
      }
    }
    return out
  },
}

/** Self-recursive backgrounded function (fork bomb) → deny. */
const RULE_FORK_BOMB: DangerRule = {
  code: 'FORK_BOMB',
  severity: 'deny',
  describe: 'A self-recursive backgrounded function exhausts process slots (fork bomb).',
  detect: (ctx) => {
    const out: Violation[] = []
    for (const f of ctx.functions) {
      if (f.isForkBomb) {
        out.push({
          code: 'FORK_BOMB',
          severity: 'deny',
          message: `Refusing fork bomb: function "${f.name}" recursively spawns itself in the background.`,
          evidence: `${f.name}() { ... }`,
        })
      }
    }
    return out
  },
}

const DOWNLOADERS = new Set(['curl', 'wget', 'fetch'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish'])

/** `curl ... | bash` (download-and-execute) → warn. */
const RULE_CURL_PIPE_SHELL: DangerRule = {
  code: 'CURL_PIPE_SHELL',
  severity: 'warn',
  describe: 'Piping a download straight into a shell executes unreviewed remote code.',
  detect: (ctx) => {
    const out: Violation[] = []
    for (const p of ctx.pipelines) {
      const hasDownloader = p.names.some((n) => DOWNLOADERS.has(n))
      const hasShell = p.names.some((n) => SHELLS.has(n))
      if (hasDownloader && hasShell) {
        out.push({
          code: 'CURL_PIPE_SHELL',
          severity: 'warn',
          message: 'Download piped directly into a shell — remote code runs unreviewed.',
          evidence: p.names.join(' | '),
        })
      }
    }
    return out
  },
}

/** git reset --hard / git clean -fd / git checkout -- . → warn. */
const RULE_GIT_DESTRUCTIVE: DangerRule = {
  code: 'GIT_DESTRUCTIVE',
  severity: 'warn',
  describe: 'git reset --hard / clean -fd / checkout -- . discards uncommitted work.',
  detect: (ctx) => {
    const out: Violation[] = []
    for (const c of ctx.commands) {
      if (c.name !== 'git') continue
      const a = c.args
      const sub = a.find((x) => !x.startsWith('-')) ?? ''
      let hit: string | undefined
      if (sub === 'reset' && a.includes('--hard')) hit = 'git reset --hard'
      else if (sub === 'clean' && a.some((x) => /^-[a-zA-Z]*f/.test(x))) hit = 'git clean -f'
      else if (sub === 'checkout' && a.includes('--')) hit = 'git checkout -- ...'
      if (hit) {
        out.push({
          code: 'GIT_DESTRUCTIVE',
          severity: 'warn',
          message: `${hit} discards uncommitted changes (not recoverable via git).`,
          evidence: `git ${a.join(' ')}`.slice(0, 80),
        })
      }
    }
    return out
  },
}

/** find ... -delete  or  find ... -exec rm → warn. */
const RULE_FIND_DELETE: DangerRule = {
  code: 'FIND_DELETE',
  severity: 'warn',
  describe: 'find -delete / -exec rm can remove many files at once.',
  detect: (ctx) => {
    const out: Violation[] = []
    for (const c of ctx.commands) {
      if (c.name !== 'find') continue
      const hasDelete = c.args.includes('-delete')
      const hasExecRm = c.args.includes('-exec') && c.args.includes('rm')
      if (hasDelete || hasExecRm) {
        out.push({
          code: 'FIND_DELETE',
          severity: 'warn',
          message: 'find bulk-deletes matching files — verify the path and predicate.',
          evidence: `find ${c.args.join(' ')}`.slice(0, 80),
        })
      }
    }
    return out
  },
}

/** Recursive+forced rm of an absolute path outside /tmp → warn. */
const RULE_RM_RECURSIVE_FORCE: DangerRule = {
  code: 'RM_RECURSIVE_FORCE',
  severity: 'warn',
  describe: 'Recursive forced deletion of an absolute path outside the temp tree.',
  detect: (ctx) => {
    const out: Violation[] = []
    for (const c of ctx.commands) {
      if (c.name !== 'rm') continue
      const { recursive, force } = rmFlags(c.args)
      if (!(recursive && force)) continue
      for (const target of positionalTargets(c.args)) {
        const t = normalizeTarget(target, ctx.homeDir)
        if (isCatastrophicTarget(t, ctx.homeDir)) continue // already denied
        const isAbsolute = t.startsWith('/')
        const isTemp = t.startsWith('/tmp') || t.startsWith('/var/tmp') || /\/temp(\/|$)/i.test(t)
        if (isAbsolute && !isTemp) {
          out.push({
            code: 'RM_RECURSIVE_FORCE',
            severity: 'warn',
            message: `Recursive forced delete of "${t}" — irreversible (no snapshot is taken in this phase).`,
            evidence: `rm -rf ${target}`,
          })
        }
      }
    }
    return out
  },
}

/** Outbound data upload (curl upload / scp / rsync remote / git push) → warn. */
const RULE_OUTBOUND_UPLOAD: DangerRule = {
  code: 'OUTBOUND_UPLOAD',
  severity: 'warn',
  describe: 'Sends local data to a remote destination.',
  detect: (ctx) => {
    const out: Violation[] = []
    for (const c of ctx.commands) {
      if (DOWNLOADERS.has(c.name)) {
        const uploads = c.args.some(
          (a) => a === '-F' || a === '--form' || a === '-T' || a === '--upload-file' ||
            a === '--data-binary' || /^--data-binary=@/.test(a) || a.startsWith('@'),
        )
        if (uploads) {
          out.push({
            code: 'OUTBOUND_UPLOAD',
            severity: 'warn',
            message: `${c.name} is uploading local data to a remote endpoint.`,
            evidence: `${c.name} ${c.args.join(' ')}`.slice(0, 80),
          })
        }
      } else if (c.name === 'scp' || c.name === 'rsync') {
        const remote = c.args.some((a) => /^[\w.-]+@/.test(a) || /^[\w.-]+:/.test(a))
        if (remote) {
          out.push({
            code: 'OUTBOUND_UPLOAD',
            severity: 'warn',
            message: `${c.name} transfers data to/from a remote host.`,
            evidence: `${c.name} ${c.args.join(' ')}`.slice(0, 80),
          })
        }
      } else if (c.name === 'git' && c.args[0] === 'push') {
        out.push({
          code: 'OUTBOUND_UPLOAD',
          severity: 'warn',
          message: 'git push uploads commits to a remote.',
          evidence: `git ${c.args.join(' ')}`.slice(0, 80),
        })
      }
    }
    return out
  },
}

/** The full preset rule set, in evaluation order. */
export const PRESET_RULES: readonly DangerRule[] = [
  RULE_RM_CATASTROPHIC,
  RULE_MKFS,
  RULE_WRITE_RAW_DISK,
  RULE_FORK_BOMB,
  RULE_CURL_PIPE_SHELL,
  RULE_GIT_DESTRUCTIVE,
  RULE_FIND_DELETE,
  RULE_RM_RECURSIVE_FORCE,
  RULE_OUTBOUND_UPLOAD,
]

// ─── Text-level rules (parser-independent) ─────────────────────────────────
//
// Some bashisms (e.g. process substitution `<(...)`) are not modelled by
// bash-parser and make the whole command unparseable. These regex checks run
// on the raw command string regardless of parse success, so detection is not
// silently lost. They are intentionally conservative (low false-positive).

interface TextRule {
  code: string
  severity: DangerSeverity
  test: RegExp
  message: string
}

const TEXT_RULES: readonly TextRule[] = [
  {
    code: 'CURL_PIPE_SHELL',
    severity: 'warn',
    // bash <(curl ...) / sh <(wget ...)
    test: /\b(?:bash|sh|zsh|dash|ksh)\s+<\(\s*(?:curl|wget|fetch)\b/,
    message: 'Shell executing a downloaded process substitution — remote code runs unreviewed.',
  },
]

function runTextRules(command: string, disabled: Set<string>): Violation[] {
  const out: Violation[] = []
  for (const r of TEXT_RULES) {
    if (disabled.has(r.code)) continue
    if (r.test.test(command)) {
      out.push({ code: r.code, severity: r.severity, message: r.message, evidence: command.slice(0, 80) })
    }
  }
  return out
}

// ─── Public entry point ────────────────────────────────────────────────────

/**
 * Parse `command` and run danger rules against it.
 *
 * Never throws. On parse failure returns `{ parseOk: false, violations: [],
 * blocked: false }` — detection is skipped (fail-open) and the command is
 * allowed to run.
 *
 * @param cwd Working directory used to resolve relative paths for the optional
 *            path policy. Defaults to process.cwd() when omitted.
 */
export function detectDangers(
  command: string,
  options?: DangerDetectionOptions,
  cwd?: string,
): DetectResult {
  const enabled = options?.enabled ?? true
  if (!enabled || !command.trim()) {
    return { parseOk: true, violations: [], blocked: false }
  }

  const disabled = new Set(options?.disabledCodes ?? [])
  const warnOnly = options?.mode === 'warn-only'
  const homeDir = path.toPosixPath(homedir())

  // Text-level rules run regardless of parse success (catch bashisms that the
  // parser cannot model, e.g. process substitution).
  const textViolations = runTextRules(command, disabled)

  let ast: unknown
  try {
    ast = parse(command)
  } catch {
    // Parse failed (fail-open): no AST rules, but keep any text-level findings.
    const violations = warnOnly
      ? textViolations.map((v) => ({ ...v, severity: 'warn' as const }))
      : textViolations
    return { parseOk: false, violations, blocked: violations.some((v) => v.severity === 'deny') }
  }

  const ctx = buildContext(command, ast)
  ctx.homeDir = homeDir
  const rules = [...PRESET_RULES, ...(options?.extraRules ?? [])].filter(
    (r) => !disabled.has(r.code),
  )

  const violations: Violation[] = []
  const seen = new Set<string>()
  const add = (v: Violation): void => {
    const key = `${v.code}|${v.evidence ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    violations.push(warnOnly ? { ...v, severity: 'warn' } : v)
  }

  for (const rule of rules) {
    let matches: Violation[]
    try {
      matches = rule.detect(ctx)
    } catch {
      continue // a misbehaving rule must never break execution
    }
    for (const v of matches) add(v)
  }
  // Append text-level findings not already produced by an AST rule.
  for (const v of textViolations) add(v)

  // App-injected path policy, layered on top of the presets.
  if (options?.pathPolicy && !disabled.has('PATH_POLICY')) {
    try {
      const policyViolations = checkPathPolicy(ctx.commands, {
        policy: options.pathPolicy,
        homeDir,
        ...(cwd !== undefined ? { cwd } : {}),
      })
      for (const v of policyViolations) add(v)
    } catch {
      // Policy evaluation must never break execution.
    }
  }

  const blocked = violations.some((v) => v.severity === 'deny')
  return { parseOk: true, violations, blocked }
}
