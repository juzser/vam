/**
 * CONTROL CHORDS INTO THE PANE -- Ctrl+U, Ctrl+C and the rest of the keys a
 * terminal is actually driven with.
 *
 * THE REPORT was "khong dung duoc Cmd+U de xoa dong hoac cac shortcut khac
 * trong terminal" -- Ctrl+U will not kill the line, and neither will any other
 * terminal shortcut. The cause was one line in `TerminalTab.tsx` that had
 * handed EVERY modified key back to vam since the pane learned to type, so
 * `PaneKey` never had a shape that could carry one.
 *
 * WHAT THESE TESTS ARE ABOUT, and it is the same thing every test in
 * `send.test.ts` is about: a channel that types into somebody's running agent.
 * A control chord is a bigger keystroke than a letter -- `C-c` interrupts a
 * tool call, `C-d` can end a shell, `C-z` suspends one -- so this file checks
 * three properties and not one:
 *
 *   1. THE CHORD ARRIVES INTERPRETED. `send-keys -l` types the characters of
 *      a key name; only an interpreted `send-keys` presses the key. This is
 *      the same split `sendEnterArgv` and `sendBackspaceArgv` were written
 *      for, and it is the whole of why `control` is a kind rather than text.
 *   2. NOTHING OFF THE BRIDGE CAN NAME A TMUX KEY. The renderer is the least
 *      trusted process in the app. A `letter` is one of twenty-six, checked
 *      against a frozen set, and `C-` + that letter is looked up in a table of
 *      twenty-six constants -- so a value from the bridge is a table INDEX and
 *      never a key name, never an option, and never a second tmux command.
 *   3. IT IS AIMED BY THE SAME GUARD AS A LETTER. `C-c` in the wrong pane
 *      interrupts the wrong person's work.
 *
 * Nothing spawns: the runner is a fake and the argv is read back from it,
 * because this machine has live agents in real panes.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import { sendControlArgv } from '../../../src/main/sources/tmux/argv.js';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import { registerTerminalIpc } from '../../../src/main/terminal/ipc.js';
import { sendSessionKey } from '../../../src/main/terminal/pane.js';
import { CONTROL_LETTERS, type ControlLetter } from '../../../src/shared/terminal.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });
const failed = (stderr: string): TmuxRunResult => ({
  failure: { message: 'tmux failed' },
  stdout: '',
  stderr,
});

const ATLAS = 'claude-code:atlas-11111111';
const BEACON = 'claude-code:beacon-22222222';
const PANE = '=vam-atlas-a1b2c3:';

function runner(rows: string) {
  const argvs: (readonly string[])[] = [];
  const answers: Record<string, TmuxRunResult> = {
    'list-sessions': ok(rows),
    'send-keys': ok(''),
  };
  const run: TmuxRun = async (argv) => {
    argvs.push(argv);
    return answers[argv[0] ?? ''] ?? failed(`no stub for ${argv[0]}`);
  };
  return { run, argvs, verbs: () => argvs.map((argv) => argv[0]) };
}

const atlasIsListed = `${ATLAS}\t\tvam-atlas-a1b2c3\n`;

describe('a control chord reaches the pane as a key, never as its letters', () => {
  it('sends Ctrl+U as the interpreted C-u, which is what kills the line', async () => {
    const { run, argvs } = runner(atlasIsListed);
    expect(await sendSessionKey(run, ATLAS, { kind: 'control', letter: 'u' })).toBe('sent');
    expect(argvs[1]).toEqual(['send-keys', '-t', PANE, '--', 'C-u']);
    // `-l` is the one flag that would make this type the three characters of
    // `C-u` into the operator's prompt instead of pressing the key.
    expect(argvs[1]).not.toContain('-l');
    // Exactly one send. A Return behind an interrupt would submit whatever the
    // interrupt left on the line.
    expect(argvs).toHaveLength(2);
  });

  it('sends Ctrl+C, which is the point of the whole channel', async () => {
    // A terminal that cannot interrupt a running agent is not a terminal, and
    // this was the chord `TerminalTab.tsx` named in its own comment as the one
    // it deliberately did not deliver.
    const { run, argvs } = runner(atlasIsListed);
    expect(await sendSessionKey(run, ATLAS, { kind: 'control', letter: 'c' })).toBe('sent');
    expect(argvs[1]).toEqual(['send-keys', '-t', PANE, '--', 'C-c']);
  });

  /**
   * EVERY LETTER, AND THE COUNT IS ASSERTED INSIDE THE LOOP'S OWN EXPRESSION.
   *
   * A sweep that finds nothing passes silently, so the corpus is proven twice:
   * the length of what was collected, and the exact list. Without the first
   * assertion an empty `CONTROL_LETTERS` would make this the greenest test in
   * the file.
   */
  it('spells all twenty-six the one way tmux spells them, and no other way', async () => {
    const names: string[] = [];
    for (const letter of CONTROL_LETTERS) {
      const { run, argvs } = runner(atlasIsListed);
      expect(await sendSessionKey(run, ATLAS, { kind: 'control', letter })).toBe('sent');
      const argv = argvs[1] ?? [];
      // The argv is a fixed five words: nothing a letter carries can add a
      // sixth, and nothing can become a second tmux command.
      expect(argv).toHaveLength(5);
      expect(argv.slice(0, 4)).toEqual(['send-keys', '-t', PANE, '--']);
      names.push(argv[4] ?? '');
    }
    expect(names).toHaveLength(26);
    expect(names).toEqual([
      'C-a',
      'C-b',
      'C-c',
      'C-d',
      'C-e',
      'C-f',
      'C-g',
      'C-h',
      'C-i',
      'C-j',
      'C-k',
      'C-l',
      'C-m',
      'C-n',
      'C-o',
      'C-p',
      'C-q',
      'C-r',
      'C-s',
      'C-t',
      'C-u',
      'C-v',
      'C-w',
      'C-x',
      'C-y',
      'C-z',
    ]);
    // Not one of them can be read as an option, whatever the table says.
    expect(names.some((name) => name.startsWith('-'))).toBe(false);
  });

  it('is aimed by the same guard as a letter: no session, no chord', async () => {
    // `C-c` in the wrong pane interrupts the wrong person's work, which is a
    // larger mistake than typing a letter into it, not a smaller one.
    const { run, verbs } = runner(`${BEACON}\t\tvam-beacon-d4e5f6\n`);
    expect(await sendSessionKey(run, ATLAS, { kind: 'control', letter: 'c' })).toBe('unaimed');
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('refuses a chord through a published pane of another project', async () => {
    const { run, verbs } = runner(`${ATLAS}\t\tvam-atlas-a1b2c3\n${BEACON}\t\tvam-beacon-d4e5f6\n`);
    const panes = new Map([[ATLAS, 'vam-beacon-d4e5f6']]);
    expect(await sendSessionKey(run, ATLAS, { kind: 'control', letter: 'c' }, ATLAS, panes)).toBe(
      'mispaired',
    );
    expect(verbs()).toEqual(['list-sessions']);
  });
});

