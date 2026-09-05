/**
 * Typing INTO the pane -- the second thing in vam that changes a tmux session
 * on the operator's server, and the one that lands inside a running agent.
 *
 * A resize aimed at the wrong session reflows someone else's screen. A
 * keystroke aimed at the wrong session is typed into someone else's work, and
 * a Return behind it submits it. So every test here is about the guard, not
 * about the keys: vam sends to a session it can PROVE it started for this
 * project by the recorded pairing, and to no other session ever.
 *
 * Nothing spawns -- the runner is a fake and the argv is asserted BY VALUE,
 * because the machine this runs on has live agents in real panes.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import { AIM_TTL_MS, registerTerminalIpc } from '../../../src/main/terminal/ipc.js';
import { sendSessionKey } from '../../../src/main/terminal/pane.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });
const failed = (stderr: string): TmuxRunResult => ({
  failure: { message: 'tmux failed' },
  stdout: '',
  stderr,
});

const ATLAS = 'claude-code:atlas-11111111';
const BEACON = 'claude-code:beacon-22222222';

function runner(answers: Record<string, TmuxRunResult>) {
  const argvs: (readonly string[])[] = [];
  const run: TmuxRun = async (argv) => {
    argvs.push(argv);
    return answers[argv[0] ?? ''] ?? failed(`no stub for ${argv[0] ?? ''}`);
  };
  return { run, argvs, verbs: () => argvs.map((argv) => argv[0]) };
}

const listing = (rows: string) => ({ 'list-sessions': ok(rows), 'send-keys': ok('') });

describe('typing into the session vam started for a project', () => {
  it('sends one literal send-keys for a character, and no Return', async () => {
    const { run, argvs } = runner(listing(`${ATLAS}\tvam-atlas-a1b2c3\n`));
    expect(await sendSessionKey(run, ATLAS, { kind: 'text', text: 'h' })).toBe('sent');
    // `-l` is the whole correctness: without it tmux looks the argument up as
    // a KEY NAME, so a pane would be sent `^[` for the letters of `Escape`.
    expect(argvs[1]).toEqual(['send-keys', '-t', '=vam-atlas-a1b2c3:', '-l', '--', 'h']);
    // Exactly one. A Return the operator did not press submits whatever is
    // sitting in the pane.
    expect(argvs).toHaveLength(2);
  });

  it('sends the interpreted Return for Enter, and nothing literal', async () => {
    const { run, argvs } = runner(listing(`${ATLAS}\tvam-atlas-a1b2c3\n`));
    expect(await sendSessionKey(run, ATLAS, { kind: 'enter' })).toBe('sent');
    expect(argvs[1]).toEqual(['send-keys', '-t', '=vam-atlas-a1b2c3:', 'Enter']);
    expect(argvs[1]).not.toContain('-l');
  });

  it('sends Backspace as the interpreted key, so a typo can be corrected', async () => {
    const { run, argvs } = runner(listing(`${ATLAS}\tvam-atlas-a1b2c3\n`));
    expect(await sendSessionKey(run, ATLAS, { kind: 'backspace' })).toBe('sent');
    expect(argvs[1]).toEqual(['send-keys', '-t', '=vam-atlas-a1b2c3:', 'BSpace']);
    expect(argvs[1]).not.toContain('-l');
  });

  it('refuses a Backspace it cannot aim, exactly like every other key', async () => {
    const { run, verbs } = runner(listing(`${BEACON}\tvam-beacon-d4e5f6\n`));
    expect(await sendSessionKey(run, ATLAS, { kind: 'backspace' })).toBe('unaimed');
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('cycles the mode with the interpreted BTab, never a plain tab', async () => {
    const { run, argvs } = runner(listing(`${ATLAS}\tvam-atlas-a1b2c3\n`));
    expect(await sendSessionKey(run, ATLAS, { kind: 'back-tab' })).toBe('sent');
    // BY VALUE, because the wrong spelling of this one is SILENT. Measured on
    // tmux 3.7b over a private `-L` socket: `send-keys BTab` delivered `^[[Z`,
    // the escape sequence Shift-Tab is, while `send-keys S-Tab` exited 0 and
    // delivered a plain tab -- which completes or indents, and reports
    // nothing.
    expect(argvs[1]).toEqual(['send-keys', '-t', '=vam-atlas-a1b2c3:', 'BTab']);
    expect(argvs[1]).not.toContain('-l');
    expect(argvs[1]).not.toContain('Tab');
    expect(argvs[1]).not.toContain('S-Tab');
    expect(argvs).toHaveLength(2);
  });

  it('sends NO BTab into a session vam cannot prove it started', async () => {
    // Aimed by the same guard as every other key: the pane vam started for
    // THIS project. Cycling somebody else's agent is not a smaller mistake
    // than typing into it.
    const { run, verbs } = runner(listing(`${BEACON}\tvam-beacon-d4e5f6\n`));
    expect(await sendSessionKey(run, ATLAS, { kind: 'back-tab' })).toBe('unaimed');
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('sends NO BTab through a published pane of another project', async () => {
    const { run, verbs } = runner(
      listing(`${ATLAS}\tvam-atlas-a1b2c3\n${BEACON}\tvam-beacon-d4e5f6\n`),
    );
    const panes = new Map([[ATLAS, 'vam-beacon-d4e5f6']]);
    expect(await sendSessionKey(run, ATLAS, { kind: 'back-tab' }, ATLAS, panes)).toBe('mispaired');
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('sends Escape as the interpreted key, because a TUI cancels on it', async () => {
    const { run, argvs } = runner(listing(`${ATLAS}\tvam-atlas-a1b2c3\n`));
    expect(await sendSessionKey(run, ATLAS, { kind: 'escape' })).toBe('sent');
    expect(argvs[1]).toEqual(['send-keys', '-t', '=vam-atlas-a1b2c3:', 'Escape']);
    expect(argvs[1]).not.toContain('-l');
  });

  it('refuses an Escape it cannot aim, exactly like every other key', async () => {
    const { run, verbs } = runner(listing(`${BEACON}\tvam-beacon-d4e5f6\n`));
    expect(await sendSessionKey(run, ATLAS, { kind: 'escape' })).toBe('unaimed');
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('sends text that reads as a key name as the characters it is', async () => {
    const { run, argvs } = runner(listing(`${ATLAS}\tvam-atlas-a1b2c3\n`));
    await sendSessionKey(run, ATLAS, { kind: 'text', text: 'Escape' });
    expect(argvs[1]).toEqual(['send-keys', '-t', '=vam-atlas-a1b2c3:', '-l', '--', 'Escape']);
  });

  it('sends NOTHING when no session vam started carries this project', async () => {
    const { run, verbs } = runner(listing(`${BEACON}\tvam-beacon-d4e5f6\n`));
    expect(await sendSessionKey(run, ATLAS, { kind: 'text', text: 'h' })).toBe('unaimed');
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('sends NOTHING to a session vam does not control', async () => {
    // An unset `@vam-project` reads back as the empty string: the operator's
    // own session, listed beside vam's. It is not vam's to type into.
    const { run, verbs } = runner(listing('\tsome-session\n'));
    expect(await sendSessionKey(run, ATLAS, { kind: 'text', text: 'h' })).toBe('unaimed');
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('sends NOTHING when two sessions answer to one project', async () => {
    // The tab draws no screen for `ambiguous`, and picking one of the two
    // would be a coin toss landing in a real agent's terminal.
    const { run, verbs } = runner(
      listing(`${ATLAS}\tvam-atlas-a1b2c3\n${ATLAS}\tvam-atlas-g7h8i9\n`),
    );
    expect(await sendSessionKey(run, ATLAS, { kind: 'text', text: 'h' })).toBe('unaimed');
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('says vam could not LOOK, rather than claiming a pairing failure', async () => {
    // The listing itself failed: tmux is not on PATH, or the call timed out.
    // vam did not look, so it cannot report what it would have found -- and
    // `unaimed` sends the operator after a duplicate or missing pairing that
    // nothing here has any evidence for.
    // NOT "no server running", which is an ANSWER -- no server means no
    // sessions -- and resolves to an empty listing (`tmux/spawn.ts`). This is
    // a failure that did not classify at all.
    const { run, verbs } = runner({ 'list-sessions': failed('tmux: connection lost') });
    expect(await sendSessionKey(run, ATLAS, { kind: 'text', text: 'h' })).toBe('unavailable');
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('reports a REFUSAL, not a pairing failure, when tmux declined the keystroke', async () => {
    // vam named a session and tmux would not deliver to it -- almost always
    // one that ended between the listing and the send. Reporting that as
    // `unaimed` sent the operator looking for a pairing problem that is not
    // there; the tab draws a different sentence for each.
    const { run } = runner({
      'list-sessions': ok(`${ATLAS}\tvam-atlas-a1b2c3\n`),
      'send-keys': failed("can't find pane"),
    });
    expect(await sendSessionKey(run, ATLAS, { kind: 'text', text: 'h' })).toBe('refused');
  });

  it('aims at the pane the session published, not at the project', async () => {
    const { run, argvs } = runner(
      listing(`${ATLAS}\tvam-atlas-a1b2c3\n${ATLAS}\tvam-atlas-g7h8i9\n`),
    );
    const panes = new Map([[ATLAS, 'vam-atlas-g7h8i9']]);
    expect(await sendSessionKey(run, ATLAS, { kind: 'text', text: 'h' }, ATLAS, panes)).toBe(
      'sent',
    );
    expect(argvs[1]?.[2]).toBe('=vam-atlas-g7h8i9:');
  });

  it('refuses a published pane belonging to ANOTHER project', async () => {
    // The fast path asked only whether the name was in vam's listing, while
    // the fallback filtered on the project: a stale published value naming a
    // session of Beacon's resolved as a confident single Atlas match, and the
    // keystroke was typed into Beacon's running agent.
    const { run, verbs } = runner(listing(`${BEACON}\tvam-beacon-d4e5f6\n`));
    const panes = new Map([[ATLAS, 'vam-beacon-d4e5f6']]);
    // vam DID name a session and rejected the one it named. That is not "no
    // session of mine answers for this project", which is what `unaimed`
    // says, and the read path has kept the two apart since `PaneView` gained
    // its own `mispaired` arm.
    expect(await sendSessionKey(run, ATLAS, { kind: 'text', text: 'h' }, ATLAS, panes)).toBe(
      'mispaired',
    );
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('does NOT fall back to the project’s own session when the published one is another’s', async () => {
    // THIS TEST ASSERTED THE DEFECT until the branches were gated against
    // each other: it expected the keystroke to land in `vam-atlas-a1b2c3`.
    // Rejecting the published value and then letting the tag path answer aims
    // the key at a session chosen by a rule that never looked at this row --
    // healthy, live, and not the one the operator is typing in.
    const { run, verbs } = runner(
      listing(`${ATLAS}\tvam-atlas-a1b2c3\n${BEACON}\tvam-beacon-d4e5f6\n`),
    );
    const panes = new Map([[ATLAS, 'vam-beacon-d4e5f6']]);
    // vam DID name a session and rejected the one it named. That is not "no
    // session of mine answers for this project", which is what `unaimed`
    // says, and the read path has kept the two apart since `PaneView` gained
    // its own `mispaired` arm.
    expect(await sendSessionKey(run, ATLAS, { kind: 'text', text: 'h' }, ATLAS, panes)).toBe(
      'mispaired',
    );
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('types where the three cases say it may, and nowhere else', async () => {
    const stdout = `${ATLAS}\tvam-atlas-a1b2c3\n${BEACON}\tvam-beacon-d4e5f6\n`;
    // 1. NOBODY SAID: no published value, and the project names exactly one.
    const nobody = runner(listing(stdout));
    await sendSessionKey(nobody.run, ATLAS, { kind: 'text', text: 'h' }, ATLAS, new Map());
    expect(nobody.argvs[1]?.[2]).toBe('=vam-atlas-a1b2c3:');
    // 2. IT AGREES: resolved, bypassing the counts by design.
    const agrees = runner(listing(stdout));
    await sendSessionKey(
      agrees.run,
      ATLAS,
      { kind: 'text', text: 'h' },
      ATLAS,
      new Map([[ATLAS, 'vam-atlas-a1b2c3']]),
    );
    expect(agrees.argvs[1]?.[2]).toBe('=vam-atlas-a1b2c3:');
    // 3. IT DISAGREES: nothing is sent at all, and no fallback is consulted.
    const disagrees = runner(listing(stdout));
    await sendSessionKey(
      disagrees.run,
      ATLAS,
      { kind: 'text', text: 'h' },
      ATLAS,
      new Map([[ATLAS, 'vam-beacon-d4e5f6']]),
    );
    expect(disagrees.verbs()).toEqual(['list-sessions']);
  });

  it('ignores a published pane that is not in vam’s own listing', async () => {
    // A pane the OPERATOR started publishes into the same directory. It is
    // never acted on -- and it is `mispaired` rather than `unaimed`, because
    // the row did name where it is and vam refused that name.
    const { run, verbs } = runner(listing(`${BEACON}\tvam-beacon-d4e5f6\n`));
    const panes = new Map([[ATLAS, 'their-own-session']]);
    expect(await sendSessionKey(run, ATLAS, { kind: 'text', text: 'h' }, ATLAS, panes)).toBe(
      'mispaired',
    );
    expect(verbs()).toEqual(['list-sessions']);
  });
});

describe('the send channel refuses what the renderer may not ask', () => {
  function handler() {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const { run, argvs } = runner(listing(`${ATLAS}\tvam-atlas-a1b2c3\n`));
    registerTerminalIpc(
      { handle: (channel, listener) => void handlers.set(channel, listener) },
      run,
      async () => new Map(),
    );
    const send = handlers.get(CHANNELS.terminalSend);
    if (send === undefined) throw new Error('the send channel was never registered');
    return { send, argvs };
  }

  it('carries a Backspace across the bridge like the other two keys', async () => {
    const { send, argvs } = handler();
    expect(await send({}, ATLAS, { kind: 'backspace' })).toBe('sent');
    expect(argvs[1]).toEqual(['send-keys', '-t', '=vam-atlas-a1b2c3:', 'BSpace']);
  });

  it('carries a BTab across the bridge, and nothing that only looks like one', async () => {
    const { send, argvs } = handler();
    expect(await send({}, ATLAS, { kind: 'back-tab' })).toBe('sent');
    expect(argvs[1]).toEqual(['send-keys', '-t', '=vam-atlas-a1b2c3:', 'BTab']);
  });

  it('refuses a key NAME dressed as a keystroke, so no verb can be asked for', async () => {
    // The channel gained one verb, not a key-forwarding mechanism: `back-tab`
    // is a kind the main side maps to its own builder, and a `keyName` field
    // is not a way to ask for `C-c`.
    const { send, argvs } = handler();
    expect(await send({}, ATLAS, { kind: 'key', keyName: 'C-c' })).toBe('unaimed');
    expect(await send({}, ATLAS, { kind: 'back-tab', keyName: 'C-c' })).toBe('sent');
    expect(argvs[1]).toEqual(['send-keys', '-t', '=vam-atlas-a1b2c3:', 'BTab']);
  });

  it('answers a plain boolean, and true only when the key landed', async () => {
    const { send, argvs } = handler();
    expect(await send({}, ATLAS, { kind: 'text', text: 'h' })).toBe('sent');
    expect(argvs[1]).toContain('-l');
  });

  it.each([
    ['no arguments at all', [] as unknown[]],
    ['a project id that is not a string', [42, { kind: 'text', text: 'h' }]],
    ['an oversized project id', ['x'.repeat(501), { kind: 'text', text: 'h' }]],
    ['a key that is not one of the three', [ATLAS, { kind: 'kill' }]],
    ['a key that is not an object', [ATLAS, 'h']],
    ['text that is not a string', [ATLAS, { kind: 'text', text: 7 }]],
    ['a paste wearing a keystroke’s clothes', [ATLAS, { kind: 'text', text: 'x'.repeat(64) }]],
    ['an empty keystroke', [ATLAS, { kind: 'text', text: '' }]],
    ['a row id that is not a string', [ATLAS, { kind: 'enter' }, 42]],
    ['one argument too many', [ATLAS, { kind: 'enter' }, ATLAS, 'extra']],
  ])('refuses %s without running tmux', async (_why, args) => {
    const { send, argvs } = handler();
    expect(await send({}, ...args)).toBe('unaimed');
    expect(argvs).toHaveLength(0);
  });
});

/**
 * Proving the pairing once per typing RUN instead of once per character.
 *
 * The operator's report was "khi go delay kha nhieu" -- typing lags. Measured
 * on a private `-L` server, idle, each key cost a `list-sessions` spawn
 * (5.7ms), a `send-keys` spawn (5.4ms) and a `readdir` plus a `readFile` per
 * published session file (0.3ms), and the renderer serializes the sends so
 * that cost is the wait between characters, not a background cost.
 *
 * What is asserted here is the SPAWN COUNT, because that is the part of the
 * latency vam controls and the part a test can hold still. The safety of
 * reusing an aim is asserted beside it, in the same tests: what drops it.
 */
