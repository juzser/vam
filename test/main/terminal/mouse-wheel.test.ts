/**
 * A WHEEL OVER A PANE WHOSE PROGRAM OWNS THE MOUSE REACHES THAT PROGRAM.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 * The operator, on the build carrying #439: "still can't scroll in the
 * terminal". Not while typing -- ever. MEASURED on a private tmux socket
 * (3.7b) against Claude Code 2.1.278 started the way vam starts it, straight
 * into `claude` with `"tui": "fullscreen"` in the operator's settings:
 *
 *   alternate_on=1  history_size=0  mouse_any_flag=1
 *
 * at three, six, nine and twelve seconds, and `capture-pane -S -500` answers
 * with exactly the pane's 50 rows. The program draws in the ALTERNATE SCREEN,
 * for which tmux keeps no scrollback, so the window read IS the screen, the
 * pane holds one boxful, and there is nothing in the DOM to scroll -- the
 * scrollback is inside Claude Code, which asked the terminal for mouse
 * reports so that it can scroll itself. Every terminal honours that request:
 * a wheel over a program that asked for the mouse is DELIVERED to it, not
 * spent on the terminal's own history. vam spent it on a history it did not
 * have.
 *
 * (#439's own premise -- the screen is a byte-suffix of the window -- was
 * measured intact on the same session, in and out of the alternate screen:
 * `cmp` says the screen capture is identical to the window's tail, and
 * `composeScreen` returns the answer untouched when there is nothing above
 * it, which is right. It was fixing a collapse that never happened here.)
 *
 * ── WHAT THIS FILE PINS ────────────────────────────────────────────────────
 * The read carries whether the pane asked for the mouse (`#{mouse_any_flag}`
 * on the same `display-message` that already carries the cursor), and a
 * wheel is a `PaneKey` main turns into the SGR mouse report the program is
 * waiting for -- `ESC [ < 64 ; col ; row M` up, 65 down -- typed literally
 * through `send-keys -l`, which is how the bytes were measured to reach
 * Claude Code's viewport (three reports moved it three lines).
 */

import { describe, expect, it } from 'vitest';
import { CURSOR_FORMAT, sendWheelArgv } from '../../../src/main/sources/tmux/argv.js';
import {
  readCursorLine,
  readPane,
  type TmuxRun,
  type TmuxRunResult,
} from '../../../src/main/sources/tmux/spawn.js';
import { readAimedPane, sendSessionKey } from '../../../src/main/terminal/pane.js';
import { isPaneKey, MAX_WHEEL_TICKS, type PaneKey } from '../../../src/shared/terminal.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });
const failed = (stderr: string): TmuxRunResult => ({
  failure: { message: 'tmux failed' },
  stdout: '',
  stderr,
});

const ATLAS = 'claude-code:atlas-11111111';
const NAME = 'vam-atlas-a1b2c3';
const PANE = `=${NAME}:`;
const atlasIsListed = `${ATLAS}\t\t${NAME}\n`;

function runner(rows: string, screen = '') {
  const argvs: (readonly string[])[] = [];
  const answers: Record<string, TmuxRunResult> = {
    'list-sessions': ok(rows),
    'send-keys': ok(''),
    'display-message': ok(screen),
  };
  const run: TmuxRun = async (argv) => {
    argvs.push(argv);
    return answers[argv[0] ?? ''] ?? failed(`no stub for ${argv[0]}`);
  };
  return { run, argvs };
}

const ESC = '\u001b';
const wheel = (direction: 'up' | 'down', ticks = 1, column = 1, row = 1) =>
  ({ kind: 'wheel', direction, ticks, column, row }) satisfies PaneKey;

