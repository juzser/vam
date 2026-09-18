/**
 * THE PRs TAB'S TWO CHANNELS, driven from main's side with no renderer in the
 * room.
 *
 * `test/main/link/ipc.test.ts` states the rule these are built inside and it
 * is sharper here, because one of these channels WRITES. The renderer runs its
 * own checks -- the reader refuses an address it would not open, the pane only
 * draws Merge on an open non-draft row -- and every one of those is a
 * CONVENIENCE. The arguments below go straight into the registered listener
 * the way a compromised page's `ipcRenderer.invoke` would deliver them: a
 * number the pane never drew, a branch name with `..` in it, an address on a
 * host that merely looks like GitHub. If every renderer-side check were
 * deleted tomorrow every assertion in this file would still hold, and that is
 * what makes this side the guarantee.
 *
 * Nothing here spawns anything: the action runner is injected, and what is
 * asserted is what it was HANDED -- or, in the refusal cases, that it was
 * never called at all.
 */

import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import { registerPrIpc } from '../../../src/main/pr/ipc.js';
import type {
  PrAction,
  PrActionOutcome,
} from '../../../src/main/sources/claude-code/pr-actions.js';
import type { PrLinkOutcome } from '../../../src/shared/pr-link.js';
import { PR_HOST } from '../../../src/shared/pr-link.js';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function harness(
  over: {
    openExternal?: (url: string) => Promise<void>;
    resolveCwd?: (sessionId: string) => Promise<string | null>;
    run?: (input: { cwd: string; action: PrAction }) => Promise<PrActionOutcome>;
  } = {},
) {
  const opened: string[] = [];
  const ran: { cwd: string; action: PrAction }[] = [];
  const handlers = new Map<string, Handler>();
  registerPrIpc(
    { handle: (channel, listener) => void handlers.set(channel, listener) },
    {
      openExternal: async (url) => {
        await (over.openExternal?.(url) ?? Promise.resolve());
        opened.push(url);
      },
      resolveCwd: over.resolveCwd ?? (async () => '/repo/atlas'),
      run: async (input) => {
        ran.push(input);
        return (await over.run?.(input)) ?? { ok: true, message: 'done' };
      },
    },
  );
  const open = handlers.get(CHANNELS.prsOpen);
  const act = handlers.get(CHANNELS.prsAction);
  if (open === undefined || act === undefined) {
    throw new Error('the pull request channels were never registered');
  }
  return {
    open: (...args: unknown[]) => open({}, ...args) as Promise<PrLinkOutcome>,
    act: (...args: unknown[]) => act({}, ...args) as Promise<PrActionOutcome>,
    opened,
    ran,
  };
}

describe('the channel that opens a pull request', () => {
  it('opens an https address on GitHub and says where it went', async () => {
    const { open, opened } = harness();
    const url = `https://${PR_HOST}/juzser/atlas/pull/411`;
    expect(await open(url)).toEqual({ ok: true, url });
    expect(opened).toEqual([url]);
  });

  /**
   * THE BOUND THAT IS THE WHOLE REASON THIS CHANNEL MAY EXIST, and it is
   * enforced here rather than at the call site. Each of these is a real shape:
   * a host that merely CONTAINS the word github, a subdomain of an attacker's
   * domain, plain http (downgradeable), and a scheme that is a program.
   */
  it('refuses anything that is not https on GitHub, and opens nothing', async () => {
    for (const bad of [
      `http://${PR_HOST}/juzser/atlas/pull/411`,
      'https://github.com.evil.test/juzser/atlas/pull/411',
      'https://evil.test/github.com/juzser/atlas/pull/411',
      'https://raw.githubusercontent.com/x',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://user@github.com/juzser/atlas/pull/411',
      '',
      'not an address',
      42,
      null,
      undefined,
    ]) {
      const { open, opened } = harness();
      const outcome = await open(bad);
      expect(outcome.ok, String(bad)).toBe(false);
      // A refusal is a SENTENCE, drawn beside the control that was pressed.
      if (!outcome.ok) expect(outcome.reason.length).toBeGreaterThan(5);
      expect(opened, String(bad)).toEqual([]);
    }
  });

  it('takes one address at a time', async () => {
    const { open, opened } = harness();
    expect((await open('https://github.com/a/b/pull/1', 'https://github.com/a/b/pull/2')).ok).toBe(
      false,
    );
    expect(opened).toEqual([]);
  });

  it('says so when no browser would take it, rather than claiming it opened', async () => {
    const { open } = harness({
      openExternal: () => Promise.reject(new Error('no handler for https')),
    });
    const outcome = await open(`https://${PR_HOST}/juzser/atlas/pull/411`);
    expect(outcome.ok).toBe(false);
  });
});

