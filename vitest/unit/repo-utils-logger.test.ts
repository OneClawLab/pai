import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  formatLogLine,
  formatRotationTimestamp,
  createFileLogger,
  createForegroundLogger,
  createStderrLogger,
  createFireAndForgetLogger,
} from '../../src/repo-utils/logger.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-utils-logger-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('formatLogLine', () => {
  it('includes level and message', () => {
    const line = formatLogLine('INFO', 'hello');
    expect(line).toContain('[INFO]');
    expect(line).toContain('hello');
  });

  it('includes ISO timestamp', () => {
    const line = formatLogLine('ERROR', 'oops');
    expect(line).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('supports DEBUG level', () => {
    const line = formatLogLine('DEBUG', 'trace');
    expect(line).toContain('[DEBUG]');
  });
});

describe('formatRotationTimestamp', () => {
  it('returns YYYYMMDD-HHmmss format', () => {
    const ts = formatRotationTimestamp(new Date('2024-03-15T10:30:45Z'));
    expect(ts).toBe('20240315-103045');
  });
});

describe('createFileLogger', () => {
  it('writes info/warn/error/debug to log file', async () => {
    const logger = await createFileLogger(tmpDir, 'test');
    logger.info('info msg');
    logger.warn('warn msg');
    logger.error('error msg');
    logger.debug('debug msg');
    await logger.close();

    const content = fs.readFileSync(path.join(tmpDir, 'test.log'), 'utf8');
    expect(content).toContain('[INFO]');
    expect(content).toContain('info msg');
    expect(content).toContain('[WARN]');
    expect(content).toContain('[ERROR]');
    expect(content).toContain('[DEBUG]');
    expect(content).toContain('debug msg');
  });

  it('creates log directory if it does not exist', async () => {
    const nested = path.join(tmpDir, 'a', 'b', 'c');
    const logger = await createFileLogger(nested, 'test');
    logger.info('hi');
    await logger.close();
    expect(fs.existsSync(path.join(nested, 'test.log'))).toBe(true);
  });

  it('rotates log when line count exceeds maxLines', async () => {
    const logFile = path.join(tmpDir, 'test.log');
    // Write 11 lines manually to exceed maxLines=10
    fs.writeFileSync(logFile, Array(11).fill('old line').join('\n') + '\n');

    const logger = await createFileLogger(tmpDir, 'test', 10);
    logger.info('new entry');
    await logger.close();

    const files = fs.readdirSync(tmpDir);
    expect(files.some(f => f.startsWith('test-') && f.endsWith('.log'))).toBe(true);
    const newContent = fs.readFileSync(logFile, 'utf8');
    expect(newContent).toContain('new entry');
    expect(newContent).not.toContain('old line');
  });

  it('rotates existing log on startup and writes to fresh file', async () => {
    const logFile = path.join(tmpDir, 'test.log');
    fs.writeFileSync(logFile, 'existing line\n');

    const logger = await createFileLogger(tmpDir, 'test');
    logger.info('appended');
    await logger.close();

    // existing content should have been rotated to an archive file
    const files = fs.readdirSync(tmpDir);
    expect(files.some(f => f.startsWith('test-') && f.endsWith('.log'))).toBe(true);

    // current log file should only contain the new entry
    const content = fs.readFileSync(logFile, 'utf8');
    expect(content).not.toContain('existing line');
    expect(content).toContain('appended');
  });
});

describe('createForegroundLogger', () => {
  it('writes to log file and returns a logger', async () => {
    const logger = await createForegroundLogger(tmpDir, 'fg');
    logger.info('fg info');
    logger.debug('fg debug');
    await logger.close();

    const content = fs.readFileSync(path.join(tmpDir, 'fg.log'), 'utf8');
    expect(content).toContain('fg info');
    expect(content).toContain('fg debug');
  });
});

describe('createStderrLogger', () => {
  it('returns a logger with all methods', () => {
    const logger = createStderrLogger();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('close() resolves immediately', async () => {
    const logger = createStderrLogger();
    await expect(logger.close()).resolves.toBeUndefined();
  });
});

describe('createFireAndForgetLogger', () => {
  it('writes to log file asynchronously', async () => {
    const logger = createFireAndForgetLogger(tmpDir, 'faf');
    logger.info('faf info');
    logger.debug('faf debug');
    logger.error('faf error');
    // Give async writes time to complete
    await new Promise(r => setTimeout(r, 200));

    const content = fs.readFileSync(path.join(tmpDir, 'faf.log'), 'utf8');
    expect(content).toContain('faf info');
    expect(content).toContain('faf debug');
    expect(content).toContain('faf error');
  });

  it('close() resolves immediately (fire-and-forget)', async () => {
    const logger = createFireAndForgetLogger(tmpDir, 'faf2');
    await expect(logger.close()).resolves.toBeUndefined();
  });

  it('does not throw when log dir is invalid', async () => {
    // Should silently swallow errors
    const logger = createFireAndForgetLogger('/nonexistent/path/xyz', 'faf');
    expect(() => logger.info('test')).not.toThrow();
    await new Promise(r => setTimeout(r, 200));
  });
});