describe('a typing run proves its pane once, and re-proves it when it must', () => {
  function typing(stdout = `${ATLAS}\tvam-atlas-a1b2c3\n`) {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const { run, argvs, verbs } = runner({
      'list-sessions': ok(stdout),
      'send-keys': ok(''),
      'capture-pane': ok('screen'),
    });
    let clock = 1_000;
    registerTerminalIpc(
      { handle: (channel, listener) => void handlers.set(channel, listener) },
      run,
      async () => new Map(),
      () => clock,
    );
    const send = handlers.get(CHANNELS.terminalSend);
    const read = handlers.get(CHANNELS.terminalRead);
    if (send === undefined || read === undefined) throw new Error('channels not registered');
    return {
      argvs,
      verbs,
      send,
      read,
      tick: (ms: number) => {
        clock += ms;
      },
      type: async (text: string) => {
        for (const character of text) {
          await send({}, ATLAS, { kind: 'text', text: character });
        }
      },
    };
  }

  it('spawns twice for the first key and once for every key after it', async () => {
    const t = typing();
    await t.type('hello');
    // Five characters: one listing, five sends. It was five listings before,
    // which is the delay the operator felt.
    expect(t.verbs()).toEqual([
      'list-sessions',
      'send-keys',
      'send-keys',
      'send-keys',
      'send-keys',
      'send-keys',
    ]);
    // Still the right pane, every time -- the reuse is of a PROVEN pairing.
    for (const argv of t.argvs.filter((a) => a[0] === 'send-keys')) {
      expect(argv[2]).toBe('=vam-atlas-a1b2c3:');
    }
  });

  it('proves it again once the aim is older than its backstop', async () => {
    const t = typing();
    await t.type('a');
    t.tick(AIM_TTL_MS + 1);
    await t.type('b');
    expect(t.verbs()).toEqual(['list-sessions', 'send-keys', 'list-sessions', 'send-keys']);
  });

  it('drops the aim when tmux refuses, so the next key proves one again', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    let answer = ok('');
    const argvs: (readonly string[])[] = [];
    const run: TmuxRun = async (argv) => {
      argvs.push(argv);
      return argv[0] === 'list-sessions' ? ok(`${ATLAS}\tvam-atlas-a1b2c3\n`) : answer;
    };
    registerTerminalIpc(
      { handle: (channel, listener) => void handlers.set(channel, listener) },
      run,
      async () => new Map(),
    );
    const send = handlers.get(CHANNELS.terminalSend);
    if (send === undefined) throw new Error('the send channel was never registered');

    expect(await send({}, ATLAS, { kind: 'text', text: 'a' })).toBe('sent');
    answer = failed("can't find pane");
    // The session died under the run. tmux says so, which is the fail-safe
    // half of the window this reuse widens.
    expect(await send({}, ATLAS, { kind: 'text', text: 'b' })).toBe('refused');
    answer = ok('');
    await send({}, ATLAS, { kind: 'text', text: 'c' });
    expect(argvs.map((argv) => argv[0])).toEqual([
      'list-sessions',
      'send-keys',
      'send-keys',
      'list-sessions',
      'send-keys',
    ]);
  });

  it('lets the once-a-second read re-prove the aim, and destroy it when it fails', async () => {
    const t = typing();
    await t.type('a');
    // A read that still resolves keeps the run going without a listing of its
    // own -- and refreshes the timestamp, which is why the backstop is a
    // backstop rather than the mechanism.
    t.tick(AIM_TTL_MS - 1);
    await t.read({}, ATLAS);
    t.tick(AIM_TTL_MS - 1);
    await t.type('b');
    const afterRefresh = t.verbs().filter((verb) => verb === 'list-sessions').length;
    expect(afterRefresh).toBe(2); // the first key, and the read itself
  });

  it('destroys the aim when the read stops resolving the pane', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    let sessions = `${ATLAS}\tvam-atlas-a1b2c3\n`;
    const argvs: (readonly string[])[] = [];
    const run: TmuxRun = async (argv) => {
      argvs.push(argv);
      return argv[0] === 'list-sessions' ? ok(sessions) : ok('screen');
    };
    registerTerminalIpc(
      { handle: (channel, listener) => void handlers.set(channel, listener) },
      run,
      async () => new Map(),
    );
    const send = handlers.get(CHANNELS.terminalSend);
    const read = handlers.get(CHANNELS.terminalRead);
    if (send === undefined || read === undefined) throw new Error('channels not registered');

    await send({}, ATLAS, { kind: 'text', text: 'a' });
    sessions = ''; // the session ended, and the tab's next read finds nothing
    await read({}, ATLAS);
    await send({}, ATLAS, { kind: 'text', text: 'b' });
    // The second key did NOT ride the dead aim: it proved again, and refused.
    expect(argvs.filter((argv) => argv[0] === 'list-sessions')).toHaveLength(3);
    expect(argvs.filter((argv) => argv[0] === 'send-keys')).toHaveLength(1);
  });

  it('keeps one aim per row, so a second session in the project proves its own', async () => {
    const t = typing(`${ATLAS}\tvam-atlas-a1b2c3\n`);
    await t.send({}, ATLAS, { kind: 'text', text: 'a' }, 'row-one');
    await t.send({}, ATLAS, { kind: 'text', text: 'b' }, 'row-two');
    expect(t.verbs().filter((verb) => verb === 'list-sessions')).toHaveLength(2);
  });
});
