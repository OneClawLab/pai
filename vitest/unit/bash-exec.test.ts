import { describe, it, expect } from 'vitest';
import { createBashExecTool, detectShell } from '../../src/tools/bash-exec.js';
import type { BashExecArgs } from '../../src/types.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';
import * as fc from 'fast-check';

// Use the actual detected shell to decide command syntax in tests.
// On Windows with Git Bash / MSYS2, isCmdExe will be false even though platform() === 'win32'.
const { isCmdExe } = detectShell();
const isWin32 = platform() === 'win32';

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
      const cmd = isCmdExe
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
      const cmd = isCmdExe
        ? 'dir /nonexistent-directory-xyz'
        : 'ls /nonexistent-directory-xyz';
      const result = await tool.handler({ command: cmd });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toBeTruthy();
    });
  });

  describe('shell features', () => {
    it('should support pipes', async () => {
      const cmd = isCmdExe
        ? 'echo hello world | findstr world'
        : 'echo "hello world" | grep world';
      const result = await tool.handler({ command: cmd });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('world');
    });

    it('should support command substitution', async () => {
      if (isCmdExe) {
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
      const cmd = isCmdExe
        ? 'echo first && echo second'
        : 'echo "first" && echo "second"';
      const result = await tool.handler({ command: cmd });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('first');
      expect(result.stdout).toContain('second');
    });

    it('should support environment variables', async () => {
      const pathCmd = isCmdExe ? 'echo %PATH%' : 'echo $PATH';
      const result = await tool.handler({ command: pathCmd });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim().length).toBeGreaterThan(0);
      expect(result.stdout.trim()).not.toBe('%PATH%');
      expect(result.stdout.trim()).not.toBe('$PATH');

      if (!isCmdExe) {
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
        const cmd = isCmdExe ? 'cd' : 'pwd';
        const result = await tool.handler({ command: cmd, cwd: tempDir });
        expect(result.exitCode).toBe(0);

        // On Windows with bash (Git Bash/MSYS2), pwd returns MSYS-style paths
        // e.g. /c/Users/... instead of C:\Users\...
        // Normalize both to compare just the directory name suffix
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
        const cmd = isCmdExe ? 'type test.txt' : 'cat test.txt';
        const result = await tool.handler({ command: cmd, cwd: tempDir });
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
      const cmd = isCmdExe ? 'echo.' : 'true';
      const result = await tool.handler({ command: cmd });
      expect(result.exitCode).toBe(0);
    });

    it('should handle commands with special characters', async () => {
      const result = await tool.handler({ command: 'echo Special: !@#$%' });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Special:');
    });

    it('should handle multiline output', async () => {
      const cmd = isCmdExe
        ? 'echo Line 1 && echo Line 2 && echo Line 3'
        : 'printf "Line 1\\nLine 2\\nLine 3\\n"';
      const result = await tool.handler({ command: cmd });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Line 1');
      expect(result.stdout).toContain('Line 2');
      expect(result.stdout).toContain('Line 3');
    });

    it('should handle large output', async () => {
      const cmd = isCmdExe
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
      const cmd = isCmdExe
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
        let cmd: string;
        let cmd2: string;
        if (isCmdExe) {
          cmd = `echo test content > ${outputFile}`;
          cmd2 = `type ${outputFile}`;
        } else {
          // Convert Windows path to MSYS-style for bash on Windows (C:\foo → /c/foo)
          const bashPath = isWin32
            ? outputFile.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`)
            : outputFile;
          cmd = `echo "test content" > "${bashPath}"`;
          cmd2 = `cat "${bashPath}"`;
        }
        await tool.handler({ command: cmd });
        const result2 = await tool.handler({ command: cmd2 });
        expect(result2.stdout).toContain('test content');
      } finally {
        if (isWin32) await new Promise((r) => setTimeout(r, 100));
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('should handle heredoc on Unix', async () => {
      if (isCmdExe) return;
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
      const cmd = isCmdExe ? '(exit 1) || echo fallback' : 'false || echo fallback';
      const result = await tool.handler({ command: cmd });
      if (!isCmdExe) {
        expect(result.stdout).toContain('fallback');
      } else {
        expect(result.exitCode).toBeDefined();
      }
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
              .map(s => isCmdExe ? `echo ${s} 1>&2` : `echo "${s}" >&2`),
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

            const pipeCmd = isCmdExe
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

    it('should faithfully capture echo output for alphanumeric strings', async () => {
      const t = createBashExecTool();
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 30 })
            .filter(s => /^[a-zA-Z0-9]+$/.test(s)),
          async (text) => {
            const cmd = isCmdExe ? `echo ${text}` : `echo "${text}"`;
            const result = await t.handler({ command: cmd });
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
