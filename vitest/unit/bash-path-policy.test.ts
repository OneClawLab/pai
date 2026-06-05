import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import {
  resolveTarget,
  matchPattern,
  extractFileOps,
  checkPathPolicy,
  type PathPolicy,
} from '../../src/tools/bash-path-policy.js';
import { detectDangers } from '../../src/tools/bash-danger.js';
import type { SimpleCommand } from '../../src/tools/bash-danger.js';
import { path } from '../../src/repo-utils/path.js';

const HOME = path.toPosixPath(homedir());

// Never-exists probe → all writes classify as 'create'.
const noExist = () => false;
// Always-exists probe → all writes classify as 'overwrite'.
const allExist = () => true;

const cmd = (name: string, args: string[], redirects: SimpleCommand['redirects'] = []): SimpleCommand =>
  ({ name, args, redirects });

describe('bash-path-policy: resolveTarget', () => {
  it('expands ~ and $HOME', () => {
    expect(resolveTarget('~/x', undefined, HOME)).toBe(`${HOME}/x`);
    expect(resolveTarget('$HOME/y', undefined, HOME)).toBe(`${HOME}/y`);
  });

  it('resolves relative against cwd', () => {
    expect(resolveTarget('sub/f.txt', '/work/proj', HOME)).toBe('/work/proj/sub/f.txt');
    expect(resolveTarget('../x', '/work/proj', HOME)).toBe('/work/x');
  });

  it('keeps absolute paths', () => {
    expect(resolveTarget('/etc/hosts', '/work', HOME)).toBe('/etc/hosts');
  });
});

describe('bash-path-policy: matchPattern', () => {
  it('plain path matches itself and subtree', () => {
    expect(matchPattern('/work/proj', '/work/proj', HOME)).toBe(true);
    expect(matchPattern('/work/proj', '/work/proj/a/b', HOME)).toBe(true);
    expect(matchPattern('/work/proj', '/work/projector', HOME)).toBe(false);
    expect(matchPattern('/work/proj', '/work', HOME)).toBe(false);
  });

  it('~ pattern expands', () => {
    expect(matchPattern('~/.ssh', `${HOME}/.ssh/id_rsa`, HOME)).toBe(true);
  });

  it('* stays within a segment', () => {
    expect(matchPattern('/var/log/*.log', '/var/log/app.log', HOME)).toBe(true);
    expect(matchPattern('/var/log/*.log', '/var/log/sub/app.log', HOME)).toBe(false);
  });

  it('** crosses segments', () => {
    expect(matchPattern('/src/**', '/src/a/b/c.ts', HOME)).toBe(true);
  });
});

describe('bash-path-policy: extractFileOps', () => {
  it('rm → delete', () => {
    const ops = extractFileOps(cmd('rm', ['-rf', 'build']), '/proj', HOME, noExist);
    expect(ops).toEqual([{ op: 'delete', absPath: '/proj/build', raw: 'build', glob: false }]);
  });

  it('redirect > to new file → create', () => {
    const ops = extractFileOps(cmd('echo', ['x'], [{ op: '>', target: 'out.txt' }]), '/proj', HOME, noExist);
    expect(ops[0]).toMatchObject({ op: 'create', absPath: '/proj/out.txt' });
  });

  it('redirect > to existing file → overwrite', () => {
    const ops = extractFileOps(cmd('echo', ['x'], [{ op: '>', target: 'out.txt' }]), '/proj', HOME, allExist);
    expect(ops[0]).toMatchObject({ op: 'overwrite', absPath: '/proj/out.txt' });
  });

  it('redirect >> → write (append)', () => {
    const ops = extractFileOps(cmd('echo', ['x'], [{ op: '>>', target: 'log' }]), '/proj', HOME, noExist);
    expect(ops[0]).toMatchObject({ op: 'write', absPath: '/proj/log' });
  });

  it('cp reads sources and writes dest', () => {
    const ops = extractFileOps(cmd('cp', ['a.txt', 'b.txt']), '/proj', HOME, noExist);
    expect(ops).toEqual([
      { op: 'read', absPath: '/proj/a.txt', raw: 'a.txt', glob: false },
      { op: 'create', absPath: '/proj/b.txt', raw: 'b.txt', glob: false },
    ]);
  });

  it('mv deletes source and writes dest', () => {
    const ops = extractFileOps(cmd('mv', ['a', 'b']), '/proj', HOME, allExist);
    expect(ops.map(o => o.op)).toEqual(['delete', 'overwrite']);
  });

  it('sed -i → overwrite', () => {
    const ops = extractFileOps(cmd('sed', ['-i', 's/x/y/', 'f.txt']), '/proj', HOME, allExist);
    expect(ops).toEqual([{ op: 'overwrite', absPath: '/proj/f.txt', raw: 'f.txt', glob: false }]);
  });

  it('cat → read', () => {
    const ops = extractFileOps(cmd('cat', ['f.txt']), '/proj', HOME, noExist);
    expect(ops[0]).toMatchObject({ op: 'read', absPath: '/proj/f.txt' });
  });

  it('glob target reduces to literal parent dir and is flagged', () => {
    const ops = extractFileOps(cmd('rm', ['-rf', 'dist/*.js']), '/proj', HOME, noExist);
    expect(ops[0]).toMatchObject({ op: 'delete', absPath: '/proj/dist', glob: true });
  });
});

