import { describe, it, expect } from 'vitest';
import { createBashExecTool } from '../../src/tools/bash-exec.js';
import type { BashExecArgs } from '../../src/types.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';
import * as fc from 'fast-check';

const isWindows = platform() === 'win32';

describe('bash_exec tool', () => {
  const tool = createBashExecTool();

  it('should have correct tool definition', () => {
    expect(tool.name).toBe('bash_exec');
    expect(tool.description).toBeTruthy();
    expect(tool.parameters).toHaveProperty('type', 'object');
    expect(tool.parameters).toHaveProperty('properties');
    expect(tool.handler).toBeTypeOf('function');
  });

  describe('command execution', () => {
    it('should execute simple command successfully', async () => {
      const args: BashExecArgs = { command: 'echo Hello World' };
      const result = await tool.handler(args);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello World');
    });

    it('should return stdout and stderr', async () => {
      const cmd = isWindows
        ? 'echo stdout && echo stderr 1>&2'
        : 'echo "stdout" && echo "stderr" >&2';
      const result = await tool.handler({ command: cmd });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('stdout');
      expect(result.stderr).toContain('stderr');
    });

    it('should return non-zero exit code on failure', async () => {
      const result = await tool.handler({ command: 'exit 42' });
      expect(result.exitCode).toBe(42);
    });

    it('should capture error output on command failure', async () => {
      const cmd = isWindows
        ? 'dir /nonexistent-directory-xyz'
        : 'ls /nonexistent-directory-xyz';
      const result = await tool.handler({ command: cmd });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toBeTruthy();
    });
  });

  describe('shell features', () => {
    it('should support pipes', async () => {
      const cmd = isWindows
        ? 'echo hello world | findstr world'
        : 'echo "hello world" | grep world';
      const result = await tool.handler({ command: cmd });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('world');
    });

    it('should support command substitution', async () => {
      if (isWindows) {
        // Windows: use FOR /F to capture command output (real substitution)
        const result = await tool.handler({
          command: 'for /F "delims=" %i in (\'echo 42\') do @echo Result: %i',
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Result: 42');
      } else {
        const result = await tool.handler({
          command: 'echo "Result: $(echo 42)"',
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Result: 42');
      }
    });

    it('should support multiple commands', async () => {
      const cmd = isWindows
        ? 'echo first && echo second'
        : 'echo "first" && echo "second"';
      const result = await tool.handler({ command: cmd });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('first');
      expect(result.stdout).toContain('second');
    });

    it('should support environment variables', async () => {
      // Cross-platform: verify PATH env var is accessible
      const pathCmd = isWindows ? 'echo %PATH%' : 'echo $PATH';
      const result = await tool.handler({ command: pathCmd });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim().length).toBeGreaterThan(0);
      // PATH should not literally be "%PATH%" or "$PATH"
      expect(result.stdout.trim()).not.toBe('%PATH%');
      expect(result.stdout.trim()).not.toBe('$PATH');

      if (!isWindows) {
        const result2 = await tool.handler({ command: 'TEST_VAR="test value" && echo $TEST_VAR' });
        expect(result2.exitCode).toBe(0);
        expect(result2.stdout).toContain('test value');
      }
    });
  });

  describe('cwd parameter', () => {
    it('should execute command in specified working directory', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'pai-bash-test-'));
      try {
        const cmd = isWindows ? 'cd' : 'pwd';
        const result = await tool.handler({ command: cmd, cwd: tempDir });
        expect(result.exitCode).toBe(0);
        const normalizedStdout = result.stdout.trim().replace(/\\/g, '/').toLowerCase();
        const normalizedTempDir = tempDir.replace(/\\/g, '/').toLowerCase();
        expect(normalizedStdout).toContain(normalizedTempDir);
      } finally {
        if (isWindows) await new Promise((r) => setTimeout(r, 100));
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('should be able to read files in cwd', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'pai-bash-test-'));
      try {
        await writeFile(join(tempDir, 'test.txt'), 'test content', 'utf-8');
        const cmd = isWindows ? 'type test.txt' : 'cat test.txt';
        const result = await tool.handler({ command: cmd, cwd: tempDir });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('test content');
      } finally {
        if (isWindows) await new Promise((r) => setTimeout(r, 100));
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty stdout', async () => {
      const cmd = isWindows ? 'echo.' : 'true';
      const result = await tool.handler({ command: cmd });
      expect(result.exitCode).toBe(0);
    });

    it('should handle commands with special characters', async () => {
      const result = await tool.handler({ command: 'echo Special: !@#$%' });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Special:');
    });

    it('should handle multiline output', async () => {
      const cmd = isWindows
        ? 'echo Line 1 && echo Line 2 && echo Line 3'
        : 'printf "Line 1\\nLine 2\\nLine 3\\n"';
      const result = await tool.handler({ command: cmd });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Line 1');
      expect(result.stdout).toContain('Line 2');
      expect(result.stdout).toContain('Line 3');
    });

    it('should handle large output', async () => {
      const cmd = isWindows
        ? 'for /L %i in (1,1,100) do @echo %i'
        : 'seq 1 100';
      const result = await tool.handler({ command: cmd });
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
      const cmd = isWindows
        ? 'echo error message 1>&2'
        : 'echo "error message" >&2';
      const result = await tool.handler({ command: cmd });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('error');
      expect(result.stdout).toBe('');
    });

    it('should handle command with redirection', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'pai-bash-test-'));
      try {
        const outputFile = join(tempDir, 'output.txt');
        const cmd = isWindows
          ? `echo test content > ${outputFile}`
          : `echo "test content" > ${outputFile}`;
        await tool.handler({ command: cmd });
        const cmd2 = isWindows ? `type ${outputFile}` : `cat ${outputFile}`;
        const result2 = await tool.handler({ command: cmd2 });
        expect(result2.stdout).toContain('test content');
      } finally {
        if (isWindows) await new Promise((r) => setTimeout(r, 100));
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('should handle heredoc on Unix', async () => {
      if (isWindows) return;
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
      const cmd = isWindows ? '(exit 1) || echo fallback' : 'false || echo fallback';
      const result = await tool.handler({ command: cmd });
      if (!isWindows) {
        expect(result.stdout).toContain('fallback');
      } else {
        expect(result.exitCode).toBeDefined();
      }
    });
  });

  // Property-Based Tests (inside main describe)
  describe('Property-Based Tests', () => {
    // Feature: pai-cli-tool, Property 18: Command Result Structure
    it('should always return stdout, stderr, and exitCode fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            // Random echo commands with generated strings
            fc.string({ minLength: 1, maxLength: 20 })
              .filter(s => /^[a-zA-Z0-9 ]+$/.test(s))
              .map(s => `echo ${s}`),
            // Random exit codes
            fc.integer({ min: 0, max: 5 }).map(n => `exit ${n}`),
            // Stderr output
            fc.string({ minLength: 1, maxLength: 10 })
              .filter(s => /^[a-zA-Z0-9]+$/.test(s))
              .map(s => isWindows ? `echo ${s} 1>&2` : `echo "${s}" >&2`),
          ),
          async (command) => {
            const t = createBashExecTool();
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

    // Feature: pai-cli-tool, Property 17: Bash Feature Support
    it('should support pipes and command chaining with random data', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 3, maxLength: 10 })
            .filter(s => /^[a-zA-Z]+$/.test(s)),
          async (word) => {
            const t = createBashExecTool();

            const pipeCmd = isWindows
              ? `echo ${word} | findstr ${word}`
              : `echo "${word}" | grep "${word}"`;
            const pipeResult = await t.handler({ command: pipeCmd });
            expect(pipeResult.exitCode).toBe(0);
            expect(pipeResult.stdout).toContain(word);

            const chainCmd = `echo ${word}_first && echo ${word}_second`;
            const chainResult = await t.handler({ command: chainCmd });
            expect(chainResult.exitCode).toBe(0);
            expect(chainResult.stdout).toContain(`${word}_first`);
            expect(chainResult.stdout).toContain(`${word}_second`);
          }
        ),
        { numRuns: 20 }
      );
    });

    // Property: echo content round-trip
    it('should faithfully capture echo output for alphanumeric strings', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 30 })
            .filter(s => /^[a-zA-Z0-9]+$/.test(s)),
          async (text) => {
            const t = createBashExecTool();
            const cmd = isWindows ? `echo ${text}` : `echo "${text}"`;
            const result = await t.handler({ command: cmd });
            expect(result.exitCode).toBe(0);
            expect(result.stdout.trim()).toContain(text);
          }
        ),
        { numRuns: 50 }
      );
    });

    // Property: exit code is faithfully captured
    it('should capture exact exit codes', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 125 }),
          async (code) => {
            const t = createBashExecTool();
            const result = await t.handler({ command: `exit ${code}` });
            expect(result.exitCode).toBe(code);
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});
