import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Message, ExitCode } from './types.js';
import { PAIError } from './types.js';

export class SessionManager {
  private sessionPath?: string;

  constructor(sessionPath?: string) {
    this.sessionPath = sessionPath;
  }

  /**
   * Load messages from session file
   * Returns empty array if file doesn't exist
   */
  async loadMessages(): Promise<Message[]> {
    if (!this.sessionPath || !existsSync(this.sessionPath)) {
      return [];
    }

    try {
      const messages: Message[] = [];
      const fileStream = createReadStream(this.sessionPath, 'utf-8');
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      let lineNumber = 0;
      for await (const line of rl) {
        lineNumber++;
        
        // Skip empty lines
        if (line.trim() === '') {
          continue;
        }

        try {
          const message = JSON.parse(line) as Message;

          // Validate required fields
          if (!message.role || message.content === undefined) {
            throw new Error('Missing required fields: role and content');
          }

          messages.push(message);
        } catch (error) {
          throw new PAIError(
            `Malformed JSONL at line ${lineNumber}`,
            4 as ExitCode,
            {
              path: this.sessionPath,
              line: lineNumber,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }

      return messages;
    } catch (error) {
      if (error instanceof PAIError) {
        throw error;
      }

      throw new PAIError(
        'Failed to read session file',
        4 as ExitCode,
        { path: this.sessionPath, error: String(error) }
      );
    }
  }

  /**
   * Append a single message to session file
   * Creates file if it doesn't exist
   */
  async appendMessage(message: Message): Promise<void> {
    if (!this.sessionPath) {
      return;
    }

    // Add timestamp if not present
    if (!message.timestamp) {
      message.timestamp = new Date().toISOString();
    }

    try {
      const line = JSON.stringify(message) + '\n';

      if (existsSync(this.sessionPath)) {
        await appendFile(this.sessionPath, line, 'utf-8');
      } else {
        await writeFile(this.sessionPath, line, 'utf-8');
      }
    } catch (error) {
      throw new PAIError(
        'Failed to write to session file',
        4 as ExitCode,
        { path: this.sessionPath, error: String(error) }
      );
    }
  }

  /**
   * Append multiple messages to session file
   * TODO: Implement atomic write for concurrent access
   */
  async appendMessages(messages: Message[]): Promise<void> {
    if (!this.sessionPath || messages.length === 0) {
      return;
    }

    // Add timestamps to messages without them
    const timestampedMessages = messages.map((msg) => ({
      ...msg,
      timestamp: msg.timestamp || new Date().toISOString(),
    }));

    try {
      const lines = timestampedMessages.map((msg) => JSON.stringify(msg)).join('\n') + '\n';

      if (existsSync(this.sessionPath)) {
        await appendFile(this.sessionPath, lines, 'utf-8');
      } else {
        await writeFile(this.sessionPath, lines, 'utf-8');
      }
    } catch (error) {
      throw new PAIError(
        'Failed to write to session file',
        4 as ExitCode,
        { path: this.sessionPath, error: String(error) }
      );
    }
  }

  /**
   * Get the session file path
   */
  getSessionPath(): string | undefined {
    return this.sessionPath;
  }
}
