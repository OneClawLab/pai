import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from '../../src/repo-utils/fs.js';
import {
  StreamCapture,
  captureFromString,
  processCapture,
  resolveStreamBudget,
  DEFAULT_OUTPUT_CAP,
  _resetSpillDir,
  type OutputCapConfig,
} from '../../src/tools/bash-output.js';

const KB = 1024;

const SMALL_CAP: OutputCapConfig = {
  defaultReturnBytes: 1 * KB,
  hardCeilingBytes: 8 * KB,
  assumedLineBytes: 100,
  tailReserveBytes: 2 * KB,
  spillToFile: true,
};

describe('bash-output: StreamCapture', () => {
  it('keeps everything when under capacity', () => {
    const sc = new StreamCapture(1000, 500);
    sc.push(Buffer.from('hello world'));
    const c = sc.finalize();
    expect(c.dropped).toBe(false);
    expect(c.totalBytes).toBe(11);
    expect(Buffer.concat([c.head, c.tail]).toString()).toBe('hello world');
  });

  it('preserves head and tail, dropping the middle, when over capacity', () => {
    const sc = new StreamCapture(10, 10); // 20 bytes capacity
    // 100 bytes: 0..99
    const data = Buffer.from(Array.from({ length: 100 }, (_, i) => 48 + (i % 10)));
    sc.push(data);
    const c = sc.finalize();
    expect(c.dropped).toBe(true);
    expect(c.totalBytes).toBe(100);
    expect(c.head.length).toBe(10);
    expect(c.tail.length).toBeGreaterThanOrEqual(10);
    // Head is the first 10 bytes
    expect(c.head.toString()).toBe(data.subarray(0, 10).toString());
    // Tail ends with the last bytes
    expect(c.tail[c.tail.length - 1]).toBe(data[data.length - 1]);
  });

  it('handles many small chunks (rolling tail)', () => {
    const sc = new StreamCapture(5, 5);
    for (let i = 0; i < 100; i++) sc.push(Buffer.from('x'));
    const c = sc.finalize();
    expect(c.totalBytes).toBe(100);
    expect(c.head.length).toBe(5);
    expect(c.tail.length).toBeGreaterThanOrEqual(5);
    expect(c.head.length + c.tail.length).toBeLessThanOrEqual(20);
  });
});

describe('bash-output: resolveStreamBudget', () => {
  it('uses the default when no intent and no explicit limit', () => {
    expect(resolveStreamBudget(undefined, undefined, SMALL_CAP)).toBe(SMALL_CAP.defaultReturnBytes);
  });

  it('honors an explicit byte limit, clamped to the ceiling', () => {
    expect(resolveStreamBudget(undefined, 500, SMALL_CAP)).toBe(500);
    expect(resolveStreamBudget(undefined, 99999, SMALL_CAP)).toBe(SMALL_CAP.hardCeilingBytes);
    expect(resolveStreamBudget(undefined, 0, SMALL_CAP)).toBe(0);
  });

  it('explicit limit wins over intent', () => {
    expect(resolveStreamBudget({ bounded: true, lines: 500 }, 256, SMALL_CAP)).toBe(256);
  });

  it('raises budget for a line-bounded reader via assumedLineBytes', () => {
    // 50 lines * 100 bytes = 5000, clamped to ceiling 8KB → 5000
    const b = resolveStreamBudget({ bounded: true, lines: 50 }, undefined, SMALL_CAP);
    expect(b).toBe(5000);
  });

  it('clamps a huge line bound to the ceiling (protects against long lines)', () => {
    const b = resolveStreamBudget({ bounded: true, lines: 100000 }, undefined, SMALL_CAP);
    expect(b).toBe(SMALL_CAP.hardCeilingBytes);
  });

  it('never drops below the default for a small bounded read', () => {
    const b = resolveStreamBudget({ bounded: true, lines: 1 }, undefined, SMALL_CAP);
    expect(b).toBe(SMALL_CAP.defaultReturnBytes);
  });

  it('uses byte-bounded intent directly', () => {
    const b = resolveStreamBudget({ bounded: true, bytes: 4000 }, undefined, SMALL_CAP);
    expect(b).toBe(4000);
  });
});

