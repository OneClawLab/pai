import { describe, it, expect } from 'vitest';
import { commandExists, execCommand, spawnCommand } from '../../src/os-utils.js';
import * as fc from 'fast-check';

describe('commandExists', () => {
  it('returns true for a known command (echo)', async () => {
    expect(await commandExists('echo')).toBe(true);
  });

  it('returns false for a non-existent command', async () => {
    expect(await commandExists('nonexistent-command-xyz-abc-123')).toBe(false);
  });

  it('never throws — always returns boolean', async () => {
    const result = await commandExists('');
    expect(typeof result).toBe('boolean');
  });
});

describe('execCommand', () => {
  it('captures stdout', async () => {
    const { stdout } = await execCommand('echo', ['hello']);
    expect(stdout).toContain('hello');
  });

  it('returns stdout and stderr as strings', async () => {
    const result = await execCommand('echo', ['test']);
    expect(typeof result.stdout).toBe('string');
    expect(typeof result.stderr).toBe('string');
  });

  it('throws on non-zero exit code', async () => {
    // Use a command that reliably exits non-zero on all platforms
    await expect(execCommand('ls', ['/nonexistent-path-xyz-abc'])).rejects.toThrow();
  });

  it('throws when command not found', async () => {
    await expect(execCommand('nonexistent-xyz', [])).rejects.toThrow();
  });

  it('handles multiple arguments', async () => {
    const { stdout } = await execCommand('echo', ['foo', 'bar']);
    expect(stdout).toContain('foo');
    expect(stdout).toContain('bar');
  });

  // On Win32, shell:true means args are joined into a cmd.exe command line.
  // Safe characters (spaces, quotes, backslashes, single quotes) are passed correctly.
  // Shell metacharacters (&, |, >, <, ^) are NOT safe — they are interpreted by cmd.exe.
  it('passes arg with spaces correctly', async () => {
    const { stdout } = await execCommand('echo', ['hello world']);
    expect(stdout).toContain('hello world');
  });

  it('passes arg with single quotes correctly', async () => {
    const { stdout } = await execCommand('echo', ["it's here"]);
    expect(stdout).toContain("it's here");
  });

  it('passes arg with backslashes correctly', async () => {
    const { stdout } = await execCommand('echo', ['path\\to\\file']);
    expect(stdout).toContain('path');
    expect(stdout).toContain('to');
    expect(stdout).toContain('file');
  });
});

describe('spawnCommand', () => {
  it('captures stdout', async () => {
    const { stdout } = await spawnCommand('echo', ['hello']);
    expect(stdout).toContain('hello');
  });

  it('returns stdout and stderr as strings', async () => {
    const result = await spawnCommand('echo', ['test']);
    expect(typeof result.stdout).toBe('string');
    expect(typeof result.stderr).toBe('string');
  });

  it('pipes stdin to the process', async () => {
    const { stdout } = await spawnCommand('cat', [], 'hello from stdin');
    expect(stdout).toContain('hello from stdin');
  });

  it('handles multiline stdin', async () => {
    const { stdout } = await spawnCommand('cat', [], 'line1\nline2\nline3\n');
    expect(stdout).toContain('line1');
    expect(stdout).toContain('line2');
    expect(stdout).toContain('line3');
  });

  it('filters stdin via grep', async () => {
    const { stdout } = await spawnCommand('grep', ['world'], 'hello world\ngoodbye\n');
    expect(stdout).toContain('world');
    expect(stdout).not.toContain('goodbye');
  });

  it('rejects when command not found', async () => {
    await expect(spawnCommand('nonexistent-xyz', [])).rejects.toThrow();
  });

  it('rejects when exit code is non-zero and stdout is empty', async () => {
    await expect(spawnCommand('grep', ['nomatch'], 'hello\n')).rejects.toThrow();
  });

  it('resolves when exit code is non-zero but stdout is non-empty', async () => {
    // grep -c counts matches; exits 1 when count=0 but still outputs "0\n"
    const result = await spawnCommand('grep', ['-c', 'nomatch'], 'hello\n');
    expect(result.stdout.trim()).toBe('0');
  });

  it('times out and rejects when timeoutMs exceeded', async () => {
    await expect(
      spawnCommand('node', ['-e', 'setInterval(function(){},1000)'], undefined, 100)
    ).rejects.toThrow(/timed out/);
  });

  // On Win32, shell:true means args are joined into a cmd.exe command line.
  // Safe characters (spaces, quotes, backslashes, single quotes) are passed correctly.
  // Shell metacharacters (&, |, >, <, ^) are NOT safe — they are interpreted by cmd.exe.
  it('passes arg with spaces correctly', async () => {
    const { stdout } = await spawnCommand('echo', ['hello world']);
    expect(stdout).toContain('hello world');
  });

  it('passes arg with single quotes correctly', async () => {
    const { stdout } = await spawnCommand('echo', ["it's here"]);
    expect(stdout).toContain("it's here");
  });

  it('passes arg with backslashes correctly', async () => {
    const { stdout } = await spawnCommand('echo', ['path\\to\\file']);
    expect(stdout).toContain('path');
    expect(stdout).toContain('to');
    expect(stdout).toContain('file');
  });
});

describe('Property-Based Tests', () => {
  it('commandExists always returns a boolean', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9-]+$/.test(s)),
        async (name) => {
          const result = await commandExists(name);
          expect(typeof result).toBe('boolean');
        }
      ),
      { numRuns: 10 }
    );
  });

  it('spawnCommand stdout and stderr are always strings', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9]+$/.test(s)),
        async (text) => {
          const result = await spawnCommand('echo', [text]);
          expect(typeof result.stdout).toBe('string');
          expect(typeof result.stderr).toBe('string');
        }
      ),
      { numRuns: 20 }
    );
  });

  it('spawnCommand faithfully captures echo output', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9]+$/.test(s)),
        async (text) => {
          const { stdout } = await spawnCommand('echo', [text]);
          expect(stdout.trim()).toContain(text);
        }
      ),
      { numRuns: 20 }
    );
  });
});
