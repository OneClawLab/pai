/**
 * bash-path-policy.ts — app-injected, path-scoped access policy for bash_exec.
 *
 * Phase-1 danger detection hardcodes a few never-legitimate catastrophes. This
 * module lets the APPLICATION inject finer, smarter boundaries: "the agent may
 * read ~/.config but must never write outside ~/projects/foo", expressed as
 * per-path allow/warn/deny rules over five access kinds:
 *
 *     read · write(append) · create · overwrite · delete
 *
 * The AST tells us, for each command, which (operation, target-path) pairs it
 * performs; we resolve targets to absolute POSIX paths and match each pair
 * against the policy. create-vs-overwrite is refined with a cheap, bounded
 * existsSync probe (one stat per concrete target, memoised) — globs and
 * unresolved targets stay conservative rather than walking the tree.
 *
 * This composes ON TOP of the catastrophic presets (which always win as hard
 * deny). It is a precision tool, not an adversarial boundary, and fails open:
 * any extraction/resolution it cannot do simply yields no policy verdict.
 */

import { existsSync } from '../repo-utils/fs.js'
import { path } from '../repo-utils/path.js'
import type { SimpleCommand, Violation, DangerSeverity } from './bash-danger.js'

export type PathAccess = 'read' | 'write' | 'create' | 'overwrite' | 'delete'

export interface PathPolicyRule {
  /**
   * Path pattern. `~`/`$HOME` expand. A plain path matches itself and its
   * subtree (`/a/b` matches `/a/b` and `/a/b/**`). Wildcards `*` (within a
   * segment), `**` (across segments), and `?` are supported for explicit globs.
   */
  pattern: string
  /** Access kinds explicitly allowed (suppresses default + other lists). */
  allow?: PathAccess[]
  /** Access kinds that warn (run, but flagged). */
  warn?: PathAccess[]
  /** Access kinds that are denied (blocked before spawn). */
  deny?: PathAccess[]
}

export interface PathPolicy {
  /** Rules evaluated in order; first rule matching (path, op) decides. */
  rules: PathPolicyRule[]
  /** Verdict for an (op, path) matched by no rule. Default: 'allow'. */
  default?: 'allow' | 'warn' | 'deny'
}

/** A single resolved file operation a command performs. */
export interface FileOp {
  op: PathAccess
  /** Absolute POSIX path (glob suffix reduced to its literal parent). */
  absPath: string
  /** Original token, for diagnostics. */
  raw: string
  /** True when the target contained glob metacharacters. */
  glob: boolean
}

// ─── Target resolution ──────────────────────────────────────────────────────

const GLOB_RE = /[*?[\]]/

function stripQuotes(s: string): string {
  const t = s.trim()
  if (t.length >= 2) {
    const a = t[0]
    const b = t[t.length - 1]
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return t.slice(1, -1)
  }
  return t
}

/** Resolve a raw argument to an absolute POSIX path (best-effort). */
export function resolveTarget(raw: string, cwd: string | undefined, homeDir: string): string {
  let t = stripQuotes(raw)
  if (t === '~' || t.startsWith('~/')) t = homeDir + t.slice(1)
  t = t.replace(/\$\{HOME\}|\$HOME(?=\/|$)/g, homeDir)
  t = path.toPosixPath(t)
  if (!t.startsWith('/')) {
    const base = cwd ? path.toPosixPath(cwd) : path.toPosixPath(process.cwd())
    t = path.join(base, t)
  }
  t = path.normalize(t)
  if (t.length > 1 && t.endsWith('/')) t = t.slice(0, -1)
  return t
}

/** Reduce a glob target to the literal directory prefix used for matching. */
function globToLiteralDir(absPath: string): string {
  const idx = absPath.search(GLOB_RE)
  if (idx === -1) return absPath
  const prefix = absPath.slice(0, idx)
  const lastSlash = prefix.lastIndexOf('/')
  const dir = lastSlash <= 0 ? '/' : prefix.slice(0, lastSlash)
  return dir
}

// ─── Pattern matching ────────────────────────────────────────────────────────