describe('bash-output: processCapture', () => {
  beforeEach(() => _resetSpillDir());

  it('returns small output verbatim (not truncated)', () => {
    const c = captureFromString('hello\nworld\n', DEFAULT_OUTPUT_CAP);
    const r = processCapture(c, 'stdout', 'run1', DEFAULT_OUTPUT_CAP.defaultReturnBytes, DEFAULT_OUTPUT_CAP);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe('hello\nworld\n');
    expect(r.spillPath).toBeUndefined();
  });

  it('truncates and spills when over budget', () => {
    const full = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const c = captureFromString(full, SMALL_CAP);
    const r = processCapture(c, 'stdout', 'run2', SMALL_CAP.defaultReturnBytes, SMALL_CAP);
    expect(r.truncated).toBe(true);
    expect(r.text).toContain('omitted middle');
    expect(r.spillPath).toBeTruthy();
  });

  it('spill file contains the full output when within the ceiling', () => {
    // ~3.5KB: over the 1KB budget (so it spills) but under the 8KB ceiling.
    const full = Array.from({ length: 500 }, (_, i) => `row-${i}`).join('\n');
    const c = captureFromString(full, SMALL_CAP);
    expect(c.dropped).toBe(false);
    const r = processCapture(c, 'stdout', 'run3', SMALL_CAP.defaultReturnBytes, SMALL_CAP);
    expect(r.capExceeded).toBe(false);
    const onDisk = readFileSync(r.spillPath!, 'utf-8');
    expect(onDisk).toBe(full);
  });

  it('marks capExceeded and notes lost bytes when over the ceiling', () => {
    const full = 'x'.repeat(50 * KB); // > 8KB ceiling
    const c = captureFromString(full, SMALL_CAP);
    expect(c.dropped).toBe(true);
    const r = processCapture(c, 'stdout', 'run4', SMALL_CAP.defaultReturnBytes, SMALL_CAP);
    expect(r.capExceeded).toBe(true);
    expect(r.text).toContain('capture ceiling');
    const onDisk = readFileSync(r.spillPath!, 'utf-8');
    expect(onDisk).toContain('not captured');
  });

  it('budget 0 suppresses the stream but still spills', () => {
    const full = Array.from({ length: 100 }, (_, i) => `n${i}`).join('\n');
    const c = captureFromString(full, SMALL_CAP);
    const r = processCapture(c, 'stdout', 'run5', 0, SMALL_CAP);
    expect(r.returnedBytes).toBe(0);
    expect(r.text).toContain('suppressed');
    expect(r.spillPath).toBeTruthy();
  });

  it('budget 0 on empty output returns empty, no spill', () => {
    const c = captureFromString('', SMALL_CAP);
    const r = processCapture(c, 'stderr', 'run6', 0, SMALL_CAP);
    expect(r.text).toBe('');
    expect(r.truncated).toBe(false);
    expect(r.spillPath).toBeUndefined();
  });

  it('does not spill when spillToFile is false but still truncates', () => {
    const full = Array.from({ length: 500 }, (_, i) => `n${i}`).join('\n');
    const cap = { ...SMALL_CAP, spillToFile: false };
    const c = captureFromString(full, cap);
    const r = processCapture(c, 'stdout', 'run7', cap.defaultReturnBytes, cap);
    expect(r.truncated).toBe(true);
    expect(r.spillPath).toBeUndefined();
    expect(r.text).toContain('spill disabled');
  });

  it('keeps head and tail content in the summary', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `marker${i}`);
    const c = captureFromString(lines.join('\n'), SMALL_CAP);
    const r = processCapture(c, 'stdout', 'run8', SMALL_CAP.defaultReturnBytes, SMALL_CAP);
    expect(r.text).toContain('marker0');
    expect(r.text).toContain('marker499');
  });
});