describe('the bridge cannot name a tmux key, only index a table of them', () => {
  function handler() {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const { run, argvs } = runner(atlasIsListed);
    registerTerminalIpc(
      { handle: (channel, listener) => void handlers.set(channel, listener) },
      run,
      async () => new Map(),
    );
    const send = handlers.get(CHANNELS.terminalSend);
    if (send === undefined) throw new Error('the send channel was never registered');
    return { send, argvs };
  }

  it('carries a real chord across the bridge', async () => {
    const { send, argvs } = handler();
    expect(await send({}, ATLAS, { kind: 'control', letter: 'u' })).toBe('sent');
    expect(argvs[1]).toEqual(['send-keys', '-t', PANE, '--', 'C-u']);
  });

  it.each([
    ['a key name in the letter field', { kind: 'control', letter: 'C-c' }],
    ['a tmux verb in the letter field', { kind: 'control', letter: 'kill-session' }],
    ['an option in the letter field', { kind: 'control', letter: '-l' }],
    ['a separator in the letter field', { kind: 'control', letter: ';' }],
    [
      'an uppercase letter, which is a second spelling of one chord',
      { kind: 'control', letter: 'A' },
    ],
    ['two letters', { kind: 'control', letter: 'ab' }],
    ['a digit, which is no control character at all', { kind: 'control', letter: '1' }],
    ['an empty letter', { kind: 'control', letter: '' }],
    ['no letter at all', { kind: 'control' }],
    ['a letter that is not a string', { kind: 'control', letter: 3 }],
    ['a letter carried on an array', { kind: 'control', letter: ['u'] }],
    ['a letter on the prototype rather than the object', Object.create({ letter: 'u' })],
  ])('refuses %s without running tmux at all', async (_why, key) => {
    const { send, argvs } = handler();
    expect(await send({}, ATLAS, { ...(key as object), kind: 'control' })).toBe('unaimed');
    expect(argvs).toHaveLength(0);
  });

  it('still refuses the key NAME shape the channel never grew', async () => {
    // The channel gained a chord, not a key-forwarding mechanism. This is the
    // case `send.test.ts` already pins for `back-tab`, re-derived here because
    // `control` is the first kind that maps to a FAMILY of tmux keys and so
    // the first one a `keyName` field could plausibly be smuggled through.
    const { send, argvs } = handler();
    expect(await send({}, ATLAS, { kind: 'key', keyName: 'C-c' })).toBe('unaimed');
    expect(await send({}, ATLAS, { kind: 'control', letter: 'u', keyName: 'kill-session' })).toBe(
      'sent',
    );
    expect(argvs[1]).toEqual(['send-keys', '-t', PANE, '--', 'C-u']);
  });
});

describe('the builder refuses a letter it has no constant for', () => {
  it('throws rather than splicing an undefined into somebody’s argv', () => {
    // Unreachable through the bridge -- `isPaneKey` has already refused it --
    // and checked anyway, because the alternative to a refusal here is an
    // argv with a hole in it: `['send-keys', '-t', target, '--', undefined]`
    // shifts nothing but arrives at `execFile` as the string "undefined",
    // which tmux reads as a key name it does not know.
    const notALetter: string = 'C-c';
    expect(() => sendControlArgv('vam-atlas-a1b2c3', notALetter as ControlLetter)).toThrow(
      /control/i,
    );
  });
});
