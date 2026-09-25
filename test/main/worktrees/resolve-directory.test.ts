import { describe, expect, it } from 'vitest';
import type { LiveAgent } from '../../../src/main/sources/claude-code/agents.js';
import { projectIdOf } from '../../../src/main/sources/claude-code/project-id.js';
import type { TmuxSession } from '../../../src/main/sources/tmux/spawn.js';
import { resolveProjectDirectoryFrom } from '../../../src/main/worktrees/resolve-directory.js';

function agent(cwd: string): LiveAgent {
  return {
    key: `${cwd}#1`,
    sessionId: 'sid',
    name: null,
    cwd,
    status: 'idle',
  } as LiveAgent;
}

function pane(cwd: string | undefined, project?: string): TmuxSession {
  return { project: project ?? '', name: 'vam-x', cwd } as TmuxSession;
}

describe('resolveProjectDirectoryFrom', () => {
  it('answers from a live agent whose cwd digests to the project id', () => {
    const cwd = '/repo/a';
    const id = projectIdOf(cwd);
    expect(resolveProjectDirectoryFrom([agent(cwd)], [], id)).toBe(cwd);
  });

  it('falls back to a pane when no agent answers', () => {
    const cwd = '/repo/b';
    const id = projectIdOf(cwd);
    expect(resolveProjectDirectoryFrom([], [pane(cwd)], id)).toBe(cwd);
  });

  it('prefers a live agent over a pane that disagrees', () => {
    const cwd = '/repo/c';
    const id = projectIdOf(cwd);
    expect(resolveProjectDirectoryFrom([agent(cwd)], [pane('/somewhere/else', id)], id)).toBe(cwd);
  });

  it('matches a pane by its own @vam-project tag before re-hashing its cwd', () => {
    const cwd = '/repo/d';
    const id = projectIdOf(cwd);
    expect(resolveProjectDirectoryFrom([], [pane(cwd, id)], id)).toBe(cwd);
  });

  it('refuses (null) when no agent and no pane names the project', () => {
    expect(resolveProjectDirectoryFrom([], [], 'claude-code:unknown-00000000')).toBeNull();
  });

  it('refuses (null) when panes disagree on the directory for one project id', () => {
    const id = 'claude-code:ambiguous-00000000';
    const panes = [pane('/repo/e', id), pane('/repo/e-elsewhere', id)];
    expect(resolveProjectDirectoryFrom([], panes, id)).toBeNull();
  });

  it('ignores a pane with no cwd at all', () => {
    const id = 'claude-code:none-00000000';
    expect(resolveProjectDirectoryFrom([], [pane(undefined, id)], id)).toBeNull();
  });
});
