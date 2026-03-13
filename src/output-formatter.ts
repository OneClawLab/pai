import { appendFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { OutputEvent, ExitCode } from './types.js';
import { PAIError } from './types.js';

/**
 * Handles output formatting for stdout/stderr
 */
export class OutputFormatter {
  private jsonMode: boolean;
  private quietMode: boolean;
  private logFile: string | undefined;

  constructor(jsonMode: boolean = false, quietMode: boolean = false, logFile?: string) {
    this.jsonMode = jsonMode;
    this.quietMode = quietMode;
    this.logFile = logFile;
  }

  /**
   * Write model output to stdout
   * Always writes to stdout regardless of mode
   */
  writeModelOutput(content: string): void {
    process.stdout.write(content);

    // Also append to log file if specified
    if (this.logFile) {
      this.appendToLog('assistant', content).catch(() => {
        // Silently fail log writes to not interrupt main flow
      });
    }
  }

  /**
   * Write progress/diagnostic information to stderr
   */
  writeProgress(event: OutputEvent): void {
    // Skip if quiet mode
    if (this.quietMode) return;

    if (this.jsonMode) {
      this.writeNDJSON(event);
    } else {
      this.writeHumanReadable(event);
    }
  }

  /**
   * Write error to stderr
   */
  writeError(error: Error | PAIError): void {
    if (this.jsonMode) {
      const errorObj = {
        type: 'error',
        message: error.message,
        ...(error instanceof PAIError && error.context ? { context: error.context } : {}),
      };
      process.stderr.write(JSON.stringify(errorObj) + '\n');
    } else {
      process.stderr.write(`Error: ${error.message}\n`);
      if (error instanceof PAIError && error.context) {
        process.stderr.write(`Context: ${JSON.stringify(error.context)}\n`);
      }
    }
  }

  /**
   * Write NDJSON event to stderr
   */
  private writeNDJSON(event: OutputEvent): void {
    const line = JSON.stringify({
      ...event,
      timestamp: event.timestamp || Date.now(),
    });
    process.stderr.write(line + '\n');
  }

  /**
   * Write human-readable event to stderr
   */
  private writeHumanReadable(event: OutputEvent): void {
    switch (event.type) {
      case 'start': {
        const d = event.data;
        const parts = [`Starting request (${d.provider || '?'}/${d.model || '?'}`];
        if (d.messages) parts.push(`${d.messages} msgs`);
        if (d.tools) parts.push(`${d.tools} tools`);
        if (d.stream) parts.push('stream');
        process.stderr.write(parts.join(', ') + ')...\n');
        break;
      }
      case 'chunk':
        // Don't output individual chunks in human mode
        break;
      case 'tool_call':
        process.stderr.write(`Tool call: ${JSON.stringify(event.data)}\n`);
        break;
      case 'tool_result':
        process.stderr.write(`Tool result: ${JSON.stringify(event.data)}\n`);
        break;
      case 'complete': {
        const d = event.data;
        const parts = ['Request complete'];
        if (d.finishReason) parts.push(`reason=${d.finishReason}`);
        if (d.usage) parts.push(`tokens: in=${d.usage.input} out=${d.usage.output}`);
        process.stderr.write(parts.join(', ') + '.\n');
        break;
      }
      case 'error':
        process.stderr.write(`Error: ${event.data}\n`);
        break;
    }
  }

  /**
   * Append to log file in Markdown format
   */
  private async appendToLog(role: string, content: string): Promise<void> {
    if (!this.logFile) return;

    try {
      const timestamp = new Date().toISOString();
      const entry = `\n### ${role.charAt(0).toUpperCase() + role.slice(1)} (${timestamp})\n\n${content}\n`;

      if (existsSync(this.logFile)) {
        await appendFile(this.logFile, entry, 'utf-8');
      } else {
        const header = `# Chat Log\n\nGenerated: ${timestamp}\n`;
        await writeFile(this.logFile, header + entry, 'utf-8');
      }
    } catch (error) {
      throw new PAIError(
        'Failed to write to log file',
        4 as ExitCode,
        { path: this.logFile, error: String(error) }
      );
    }
  }

  /**
   * Log user message
   */
  async logUserMessage(content: string): Promise<void> {
    if (this.logFile) {
      await this.appendToLog('user', content).catch(() => {
        // Silently fail
      });
    }
  }

  /**
   * Log system message
   */
  async logSystemMessage(content: string): Promise<void> {
    if (this.logFile) {
      await this.appendToLog('system', content).catch(() => {
        // Silently fail
      });
    }
  }

  /**
   * Log request summary (provider, model, parameters)
   */
  async logRequestSummary(info: { provider: string; model: string; temperature?: number | undefined; maxTokens?: number | undefined; stream?: boolean | undefined }): Promise<void> {
    if (this.logFile) {
      const lines = [
        `Provider: ${info.provider}`,
        `Model: ${info.model}`,
      ];
      if (info.temperature !== undefined) lines.push(`Temperature: ${info.temperature}`);
      if (info.maxTokens !== undefined) lines.push(`Max Tokens: ${info.maxTokens}`);
      if (info.stream) lines.push(`Stream: true`);
      await this.appendToLog('request', lines.join('\n')).catch(() => {});
    }
  }

  /**
   * Log tool call
   */
  async logToolCall(name: string, args: any): Promise<void> {
    if (this.logFile) {
      const content = `**Tool:** ${name}\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\``;
      await this.appendToLog('tool_call', content).catch(() => {});
    }
  }

  /**
   * Log tool result
   */
  async logToolResult(name: string, result: any): Promise<void> {
    if (this.logFile) {
      const content = `**Tool:** ${name}\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
      await this.appendToLog('tool_result', content).catch(() => {});
    }
  }

  /**
   * Log error
   */
  async logError(error: Error | PAIError): Promise<void> {
    if (this.logFile) {
      const detail = error instanceof PAIError && error.context
        ? `\n\nContext: ${JSON.stringify(error.context)}`
        : '';
      await this.appendToLog('error', `${error.message}${detail}`).catch(() => {});
    }
  }
}
