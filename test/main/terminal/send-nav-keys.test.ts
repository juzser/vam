/**
 * NAVIGATION KEYS INTO THE PANE -- the arrows, Home, End, PageUp and
 * PageDown, the keys Claude Code's own option pickers are walked with.
 *
 * vam/terminal-arrows. THE REPORT, translated: "in the terminal, the arrow
 * keys can't be used to select options." `TerminalTab.tsx` read
 * `ArrowUp`/`ArrowDown`/`PageUp`/`PageDown`/`Home`/`End` as VAM'S OWN scroll
 * keys before a keystroke ever reached `strokeFor`, so `AskUserQuestion`, a
 * permission prompt, `/model`, `/config` and plan approval -- every one of
 * them walked with the arrows -- could not be driven from inside the pane at
 * all.
 *
 * THIS FILE MIRRORS `send-control-chords.test.ts`, on purpose: `nav` is the
 * same shape of kind `control` is -- a value off the bridge SELECTING a
 * compile-time constant out of a closed table -- and the properties worth
 * checking are the same three:
 *
 *   1. THE KEY ARRIVES INTERPRETED. `send-keys -l -- 'Up'` would TYPE the two
 *      letters into the operator's own prompt; only an interpreted send-keys
 *      presses the key.
 *   2. NOTHING OFF THE BRIDGE CAN NAME A TMUX KEY. `nav` is one of eight,
 *      checked against a frozen set, and looked up in a table of eight
 *      constants -- a value from the bridge is a table INDEX, never a name.
 *   3. IT IS AIMED BY THE SAME GUARD AS EVERYTHING ELSE. An arrow key in the
 *      wrong pane moves the wrong person's cursor.
 *
 * Nothing spawns: the runner is a fake and the argv is read back from it.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import { sendNavArgv } from '../../../src/main/sources/tmux/argv.js';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import { registerTerminalIpc } from '../../../src/main/terminal/ipc.js';
import { sendSessionKey } from '../../../src/main/terminal/pane.js';
import { NAV_KEYS, type NavKey } from '../../../src/shared/terminal.js';

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

describe('a navigation key reaches the pane as a real key, never as its letters', () => {
  it('sends ArrowUp as the interpreted Up, which is what walks a picker', async () => {
    const { run, argvs } = runner(atlasIsListed);
    expect(await sendSessionKey(run, ATLAS, { kind: 'nav', nav: 'up' })).toBe('sent');
    expect(argvs[1]).toEqual(['send-keys', '-t', PANE, '--', 'Up']);
    // `-l` is the one flag that would make this type the two characters of
    // `Up` into the operator's own prompt instead of pressing the key.
    expect(argvs[1]).not.toContain('-l');
    expect(argvs).toHaveLength(2);
  });

  it('sends ArrowLeft/ArrowRight, the two the operator’s report had no luck with at all', async () => {
    // `strokeFor` used to decline these outright -- a named key is never one
    // printable character -- so they reached neither the pane nor vam's own
    // grammar. Now they are exactly as much the pane's as Up/Down are.
    const { run, argvs } = runner(atlasIsListed);
    expect(await sendSessionKey(run, ATLAS, { kind: 'nav', nav: 'left' })).toBe('sent');
    expect(argvs[1]).toEqual(['send-keys', '-t', PANE, '--', 'Left']);
    const { run: run2, argvs: argvs2 } = runner(atlasIsListed);
    expect(await sendSessionKey(run2, ATLAS, { kind: 'nav', nav: 'right' })).toBe('sent');
    expect(argvs2[1]).toEqual(['send-keys', '-t', PANE, '--', 'Right']);
  });

  /**
   * EVERY ONE OF THE EIGHT, AND THE COUNT IS ASSERTED INSIDE THE LOOP'S OWN
   * EXPRESSION -- a sweep that finds nothing passes silently otherwise.
   */
  it('spells all eight the one way tmux spells them, and no other way', async () => {
    const names: string[] = [];
    for (const nav of NAV_KEYS) {
      const { run, argvs } = runner(atlasIsListed);
      expect(await sendSessionKey(run, ATLAS, { kind: 'nav', nav })).toBe('sent');
      const argv = argvs[1] ?? [];
      expect(argv).toHaveLength(5);
      expect(argv.slice(0, 4)).toEqual(['send-keys', '-t', PANE, '--']);
      names.push(argv[4] ?? '');
    }
    expect(names).toHaveLength(8);
    expect(names).toEqual(['Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown']);
    expect(names.some((name) => name.startsWith('-'))).toBe(false);
  });

  it('is aimed by the same guard as a letter: no session, no key', async () => {
    const { run, verbs } = runner(`${BEACON}\t\tvam-beacon-d4e5f6\n`);
    expect(await sendSessionKey(run, ATLAS, { kind: 'nav', nav: 'up' })).toBe('unaimed');
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('refuses a navigation key through a published pane of another project', async () => {
    const { run, verbs } = runner(`${ATLAS}\t\tvam-atlas-a1b2c3\n${BEACON}\t\tvam-beacon-d4e5f6\n`);
    const panes = new Map([[ATLAS, 'vam-beacon-d4e5f6']]);
    expect(await sendSessionKey(run, ATLAS, { kind: 'nav', nav: 'down' }, ATLAS, panes)).toBe(
      'mispaired',
    );
    expect(verbs()).toEqual(['list-sessions']);
  });
});

