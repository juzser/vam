/**
 * Detecting a Claude Code AGENT WORKTREE -- `<repo>/.claude/worktrees/
 * agent-<id>`, minted by `isolation: "worktree"` (the Claude Agent SDK's own
 * mechanism, unrelated to vam's OWN worktree feature, #496). The operator's
 * report: these show up as ordinary projects in the sidebar and in the New
 * session flow, and there is no way to tell vam "I don't want to see these".
 *
 * TWO SIGNALS, EITHER ONE ENOUGH: a REALPATH'd cwd carrying the literal
 * segment `/.claude/worktrees/`, or a branch named `worktree-agent-*`. The
 * realpath matters because a symlinked path could otherwise dodge the
 * segment check entirely.
 *
 * WHAT THIS MUST NOT MATCH: vam's own worktrees, `<repo>-worktrees/<slug>`
 * (`worktreesRootFor`, `src/main/worktrees/worktrees.ts`) -- a different
 * literal string, so the segment check alone already leaves them alone.
 */

import { describe, expect, it } from 'vitest';
import {
  AGENT_WORKTREE_PATH_SEGMENT,
  hasAgentWorktreeSegment,
  isAgentWorktreeBranch,
  isAgentWorktreeCwd,
} from '../../src/main/sources/agent-worktree.js';

describe('hasAgentWorktreeSegment', () => {
  it('matches a real Claude Code agent worktree path', () => {
    expect(
      hasAgentWorktreeSegment(
        '/Users/ser/scatola/jobs/projects/maestro/.claude/worktrees/agent-a0616e5e562d36873',
      ),
    ).toBe(true);
  });

  it('is the exact literal segment, exported for anyone else who needs it', () => {
    expect(AGENT_WORKTREE_PATH_SEGMENT).toBe('/.claude/worktrees/');
  });

  it('does NOT match vam’s own worktree layout -- a different literal string entirely', () => {
    expect(hasAgentWorktreeSegment('/Users/ser/scatola/jobs/projects/vam-worktrees/feat')).toBe(
      false,
    );
  });

  it('does NOT match an ordinary project that merely contains ".claude" as a directory name', () => {
    expect(hasAgentWorktreeSegment('/Users/ser/code/dotclaude-tools/worktrees/readme')).toBe(false);
  });

  it('does not match a bare ".claude/worktrees" with no trailing content, which is not a real row', () => {
    expect(hasAgentWorktreeSegment('/repo/.claude/worktrees')).toBe(false);
  });

  /**
   * S2, CROSS-PROVIDER REVIEW: the old check matched ANY path under
   * `/.claude/worktrees/`, not only a Claude Code AGENT worktree
   * (`agent-<id>`, the literal directory name Claude Code itself mints --
   * confirmed against real worktree admin dirs on this machine, `git
   * worktree list` in the maestro checkout: `.claude/worktrees/agent-<hex>`
   * on branch `worktree-agent-<hex>`). `docs/design/workspace-options.md`
   * only ever promised to hide THOSE -- a worktree a person makes under the
   * same container directory by hand, or with `claude --worktree <name>`,
   * is not one, and hiding it took away a worktree the operator asked vam to
   * manage with no way to get it back (`hideAgentWorktrees` is on by
   * default).
   */
  it('does NOT match a human-named worktree under the same container directory', () => {
    expect(hasAgentWorktreeSegment('/repo/.claude/worktrees/feature-x')).toBe(false);
  });

  it('does NOT match a human-named worktree nested one level deeper', () => {
    expect(hasAgentWorktreeSegment('/repo/.claude/worktrees/my-review/notes')).toBe(false);
  });

  it('matches "agent-" as a PREFIX of the first segment too, not only an exact worktree dir', () => {
    // Claude Code's own dirs are `agent-<hex>`; this stays permissive on the
    // prefix (rather than a fixed-length hex match) the same way
    // `isAgentWorktreeBranch`'s own `startsWith` does for the branch signal.
    expect(hasAgentWorktreeSegment('/repo/.claude/worktrees/agent-anything-else')).toBe(true);
  });
});

describe('isAgentWorktreeBranch', () => {
  it('matches the worktree-agent- branch prefix', () => {
    expect(isAgentWorktreeBranch('worktree-agent-a0616e5e562d36873')).toBe(true);
  });

  it('does not match an ordinary feature branch', () => {
    expect(isAgentWorktreeBranch('feat/sort-created')).toBe(false);
  });

  it('is false for null, never throws', () => {
    expect(isAgentWorktreeBranch(null)).toBe(false);
  });
});

describe('isAgentWorktreeCwd', () => {
  it('is true from the branch alone, without even asking realpath', async () => {
    const realpathFn = async () => {
      throw new Error('must not be called when the branch already answers');
    };
    await expect(isAgentWorktreeCwd('/w/anything', 'worktree-agent-x', realpathFn)).resolves.toBe(
      true,
    );
  });

  it('is true from a realpath’d segment when the branch does not say', async () => {
    const realpathFn = async (path: string) => `/real${path}`;
    await expect(
      isAgentWorktreeCwd('/link/.claude/worktrees/agent-1', null, realpathFn),
    ).resolves.toBe(true);
  });

  it('resolves the symlink before checking -- a path that only LOOKS safe through a link is still caught', async () => {
    // The raw path carries no such segment; only the resolved target does.
    const realpathFn = async () => '/Users/op/repo/.claude/worktrees/agent-9';
    await expect(isAgentWorktreeCwd('/link/to/somewhere', null, realpathFn)).resolves.toBe(true);
  });

  it('is false for an ordinary project, realpath included', async () => {
    const realpathFn = async (path: string) => path;
    await expect(isAgentWorktreeCwd('/w/vam', 'feat/sort-created', realpathFn)).resolves.toBe(
      false,
    );
  });

  it('falls back to the raw path, never throws, when realpath itself fails', async () => {
    const realpathFn = async () => {
      throw new Error('ENOENT');
    };
    await expect(
      isAgentWorktreeCwd('/repo/.claude/worktrees/agent-1', null, realpathFn),
    ).resolves.toBe(true);
    await expect(isAgentWorktreeCwd('/w/vam', null, realpathFn)).resolves.toBe(false);
  });
});
