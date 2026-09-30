import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listDirectory, type ReadDir } from '../../../src/main/files/list.js';

const readDir: ReadDir = async (p) => readdirSync(p, { withFileTypes: true });
const tmp = () => mkdtempSync(join(tmpdir(), 'vam-ignored-'));
const marked = (entries: readonly { name: string; ignored?: true }[]) =>
  entries.filter((e) => e.ignored).map((e) => e.name);

function repo(gitignore?: string): string {
  const root = tmp();
  execFileSync('git', ['init', '-q'], { cwd: root });
  if (gitignore !== undefined) writeFileSync(join(root, '.gitignore'), gitignore);
  mkdirSync(join(root, 'build/sub'), { recursive: true });
  mkdirSync(join(root, 'src'));
  for (const f of ['debug.log', 'keep.log', 'build/sub/x.txt']) writeFileSync(join(root, f), '');
  return root;
}

describe('listDirectory git marks', () => {
  it('(i) marks what git ignores and resolves negation through git', async () => {
    const root = repo('build/\n*.log\n!keep.log\n');
    expect(marked(await listDirectory(root, '', readDir))).toEqual(['build', 'debug.log']);
  });

  it('(ii) marks entries inside an ignored directory', async () => {
    const root = repo('build/\n');
    expect(marked(await listDirectory(root, 'build/sub', readDir))).toEqual(['x.txt']);
  });

  it('(iii) a repo with no .gitignore marks nothing', async () => {
    expect(marked(await listDirectory(repo(), '', readDir))).toEqual([]);
  });

  it('(iv) a directory outside any repo lists as before, with no marks', async () => {
    const root = tmp();
    writeFileSync(join(root, 'a.txt'), '');
    const out = await listDirectory(root, '', readDir);
    expect(out).toEqual([{ name: 'a.txt', kind: 'file' }]);
  });

  it('(v) makes exactly one git call per non-empty listing, none for an empty one', async () => {
    const root = repo('build/\n');
    const calls: string[][] = [];
    const run = async (_cwd: string, args: readonly string[], input: string) => {
      calls.push([...args, input]);
      return 'build\0';
    };
    const out = await listDirectory(root, '', readDir, run);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(0, 3)).toEqual(['check-ignore', '--stdin', '-z']);
    expect(marked(out)).toEqual(['build']);
    await listDirectory(tmp(), '', readDir, run);
    expect(calls).toHaveLength(1);
  });

  it('a failing runner never fails the listing', async () => {
    const root = repo('build/\n');
    const out = await listDirectory(root, '', readDir, async () => Promise.reject(new Error('x')));
    expect(marked(out)).toEqual([]);
    expect(out.length).toBeGreaterThan(0);
  });
});