describe('the bridge cannot name a tmux key, only index a table of eight', () => {
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

  it('carries a real navigation key across the bridge', async () => {
    const { send, argvs } = handler();
    expect(await send({}, ATLAS, { kind: 'nav', nav: 'page-down' })).toBe('sent');
    expect(argvs[1]).toEqual(['send-keys', '-t', PANE, '--', 'PageDown']);
  });

  it.each([
    ['a key name in the nav field', { kind: 'nav', nav: 'Up' }],
    ['a tmux verb in the nav field', { kind: 'nav', nav: 'kill-session' }],
    ['an option in the nav field', { kind: 'nav', nav: '-l' }],
    ['a separator in the nav field', { kind: 'nav', nav: ';' }],
    ['an uppercase spelling, a second spelling of one key', { kind: 'nav', nav: 'Home' }],
    ['a control letter, a different kind entirely', { kind: 'nav', nav: 'u' }],
    ['a digit, which names nothing here', { kind: 'nav', nav: '1' }],
    ['an empty nav', { kind: 'nav', nav: '' }],
    ['no nav at all', { kind: 'nav' }],
    ['a nav that is not a string', { kind: 'nav', nav: 3 }],
    ['a nav carried on an array', { kind: 'nav', nav: ['up'] }],
    ['a nav on the prototype rather than the object', Object.create({ nav: 'up' })],
  ])('refuses %s without running tmux at all', async (_why, key) => {
    const { send, argvs } = handler();
    expect(await send({}, ATLAS, { ...(key as object), kind: 'nav' })).toBe('unaimed');
    expect(argvs).toHaveLength(0);
  });

  it('still refuses the key NAME shape the channel never grew', async () => {
    const { send, argvs } = handler();
    expect(await send({}, ATLAS, { kind: 'key', keyName: 'Up' })).toBe('unaimed');
    expect(await send({}, ATLAS, { kind: 'nav', nav: 'up', keyName: 'kill-session' })).toBe('sent');
    expect(argvs[1]).toEqual(['send-keys', '-t', PANE, '--', 'Up']);
  });
});

describe('the builder refuses a nav key it has no constant for', () => {
  it('throws rather than splicing an undefined into somebody’s argv', () => {
    // Unreachable through the bridge -- `isPaneKey` has already refused it --
    // and checked anyway, for the reason `sendControlArgv`'s own test is:
    // the alternative to a refusal is an argv with a hole in it.
    const notANavKey: string = 'Up';
    expect(() => sendNavArgv('vam-atlas-a1b2c3', notANavKey as NavKey)).toThrow(/navigation/i);
  });
});
