import { describe, it, expect } from 'vitest';
import { createBashExecTool, detectShell } from '../../src/tools/bash-exec.js';
import type { BashExecArgs } from '../../src/types.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';
import * as fc from 'fast-check';

const isWin32 = platform() === 'win32';

describe('bash_exec tool', () => {
  const tool = createBashExecTool();

  it('should have correct tool definition', () => {
    expect(tool.name).toBe('bash_exec');
    expect(tool.description).toBeTruthy();
    expect(tool.description).toContain('bash');
    expect(tool.parameters).toHaveProperty('type', 'object');
    expect(tool.parameters).toHaveProperty('properties');
    expect(tool.handler).toBeTypeOf('function');
  });

  describe('detectShell', () => {
    it('should return a string (shell path)', () => {
      const shell = detectShell();
      expect(typeof shell).toBe('string');
      expect(shell.length).toBeGreaterThan(0);
      expect(/bash/i.test(shell)).toBe(true);
    });
  });

  describe('command execution', () => {
    it('should execute simple command successfully', async () => {
      const args: BashExecArgs = { command: 'echo Hello World' };
      const result = await tool.handler(args);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello World');
    });

    it('should return stdout and stderr', async () => {
      const result = await tool.handler({
        command: 'echo "stdout" && echo "stderr" >&2',
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('stdout');
      expect(result.stderr).toContain('stderr');
    });

    it('should return non-zero exit code on failure', async () => {
      const result = await tool.handler({ command: 'exit 42' });
      expect(result.exitCode).toBe(42);
    });

    it('should capture error output on command failure', async () => {
      const result = await tool.handler({ command: 'ls /nonexistent-directory-xyz' });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toBeTruthy();
    });
  });

  describe('shell features', () => {
    it('should support pipes', async () => {
      const result = await tool.handler({
        command: 'echo "hello world" | grep world',
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('world');
    });

    it('should support command substitution', async () => {
      const result = await tool.handler({
        command: 'echo "Result: $(echo 42)"',
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Result: 42');
    });

    it('should support multiple commands', async () => {
      const result = await tool.handler({
        command: 'echo "first" && echo "second"',
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('first');
      expect(result.stdout).toContain('second');
    });

    it('should support environment variables', async () => {
      const result = await tool.handler({ command: 'echo $PATH' });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim().length).toBeGreaterThan(0);
      expect(result.stdout.trim()).not.toBe('$PATH');

      const result2 = await tool.handler({
        command: 'TEST_VAR="test value" && echo $TEST_VAR',
      });
      expect(result2.exitCode).toBe(0);
      expect(result2.stdout).toContain('test value');
    });
  });

  describe('cwd parameter', () => {
    it('should execute command in specified working directory', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'pai-bash-test-'));
      try {
        const result = await tool.handler({ command: 'pwd', cwd: tempDir });
        expect(result.exitCode).toBe(0);
        // On Windows with bash (Git Bash/MSYS2), pwd returns MSYS-style paths
        const dirName = tempDir.replace(/\\/g, '/').split('/').pop()!;
        expect(result.stdout).toContain(dirName);
      } finally {
        if (isWin32) await new Promise((r) => setTimeout(r, 100));
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('should be able to read files in cwd', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'pai-bash-test-'));
      try {
        await writeFile(join(tempDir, 'test.txt'), 'test content', 'utf-8');
        const result = await tool.handler({ command: 'cat test.txt', cwd: tempDir });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('test content');
      } finally {
        if (isWin32) await new Promise((r) => setTimeout(r, 100));
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty stdout', async () => {
      const result = await tool.handler({ command: 'true' });
      expect(result.exitCode).toBe(0);
    });

    it('should handle commands with special characters', async () => {
      const result = await tool.handler({ command: 'echo Special: !@#$%' });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Special:');
    });

    it('should handle multiline output', async () => {
      const result = await tool.handler({
        command: 'printf "Line 1\\nLine 2\\nLine 3\\n"',
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Line 1');
      expect(result.stdout).toContain('Line 2');
      expect(result.stdout).toContain('Line 3');
    });

    it('should handle large output', async () => {
      const result = await tool.handler({ command: 'seq 1 100' });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('1');
      expect(result.stdout).toContain('100');
    });

    it('should handle command with invalid cwd', async () => {
      const result = await tool.handler({
        command: 'echo test',
        cwd: '/nonexistent/directory/xyz',
      });
      expect(result.exitCode).not.toBe(0);
    });

    it('should handle command that outputs only to stderr', async () => {
      const result = await tool.handler({ command: 'echo "error message" >&2' });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('error');
      expect(result.stdout).toBe('');
    });

    it('should handle command with redirection', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'pai-bash-test-'));
      try {
        const outputFile = join(tempDir, 'output.txt');
        // Convert Windows path to MSYS-style for bash on Windows
        const bashPath = isWin32
          ? outputFile.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`)
          : outputFile;
        await tool.handler({ command: `echo "test content" > "${bashPath}"` });
        const result2 = await tool.handler({ command: `cat "${bashPath}"` });
        expect(result2.stdout).toContain('test content');
      } finally {
        if (isWin32) await new Promise((r) => setTimeout(r, 100));
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('should handle heredoc', async () => {
      const result = await tool.handler({
        command: 'cat << EOF\nLine 1\nLine 2\nLine 3\nEOF',
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Line 1');
      expect(result.stdout).toContain('Line 2');
      expect(result.stdout).toContain('Line 3');
    });

    it('should handle empty command gracefully', async () => {
      const result = await tool.handler({ command: '' });
      expect(result.exitCode).not.toBe(0);
    });

    it('should handle command with quotes', async () => {
      const result = await tool.handler({ command: 'echo "Hello World"' });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello World');
    });

    it('should handle command with conditional execution', async () => {
      const result = await tool.handler({
        command: 'echo success && echo next || echo failed',
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('success');
      expect(result.stdout).toContain('next');
      expect(result.stdout).not.toContain('failed');
    });

    it('should handle command with OR operator on failure', async () => {
      const result = await tool.handler({ command: 'false || echo fallback' });
      expect(result.stdout).toContain('fallback');
    });
  });

  // Property-Based Tests
  describe('Property-Based Tests', () => {
    it('should always return stdout, stderr, and exitCode fields', async () => {
      const t = createBashExecTool();
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.string({ minLength: 1, maxLength: 20 })
              .filter(s => /^[a-zA-Z0-9 ]+$/.test(s))
              .map(s => `echo ${s}`),
            fc.integer({ min: 0, max: 5 }).map(n => `exit ${n}`),
            fc.string({ minLength: 1, maxLength: 10 })
              .filter(s => /^[a-zA-Z0-9]+$/.test(s))
              .map(s => `echo "${s}" >&2`),
          ),
          async (command) => {
            const result = await t.handler({ command });

            expect(result).toHaveProperty('stdout');
            expect(result).toHaveProperty('stderr');
            expect(result).toHaveProperty('exitCode');
            expect(typeof result.stdout).toBe('string');
            expect(typeof result.stderr).toBe('string');
            expect(typeof result.exitCode).toBe('number');
            expect(result.exitCode).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(result.exitCode)).toBe(true);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should support pipes and command chaining with random data', async () => {
      const t = createBashExecTool();
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 3, maxLength: 10 })
            .filter(s => /^[a-zA-Z]+$/.test(s)),
          async (word) => {
            const pipeResult = await t.handler({
              command: `echo "${word}" | grep "${word}"`,
            });
            expect(pipeResult.exitCode).toBe(0);
            expect(pipeResult.stdout).toContain(word);

            const chainResult = await t.handler({
              command: `echo ${word}_first && echo ${word}_second`,
            });
            expect(chainResult.exitCode).toBe(0);
            expect(chainResult.stdout).toContain(`${word}_first`);
            expect(chainResult.stdout).toContain(`${word}_second`);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should faithfully capture echo output for alphanumeric strings', async () => {
      const t = createBashExecTool();
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 30 })
            .filter(s => /^[a-zA-Z0-9]+$/.test(s)),
          async (text) => {
            const result = await t.handler({ command: `echo "${text}"` });
            expect(result.exitCode).toBe(0);
            expect(result.stdout.trim()).toContain(text);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should capture exact exit codes', async () => {
      const t = createBashExecTool();
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 125 }),
          async (code) => {
            const result = await t.handler({ command: `exit ${code}` });
            expect(result.exitCode).toBe(code);
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});
