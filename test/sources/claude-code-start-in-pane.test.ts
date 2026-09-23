/**
 * The two writes a PANE ROW answers to -- `docs/design/vam-owns-the-session.md`
 * §3 and §5 -- and what each must prove before it acts.
 *
 * Start session TYPES the provider's command into the pane vam already owns;
 * it spawns nothing. Close KILLS that pane. Both are aimed at a tmux session
 * BY NAME, which is a power no other write in this source has (every other
 * resolves its pane through `paneForRow`), so both re-prove the name against
 * `listVamSessions` first: the operator's own sessions never appear in that
 * listing, and a name that is not in it is refused by the same words the rest
 * of vam refuses with.
 */

import { describe, expect, it } from 'vitest';
import { killOwnPane, typeIntoOwnPane } from '../../src/main/sources/claude-code/start-in-pane.js';
import type { TmuxRun } from '../../src/main/sources/tmux/spawn.js';

const PANE = 'vam-atlas-aa11bb';
const PROJECT = 'claude-code:atlas-11111111';

/** A tmux whose `list-sessions` answers `listing`, recording every call. */
function fakeTmux(listing: string, failing: ReadonlySet<string> = new Set()) {
  const calls: (readonly string[])[] = [];
  const run: TmuxRun = async (argv) => {
    calls.push(argv);
    const verb = argv[0] ?? '';
    if (failing.has(verb)) return { failure: { message: 'exit 1' }, stdout: '', stderr: 'nope' };
    return { failure: null, stdout: verb === 'list-sessions' ? listing : '', stderr: '' };
  };
  return { run, calls };
}

describe('typeIntoOwnPane -- Start session', () => {
  it('types the command literally, then presses Return, into the named pane', async () => {
    const { run, calls } = fakeTmux(`${PROJECT}\t4242\t${PANE}\tzsh\n`);
    await expect(typeIntoOwnPane({ run, name: PANE, text: 'codex' })).resolves.toBeNull();
    expect(calls.slice(1)).toEqual([
      ['send-keys', '-t', `=${PANE}:`, '-l', '--', 'codex'],
      ['send-keys', '-t', `=${PANE}:`, 'Enter'],
    ]);
  });

  it('refuses a name that is not in vam’s own listing, and types nothing', async () => {
    const { run, calls } = fakeTmux(`${PROJECT}\t4242\t${PANE}\tzsh\n`);
    const refused = await typeIntoOwnPane({ run, name: 'vam-atlas-gone99', text: 'claude' });
    expect(refused).toMatchObject({ kind: 'refused', code: 'not-vam-started' });
    expect(calls.map((c) => c[0])).toEqual(['list-sessions']);
  });

  it('refuses a pane that already has something other than a shell in front', async () => {
    // Typing `claude` into a running agent sends it as a PROMPT. The pane
    // row that offered Start was drawn a poll ago; by now the operator may
    // have typed the command by hand in the Terminal view.
    const { run, calls } = fakeTmux(`${PROJECT}\t4242\t${PANE}\tclaude\n`);
    const refused = await typeIntoOwnPane({ run, name: PANE, text: 'claude' });
    expect(refused).toMatchObject({ kind: 'refused', code: 'pane-occupied' });
    expect(refused?.message).toContain('claude');
    expect(calls.map((c) => c[0])).toEqual(['list-sessions']);
  });

  it('still types when the listing said nothing about the foreground -- absence is not an agent', async () => {
    const { run, calls } = fakeTmux(`${PROJECT}\t4242\t${PANE}\n`);
    await expect(typeIntoOwnPane({ run, name: PANE, text: 'claude' })).resolves.toBeNull();
    expect(calls).toHaveLength(3);
  });

  it('does not press Return when the text failed to land', async () => {
    const { run, calls } = fakeTmux(`${PROJECT}\t4242\t${PANE}\tzsh\n`, new Set(['send-keys']));
    const failed = await typeIntoOwnPane({ run, name: PANE, text: 'claude' });
    expect(failed).not.toBeNull();
    expect(calls.map((c) => c[0])).toEqual(['list-sessions', 'send-keys']);
  });

  it('carries the tmux reason when the listing itself could not be read', async () => {
    const { run } = fakeTmux('', new Set(['list-sessions']));
    const failed = await typeIntoOwnPane({ run, name: PANE, text: 'claude' });
    // `classifyTmuxFailure`'s own classification, not `not-vam-started`: an
    // unreadable listing is "vam could not ask", never "vam did not start it".
    expect(failed?.code).not.toBe('not-vam-started');
    expect(failed?.message).toMatch(/listing sessions/);
  });
});

describe('killOwnPane -- Close on a pane with no agent in it', () => {
  it('kills exactly the named session, once it is in vam’s own listing', async () => {
    const { run, calls } = fakeTmux(`${PROJECT}\t4242\t${PANE}\tzsh\n`);
    await expect(killOwnPane({ run, name: PANE })).resolves.toBeNull();
    expect(calls.slice(1)).toEqual([['kill-session', '-t', `=${PANE}`]]);
  });

  it('refuses -- kills nothing -- for a name that was never vam’s to begin with', async () => {
    const { run, calls } = fakeTmux(`${PROJECT}\t4242\t${PANE}\tzsh\n`);
    const refused = await killOwnPane({ run, name: 'notes' });
    expect(refused).toMatchObject({ kind: 'refused', code: 'not-vam-started' });
    expect(calls.map((c) => c[0])).toEqual(['list-sessions']);
  });

  it('IDEMPOTENT: succeeds -- there is nothing left to kill -- for vam’s own pane already gone', async () => {
    // `name` carries vam's own prefix (`vam-…`), so it was minted by
    // `vamSessionName` and this row can only exist because `pane-row.ts` once
    // read it out of `listVamSessions`. Its tmux session having ended between
    // that poll and this click -- the operator killed it by hand, or the
    // shell exited on its own -- means the goal of Close, "this pane is not
    // running", is already true. Reporting that as a refusal is the bug the
    // operator described: a row Close cannot make disappear.
    const { run, calls } = fakeTmux(`${PROJECT}\t4242\t${PANE}\tzsh\n`);
    await expect(killOwnPane({ run, name: 'vam-atlas-gone99' })).resolves.toBeNull();
    // Nothing was killed: there is no session by that name to send
    // `kill-session` to. Only the listing was asked.
    expect(calls.map((c) => c[0])).toEqual(['list-sessions']);
  });

  it('refuses a pane with an agent in it: that is the agent row’s Close, not this one', async () => {
    // The row that offered this Close was empty a poll ago. Killing the pane
    // now would cut an agent off mid-turn through a control that promised to
    // close an empty shell. The agent's own row closes it, with the
    // confirmation `stop.ts` owes a running one.
    const { run, calls } = fakeTmux(`${PROJECT}\t4242\t${PANE}\tclaude\n`);
    const refused = await killOwnPane({ run, name: PANE });
    expect(refused).toMatchObject({ kind: 'refused', code: 'pane-occupied' });
    expect(calls.map((c) => c[0])).toEqual(['list-sessions']);
  });

  it('reports a kill tmux refused as its own failure, not as a success', async () => {
    const { run } = fakeTmux(`${PROJECT}\t4242\t${PANE}\tzsh\n`, new Set(['kill-session']));
    const failed = await killOwnPane({ run, name: PANE });
    expect(failed).not.toBeNull();
    expect(failed?.message).toMatch(/closing/);
  });
});