describe('the channel that merges or deletes', () => {
  it('runs a merge in the session’s own directory', async () => {
    const { act, ran } = harness();
    expect(await act('session-1', { kind: 'merge', number: 411, method: 'squash' })).toEqual({
      ok: true,
      message: 'done',
    });
    expect(ran).toEqual([
      { cwd: '/repo/atlas', action: { kind: 'merge', number: 411, method: 'squash' } },
    ]);
  });

  /**
   * THE DIRECTORY IS NEVER THE RENDERER'S TO NAME. It is resolved from the
   * session id on this side, exactly as the reader resolves where to ask. A
   * channel that took a path would let a pane act on a repository the session
   * is not in -- which is the invariant `pull-requests.ts` refuses `--repo` to
   * keep.
   */
  it('refuses when the session has no directory vam can find', async () => {
    const run = vi.fn();
    const { act } = harness({ resolveCwd: async () => null, run });
    const outcome = await act('ghost', { kind: 'merge', number: 411, method: 'squash' });
    expect(outcome.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a branch name that could climb out of the ref path, and spawns nothing', async () => {
    const { act, ran } = harness();
    const outcome = await act('session-1', {
      kind: 'delete-branch',
      branch: '../../../../repos/someone/else/git/refs/heads/main',
    });
    expect(outcome.ok).toBe(false);
    expect(ran).toEqual([]);
  });

  it('refuses a pull request number that is not one', async () => {
    for (const bad of [0, -3, 1.5, '411', null]) {
      const { act, ran } = harness();
      const outcome = await act('session-1', { kind: 'merge', number: bad, method: 'squash' });
      expect(outcome.ok, String(bad)).toBe(false);
      expect(ran, String(bad)).toEqual([]);
    }
  });

  /**
   * `--admin` IS NOT REACHABLE FROM THIS CHANNEL. The merge method is an
   * allowlist on main's side, so a renderer inventing a method -- or naming a
   * gh flag -- gets a refusal rather than a merge with an extra argument.
   */
  it('refuses a merge method it does not know, including a gh flag', async () => {
    for (const bad of ['admin', '--admin', 'auto', '', null, 42]) {
      const { act, ran } = harness();
      const outcome = await act('session-1', { kind: 'merge', number: 411, method: bad });
      expect(outcome.ok, String(bad)).toBe(false);
      expect(ran, String(bad)).toEqual([]);
    }
  });

  it('refuses an action shape it has never heard of', async () => {
    for (const bad of [
      { kind: 'close', number: 411 },
      { kind: 'merge' },
      { kind: 'delete-branch' },
      'merge',
      null,
      undefined,
    ]) {
      const { act, ran } = harness();
      const outcome = await act('session-1', bad);
      expect(outcome.ok, JSON.stringify(bad)).toBe(false);
      expect(ran, JSON.stringify(bad)).toEqual([]);
    }
  });

  it('refuses a session id that is not a string', async () => {
    const { act, ran } = harness();
    expect((await act(42, { kind: 'merge', number: 411, method: 'squash' })).ok).toBe(false);
    expect(ran).toEqual([]);
  });

  it('hands the runner’s own failure straight through, gh’s words and all', async () => {
    const { act } = harness({
      run: async () => ({
        ok: false,
        code: 'gh-failed',
        message: 'merge #411 failed: Pull request is not mergeable: the base branch was modified.',
      }),
    });
    const outcome = await act('session-1', { kind: 'merge', number: 411, method: 'squash' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('the base branch was modified');
  });

  it('answers in data when the runner throws, never by rejecting', async () => {
    const { act } = harness({ run: () => Promise.reject(new Error('nobody foresaw this')) });
    const outcome = await act('session-1', { kind: 'delete-branch', branch: 'feature/x' });
    expect(outcome.ok).toBe(false);
  });
});