describe('the read says whether the pane asked for the mouse', () => {
  it('asks tmux for the flag on the cursor line it already reads', () => {
    expect(CURSOR_FORMAT.split(' ')).toContain('#{mouse_any_flag}');
  });

  it('reads a fifth field as the answer, and its absence as not knowing', () => {
    // The exact line tmux 3.7b printed for a fullscreen Claude Code pane.
    expect(readCursorLine('@vam-cursor 1 2 46 0 1')).toEqual({
      cursor: { kind: 'at', column: 2, row: 46 },
      depth: 0,
      mouse: true,
    });
    expect(readCursorLine('@vam-cursor 1 14 20 304 0').mouse).toBe(false);
    // Four fields is every stubbed runner in this suite and any older tmux:
    // a screen with no opinion, never a pane that declined the mouse.
    expect(readCursorLine('@vam-cursor 1 14 20 304').mouse).toBeNull();
    expect(readCursorLine('@vam-cursor 1 14 20').mouse).toBeNull();
    // Anything but 0 or 1 is a tmux this parse does not understand.
    expect(readCursorLine('@vam-cursor 1 14 20 304 2').mouse).toBeNull();
    expect(readCursorLine('@vam-cursor 1 14 20 304 1 7')).toEqual({
      cursor: { kind: 'unreadable' },
      depth: null,
      mouse: null,
    });
  });

  it('carries the flag out of the read, and through an aimed read, as a fact about the pane', async () => {
    const { run } = runner(atlasIsListed, '@vam-cursor 1 2 46 0 1\nscreen\n');
    const pane = await readPane(run, NAME);
    expect(pane).toMatchObject({ kind: 'ok', text: 'screen\n', mouse: true });
    const view = await readAimedPane(run, NAME);
    expect(view).toMatchObject({ kind: 'ok', name: NAME, mouse: true });
    const { run: older } = runner(atlasIsListed, '@vam-cursor 1 2 46 0\nscreen\n');
    const unknown = await readAimedPane(older, NAME);
    expect(unknown.kind).toBe('ok');
    expect(unknown.kind === 'ok' && 'mouse' in unknown).toBe(false);
  });
});

describe('a wheel is delivered to the pane as the mouse report it asked for', () => {
  it('spells one notch up as the SGR report, typed literally', () => {
    expect(sendWheelArgv(NAME, wheel('up', 1, 12, 7))).toEqual([
      'send-keys',
      '-t',
      PANE,
      '-l',
      '--',
      `${ESC}[<64;12;7M`,
    ]);
  });

  it('spells down as button 65 and repeats the report once per notch', () => {
    expect(sendWheelArgv(NAME, wheel('down', 3, 1, 1)).at(-1)).toBe(
      `${ESC}[<65;1;1M${ESC}[<65;1;1M${ESC}[<65;1;1M`,
    );
  });

  it('is aimed by the same guard as a letter: no session, no wheel', async () => {
    const { run, argvs } = runner('');
    expect(await sendSessionKey(run, ATLAS, wheel('up'))).toBe('unaimed');
    expect(argvs.map((argv) => argv[0])).toEqual(['list-sessions']);
  });

  it('reaches a paired session through the one send path', async () => {
    const { run, argvs } = runner(atlasIsListed);
    expect(await sendSessionKey(run, ATLAS, wheel('up', 2, 3, 4))).toBe('sent');
    expect(argvs[1]).toEqual(sendWheelArgv(NAME, wheel('up', 2, 3, 4)));
  });
});

describe('the bridge admits a wheel only in the shape main can spell', () => {
  it('accepts a bounded report', () => {
    expect(isPaneKey(wheel('up', 1, 1, 1))).toBe(true);
    expect(isPaneKey(wheel('down', MAX_WHEEL_TICKS, 500, 300))).toBe(true);
  });

  it('refuses anything it would have to clamp or invent', () => {
    expect(isPaneKey({ ...wheel('up'), direction: 'left' })).toBe(false);
    expect(isPaneKey(wheel('up', 0))).toBe(false);
    expect(isPaneKey(wheel('up', MAX_WHEEL_TICKS + 1))).toBe(false);
    expect(isPaneKey(wheel('up', 1.5))).toBe(false);
    expect(isPaneKey(wheel('up', 1, 0, 1))).toBe(false);
    expect(isPaneKey(wheel('up', 1, 1, 0))).toBe(false);
    expect(isPaneKey(wheel('up', 1, 501, 1))).toBe(false);
    expect(isPaneKey(wheel('up', 1, 1, 301))).toBe(false);
    expect(isPaneKey({ kind: 'wheel', direction: 'up' })).toBe(false);
  });
});
