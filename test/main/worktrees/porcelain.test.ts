/**
 * `git worktree list --porcelain -z` (and the non-`-z` fallback for an older
 * git) turned into structured records. Every fixture below is the literal
 * byte shape git documents, not a paraphrase of it.
 */

import { describe, expect, it } from 'vitest';
import { parseWorktreeListPorcelain } from '../../../src/main/worktrees/porcelain.js';

/** Builds the `-z` byte shape: fields NUL-joined, each record NUL-terminated. */
function z(...records: readonly (readonly string[])[]): string {
  return records.map((fields) => `${fields.join('\0')}\0\0`).join('');
}

describe('parseWorktreeListPorcelain — `-z` (NUL-separated)', () => {
  it('parses the main worktree and one linked worktree, both on an attached branch', () => {
    const output = z(
      ['worktree /repo', 'HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'branch refs/heads/main'],
      [
        'worktree /repo-worktrees/feat',
        'HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'branch refs/heads/feat',
      ],
    );
    const entries = parseWorktreeListPorcelain(output, '\0');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      path: '/repo',
      headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      branchRef: 'refs/heads/main',
      bare: false,
      detached: false,
      locked: false,
      prunable: false,
    });
    expect(entries[1]).toMatchObject({
      path: '/repo-worktrees/feat',
      branchRef: 'refs/heads/feat',
    });
  });

  it('parses a DETACHED HEAD, which carries no branch line at all', () => {
    const output = z([
      'worktree /repo-worktrees/pinned',
      'HEAD cccccccccccccccccccccccccccccccccccccccc',
      'detached',
    ]);
    const [entry] = parseWorktreeListPorcelain(output, '\0');
    expect(entry).toMatchObject({ detached: true, branchRef: null });
  });

  it('parses a BARE repository entry', () => {
    const output = z(['worktree /bare.git', 'bare']);
    const [entry] = parseWorktreeListPorcelain(output, '\0');
    expect(entry).toMatchObject({ bare: true, branchRef: null, headSha: null });
  });

  it('parses `locked` with and without a reason', () => {
    const output = z(
      [
        'worktree /repo-worktrees/a',
        'HEAD dddddddddddddddddddddddddddddddddddddddd',
        'branch refs/heads/a',
        'locked',
      ],
      [
        'worktree /repo-worktrees/b',
        'HEAD eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        'branch refs/heads/b',
        'locked manual hold',
      ],
    );
    const entries = parseWorktreeListPorcelain(output, '\0');
    expect(entries[0]).toMatchObject({ locked: true, lockedReason: null });
    expect(entries[1]).toMatchObject({ locked: true, lockedReason: 'manual hold' });
  });

  it('parses `prunable` with a reason', () => {
    const output = z([
      'worktree /repo-worktrees/gone',
      'HEAD ffffffffffffffffffffffffffffffffffffffff',
      'branch refs/heads/gone',
      'prunable gitdir file points to non-existent location',
    ]);
    const [entry] = parseWorktreeListPorcelain(output, '\0');
    expect(entry).toMatchObject({
      prunable: true,
      prunableReason: 'gitdir file points to non-existent location',
    });
  });

  it('answers an empty list for empty output', () => {
    expect(parseWorktreeListPorcelain('', '\0')).toEqual([]);
  });

  it('ignores an attribute it does not recognise rather than failing the whole record', () => {
    const output = z([
      'worktree /repo-worktrees/future',
      'HEAD 0000000000000000000000000000000000000000',
      'branch refs/heads/future',
      'a-future-git-added-this locked-in-some-new-way',
    ]);
    const [entry] = parseWorktreeListPorcelain(output, '\0');
    expect(entry.path).toBe('/repo-worktrees/future');
    expect(entry.branchRef).toBe('refs/heads/future');
  });
});

describe('parseWorktreeListPorcelain — plain porcelain (older git, no `-z`)', () => {
  it('parses records separated by a blank line, newline-terminated', () => {
    const output =
      'worktree /repo\nHEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nbranch refs/heads/main\n\n' +
      'worktree /repo-worktrees/feat\nHEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\nbranch refs/heads/feat\n\n';
    const entries = parseWorktreeListPorcelain(output, '\n');
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      path: '/repo-worktrees/feat',
      branchRef: 'refs/heads/feat',
    });
  });

  it('tolerates a missing trailing blank line on the last record', () => {
    const output =
      'worktree /repo\nHEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nbranch refs/heads/main';
    const entries = parseWorktreeListPorcelain(output, '\n');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe('/repo');
  });
});
