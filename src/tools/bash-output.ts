/**
 * bash-output.ts — large-output truncation + spill-to-file for bash_exec.
 *
 * Problem: a single command can emit far more stdout than the LLM can or
 * should consume (cat a big file, verbose build logs, an infinite `yes`).
 * Returning all of it burns the token budget and can blow up the session.
 *
 * Model (byte-budget):
 *   - A HARD CEILING bounds how much we ever keep in memory / return per stream
 *     (default 256KB). No flag or intent can exceed it. We capture the HEAD up
 *     to (ceiling − tailReserve) plus a rolling TAIL of the last `tailReserve`
 *     bytes, so the end of a long log (where errors live) survives.
 *   - A per-call BUDGET (default 64KB, ≤ ceiling) decides how much is returned
 *     inline. Output within budget is returned verbatim; over budget yields a
 *     head+tail summary plus a spill file holding everything we captured.
 *   - Self-bounded readers (head -n / sed range / grep -m …) raise the budget
 *     toward the ceiling (see resolveStreamBudget), so an explicit "read 500
 *     lines" is not clipped to the tiny default. Line-based bounds derive their
 *     byte budget from an assumed max line length, so pathologically long lines
 *     (minified JSON / JSONL) still get clipped at the ceiling.
 *
 * This is a token-budget guard, not a safety boundary.
 */

import { mkdtempSync, writeFileSync } from '../repo-utils/fs.js'
import { path } from '../repo-utils/path.js'
import { tmpdir } from 'node:os'
import type { OutputIntent } from './bash-output-intent.js'

export interface OutputCapConfig {
  /** Default bytes returned inline per stream when nothing else applies. */
  defaultReturnBytes: number
  /** Absolute max bytes ever captured/returned per stream. Nothing exceeds this. */
  hardCeilingBytes: number
  /** Assumed max bytes per line, used to turn a line bound into a byte budget. */
  assumedLineBytes: number
  /** Bytes of the ceiling reserved for the rolling tail (rest is head). */
  tailReserveBytes: number
  /** When true, spill the captured output to a file when truncated. */
  spillToFile: boolean
  /** Directory for spill files. Default: os tmpdir. */
  spillDir?: string
}

const KB = 1024

export const DEFAULT_OUTPUT_CAP: OutputCapConfig = {
  defaultReturnBytes: 64 * KB,
  hardCeilingBytes: 256 * KB,
  assumedLineBytes: 1 * KB,
  tailReserveBytes: 64 * KB,
  spillToFile: true,
}

export interface ProcessedStream {
  /** The (possibly truncated) text to hand back to the LLM. */
  text: string
  truncated: boolean
  /** True total bytes produced by the command (even if we dropped some). */
  totalBytes: number
  /** Bytes actually returned inline. */
  returnedBytes: number
  /** True when output exceeded the capture ceiling (middle bytes were lost). */
  capExceeded: boolean
  /** Absolute POSIX path to the captured output, when spilled. */
  spillPath?: string
}

// ─── Capture (bounds memory; preserves head + tail) ─────────────────────────

export interface CapturedStream {
  head: Buffer
  tail: Buffer
  totalBytes: number
  /** True when total exceeded head+tail capacity (middle bytes dropped). */
  dropped: boolean
}

/**
 * Accumulates a stream into a bounded head buffer plus a rolling tail ring.
 * Memory is capped at headLimit + tailLimit regardless of how much is pushed.
 */
export class StreamCapture {
  private head: Buffer[] = []
  private headLen = 0
  private tail: Buffer[] = []
  private tailLen = 0
  private total = 0

  constructor(
    private readonly headLimit: number,
    private readonly tailLimit: number,
  ) {}

  push(chunk: Buffer): void {
    if (chunk.length === 0) return
    this.total += chunk.length

    if (this.headLen < this.headLimit) {
      const room = this.headLimit - this.headLen
      if (chunk.length <= room) {
        this.head.push(chunk)
        this.headLen += chunk.length
        return
      }
      this.head.push(chunk.subarray(0, room))
      this.headLen += room
      this.pushTail(chunk.subarray(room))
      return
    }
    this.pushTail(chunk)
  }

  private pushTail(chunk: Buffer): void {
    // If a single chunk alone exceeds the tail limit, keep only its last
    // tailLimit bytes — otherwise the ring could hold an arbitrarily large
    // buffer (a lone giant chunk is never split by the trim loop below).
    let c = chunk
    if (c.length >= this.tailLimit) {
      c = c.subarray(c.length - this.tailLimit)
      this.tail = [c]
      this.tailLen = c.length
      return
    }
    this.tail.push(c)
    this.tailLen += c.length
    // Drop whole leading buffers while the remainder still covers tailLimit.
    while (this.tail.length > 1 && this.tailLen - this.tail[0]!.length >= this.tailLimit) {
      this.tailLen -= this.tail.shift()!.length
    }
  }

  get totalBytes(): number {
    return this.total
  }

  finalize(): CapturedStream {
    const head = Buffer.concat(this.head)
    const tail = Buffer.concat(this.tail)
    return {
      head,
      tail,
      totalBytes: this.total,
      dropped: this.total > head.length + tail.length,
    }
  }
}

/** Build a CapturedStream from a complete string (used by tests / raw paths). */
export function captureFromString(full: string, cap: OutputCapConfig): CapturedStream {
  const sc = new StreamCapture(cap.hardCeilingBytes - cap.tailReserveBytes, cap.tailReserveBytes)
  sc.push(Buffer.from(full, 'utf-8'))
  return sc.finalize()
}

