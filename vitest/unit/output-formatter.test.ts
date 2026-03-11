import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OutputFormatter } from '../../src/output-formatter.js';
import { PAIError } from '../../src/types.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as fc from 'fast-check';

describe('OutputFormatter', () => {
  let tempDir: string;
  let stdoutSpy: any;
  let stderrSpy: any;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pai-output-test-'));
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  describe('writeModelOutput', () => {
    it('should write to stdout', () => {
      const formatter = new OutputFormatter();
      formatter.writeModelOutput('Hello, world!');

      expect(stdoutSpy).toHaveBeenCalledWith('Hello, world!');
    });

    it('should write to stdout in JSON mode', () => {
      const formatter = new OutputFormatter(true);
      formatter.writeModelOutput('Test output');

      expect(stdoutSpy).toHaveBeenCalledWith('Test output');
    });

    it('should write to log file when specified', async () => {
      const logPath = join(tempDir, 'test.log');
      const formatter = new OutputFormatter(false, false, logPath);

      formatter.writeModelOutput('Test content');

      // Wait a bit for async write
      await new Promise((resolve) => setTimeout(resolve, 50));

      const logContent = await readFile(logPath, 'utf-8');
      expect(logContent).toContain('Test content');
      expect(logContent).toContain('Assistant');
    });
  });

  describe('writeProgress', () => {
    it('should write human-readable progress to stderr', () => {
      const formatter = new OutputFormatter(false);

      formatter.writeProgress({ type: 'start', data: {} });
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Starting'));

      formatter.writeProgress({ type: 'complete', data: {} });
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('complete'));
    });

    it('should write NDJSON progress in JSON mode', () => {
      const formatter = new OutputFormatter(true);

      formatter.writeProgress({ type: 'start', data: { test: 'data' } });

      const calls = stderrSpy.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall).toContain('"type":"start"');
      expect(() => JSON.parse(lastCall)).not.toThrow();
    });

    it('should not write progress in quiet mode', () => {
      const formatter = new OutputFormatter(false, true);

      formatter.writeProgress({ type: 'start', data: {} });

      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should include timestamp in JSON events', () => {
      const formatter = new OutputFormatter(true);

      formatter.writeProgress({ type: 'start', data: {} });

      const calls = stderrSpy.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      const parsed = JSON.parse(lastCall);
      expect(parsed).toHaveProperty('timestamp');
    });
  });

  describe('writeError', () => {
    it('should write error to stderr in human mode', () => {
      const formatter = new OutputFormatter(false);
      const error = new Error('Test error');

      formatter.writeError(error);

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Error: Test error'));
    });

    it('should write error as JSON in JSON mode', () => {
      const formatter = new OutputFormatter(true);
      const error = new Error('Test error');

      formatter.writeError(error);

      const calls = stderrSpy.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(() => JSON.parse(lastCall)).not.toThrow();
      const parsed = JSON.parse(lastCall);
      expect(parsed.type).toBe('error');
      expect(parsed.message).toBe('Test error');
    });

    it('should include context for PAIError', () => {
      const formatter = new OutputFormatter(true);
      const error = new PAIError('Test error', 1, { detail: 'extra info' });

      formatter.writeError(error);

      const calls = stderrSpy.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      const parsed = JSON.parse(lastCall);
      expect(parsed.context).toEqual({ detail: 'extra info' });
    });
  });

  describe('log file operations', () => {
    it('should create log file with header', async () => {
      const logPath = join(tempDir, 'test.log');
      const formatter = new OutputFormatter(false, false, logPath);

      await formatter.logUserMessage('Hello');

      const content = await readFile(logPath, 'utf-8');
      expect(content).toContain('# Chat Log');
      expect(content).toContain('User');
      expect(content).toContain('Hello');
    });

    it('should append to existing log file', async () => {
      const logPath = join(tempDir, 'test.log');
      const formatter = new OutputFormatter(false, false, logPath);

      await formatter.logUserMessage('First');
      await formatter.logSystemMessage('Second');

      const content = await readFile(logPath, 'utf-8');
      expect(content).toContain('First');
      expect(content).toContain('Second');
    });

    it('should include timestamps in log entries', async () => {
      const logPath = join(tempDir, 'test.log');
      const formatter = new OutputFormatter(false, false, logPath);

      await formatter.logUserMessage('Test');

      const content = await readFile(logPath, 'utf-8');
      // Check for ISO timestamp format
      expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should distinguish between message roles', async () => {
      const logPath = join(tempDir, 'test.log');
      const formatter = new OutputFormatter(false, false, logPath);

      await formatter.logSystemMessage('System message');
      await formatter.logUserMessage('User message');
      formatter.writeModelOutput('Assistant message');

      // Wait for async writes
      await new Promise((resolve) => setTimeout(resolve, 50));

      const content = await readFile(logPath, 'utf-8');
      expect(content).toContain('### System');
      expect(content).toContain('### User');
      expect(content).toContain('### Assistant');
    });
  });
});

  // Property-Based Tests
  describe('Property-Based Tests', () => {
    // Feature: pai-cli-tool, Property 11: JSON Output Format Validity
    it('should write valid JSON for all events in JSON mode', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            type: fc.constantFrom('start', 'chunk', 'tool_call', 'tool_result', 'complete', 'error'),
            data: fc.oneof(
              fc.string(),
              fc.record({ key: fc.string() }),
              fc.array(fc.string(), { maxLength: 3 })
            ),
          }),
          async (event) => {
            const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
            
            try {
              const formatter = new OutputFormatter(true, false);
              formatter.writeProgress(event);

              // Property: All stderr output must be valid JSON
              const calls = stderrSpy.mock.calls;
              for (const call of calls) {
                const output = call[0] as string;
                expect(() => JSON.parse(output)).not.toThrow();
                
                // Property: Must be single-line (NDJSON)
                expect(output.trim().split('\n')).toHaveLength(1);
              }
            } finally {
              stderrSpy.mockRestore();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    // Feature: pai-cli-tool, Property 12: Model Output Routing Invariant
    it('should always write model output to stdout only', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 100 }),
          async (content) => {
            const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
            const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
            
            try {
              const formatter = new OutputFormatter(false, false);
              formatter.writeModelOutput(content);

              // Property: Model output must go to stdout
              expect(stdoutSpy).toHaveBeenCalledWith(content);
              
              // Property: Model output must NOT go to stderr
              expect(stderrSpy).not.toHaveBeenCalled();
            } finally {
              stdoutSpy.mockRestore();
              stderrSpy.mockRestore();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    // Feature: pai-cli-tool, Property 20: Log File Timestamp Presence
    it('should include timestamps in all log entries', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            role: fc.constantFrom('user', 'assistant', 'system'),
            content: fc.string({ minLength: 1, maxLength: 50 }),
          }),
          async ({ role, content }) => {
            const testDir = await mkdtemp(join(tmpdir(), 'pai-pbt-'));
            const logPath = join(testDir, 'test.log');

            try {
              const formatter = new OutputFormatter(false, false, logPath);

              if (role === 'user') {
                await formatter.logUserMessage(content);
              } else if (role === 'assistant') {
                formatter.writeModelOutput(content);
                await new Promise(resolve => setTimeout(resolve, 50));
              } else {
                await formatter.logSystemMessage(content);
              }

              const logContent = await readFile(logPath, 'utf-8');

              // Property: Log must contain ISO timestamp
              expect(logContent).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
            } finally {
              await rm(testDir, { recursive: true, force: true });
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    // Feature: pai-cli-tool, Property 21: Log File Message Distinction
    it('should distinguish between different message roles in log', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 20 }),
            fc.string({ minLength: 1, maxLength: 20 }),
            fc.string({ minLength: 1, maxLength: 20 })
          ),
          async ([systemMsg, userMsg, assistantMsg]) => {
            const testDir = await mkdtemp(join(tmpdir(), 'pai-pbt-'));
            const logPath = join(testDir, 'test.log');

            try {
              const formatter = new OutputFormatter(false, false, logPath);

              await formatter.logSystemMessage(systemMsg);
              await formatter.logUserMessage(userMsg);
              formatter.writeModelOutput(assistantMsg);
              await new Promise(resolve => setTimeout(resolve, 50));

              const logContent = await readFile(logPath, 'utf-8');

              // Property: Each role must be clearly marked
              expect(logContent).toContain('### System');
              expect(logContent).toContain('### User');
              expect(logContent).toContain('### Assistant');

              // Property: Messages must be present
              expect(logContent).toContain(systemMsg);
              expect(logContent).toContain(userMsg);
              expect(logContent).toContain(assistantMsg);
            } finally {
              await rm(testDir, { recursive: true, force: true });
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });
