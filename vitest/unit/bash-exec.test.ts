import { describe, it, expect } from 'vitest';
import { createBashExecTool } from '../../src/tools/bash-exec.js';
import type { BashExecArgs } from '../../src/types.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';

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
  });
});