// ─── Budget resolution ──────────────────────────────────────────────────────

/**
 * Decide how many bytes to return inline for a stream.
 *
 * Precedence: an explicit per-call byte limit wins (0 = suppress); otherwise a
 * self-bounded reader raises the budget from its declared size; otherwise the
 * default. Everything is clamped to [0, hardCeiling].
 */
export function resolveStreamBudget(
  intent: OutputIntent | undefined,
  explicitBytes: number | undefined,
  cap: OutputCapConfig,
): number {
  const ceiling = cap.hardCeilingBytes
  if (explicitBytes !== undefined) {
    return Math.max(0, Math.min(explicitBytes, ceiling))
  }
  if (intent?.bounded) {
    if (intent.bytes !== undefined) {
      return Math.min(Math.max(intent.bytes, cap.defaultReturnBytes), ceiling)
    }
    if (intent.lines !== undefined) {
      const derived = intent.lines * cap.assumedLineBytes
      return Math.min(Math.max(derived, cap.defaultReturnBytes), ceiling)
    }
  }
  return cap.defaultReturnBytes
}

// ─── Spill ──────────────────────────────────────────────────────────────────

let spillSessionDir: string | undefined

function getSpillDir(cap: OutputCapConfig): string {
  if (cap.spillDir) return cap.spillDir
  if (!spillSessionDir) {
    spillSessionDir = mkdtempSync(path.join(path.toPosixPath(tmpdir()), 'pai-bash-out-'))
  }
  return spillSessionDir
}

/** The text we persist to the spill file (complete, or head+marker+tail). */
function spillContent(c: CapturedStream): string {
  if (!c.dropped) return Buffer.concat([c.head, c.tail]).toString('utf-8')
  const lost = c.totalBytes - c.head.length - c.tail.length
  return (
    c.head.toString('utf-8') +
    `\n... [${lost} bytes not captured — exceeded capture ceiling] ...\n` +
    c.tail.toString('utf-8')
  )
}

function writeSpill(c: CapturedStream, streamName: string, runId: string, cap: OutputCapConfig): string | undefined {
  if (!cap.spillToFile) return undefined
  try {
    const file = path.join(getSpillDir(cap), `${runId}.${streamName}.txt`)
    writeFileSync(file, spillContent(c), 'utf-8')
    return file
  } catch {
    return undefined
  }
}

// ─── Presentation ────────────────────────────────────────────────────────────

/** head[0:half] + marker + tail[-half:], fitting within `budget` bytes. */
function headTailSummary(c: CapturedStream, budget: number): string {
  const half = Math.max(1, Math.floor(budget / 2))
  let headBuf: Buffer
  let tailBuf: Buffer
  if (!c.dropped) {
    const full = Buffer.concat([c.head, c.tail])
    headBuf = full.subarray(0, half)
    tailBuf = full.subarray(Math.max(half, full.length - half))
  } else {
    headBuf = c.head.subarray(0, half)
    tailBuf = c.tail.subarray(Math.max(0, c.tail.length - half))
  }
  return `${headBuf.toString('utf-8')}\n... [omitted middle] ...\n${tailBuf.toString('utf-8')}`
}

/**
 * Apply the return budget to a captured stream.
 *
 * - budget 0 → stream suppressed (only a note is returned; full output still
 *   spilled so it can be retrieved).
 * - total ≤ budget and nothing dropped → returned verbatim (not truncated).
 * - otherwise → head+tail summary within budget, plus a spill file.
 */
export function processCapture(
  c: CapturedStream,
  streamName: 'stdout' | 'stderr',
  runId: string,
  budget: number,
  cap: OutputCapConfig,
): ProcessedStream {
  const base = { totalBytes: c.totalBytes, capExceeded: c.dropped }

  if (budget <= 0) {
    const spillPath = c.totalBytes > 0 ? writeSpill(c, streamName, runId, cap) : undefined
    const note =
      c.totalBytes === 0
        ? ''
        : `[${streamName} suppressed (limit 0): ${c.totalBytes} bytes total` +
          (spillPath ? `. Full output: ${spillPath}` : ``) + `]`
    const r: ProcessedStream = { ...base, text: note, truncated: c.totalBytes > 0, returnedBytes: 0 }
    if (spillPath !== undefined) r.spillPath = spillPath
    return r
  }

  if (!c.dropped && c.totalBytes <= budget) {
    const full = Buffer.concat([c.head, c.tail]).toString('utf-8')
    return { ...base, text: full, truncated: false, returnedBytes: c.totalBytes }
  }

  const spillPath = writeSpill(c, streamName, runId, cap)
  const completeness = c.dropped
    ? `head+tail only — output exceeded the ${Math.round(cap.hardCeilingBytes / KB)}KB capture ceiling, middle lost`
    : `showing head+tail`
  const banner =
    `[${streamName} truncated: ${c.totalBytes} bytes total, ${completeness}` +
    (spillPath
      ? `. Captured output: ${spillPath} (grep/sed/head it instead of re-running).`
      : ` (spill disabled).`) +
    `]`
  const text = `${banner}\n${headTailSummary(c, budget)}`
  const r: ProcessedStream = {
    ...base,
    text,
    truncated: true,
    returnedBytes: Buffer.byteLength(text, 'utf-8'),
  }
  if (spillPath !== undefined) r.spillPath = spillPath
  return r
}

/** Reset cached per-run spill dir (used by tests). */
export function _resetSpillDir(): void {
  spillSessionDir = undefined
}
