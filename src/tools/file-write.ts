import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname, isAbsolute } from 'node:path'
import type { Tool } from '../types.js'

export interface FileWriteArgs {
  path: string
  content: string
  mode: 'write' | 'append'
  cwd?: string
  encoding?: 'utf-8'
  comment: string
}

export interface FileWriteResult {
  path: string
  mode: 'write' | 'append'
  bytesWritten: number
  totalLines: number
  tail: string
  tailMode: 'last3lines' | 'last50chars'
}

const FILE_WRITE_TOOL_DESC = `
Write or append text to a file. Prefer this over bash heredoc — no shell escaping needed.

- path: file path. Use absolute path, or relative + cwd together.
- cwd: required when path is relative. Must be an absolute path.
- mode: "write" (overwrite/create) or "append".
- content: exact text to write. No escaping needed.
- comment: brief note for audit trail.

Returns totalLines, tail, and tailMode after every write — no separate verification needed.

For files >150 lines, split into chunks: first chunk mode="write", rest mode="append".
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
          description: '"write" to overwrite/create, "append" to add to end.',
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
      required: ['path', 'mode', 'content', 'comment'],
    },
    handler: async (args: FileWriteArgs): Promise<FileWriteResult> => {
      const mode = args.mode

      if (!isAbsolute(args.path) && !args.cwd) {
        throw new Error('cwd is required when path is relative. Provide an absolute cwd or use an absolute path.')
      }

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

      // Tail: take whichever is smaller — last 3 lines or last 50 chars
      const trimmed = written.endsWith('\n') ? written.slice(0, -1) : written
      const last3Lines = lines
        .slice(Math.max(0, lines.length - (written.endsWith('\n') ? 4 : 3)),
               written.endsWith('\n') ? lines.length - 1 : lines.length)
        .join('\n')
      const last50Chars = trimmed.slice(-50)
      const useLast3 = last3Lines.length <= last50Chars.length
      const tail = useLast3 ? last3Lines : last50Chars
      const tailMode = useLast3 ? 'last3lines' : 'last50chars'

      return {
        path: filePath,
        mode,
        bytesWritten: buf.byteLength,
        totalLines,
        tail,
        tailMode,
      }
    },
  }
}
