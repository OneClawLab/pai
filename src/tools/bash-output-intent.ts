/**
 * bash-output-intent.ts — classify a command's STDOUT volume intent.
 *
 * The output cap (bash-output.ts) protects the token budget against *surprise*
 * volume. But when the LLM has already stated how much it wants — `head -n 500`,
 * `tail -c 100000`, `sed -n '1,800p'`, `grep -m 20`, or `… | head -20` — cutting
 * it again to the small default cap just forces wasteful re-reads.
 *
 * This module parses the command and decides whether stdout is "self-bounded".
 * When it is, the caller raises the per-call byte budget toward the hard ceiling
 * (and, for line-bounded readers, derives a byte budget from the requested line
 * count so a few pathologically long lines — e.g. minified JSON / JSONL — still
 * get clipped at the ceiling rather than blowing up the context).
 *
 * It is a precision/UX tool, NOT a safety boundary — failure is open (treat as
 * unbounded). The hard ceiling always applies regardless of verdict.
 */

import parse from 'bash-parser'

export interface OutputIntent {
  /** True when the LAST stage of the stdout pipeline self-limits its output. */
  bounded: boolean
  /** Requested line count, when the bound is line-based (head -n / sed range). */
  lines?: number
  /** Requested byte count, when the bound is byte-based (head -c / tail -c). */
  bytes?: number
  /** The reader command that produced the verdict (for diagnostics). */
  reader?: string
}

type AnyNode = Record<string, unknown>

function wordText(w: unknown): string {
  if (w && typeof w === 'object' && typeof (w as AnyNode).text === 'string') {
    return (w as AnyNode).text as string
  }
  return ''
}

/** Extract [name, ...argWords] from a Command node (redirects excluded). */
function commandWords(n: AnyNode): string[] {
  const out: string[] = [wordText(n.name)]
  const suffix = Array.isArray(n.suffix) ? (n.suffix as unknown[]) : []
  for (const part of suffix) {
    if (part && typeof part === 'object' && (part as AnyNode).type === 'Word') {
      out.push(wordText(part))
    }
  }
  return out
}

/** Pull a numeric value from `-nN` (glued) or `-n N` (separate) forms. */
function flagNumber(args: string[], short: string, long?: string): number | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === undefined) continue
    // Glued short form: -n500
    if (a.startsWith(short) && a.length > short.length && /^\d+$/.test(a.slice(short.length))) {
      return Number(a.slice(short.length))
    }
    // Separate short form: -n 500
    if (a === short && i + 1 < args.length && /^\+?\d+$/.test(args[i + 1]!)) {
      return Number(args[i + 1]!.replace('+', ''))
    }
    // Long form: --lines=500 / --lines 500
    if (long) {
      if (a.startsWith(`${long}=`) && /^\d+$/.test(a.slice(long.length + 1))) {
        return Number(a.slice(long.length + 1))
      }
      if (a === long && i + 1 < args.length && /^\d+$/.test(args[i + 1]!)) {
        return Number(args[i + 1]!)
      }
    }
  }
  return undefined
}

const DEFAULT_HEAD_TAIL_LINES = 10

/**
 * Classify a single simple command's self-bounding behaviour.
 * Returns undefined when the command does not bound its own output.
 */
function classifyReader(words: string[]): OutputIntent | undefined {
  const name = words[0] ?? ''
  const args = words.slice(1)

  if (name === 'head' || name === 'tail') {
    const bytes = flagNumber(args, '-c', '--bytes')
    if (bytes !== undefined) return { bounded: true, bytes, reader: name }
    const lines = flagNumber(args, '-n', '--lines')
    if (lines !== undefined) return { bounded: true, lines, reader: name }
    // Bare head/tail → implicit 10-line bound.
    return { bounded: true, lines: DEFAULT_HEAD_TAIL_LINES, reader: name }
  }

  if (name === 'grep') {
    const m = flagNumber(args, '-m', '--max-count')
    if (m !== undefined) return { bounded: true, lines: m, reader: 'grep' }
    return undefined
  }

  if (name === 'sed') {
    // Recognise the common "print a line range then quit" idiom:
    // sed -n '1,800p'  /  sed -n 800p  (with -n suppressing default print).
    if (!args.includes('-n') && !args.some((a) => a.startsWith('-n'))) return undefined
    for (const a of args) {
      const m = /^'?(?:(\d+),)?(\d+)p'?$/.exec(a)
      if (m) {
        // With a comma it's a line RANGE (start,end → end-start+1 lines);
        // without, it's a single line address (e.g. `800p` prints 1 line).
        if (m[1]) {
          const start = Number(m[1])
          const end = Number(m[2])
          if (end >= start) return { bounded: true, lines: end - start + 1, reader: 'sed' }
        } else {
          return { bounded: true, lines: 1, reader: 'sed' }
        }
      }
    }
    return undefined
  }

  return undefined
}

/**
 * Determine the stdout volume intent of a command string.
 *
 * Only the LAST stage of the top-level pipeline governs stdout volume
 * (`cat huge | head -20` is bounded; `head -20 f | cat` is not). Anything we
 * cannot parse or recognise is reported as unbounded (fail-open).
 */
export function analyzeOutputIntent(command: string): OutputIntent {
  let ast: unknown
  try {
    ast = parse(command)
  } catch {
    return { bounded: false }
  }

  const script = ast as { commands?: unknown[] }
  const top = Array.isArray(script.commands) ? script.commands : []
  // Only a single top-level command/pipeline can have a clean stdout verdict.
  // Lists (a; b), logical exprs (a && b), backgrounded jobs → treat as unbounded.
  if (top.length !== 1) return { bounded: false }

  const node = top[0] as AnyNode | undefined
  if (!node || typeof node !== 'object') return { bounded: false }

  let lastCmd: AnyNode | undefined
  if (node.type === 'Command') {
    lastCmd = node
  } else if (node.type === 'Pipeline' && Array.isArray(node.commands) && node.commands.length > 0) {
    const cmds = node.commands as unknown[]
    const last = cmds[cmds.length - 1]
    if (last && typeof last === 'object' && (last as AnyNode).type === 'Command') {
      lastCmd = last as AnyNode
    }
  } else {
    return { bounded: false }
  }

  if (!lastCmd) return { bounded: false }

  // A redirect on the final command sends stdout to a file, not back to us →
  // nothing to cap.
  const verdict = classifyReader(commandWords(lastCmd))
  return verdict ?? { bounded: false }
}