describe('bash-path-policy: checkPathPolicy', () => {
  const policy: PathPolicy = {
    rules: [
      { pattern: '/proj/src', allow: ['read', 'write', 'create', 'overwrite', 'delete'] },
      { pattern: '~/.ssh', deny: ['write', 'create', 'overwrite', 'delete'], allow: ['read'] },
      { pattern: '/proj', warn: ['delete', 'overwrite'] },
    ],
    default: 'allow',
  };

  it('allows operations inside an allowed subtree', () => {
    const v = checkPathPolicy([cmd('rm', ['src/old.ts'])], { policy, cwd: '/proj', homeDir: HOME });
    expect(v).toHaveLength(0);
  });

  it('denies writing into ~/.ssh', () => {
    const v = checkPathPolicy([cmd('echo', ['x'], [{ op: '>', target: `${HOME}/.ssh/authorized_keys` }])],
      { policy, cwd: '/proj', homeDir: HOME });
    expect(v.some(x => x.severity === 'deny' && x.code.startsWith('PATH_POLICY'))).toBe(true);
  });

  it('allows reading ~/.ssh', () => {
    const v = checkPathPolicy([cmd('cat', [`${HOME}/.ssh/config`])], { policy, cwd: '/proj', homeDir: HOME });
    expect(v).toHaveLength(0);
  });

  it('warns on delete inside /proj (outside src)', () => {
    const v = checkPathPolicy([cmd('rm', ['-rf', 'build'])], { policy, cwd: '/proj', homeDir: HOME });
    expect(v.some(x => x.severity === 'warn' && x.code === 'PATH_POLICY_DELETE')).toBe(true);
  });

  it('default deny blocks unmatched paths', () => {
    const denyAll: PathPolicy = { rules: [{ pattern: '/proj/**', allow: ['read', 'write', 'create', 'overwrite', 'delete'] }], default: 'deny' };
    const v = checkPathPolicy([cmd('rm', ['/etc/hosts'])], { policy: denyAll, cwd: '/proj', homeDir: HOME });
    expect(v.some(x => x.severity === 'deny')).toBe(true);
  });

  it('first matching rule wins', () => {
    const v = checkPathPolicy([cmd('rm', ['src/x.ts'])], { policy, cwd: '/proj', homeDir: HOME });
    expect(v).toHaveLength(0); // /proj/src allow wins over /proj warn
  });
});

describe('bash-path-policy: integration via detectDangers', () => {
  const policy: PathPolicy = {
    rules: [{ pattern: '~/projects', allow: ['read', 'write', 'create', 'overwrite', 'delete'] }],
    default: 'deny',
  };

  it('denies a write outside the allowed root', () => {
    const r = detectDangers(`echo hi > ${HOME}/secret.txt`, { pathPolicy: policy }, HOME);
    expect(r.blocked).toBe(true);
    expect(r.violations.some(v => v.code.startsWith('PATH_POLICY'))).toBe(true);
  });

  it('allows a write inside the allowed root', () => {
    const r = detectDangers(`echo hi > ${HOME}/projects/app/x.txt`, { pathPolicy: policy }, HOME);
    expect(r.blocked).toBe(false);
  });

  it('catastrophic presets still win regardless of policy', () => {
    const permissive: PathPolicy = { rules: [{ pattern: '/**', allow: ['read', 'write', 'create', 'overwrite', 'delete'] }], default: 'allow' };
    const r = detectDangers('rm -rf /', { pathPolicy: permissive }, HOME);
    expect(r.blocked).toBe(true);
    expect(r.violations.some(v => v.code === 'RM_CATASTROPHIC')).toBe(true);
  });

  it('no policy → no path-policy violations', () => {
    const r = detectDangers(`echo hi > ${HOME}/whatever.txt`, {}, HOME);
    expect(r.violations.some(v => v.code.startsWith('PATH_POLICY'))).toBe(false);
  });

  it('PATH_POLICY can be disabled via disabledCodes', () => {
    const r = detectDangers(`rm ${HOME}/x.txt`, { pathPolicy: policy, disabledCodes: ['PATH_POLICY'] }, HOME);
    expect(r.violations.some(v => v.code.startsWith('PATH_POLICY'))).toBe(false);
  });

  it('warn-only mode downgrades policy deny to warn', () => {
    const r = detectDangers(`rm ${HOME}/x.txt`, { pathPolicy: policy, mode: 'warn-only' }, HOME);
    expect(r.blocked).toBe(false);
    expect(r.violations.some(v => v.code.startsWith('PATH_POLICY') && v.severity === 'warn')).toBe(true);
  });
});
