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

  // D12: two presses of Start (or Start's Resume twin) within a few
  // milliseconds -- two rapid clicks, or Enter's native activation landing
  // beside a mouse click -- used to both pass `ownEmptyPane`'s proof before
  // either had typed a single key: the pane is still a shell to BOTH calls,
  // because the first has not run its own `send-keys` yet, so both typed the
  // provider's command into the one pane, one after the other. The guard has
  // to live here, ahead of the tmux round trip, because it is the only point
  // two overlapping calls for the SAME pane both pass through before doing
  // anything a second call could double.
  it('D12: a second call for the same pane, fired before the first settles, is refused rather than typed twice', async () => {
    const { run, calls } = fakeTmux(`${PROJECT}\t4242\t${PANE}\tzsh\n`);
    const [first, second] = await Promise.all([
      typeIntoOwnPane({ run, name: PANE, text: 'claude' }),
      typeIntoOwnPane({ run, name: PANE, text: 'claude' }),
    ]);
    const settled = [first, second];
    expect(settled.filter((r) => r === null)).toHaveLength(1);
    const refused = settled.find((r) => r !== null);
    expect(refused).toMatchObject({ kind: 'refused', code: 'start-in-flight' });
    // THE PROOF: not merely that one result LOOKS refused, but that tmux was
    // only ever asked to type the command once. `send-keys ... -l` is the
    // literal-text write; `-l` fails to appear a second time is what "typed
    // twice into the same pane" would have looked like here.
    const typed = calls.filter((c) => c[0] === 'send-keys' && c.includes('-l'));
    expect(typed).toHaveLength(1);
  });

  it('a call for a DIFFERENT pane is unaffected by one in flight on this one', async () => {
    const OTHER_PANE = 'vam-atlas-cc33dd';
    const run: TmuxRun = async (argv) => {
      const verb = argv[0] ?? '';
      if (verb === 'list-sessions') {
        return {
          failure: null,
          stdout: `${PROJECT}\t4242\t${PANE}\tzsh\n${PROJECT}\t4243\t${OTHER_PANE}\tzsh\n`,
          stderr: '',
        };
      }
      return { failure: null, stdout: '', stderr: '' };
    };
    const [first, second] = await Promise.all([
      typeIntoOwnPane({ run, name: PANE, text: 'claude' }),
      typeIntoOwnPane({ run, name: OTHER_PANE, text: 'codex' }),
    ]);
    expect(first).toBeNull();
    expect(second).toBeNull();
  });

  it('releases the guard once settled, so the SAME pane can be started again afterwards', async () => {
    const { run } = fakeTmux(`${PROJECT}\t4242\t${PANE}\tzsh\n`);
    await expect(typeIntoOwnPane({ run, name: PANE, text: 'claude' })).resolves.toBeNull();
    await expect(typeIntoOwnPane({ run, name: PANE, text: 'claude' })).resolves.toBeNull();
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
