import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from '../../src/repo-utils/fs.js';
import {
  processStream,
  summarizeOutput,
  DEFAULT_OUTPUT_CAP,
  _resetSpillDir,
  type OutputCapConfig,
} from '../../src/tools/bash-output.js';

const SMALL_CAP: OutputCapConfig = {
  maxBytesReturned: 200,
  maxLinesReturned: 10,
  spillToFile: true,
};

describe('bash-output: processStream', () => {
  beforeEach(() => _resetSpillDir());

  it('passes through small output untouched', () => {
    const r = processStream('hello world\n', 'stdout', 'run1', DEFAULT_OUTPUT_CAP);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe('hello world\n');
    expect(r.spillPath).toBeUndefined();
  });

  it('truncates when exceeding the line cap', () => {
    const full = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const r = processStream(full, 'stdout', 'run2', SMALL_CAP);
    expect(r.truncated).toBe(true);
    expect(r.totalLines).toBe(100);
    expect(r.text).toContain('omitted middle');
    expect(r.text.length).toBeLessThan(full.length);
  });

  it('truncates when exceeding the byte cap even with few lines', () => {
    const full = 'x'.repeat(5000); // single long line
    const r = processStream(full, 'stdout', 'run3', SMALL_CAP);
    expect(r.truncated).toBe(true);
    expect(r.totalBytes).toBe(5000);
    expect(r.returnedBytes).toBeLessThan(5000);
  });

  it('spills the COMPLETE output to a file and the path is reported', () => {
    const full = Array.from({ length: 100 }, (_, i) => `row-${i}`).join('\n');
    const r = processStream(full, 'stdout', 'run4', SMALL_CAP);
    expect(r.spillPath).toBeTruthy();
    const onDisk = readFileSync(r.spillPath!, 'utf-8');
    expect(onDisk).toBe(full);
  });

  it('banner contains totals and the spill path', () => {
    const full = Array.from({ length: 50 }, () => 'data').join('\n');
    const r = processStream(full, 'stderr', 'run5', SMALL_CAP);
    expect(r.text).toContain('truncated');
    expect(r.text).toContain('50 lines');
    expect(r.text).toContain(r.spillPath!);
  });

  it('does not spill when spillToFile is false but still truncates', () => {
    const full = Array.from({ length: 100 }, (_, i) => `n${i}`).join('\n');
    const r = processStream(full, 'stdout', 'run6', { ...SMALL_CAP, spillToFile: false });
    expect(r.truncated).toBe(true);
    expect(r.spillPath).toBeUndefined();
    expect(r.text).toContain('spill disabled');
  });

  it('keeps head and tail content in the summary', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `marker${i}`);
    const r = processStream(lines.join('\n'), 'stdout', 'run7', SMALL_CAP);
    expect(r.text).toContain('marker0');
    expect(r.text).toContain('marker99');
  });
});

describe('bash-output: summarizeOutput', () => {
  it('is bounded and contains the omission marker', () => {
    const full = Array.from({ length: 1000 }, (_, i) => `L${i}`).join('\n');
    const s = summarizeOutput(full, SMALL_CAP);
    expect(s).toContain('omitted middle');
    expect(s.length).toBeLessThan(full.length);
  });
});
