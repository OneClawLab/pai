import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname, isAbsolute } from 'node:path'
import type { Tool } from '../types.js'

export interface FileWriteArgs {
  path: string
  content: string
  mode?: 'write' | 'append'
  cwd?: string
  encoding?: 'utf-8'
  comment: string
}

export interface FileWriteResult {
  path: string
  mode: 'write' | 'append'
  bytesWritten: number
  totalLines: number
  tail3: string
}

const FILE_WRITE_TOOL_DESC = `
Write or append text content to a file. Use this instead of bash heredoc for all file writing.

Advantages over heredoc:
- Content is passed as a plain string — no shell escaping needed
- Safe for markdown, source code, JSON, and any content with special characters
- Built-in verification: returns line count and tail after every write

## Parameters
- path: File path. Relative paths are resolved against cwd (if provided) or process.cwd().
- content: The text content to write. No escaping needed — write exactly what you want in the file.
- mode: "write" (default) overwrites the file; "append" adds to the end.
- cwd: Working directory for resolving relative paths. Set this to the project root.
- encoding: File encoding. Default: "utf-8".
- comment: Brief note on what and why (for audit trail).

## Splitting large files
When content exceeds ~150 lines, split into chunks:
1. First chunk: mode="write"
2. Subsequent chunks: mode="append"
The returned totalLines and tail3 confirm each chunk landed correctly.
`.trim()

/**
 * Create file_write tool — writes/appends text files without shell escaping.
 * Registered alongside bash_exec in ToolRegistry.
 */
export function createFileWriteTool(): Tool {
  return {
    name: 'file_write',
    description: FILE_WRITE_TOOL_DESC,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to write. Relative paths resolved against cwd.',
        },
        content: {
          type: 'string',
          description: 'Text content to write. No shell escaping needed.',
        },
        mode: {
          type: 'string',
          enum: ['write', 'append'],
          description: 'Write mode: "write" (overwrite/create) or "append". Default: "write".',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for resolving relative paths.',
        },
        encoding: {
          type: 'string',
          enum: ['utf-8'],
          description: 'File encoding. Default: "utf-8".',
        },
        comment: {
          type: 'string',
          description: 'Brief note on what is being written and why.',
        },
      },
      required: ['path', 'content', 'comment'],
    },
    handler: async (args: FileWriteArgs): Promise<FileWriteResult> => {
      const mode = args.mode ?? 'write'
      const base = args.cwd
        ? (isAbsolute(args.cwd) ? args.cwd : resolve(process.cwd(), args.cwd))
        : process.cwd()

      const filePath = isAbsolute(args.path)
        ? args.path
        : resolve(base, args.path)

      // Ensure parent directory exists
      const dir = dirname(filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      const content = args.content
      const buf = Buffer.from(content, 'utf-8')

      if (mode === 'append') {
        appendFileSync(filePath, content, 'utf-8')
      } else {
        writeFileSync(filePath, content, 'utf-8')
      }

      // Read back for verification
      const written = readFileSync(filePath, 'utf-8')
      const lines = written.split('\n')
      // Remove trailing empty line from final newline for accurate count
      const totalLines = lines.length > 0 && lines[lines.length - 1] === ''
        ? lines.length - 1
        : lines.length

      const tail3 = lines
        .slice(Math.max(0, lines.length - (lines[lines.length - 1] === '' ? 4 : 3)), lines.length - (lines[lines.length - 1] === '' ? 1 : 0))
        .join('\n')

      return {
        path: filePath,
        mode,
        bytesWritten: buf.byteLength,
        totalLines,
        tail3,
      }
    },
  }
}
