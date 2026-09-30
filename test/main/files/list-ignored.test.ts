import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listDirectory, type ReadDir } from '../../../src/main/files/list.js';

const readDir: ReadDir = async (p) => readdirSync(p, { withFileTypes: true });
const tmp = () => mkdtempSync(join(tmpdir(), 'vam-ignored-'));
const marked = async (root: string, dir = '', run?: Parameters<typeof listDirectory>[3]) =>
  (await listDirectory(root, dir, readDir, run)).filter((e) => e.ignored).map((e) => e.name);

function repo(gitignore?: string): string {
  const root = tmp();
  execFileSync('git', ['init', '-q'], { cwd: root });
  if (gitignore !== undefined) writeFileSync(join(root, '.gitignore'), gitignore);
  mkdirSync(join(root, 'build/sub'), { recursive: true });
  for (const f of ['debug.log', 'keep.log', 'build/sub/x.txt']) writeFileSync(join(root, f), '');
  return root;
}

describe('listDirectory git marks', () => {
  it('marks what git ignores, resolves negation, and reaches inside an ignored directory', async () => {
    expect(await marked(repo('build/\n*.log\n!keep.log\n'))).toEqual(['build', 'debug.log']);
    expect(await marked(repo('build/\n'), 'build/sub')).toEqual(['x.txt']);
  });

  it('marks nothing without a .gitignore or outside a repo, and lists as before', async () => {
    expect(await marked(repo())).toEqual([]);
    const root = tmp();
    writeFileSync(join(root, 'a.txt'), '');
    expect(await listDirectory(root, '', readDir)).toEqual([{ name: 'a.txt', kind: 'file' }]);
  });

  it('a tracked file that matches an ignore rule is not marked', async () => {
    const root = repo('*.log\n');
    execFileSync('git', ['add', '-f', 'debug.log'], { cwd: root });
    expect(await marked(root)).toEqual(['keep.log']);
  });

  it('one git call per non-empty listing, NUL names on stdin, in the listed directory', async () => {
    const calls: { cwd: string; args: readonly string[]; input: string }[] = [];
    const run = async (cwd: string, args: readonly string[], input: string) => {
      calls.push({ cwd, args, input });
      return 'sub\0';
    };
    const root = repo('build/\n');
    expect(await marked(root, 'build', run)).toEqual(['sub']);
    await listDirectory(tmp(), '', readDir, run);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cwd).toBe(`${root}/build`);
    expect(calls[0]?.args.slice(0, 3)).toEqual(['check-ignore', '--stdin', '-z']);
    expect(calls[0]?.args).not.toContain('--no-index');
    expect(calls[0]?.input).toBe('sub\0');
  });

  it('a failing runner never fails the listing', async () => {
    const out = await listDirectory(repo('build/\n'), '', readDir, () =>
      Promise.reject(new Error('x')),
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((e) => e.ignored)).toBe(false);
  });
});