function patternToRegExp(pattern: string): RegExp {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*'
        i++
        if (pattern[i + 1] === '/') i++ // collapse `**/`
      } else {
        re += '[^/]*'
      }
    } else if (ch === '?') {
      re += '[^/]'
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${re}$`)
}

/** True when `absPath` is governed by `pattern`. */
export function matchPattern(pattern: string, absPath: string, homeDir: string): boolean {
  let p = stripQuotes(pattern)
  if (p === '~' || p.startsWith('~/')) p = homeDir + p.slice(1)
  p = p.replace(/\$\{HOME\}|\$HOME(?=\/|$)/g, homeDir)
  p = path.toPosixPath(p)
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)

  if (GLOB_RE.test(p)) {
    return patternToRegExp(p).test(absPath)
  }
  // Plain path: matches itself and its subtree.
  return absPath === p || absPath.startsWith(p + '/')
}

// ─── Operation extraction ─────────────────────────────────────────────────────

function positionals(args: string[]): string[] {
  const out: string[] = []
  let afterDD = false
  for (const a of args) {
    if (a === '--') { afterDD = true; continue }
    if (!afterDD && a.startsWith('-') && a.length > 1) continue
    out.push(a)
  }
  return out
}

const READERS = new Set(['cat', 'head', 'tail', 'less', 'more', 'nl', 'od', 'xxd', 'hexdump'])

/**
 * Extract the file operations a single command performs. `existsProbe` decides
 * create vs overwrite for concrete (non-glob) destinations.
 */
export function extractFileOps(
  c: SimpleCommand,
  cwd: string | undefined,
  homeDir: string,
  existsProbe: (absPath: string) => boolean,
): FileOp[] {
  const ops: FileOp[] = []
  const mk = (op: PathAccess, raw: string): FileOp => {
    const abs0 = resolveTarget(raw, cwd, homeDir)
    const glob = GLOB_RE.test(abs0)
    return { op, absPath: glob ? globToLiteralDir(abs0) : abs0, raw, glob }
  }
  // create vs overwrite for a concrete destination.
  const writeDest = (raw: string): FileOp => {
    const abs0 = resolveTarget(raw, cwd, homeDir)
    if (GLOB_RE.test(abs0)) return { op: 'overwrite', absPath: globToLiteralDir(abs0), raw, glob: true }
    const op: PathAccess = existsProbe(abs0) ? 'overwrite' : 'create'
    return { op, absPath: abs0, raw, glob: false }
  }

  const name = c.name

  // Redirections apply to any command.
  for (const r of c.redirects) {
    if (r.op === '>' || r.op === '>|') ops.push(writeDest(r.target))
    else if (r.op === '>>') ops.push(mk('write', r.target))
  }

  if (name === 'rm' || name === 'rmdir' || name === 'shred') {
    for (const t of positionals(c.args)) ops.push(mk('delete', t))
  } else if (name === 'mkdir') {
    for (const t of positionals(c.args)) ops.push(mk('create', t))
  } else if (name === 'touch') {
    for (const t of positionals(c.args)) ops.push(writeDest(t))
  } else if (name === 'truncate') {
    // truncate -s 0 FILE...  → overwrite existing / create new
    for (const t of positionals(c.args).filter((a) => !/^\d/.test(a))) ops.push(writeDest(t))
  } else if (name === 'tee') {
    const append = c.args.some((a) => a === '-a' || a === '--append')
    for (const t of positionals(c.args)) ops.push(append ? mk('write', t) : writeDest(t))
  } else if (name === 'sed') {
    if (c.args.some((a) => a === '-i' || a.startsWith('-i') || a === '--in-place')) {
      // last positional(s) are files edited in place
      for (const t of positionals(c.args).slice(1)) ops.push(mk('overwrite', t))
    }
  } else if (name === 'cp') {
    const pos = positionals(c.args)
    if (pos.length >= 2) {
      for (let i = 0; i < pos.length - 1; i++) ops.push(mk('read', pos[i]!))
      ops.push(writeDest(pos[pos.length - 1]!))
    }
  } else if (name === 'mv') {
    const pos = positionals(c.args)
    if (pos.length >= 2) {
      for (let i = 0; i < pos.length - 1; i++) ops.push(mk('delete', pos[i]!)) // source removed
      ops.push(writeDest(pos[pos.length - 1]!))
    }
  } else if (READERS.has(name)) {
    for (const t of positionals(c.args)) ops.push(mk('read', t))
  }

  return ops
}

// ─── Policy evaluation ─────────────────────────────────────────────────────

function verdictFor(rule: PathPolicyRule, op: PathAccess): DangerSeverity | 'allow' | undefined {
  if (rule.deny?.includes(op)) return 'deny'
  if (rule.warn?.includes(op)) return 'warn'
  if (rule.allow?.includes(op)) return 'allow'
  return undefined
}

export interface PathPolicyCheckOptions {
  policy: PathPolicy
  cwd?: string
  homeDir: string
}

/**
 * Evaluate every file operation in `commands` against the policy.
 * Returns violations (deny/warn only; allow produces nothing). Fail-open: a
 * probe/match error for one op never aborts the whole check.
 */
export function checkPathPolicy(
  commands: SimpleCommand[],
  opts: PathPolicyCheckOptions,
): Violation[] {
  const { policy, cwd, homeDir } = opts
  const def = policy.default ?? 'allow'
  const out: Violation[] = []

  // Memoise existsSync per path within this check (bounded, cheap fs I/O).
  const existsCache = new Map<string, boolean>()
  const existsProbe = (p: string): boolean => {
    const cached = existsCache.get(p)
    if (cached !== undefined) return cached
    let v = false
    try { v = existsSync(p) } catch { v = false }
    existsCache.set(p, v)
    return v
  }

  for (const c of commands) {
    let fileOps: FileOp[]
    try {
      fileOps = extractFileOps(c, cwd, homeDir, existsProbe)
    } catch {
      continue
    }
    for (const fo of fileOps) {
      let decided: DangerSeverity | 'allow' | undefined
      try {
        for (const rule of policy.rules) {
          if (!matchPattern(rule.pattern, fo.absPath, homeDir)) continue
          const v = verdictFor(rule, fo.op)
          if (v !== undefined) { decided = v; break }
        }
      } catch {
        decided = undefined
      }
      const verdict = decided ?? def
      if (verdict === 'allow') continue
      out.push({
        code: `PATH_POLICY_${fo.op.toUpperCase()}`,
        severity: verdict,
        message:
          `Path policy ${verdict === 'deny' ? 'denies' : 'warns on'} ` +
          `${fo.op} of "${fo.absPath}"` + (fo.glob ? ' (glob)' : '') + '.',
        evidence: `${c.name} … ${fo.raw}`,
      })
    }
  }
  return out
}
