import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InputResolver } from '../../src/input-resolver.js';
import { PAIError } from '../../src/types.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as fc from 'fast-check';

describe('InputResolver', () => {
  let resolver: InputResolver;
  let tempDir: string;

  beforeEach(async () => {
    resolver = new InputResolver();
    tempDir = await mkdtemp(join(tmpdir(), 'pai-input-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('resolveUserInput', () => {
    it('should resolve message input', async () => {
      const content = await resolver.resolveUserInput({
        message: 'Hello, world!',
      });

      expect(content).toBe('Hello, world!');
    });

    it('should resolve file input', async () => {
      const filePath = join(tempDir, 'input.txt');
      await writeFile(filePath, 'File content', 'utf-8');

      const content = await resolver.resolveUserInput({
        file: filePath,
      });

      expect(content).toBe('File content');
    });

    it('should throw error for multiple input sources', async () => {
      await expect(
        resolver.resolveUserInput({
          message: 'Hello',
          file: 'test.txt',
        })
      ).rejects.toThrow(PAIError);

      await expect(
        resolver.resolveUserInput({
          message: 'Hello',
          file: 'test.txt',
        })
      ).rejects.toMatchObject({
        exitCode: 1,
        message: expect.stringContaining('Multiple input sources'),
      });
    });

    it('should throw error for no input source', async () => {
      await expect(resolver.resolveUserInput({})).rejects.toThrow(PAIError);

      await expect(resolver.resolveUserInput({})).rejects.toMatchObject({
        exitCode: 1,
        message: expect.stringContaining('No user input'),
      });
    });

    it('should throw error for non-existent file', async () => {
      await expect(
        resolver.resolveUserInput({
          file: '/nonexistent/file.txt',
        })
      ).rejects.toThrow(PAIError);

      await expect(
        resolver.resolveUserInput({
          file: '/nonexistent/file.txt',
        })
      ).rejects.toMatchObject({
        exitCode: 4,
      });
    });

    it('should handle multimodal content with images', async () => {
      const textFile = join(tempDir, 'text.txt');
      await writeFile(textFile, 'Describe this image', 'utf-8');

      // Create a simple PNG file (1x1 transparent pixel)
      const imagePath = join(tempDir, 'test.png');
      const pngData = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
      await writeFile(imagePath, pngData);

      const content = await resolver.resolveUserInput({
        file: textFile,
        images: [imagePath],
      });

      expect(Array.isArray(content)).toBe(true);
      expect((content as any[]).length).toBe(2);
      expect((content as any[])[0].type).toBe('text');
      expect((content as any[])[1].type).toBe('image');
    });

    it('should handle multiple images', async () => {
      const imagePath1 = join(tempDir, 'test1.png');
      const imagePath2 = join(tempDir, 'test2.jpg');
      const pngData = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
      await writeFile(imagePath1, pngData);
      await writeFile(imagePath2, pngData);

      const content = await resolver.resolveUserInput({
        message: 'Compare these images',
        images: [imagePath1, imagePath2],
      });

      expect(Array.isArray(content)).toBe(true);
      expect((content as any[]).length).toBe(3); // text + 2 images
    });
  });

  describe('resolveSystemInput', () => {
    it('should return system text when provided', async () => {
      const result = await resolver.resolveSystemInput('You are helpful');

      expect(result).toBe('You are helpful');
    });

    it('should read from system file when provided', async () => {
      const filePath = join(tempDir, 'system.txt');
      await writeFile(filePath, 'System instruction from file', 'utf-8');

      const result = await resolver.resolveSystemInput(undefined, filePath);

      expect(result).toBe('System instruction from file');
    });

    it('should return undefined when neither provided', async () => {
      const result = await resolver.resolveSystemInput();

      expect(result).toBeUndefined();
    });

    it('should throw error when both text and file provided', async () => {
      await expect(
        resolver.resolveSystemInput('Text', 'file.txt')
      ).rejects.toThrow(PAIError);

      await expect(
        resolver.resolveSystemInput('Text', 'file.txt')
      ).rejects.toMatchObject({
        exitCode: 1,
        message: expect.stringContaining('Multiple system instruction sources'),
      });
    });

    it('should throw error for non-existent system file', async () => {
      await expect(
        resolver.resolveSystemInput(undefined, '/nonexistent/system.txt')
      ).rejects.toThrow(PAIError);

      await expect(
        resolver.resolveSystemInput(undefined, '/nonexistent/system.txt')
      ).rejects.toMatchObject({
        exitCode: 4,
      });
    });
  });
});

  // Property-Based Tests
  describe('Property-Based Tests', () => {
    // Feature: pai-cli-tool, Property 16: Input Source Mutual Exclusivity
    it('should reject multiple input sources', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            message: fc.string({ minLength: 1 }),
            file: fc.string({ minLength: 1 }),
          }),
          async (source) => {
            const resolver = new InputResolver();

            // Property: Multiple sources must throw PAIError with exit code 1
            await expect(resolver.resolveUserInput(source)).rejects.toThrow(PAIError);
            await expect(resolver.resolveUserInput(source)).rejects.toMatchObject({
              exitCode: 1,
              message: expect.stringContaining('Multiple input sources'),
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject message + stdin combination', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1 }),
          async (message) => {
            const resolver = new InputResolver();

            // Property: message + stdin must throw error
            await expect(
              resolver.resolveUserInput({ message, stdin: true })
            ).rejects.toThrow(PAIError);
            
            await expect(
              resolver.resolveUserInput({ message, stdin: true })
            ).rejects.toMatchObject({
              exitCode: 1,
            });
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should reject file + stdin combination', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1 }),
          async (file) => {
            const resolver = new InputResolver();

            // Property: file + stdin must throw error
            await expect(
              resolver.resolveUserInput({ file, stdin: true })
            ).rejects.toThrow(PAIError);
            
            await expect(
              resolver.resolveUserInput({ file, stdin: true })
            ).rejects.toMatchObject({
              exitCode: 1,
            });
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should accept single input source', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 100 }),
          async (message) => {
            const resolver = new InputResolver();

            // Property: Single source should work
            const result = await resolver.resolveUserInput({ message });
            expect(result).toBe(message);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
