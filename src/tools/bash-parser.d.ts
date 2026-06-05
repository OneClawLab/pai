/**
 * Minimal ambient type declarations for the `bash-parser` package (v0.5.0),
 * which ships no `.d.ts` of its own and has no `@types/bash-parser`.
 *
 * Only the subset of the AST we actually traverse is typed here. The shapes
 * were derived empirically from the parser output (see bash-danger.ts).
 * Unknown node kinds are tolerated via the index signature on AstNode.
 */
declare module 'bash-parser' {
  /** A parsed word token. `text` is the literal source slice. */
  export interface Word {
    type: 'Word' | 'Name'
    text: string
    /** Present when the word contains $VAR / ${VAR} / $(...) expansions. */
    expansion?: Array<{ type: string; parameter?: string; loc?: { start: number; end: number } }>
  }

  /** A redirection operator node found inside a Command's `suffix`/`prefix`. */
  export interface Redirect {
    type: 'Redirect'
    op: { text: string; type: string }
    file: Word
    numberIo?: { text: string; type: string }
  }

  /** A simple command: `name suffix...`. */
  export interface Command {
    type: 'Command'
    name?: Word
    prefix?: Array<Word | Redirect>
    suffix?: Array<Word | Redirect>
  }

  /** Any AST node. Concrete kinds are narrowed structurally in traversal. */
  export interface AstNode {
    type: string
    [key: string]: unknown
  }

  export interface Script {
    type: 'Script'
    commands: AstNode[]
  }

  export interface ParseOptions {
    mode?: string
    insertLOC?: boolean
  }

  /** Parse a bash command string into an AST. Throws on syntax errors. */
  export default function parse(sourceCode: string, options?: ParseOptions): Script
}
