/**
 * bash-output.ts — large-output truncation + spill-to-file for bash_exec.
 *
 * Problem: a single command can emit megabytes of stdout (cat a big file,
 * verbose build logs, an infinite `yes`). Returning all of it to the LLM
 * burns the token budget and can blow up the session.
 *
 * Strategy: cap the bytes returned to the model. When output exceeds the cap,
 * spill the COMPLETE output to a temp file and return only a summary — the
 * head and tail of the stream (whichever bound, bytes or lines, is smaller)
 * plus the total line/byte counts and the spill path. The model can then
 * `grep`/`sed` the spill file to retrieve whatever it actually needs.
 */

import { mkdtempSync, writeFileSync } from '../repo-utils/fs.js'
import { path } from '../repo-utils/path.js'
import { tmpdir } from 'node:os'

export interface OutputCapConfig {
  /** Max bytes returned to the LLM per stream. Default: 8192. */
  maxBytesReturned: number
  /** Max lines returned to the LLM per stream. Default: 200. */
  maxLinesReturned: number
  /** When true, spill the full output to a file when truncated. Default: true. */
  spillToFile: boolean
  /** Directory for spill files. Default: os tmpdir. */
  spillDir?: string
}

export const DEFAULT_OUTPUT_CAP: OutputCapConfig = {
  maxBytesReturned: 8 * 1024,
  maxLinesReturned: 200,
  spillToFile: true,
}

export interface ProcessedStream {
  /** The (possibly truncated) text to hand back to the LLM. */
  text: string
  truncated: boolean
  totalBytes: number
  totalLines: number
  returnedBytes: number
  /** Absolute POSIX path to the full output, when spilled. */
  spillPath?: string
}

function countLines(s: string): number {
  if (s.length === 0) return 0
  let n = 0
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++
  // Count a final partial line (no trailing newline) as a line too.
  if (s.charCodeAt(s.length - 1) !== 10) n++
  return n
}

/**
 * Build a head+tail summary of `full` that fits within the byte/line caps.
 * Uses whichever bound (bytes or lines) yields the smaller summary, so a few
 * very long lines are capped by bytes and many short lines are capped by lines.
 */
export function summarizeOutput(full: string, cap: OutputCapConfig): string {
  const lines = full.split('\n')
  const halfLines = Math.max(1, Math.floor(cap.maxLinesReturned / 2))

  // Line-bounded head/tail.
  const headLines = lines.slice(0, halfLines).join('\n')
  const tailLines = lines.slice(Math.max(halfLines, lines.length - halfLines)).join('\n')

  // Byte-bounded head/tail.
  const halfBytes = Math.max(1, Math.floor(cap.maxBytesReturned / 2))
  const buf = Buffer.from(full, 'utf-8')
  const headBytes = buf.subarray(0, halfBytes).toString('utf-8')
  const tailBytes = buf.subarray(Math.max(halfBytes, buf.length - halfBytes)).toString('utf-8')

  const lineSummary = `${headLines}\n... [omitted middle] ...\n${tailLines}`
  const byteSummary = `${headBytes}\n... [omitted middle] ...\n${tailBytes}`

  // Pick the smaller; this respects the tighter of the two caps.
  return byteSummary.length <= lineSummary.length ? byteSummary : lineSummary
}

let spillSessionDir: string | undefined

/** Lazily create one spill directory per process run. */
function getSpillDir(cap: OutputCapConfig): string {
  if (cap.spillDir) return cap.spillDir
  if (!spillSessionDir) {
    spillSessionDir = mkdtempSync(path.join(path.toPosixPath(tmpdir()), 'pai-bash-out-'))
  }
  return spillSessionDir
}

/**
 * Apply the output cap to a single stream.
 *
 * If `full` is within both caps, returns it unchanged (`truncated: false`).
 * Otherwise spills the complete text to a file (when enabled) and returns a
 * head+tail summary annotated with totals and the spill path.
 */
export function processStream(
  full: string,
  streamName: 'stdout' | 'stderr',
  runId: string,
  cap: OutputCapConfig,
): ProcessedStream {
  const totalBytes = Buffer.byteLength(full, 'utf-8')
  const totalLines = countLines(full)

  const withinBytes = totalBytes <= cap.maxBytesReturned
  const withinLines = totalLines <= cap.maxLinesReturned
  if (withinBytes && withinLines) {
    return { text: full, truncated: false, totalBytes, totalLines, returnedBytes: totalBytes }
  }

  let spillPath: string | undefined
  if (cap.spillToFile) {
    try {
      const dir = getSpillDir(cap)
      const file = path.join(dir, `${runId}.${streamName}.txt`)
      writeFileSync(file, full, 'utf-8')
      spillPath = file
    } catch {
      spillPath = undefined // spill is best-effort; summary is still returned
    }
  }

  const summary = summarizeOutput(full, cap)
  const banner =
    `[${streamName} truncated: ${totalLines} lines / ${totalBytes} bytes total, ` +
    `showing head+tail` +
    (spillPath ? `. Full output: ${spillPath} (use grep/sed/head to read it).` : ` (spill disabled).`) +
    `]`

  const text = `${banner}\n${summary}`
  const result: ProcessedStream = {
    text,
    truncated: true,
    totalBytes,
    totalLines,
    returnedBytes: Buffer.byteLength(text, 'utf-8'),
  }
  if (spillPath !== undefined) result.spillPath = spillPath
  return result
}

/** Reset cached per-run spill dir (used by tests). */
export function _resetSpillDir(): void {
  spillSessionDir = undefined
}
