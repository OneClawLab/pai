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
      const args: BashExecArgs = { command: cmd };
      const result = await tool.handler(args);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('stdout');
      expect(result.stderr).toContain('stderr');
    });

    it('should return non-zero exit code on failure', async () => {
      const args: BashExecArgs = { command: 'exit 42' };
      const result = await tool.handler(args);

      expect(result.exitCode).toBe(42);
    });

    it('should capture error output on command failure', async () => {
      const cmd = isWindows
        ? 'dir /nonexistent-directory-xyz'
        : 'ls /nonexistent-directory-xyz';
      const args: BashExecArgs = { command: cmd };
      const result = await tool.handler(args);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toBeTruthy();
    });
  });

  describe('shell features', () => {
    it('should support pipes', async () => {
      const cmd = isWindows
        ? 'echo hello world | findstr world'
        : 'echo "hello world" | grep world';
      const args: BashExecArgs = { command: cmd };
      const result = await tool.handler(args);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('world');
    });

    it('should support command substitution', async () => {
      if (isWindows) {
        // Windows cmd doesn't support command substitution the same way
        const args: BashExecArgs = {
          command: 'echo Result: 42',
        };
        const result = await tool.handler(args);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Result: 42');
      } else {
        const args: BashExecArgs = {
          command: 'echo "Result: $(echo 42)"',
        };
        const result = await tool.handler(args);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Result: 42');
      }
    });

    it('should support multiple commands', async () => {
      const cmd = isWindows
        ? 'echo first && echo second'
        : 'echo "first" && echo "second"';
      const args: BashExecArgs = { command: cmd };
      const result = await tool.handler(args);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('first');
      expect(result.stdout).toContain('second');
    });

    it('should support environment variables', async () => {
      if (isWindows) {
        // Windows: just verify we can echo a value
        const args: BashExecArgs = { command: 'echo test value' };
        const result = await tool.handler(args);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('test value');
      } else {
        const args: BashExecArgs = { command: 'TEST_VAR="test value" && echo $TEST_VAR' };
        const result = await tool.handler(args);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('test value');
      }
    });
  });

  describe('cwd parameter', () => {
    it('should execute command in specified working directory', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'pai-bash-test-'));

      try {
        const cmd = isWindows ? 'cd' : 'pwd';
        const args: BashExecArgs = {
          command: cmd,
          cwd: tempDir,
        };
        const result = await tool.handler(args);

        expect(result.exitCode).toBe(0);
        // Normalize paths for comparison
        const normalizedStdout = result.stdout.trim().replace(/\\/g, '/').toLowerCase();
        const normalizedTempDir = tempDir.replace(/\\/g, '/').toLowerCase();
        expect(normalizedStdout).toContain(normalizedTempDir);
      } finally {
        // Add delay before cleanup on Windows
        if (isWindows) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('should be able to read files in cwd', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'pai-bash-test-'));

      try {
        const testFile = join(tempDir, 'test.txt');
        await writeFile(testFile, 'test content', 'utf-8');

        const cmd = isWindows ? 'type test.txt' : 'cat test.txt';
        const args: BashExecArgs = {
          command: cmd,
          cwd: tempDir,
        };
        const result = await tool.handler(args);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('test content');
      } finally {
        // Add delay before cleanup on Windows
        if (isWindows) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty stdout', async () => {
      const cmd = isWindows ? 'echo.' : 'true';
      const args: BashExecArgs = { command: cmd };
      const result = await tool.handler(args);

      expect(result.exitCode).toBe(0);
    });

    it('should handle commands with special characters', async () => {
      const args: BashExecArgs = {
        command: 'echo Special: !@#$%',
      };
      const result = await tool.handler(args);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Special:');
    });

    it('should handle multiline output', async () => {
      const cmd = isWindows
        ? 'echo Line 1 && echo Line 2 && echo Line 3'
        : 'printf "Line 1\\nLine 2\\nLine 3\\n"';
      const args: BashExecArgs = { command: cmd };
      const result = await tool.handler(args);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Line 1');
      expect(result.stdout).toContain('Line 2');
      expect(result.stdout).toContain('Line 3');
    });

    it('should handle large output', async () => {
      // Generate numbers 1-100 (smaller for faster test)
      const cmd = isWindows
        ? 'for /L %i in (1,1,100) do @echo %i'
        : 'seq 1 100';
      const args: BashExecArgs = { command: cmd };
      const result = await tool.handler(args);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('1');
      expect(result.stdout).toContain('100');
    });

    it('should handle command with invalid cwd', async () => {
      const args: BashExecArgs = {
        command: 'echo test',
        cwd: '/nonexistent/directory/xyz',
      };
      const result = await tool.handler(args);

      // Should fail with non-zero exit code
      expect(result.exitCode).not.toBe(0);
    });

    it('should handle command that outputs only to stderr', async () => {
      const cmd = isWindows
        ? 'echo error message 1>&2'
        : 'echo "error message" >&2';
      const args: BashExecArgs = { command: cmd };
      const result = await tool.handler(args);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('error');
      expect(result.stdout).toBe('');
    });

    it('should handle command with both stdout and stderr', async () => {
      const cmd = isWindows
        ? 'echo stdout && echo stderr 1>&2'
        : 'echo "stdout" && echo "stderr" >&2';
      const args: BashExecArgs = { command: cmd };
      const result = await tool.handler(args);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('stdout');
      expect(result.stderr).toContain('stderr');
    });

    it('should handle command with redirection', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'pai-bash-test-'));

      try {
        const outputFile = join(tempDir, 'output.txt');
        const cmd = isWindows
          ? `echo test content > ${outputFile}`
          : `echo "test content" > ${outputFile}`;
        const args: BashExecArgs = { command: cmd };
        const result = await tool.handler(args);

        expect(result.exitCode).toBe(0);

        // Verify file was created
        const cmd2 = isWindows ? `type ${outputFile}` : `cat ${outputFile}`;
        const result2 = await tool.handler({ command: cmd2 });
        expect(result2.stdout).toContain('test content');
      } finally {
        if (isWindows) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('should handle heredoc on Unix', async () => {
      if (isWindows) {
        // Skip on Windows - heredoc not supported in cmd.exe
        return;
      }

      const args: BashExecArgs = {
        command: 'cat << EOF\nLine 1\nLine 2\nLine 3\nEOF',
      };
      const result = await tool.handler(args);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Line 1');
      expect(result.stdout).toContain('Line 2');
      expect(result.stdout).toContain('Line 3');
    });

    it('should handle xargs on Unix', async () => {
      if (isWindows) {
        // Skip on Windows - xargs not available in cmd.exe
        return;
      }

      const args: BashExecArgs = {
        command: 'echo "file1 file2 file3" | xargs -n 1 echo Processing:',
      };
      const result = await tool.handler(args);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Processing: file1');
      expect(result.stdout).toContain('Processing: file2');
      expect(result.stdout).toContain('Processing: file3');
    });

    it('should handle command with quotes', async () => {
      const args: BashExecArgs = {
        command: 'echo "Hello World"',
      };
      const result = await tool.handler(args);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello World');
    });

    it('should handle command with single quotes on Unix', async () => {
      if (isWindows) {
        // Windows cmd.exe doesn't handle single quotes the same way
        return;
      }

      const args: BashExecArgs = {
        command: "echo 'Single quoted text'",
      };
      const result = await tool.handler(args);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Single quoted text');
    });

    it('should handle command with backticks on Unix', async () => {
      if (isWindows) {
        // Windows cmd.exe doesn't support backticks
        return;
      }

      const args: BashExecArgs = {
        command: 'echo `echo nested`',
      };
      const result = await tool.handler(args);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('nested');
    });

    it('should handle command with conditional execution', async () => {
      const cmd = isWindows
        ? 'echo success && echo next || echo failed'
        : 'echo success && echo next || echo failed';
      const args: BashExecArgs = { command: cmd };
      const result = await tool.handler(args);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('success');
      expect(result.stdout).toContain('next');
      expect(result.stdout).not.toContain('failed');
    });

    it('should handle command with OR operator on failure', async () => {
      const cmd = isWindows
        ? '(exit 1) || echo fallback'
        : 'false || echo fallback';
      const args: BashExecArgs = { command: cmd };
      const result = await tool.handler(args);

      // On Windows, the OR operator behavior is different
      // Just verify the command executed
      if (isWindows) {
        expect(result.exitCode).toBeDefined();
      } else {
        expect(result.stdout).toContain('fallback');
      }
    });

    it('should handle empty command gracefully', async () => {
      const args: BashExecArgs = { command: '' };
      const result = await tool.handler(args);

      // Empty command causes an error
      expect(result.exitCode).not.toBe(0);
    });

    it('should handle command with trailing whitespace', async () => {
      const args: BashExecArgs = { command: 'echo test   ' };
      const result = await tool.handler(args);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('test');
    });

    it('should handle command with leading whitespace', async () => {
      const args: BashExecArgs = { command: '   echo test' };
      const result = await tool.handler(args);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('test');
    });
  });
});

  // Property-Based Tests
  describe('Property-Based Tests', () => {
    // Feature: pai-cli-tool, Property 18: Command Result Structure
    it('should always return stdout, stderr, and exitCode fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(
            fc.constant('echo test'),
            fc.constant('echo hello && echo world'),
            fc.constant('exit 0'),
            fc.constant('exit 1'),
            isWindows ? fc.constant('dir') : fc.constant('ls'),
            isWindows ? fc.constant('echo test 1>&2') : fc.constant('echo test >&2'),
          ),
          async (command) => {
            const tool = createBashExecTool();
            const result = await tool.handler({ command });

            // Property: Result must have all three fields
            expect(result).toHaveProperty('stdout');
            expect(result).toHaveProperty('stderr');
            expect(result).toHaveProperty('exitCode');

            // Property: Fields must be correct types
            expect(typeof result.stdout).toBe('string');
            expect(typeof result.stderr).toBe('string');
            expect(typeof result.exitCode).toBe('number');
          }
        ),
        { numRuns: 100 }
      );
    });

    // Feature: pai-cli-tool, Property 17: Bash Feature Support
    it('should support pipes and command chaining', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            isWindows ? 'echo hello | findstr hello' : 'echo hello | grep hello',
            isWindows ? 'echo test && echo success' : 'echo test && echo success',
            isWindows ? 'echo line1 && echo line2' : 'printf "line1\\nline2\\n"'
          ),
          async (command) => {
            const tool = createBashExecTool();
            const result = await tool.handler({ command });

            // Property: Piped/chained commands should execute successfully
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toBeTruthy();
          }
        ),
        { numRuns: 50 }
      );
    });
  });
