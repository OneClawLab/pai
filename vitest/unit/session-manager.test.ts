import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../../src/session-manager.js';
import { PAIError } from '../../src/types.js';
import type { Message } from '../../src/types.js';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as fc from 'fast-check';

describe('SessionManager', () => {
  let tempDir: string;
  let sessionPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pai-session-test-'));
    sessionPath = join(tempDir, 'session.jsonl');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('loadMessages', () => {
    it('should return empty array when file does not exist', async () => {
      const manager = new SessionManager(sessionPath);
      const messages = await manager.loadMessages();

      expect(messages).toEqual([]);
    });

    it('should return empty array when no session path provided', async () => {
      const manager = new SessionManager();
      const messages = await manager.loadMessages();

      expect(messages).toEqual([]);
    });

    it('should load valid JSONL file', async () => {
      const testMessages = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const lines = testMessages.map((msg) => JSON.stringify(msg)).join('\n');
      await writeFile(sessionPath, lines, 'utf-8');

      const manager = new SessionManager(sessionPath);
      const messages = await manager.loadMessages();

      expect(messages).toHaveLength(3);
      expect(messages[0]?.role).toBe('system');
      expect(messages[1]?.role).toBe('user');
      expect(messages[2]?.role).toBe('assistant');
    });

    it('should handle multimodal content (object)', async () => {
      const testMessage = {
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image', data: 'base64data' },
        ],
      };

      await writeFile(sessionPath, JSON.stringify(testMessage), 'utf-8');

      const manager = new SessionManager(sessionPath);
      const messages = await manager.loadMessages();

      expect(messages).toHaveLength(1);
      expect(Array.isArray(messages[0]?.content)).toBe(true);
    });

    it('should skip empty lines', async () => {
      const content = `{"role":"user","content":"Hello"}\n\n{"role":"assistant","content":"Hi"}\n`;
      await writeFile(sessionPath, content, 'utf-8');

      const manager = new SessionManager(sessionPath);
      const messages = await manager.loadMessages();

      expect(messages).toHaveLength(2);
    });

    it('should throw PAIError with exit code 4 for malformed JSON', async () => {
      await writeFile(sessionPath, '{ invalid json }\n', 'utf-8');

      const manager = new SessionManager(sessionPath);

      await expect(manager.loadMessages()).rejects.toThrow(PAIError);
      await expect(manager.loadMessages()).rejects.toMatchObject({
        exitCode: 4,
        message: expect.stringContaining('Malformed JSONL'),
      });
    });

    it('should throw PAIError with exit code 4 for missing required fields', async () => {
      await writeFile(sessionPath, '{"content":"Hello"}\n', 'utf-8');

      const manager = new SessionManager(sessionPath);

      await expect(manager.loadMessages()).rejects.toThrow(PAIError);
      await expect(manager.loadMessages()).rejects.toMatchObject({
        exitCode: 4,
        message: expect.stringContaining('Malformed JSONL'),
      });
    });

    it('should include line number in error message', async () => {
      const content = `{"role":"user","content":"Hello"}\n{ invalid }\n`;
      await writeFile(sessionPath, content, 'utf-8');

      const manager = new SessionManager(sessionPath);

      await expect(manager.loadMessages()).rejects.toMatchObject({
        message: expect.stringContaining('line 2'),
      });
    });
  });

  describe('appendMessage', () => {
    it('should create file and append message', async () => {
      const manager = new SessionManager(sessionPath);
      const message: Message = { role: 'user', content: 'Hello' };

      await manager.appendMessage(message);

      const content = await readFile(sessionPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]!);
      expect(parsed.role).toBe('user');
      expect(parsed.content).toBe('Hello');
    });

    it('should append to existing file', async () => {
      const manager = new SessionManager(sessionPath);

      await manager.appendMessage({ role: 'user', content: 'First' });
      await manager.appendMessage({ role: 'assistant', content: 'Second' });

      const messages = await manager.loadMessages();
      expect(messages).toHaveLength(2);
    });

    it('should add timestamp if not present', async () => {
      const manager = new SessionManager(sessionPath);
      const message: Message = { role: 'user', content: 'Hello' };

      await manager.appendMessage(message);

      const content = await readFile(sessionPath, 'utf-8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.timestamp).toBeDefined();
      expect(typeof parsed.timestamp).toBe('string');
    });

    it('should preserve existing timestamp', async () => {
      const manager = new SessionManager(sessionPath);
      const timestamp = '2024-01-01T00:00:00.000Z';
      const message: Message = {
        role: 'user',
        content: 'Hello',
        timestamp,
      };

      await manager.appendMessage(message);

      const content = await readFile(sessionPath, 'utf-8');
      const parsed = JSON.parse(content.trim());

      expect(parsed.timestamp).toBe(timestamp);
    });

    it('should do nothing when no session path provided', async () => {
      const manager = new SessionManager();
      await manager.appendMessage({ role: 'user', content: 'Hello' });

      // Should not throw error
      expect(true).toBe(true);
    });

    it('should handle multimodal content', async () => {
      const manager = new SessionManager(sessionPath);
      const message: Message = {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'image', data: 'base64' },
        ],
      };

      await manager.appendMessage(message);

      const messages = await manager.loadMessages();
      expect(messages).toHaveLength(1);
      expect(Array.isArray(messages[0]?.content)).toBe(true);
    });
  });

  describe('appendMessages', () => {
    it('should append multiple messages', async () => {
      const manager = new SessionManager(sessionPath);
      const messages: Message[] = [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Second' },
        { role: 'user', content: 'Third' },
      ];

      await manager.appendMessages(messages);

      const loaded = await manager.loadMessages();
      expect(loaded).toHaveLength(3);
    });

    it('should add timestamps to all messages', async () => {
      const manager = new SessionManager(sessionPath);
      const messages: Message[] = [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Second' },
      ];

      await manager.appendMessages(messages);

      const loaded = await manager.loadMessages();
      expect(loaded[0]?.timestamp).toBeDefined();
      expect(loaded[1]?.timestamp).toBeDefined();
    });

    it('should do nothing for empty array', async () => {
      const manager = new SessionManager(sessionPath);
      await manager.appendMessages([]);

      const messages = await manager.loadMessages();
      expect(messages).toEqual([]);
    });

    it('should do nothing when no session path provided', async () => {
      const manager = new SessionManager();
      await manager.appendMessages([{ role: 'user', content: 'Hello' }]);

      // Should not throw error
      expect(true).toBe(true);
    });
  });

  describe('getSessionPath', () => {
    it('should return session path when provided', () => {
      const manager = new SessionManager(sessionPath);
      expect(manager.getSessionPath()).toBe(sessionPath);
    });

    it('should return undefined when no path provided', () => {
      const manager = new SessionManager();
      expect(manager.getSessionPath()).toBeUndefined();
    });
  });
});

  // Property-Based Tests
  describe('Property-Based Tests', () => {
    // Custom generators for message content
    const messageContentGen = fc.oneof(
      fc.string(), // Simple string content
      fc.array(
        fc.record({
          type: fc.constantFrom('text', 'image'),
          text: fc.option(fc.string(), { nil: undefined }),
          data: fc.option(fc.string(), { nil: undefined }),
        }),
        { minLength: 1, maxLength: 3 }
      ) // Multimodal content
    );

    const messageGen = fc.record({
      role: fc.constantFrom('system', 'user', 'assistant', 'tool'),
      content: messageContentGen,
      name: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
      tool_call_id: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
      timestamp: fc.option(
        fc.integer({ min: 1577836800000, max: 1893456000000 }) // 2020-2030 in ms
          .map(ms => new Date(ms).toISOString()),
        { nil: undefined }
      ),
    });

    // Feature: pai-cli-tool, Property 13: Session File JSONL Format
    it('should write messages as valid JSONL with role and content fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(messageGen, { minLength: 1, maxLength: 10 }),
          async (messages) => {
            const testDir = await mkdtemp(join(tmpdir(), 'pai-pbt-'));
            const testPath = join(testDir, 'session.jsonl');

            try {
              const manager = new SessionManager(testPath);

              // Append all messages
              await manager.appendMessages(messages);

              // Read file content
              const content = await readFile(testPath, 'utf-8');
              const lines = content.trim().split('\n');

              // Property: Each line must be valid JSON
              for (const line of lines) {
                const parsed = JSON.parse(line); // Should not throw
                
                // Property: Must have role and content fields
                expect(parsed).toHaveProperty('role');
                expect(parsed).toHaveProperty('content');
                expect(['system', 'user', 'assistant', 'tool']).toContain(parsed.role);
              }

              // Property: Number of lines should match number of messages
              expect(lines).toHaveLength(messages.length);
            } finally {
              await rm(testDir, { recursive: true, force: true });
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    // Feature: pai-cli-tool, Property 15: Multimodal Content Round-Trip
    it('should preserve multimodal content structure through write/read round-trip', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(messageGen, { minLength: 1, maxLength: 10 }),
          async (messages) => {
            const testDir = await mkdtemp(join(tmpdir(), 'pai-pbt-'));
            const testPath = join(testDir, 'session.jsonl');

            try {
              const manager = new SessionManager(testPath);

              // Write messages
              await manager.appendMessages(messages);

              // Read messages back
              const loaded = await manager.loadMessages();

              // Property: Number of messages should be preserved
              expect(loaded).toHaveLength(messages.length);

              // Property: Content structure should be preserved
              for (let i = 0; i < messages.length; i++) {
                const original = messages[i];
                const loadedMsg = loaded[i];

                expect(loadedMsg?.role).toBe(original?.role);
                
                // Content should be deeply equal
                if (typeof original?.content === 'string') {
                  expect(loadedMsg?.content).toBe(original.content);
                } else if (Array.isArray(original?.content)) {
                  expect(Array.isArray(loadedMsg?.content)).toBe(true);
                  expect(loadedMsg?.content).toEqual(original.content);
                } else {
                  expect(loadedMsg?.content).toEqual(original?.content);
                }

                // Optional fields should be preserved if present
                if (original?.name !== undefined) {
                  expect(loadedMsg?.name).toBe(original.name);
                }
                if (original?.tool_call_id !== undefined) {
                  expect(loadedMsg?.tool_call_id).toBe(original.tool_call_id);
                }
              }
            } finally {
              await rm(testDir, { recursive: true, force: true });
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    // Feature: pai-cli-tool, Property 14: Malformed Session Error Handling
    it('should throw PAIError with exit code 4 for malformed JSONL', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.constant('{ invalid json }'),
            fc.constant('{"role":"user"}'), // Missing content
            fc.constant('{"content":"hello"}'), // Missing role
            fc.string().filter(s => {
              try {
                JSON.parse(s);
                return false;
              } catch {
                return s.length > 0;
              }
            })
          ),
          async (malformedLine) => {
            const testDir = await mkdtemp(join(tmpdir(), 'pai-pbt-'));
            const testPath = join(testDir, 'session.jsonl');

            try {
              // Write malformed content
              await writeFile(testPath, malformedLine + '\n', 'utf-8');

              const manager = new SessionManager(testPath);

              // Property: Should throw PAIError with exit code 4
              await expect(manager.loadMessages()).rejects.toThrow(PAIError);
              await expect(manager.loadMessages()).rejects.toMatchObject({
                exitCode: 4,
              });
            } finally {
              await rm(testDir, { recursive: true, force: true });
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
