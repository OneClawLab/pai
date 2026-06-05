import { describe, it, expect } from 'vitest';
import { analyzeOutputIntent } from '../../src/tools/bash-output-intent.js';

describe('bash-output-intent: bounded readers', () => {
  it('head -n N (separate)', () => {
    expect(analyzeOutputIntent('head -n 500 file.txt')).toMatchObject({ bounded: true, lines: 500 });
  });

  it('head -n500 (glued)', () => {
    expect(analyzeOutputIntent('head -n500 file.txt')).toMatchObject({ bounded: true, lines: 500 });
  });

  it('head -c N (bytes)', () => {
    expect(analyzeOutputIntent('head -c 100000 f')).toMatchObject({ bounded: true, bytes: 100000 });
  });

  it('tail -n N', () => {
    expect(analyzeOutputIntent('tail -n 40 log')).toMatchObject({ bounded: true, lines: 40 });
  });

  it('bare head → implicit 10-line bound', () => {
    expect(analyzeOutputIntent('head file')).toMatchObject({ bounded: true, lines: 10 });
  });

  it('--lines=N long form', () => {
    expect(analyzeOutputIntent('head --lines=25 f')).toMatchObject({ bounded: true, lines: 25 });
  });

  it('grep -m N', () => {
    expect(analyzeOutputIntent('grep -m 5 pattern f')).toMatchObject({ bounded: true, lines: 5 });
  });

  it("sed -n '1,800p' line range", () => {
    expect(analyzeOutputIntent("sed -n '1,800p' f")).toMatchObject({ bounded: true, lines: 800 });
  });

  it('sed -n 800p single line', () => {
    expect(analyzeOutputIntent('sed -n 800p f')).toMatchObject({ bounded: true, lines: 1 });
  });

  it('pipeline ending in head is bounded by the last stage', () => {
    expect(analyzeOutputIntent('cat huge.txt | head -n 20')).toMatchObject({ bounded: true, lines: 20 });
  });
});

describe('bash-output-intent: unbounded', () => {
  const unbounded = [
    'cat file.txt',
    'cat a b c',
    'seq 1 100000',
    'grep pattern f',          // no -m
    'sed s/x/y/ f',            // no -n range
    'head -n 20 f | cat',      // head not last
    'echo a; head -n 5 f',     // list, not single command
    'head -n 5 f && echo done',// logical expr
    'ls -la',
  ];
  for (const cmd of unbounded) {
    it(`unbounded: ${cmd}`, () => {
      expect(analyzeOutputIntent(cmd).bounded).toBe(false);
    });
  }
});

describe('bash-output-intent: fail-open', () => {
  it('unparseable command → unbounded', () => {
    expect(analyzeOutputIntent('echo "unterminated').bounded).toBe(false);
  });

  it('empty command → unbounded', () => {
    expect(analyzeOutputIntent('').bounded).toBe(false);
  });
});
