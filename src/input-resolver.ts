import { readFile } from 'node:fs/promises';
import type { InputSource, MessageContent, ExitCode } from './types.js';
import { PAIError } from './types.js';

/**
 * Resolves user input from various sources
 */
export class InputResolver {
  /**
   * Resolve user input from message/stdin/file/images
   * Validates mutual exclusivity of input sources
   */
  async resolveUserInput(source: InputSource): Promise<MessageContent> {
    const sourceCount = [
      source.message !== undefined,
      source.stdin === true,
      source.file !== undefined,
    ].filter(Boolean).length;

    if (sourceCount > 1) {
      throw new PAIError(
        'Multiple input sources specified',
        1 as ExitCode,
        { message: 'Cannot use both positional argument and --input-file or stdin' }
      );
    }

    if (sourceCount === 0) {
      throw new PAIError(
        'No user input provided',
        1 as ExitCode,
        { message: 'Provide input via argument, stdin, or --input-file' }
      );
    }

    let textContent: string;

    // Resolve text content
    if (source.message !== undefined) {
      textContent = source.message;
    } else if (source.stdin) {
      textContent = await this.readStdin();
    } else if (source.file) {
      textContent = await this.readFile(source.file);
    } else {
      throw new PAIError('No input source available', 1 as ExitCode);
    }

    // Handle multimodal content (text + images)
    if (source.images && source.images.length > 0) {
      const content: any[] = [{ type: 'text', text: textContent }];

      for (const imagePath of source.images) {
        const imageData = await this.readImage(imagePath);
        content.push(imageData);
      }

      return content;
    }

    return textContent;
  }

  /**
   * Resolve system instruction from text or file
   */
  async resolveSystemInput(
    systemText?: string,
    systemFile?: string
  ): Promise<string | undefined> {
    if (systemText && systemFile) {
      throw new PAIError(
        'Multiple system instruction sources specified',
        2 as ExitCode,
        { message: 'Cannot use both --system and --system-file' }
      );
    }

    if (systemFile) {
      return await this.readFile(systemFile);
    }

    return systemText;
  }

  /**
   * Read from stdin
   */
  private async readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';

      process.stdin.setEncoding('utf-8');

      process.stdin.on('data', (chunk) => {
        data += chunk;
      });

      process.stdin.on('end', () => {
        resolve(data);
      });

      process.stdin.on('error', (error) => {
        reject(
          new PAIError(
            'Failed to read from stdin',
            4 as ExitCode,
            { error: String(error) }
          )
        );
      });
    });
  }

  /**
   * Read file content
   */
  private async readFile(path: string): Promise<string> {
    try {
      return await readFile(path, 'utf-8');
    } catch (error) {
      throw new PAIError(
        'Failed to read file',
        4 as ExitCode,
        { path, error: String(error) }
      );
    }
  }

  /**
   * Read image file and encode for pi-ai
   */
  private async readImage(path: string): Promise<object> {
    try {
      const buffer = await readFile(path);
      const base64Data = buffer.toString('base64');

      // Determine mime type from extension
      const ext = path.toLowerCase().split('.').pop();
      let mimeType = 'image/jpeg';

      if (ext === 'png') mimeType = 'image/png';
      else if (ext === 'gif') mimeType = 'image/gif';
      else if (ext === 'webp') mimeType = 'image/webp';

      return {
        type: 'image',
        data: base64Data,
        mimeType,
      };
    } catch (error) {
      throw new PAIError(
        'Failed to read image file',
        4 as ExitCode,
        { path, error: String(error) }
      );
    }
  }
}
