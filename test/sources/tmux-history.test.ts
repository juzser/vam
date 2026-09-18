/**
 * THE SCROLLBACK: what vam asks tmux for, and where the cursor lands once the
 * answer is longer than the screen.
 *
 * THE DEFECT THESE PIN. `capture-pane` with no `-S` returns the VISIBLE SCREEN
 * and nothing else, and `resizeWindowArgv` sizes the window to exactly the rows
 * the pane can show -- so the Terminal tab drew `rows` lines into a box `rows`
 * tall, `scrollHeight === clientHeight`, and there was nothing to scroll at
 * all. The operator's words were "the terminal has no scroll", and the hidden
 * native scrollbar was not hiding one: there was no overflow to hide.
 *
 * THE OFF-BY-N THIS FILE EXISTS FOR. `cursor_y` is a row of the SCREEN. Put
 * history above the screen and that number stops being an index into the text
 * vam hands the renderer -- by exactly the number of history lines the capture
 * carried. A caret drawn `history_size` rows too high is a claim about a cell
 * somebody's agent is not on, so the offset is arithmetic with a test rather
 * than a hope.
 *
 * THE RUNNER IS A FAKE, for the reason every other file here gives: a test
 * that ran these would read, and could resize, sessions on the operator's own
 * tmux server. What tmux really does with this argv is measured against a real
 * one in `tmux-history-live.test.ts`, over a private socket.
 */

import { describe, expect, it } from 'vitest';
import {
  capturePaneArgv,
  PANE_HISTORY_LINES,
  VAM_CURSOR_MARK,
} from '../../src/main/sources/tmux/argv.js';
import { readPane, type TmuxRun } from '../../src/main/sources/tmux/spawn.js';
import { readSessionPane } from '../../src/main/terminal/pane.js';

/** A runner that answers with one canned result and records every argv. */
function fakeTmux(stdout: string): TmuxRun & { calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const run = (async (argv: readonly string[]) => {
    calls.push(argv);
    return { failure: null, stdout, stderr: '' };
  }) as TmuxRun & { calls: (readonly string[])[] };
  run.calls = calls;
  return run;
}

/**
 * The marker line as tmux prints it: the flag, the column, the row on the
 * SCREEN, and how many lines of history sit above that screen.
 */
const mark = (flag: string, x: number, y: number, history: string): string =>
  `${VAM_CURSOR_MARK} ${flag} ${x} ${y} ${history}\n`;

const lines = (prefix: string, count: number): string =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}`).join('\n');

describe('what vam asks tmux for', () => {
  it('asks for history ONLY when a caller wants it, and never by accident', () => {
    // The screen-only shape, unchanged: this is what `answer.ts` reads a
    // picker off, and a picker found in the scrollback is a question that was
    // already answered.
    expect(capturePaneArgv('vam-a1b2c3')).not.toContain('-S');
    const withHistory = capturePaneArgv('vam-a1b2c3', PANE_HISTORY_LINES);
    const at = withHistory.indexOf('-S');
    expect(at).toBeGreaterThan(-1);
    expect(withHistory[at + 1]).toBe(`-${PANE_HISTORY_LINES}`);
    // STILL ONE PROCESS. The whole cost argument of this argv is that the
    // cursor and the screen arrive on one stdout; a second capture-pane for
    // the history would have doubled the spawns the open tab makes.
    expect(withHistory.filter((word) => word === 'capture-pane')).toHaveLength(1);
    expect(withHistory.filter((word) => word === ';')).toHaveLength(1);
  });

  it('asks how much history there is, because that is the cursor’s offset', () => {
    const argv = capturePaneArgv('vam-a1b2c3', PANE_HISTORY_LINES);
    const format = argv[argv.indexOf('-F') + 1] ?? '';
    expect(format).toContain('#{history_size}');
  });

  it('bounds the window: a screenful is a cost, and a session is 2000 lines deep', () => {
    // tmux's own default `history-limit` is 2000 (measured, 3.7b), so this
    // number is a fraction of a session's depth and not a cap on tmux.
    expect(PANE_HISTORY_LINES).toBeGreaterThan(100);
    expect(PANE_HISTORY_LINES).toBeLessThanOrEqual(2000);
  });
});

describe('the screen, with the scrollback above it', () => {
  it('hands back every captured line, not just the screen', async () => {
    const run = fakeTmux(`${mark('1', 2, 1, '3')}${lines('h', 3)}\n${lines('s', 2)}\n`);
    const pane = await readPane(run, 'vam-a1b2c3', PANE_HISTORY_LINES);
    expect(pane).toMatchObject({ kind: 'ok', text: 'h0\nh1\nh2\ns0\ns1\n' });
  });

  it('moves the cursor down by the history above it', async () => {
    // `cursor_y` is 1 -- the second row OF THE SCREEN. Three lines of history
    // came back above that screen, so the caret belongs on line 4 of the text.
    const run = fakeTmux(`${mark('1', 2, 1, '3')}${lines('h', 3)}\n${lines('s', 2)}\n`);
    const pane = await readPane(run, 'vam-a1b2c3', PANE_HISTORY_LINES);
    expect(pane).toMatchObject({ cursor: { kind: 'at', column: 2, row: 4 } });
  });

  it('offsets by what tmux GAVE, not by what tmux HAS', async () => {
    // A session 900 lines deep answers a 500-line request with 500 lines.
    // Offsetting by `history_size` would put the caret four hundred rows past
    // the end of the text.
    const deep = String(PANE_HISTORY_LINES + 400);
    const run = fakeTmux(`${mark('1', 0, 3, deep)}${lines('h', PANE_HISTORY_LINES)}\ns0\n`);
    const pane = await readPane(run, 'vam-a1b2c3', PANE_HISTORY_LINES);
    expect(pane).toMatchObject({ cursor: { row: PANE_HISTORY_LINES + 3 } });
  });

  it('leaves the cursor where it is when no history was asked for', async () => {
    // The screen-only path is every other caller in `main/terminal/`, and it
    // must keep behaving exactly as it did -- including against the many
    // fixtures in this suite whose marker line has only three fields.
    const run = fakeTmux(`${mark('1', 7, 2, '48')}s0\ns1\ns2\n`);
    await expect(readPane(run, 'vam-a1b2c3')).resolves.toMatchObject({
      cursor: { kind: 'at', column: 7, row: 2 },
    });
    const old = fakeTmux(`${VAM_CURSOR_MARK} 1 7 2\ns0\ns1\ns2\n`);
    await expect(readPane(old, 'vam-a1b2c3')).resolves.toMatchObject({
      cursor: { kind: 'at', column: 7, row: 2 },
    });
  });

  it('draws NO cursor rather than a wrong one when the offset is unreadable', async () => {
    // A tmux too old for `#{history_size}` expands it to the empty string
    // (measured: an unknown key is empty, not an error). vam then holds a
    // screen row and no way to say where the screen starts -- and a caret
    // placed anyway would be drawn in the scrollback, on a cell nobody is on.
    for (const history of ['', 'x', '-1']) {
      const run = fakeTmux(`${mark('1', 2, 1, history)}h0\nh1\ns0\n`);
      const pane = await readPane(run, 'vam-a1b2c3', PANE_HISTORY_LINES);
      expect(pane, `for ${JSON.stringify(history)}`).toMatchObject({
        kind: 'ok',
        text: 'h0\nh1\ns0\n',
        cursor: { kind: 'unreadable' },
      });
    }
  });

  it('keeps `hidden` hidden: an unreadable offset cannot invent a caret', async () => {
    const run = fakeTmux(`${mark('0', 2, 1, '')}h0\ns0\n`);
    await expect(readPane(run, 'vam-a1b2c3', PANE_HISTORY_LINES)).resolves.toMatchObject({
      cursor: { kind: 'hidden' },
    });
  });
});

describe('who gets the scrollback', () => {
  const ATLAS = 'claude-code:atlas-11111111';

  /** Answers `list-sessions` with one vam session, and the read with `stdout`. */
  function paneRunner(stdout: string): TmuxRun & { calls: (readonly string[])[] } {
    const calls: (readonly string[])[] = [];
    const run = (async (argv: readonly string[]) => {
      calls.push(argv);
      return argv[0] === 'list-sessions'
        ? { failure: null, stdout: `${ATLAS}\t\tvam-atlas-a1b2c3\n`, stderr: '' }
        : { failure: null, stdout, stderr: '' };
    }) as TmuxRun & { calls: (readonly string[])[] };
    run.calls = calls;
    return run;
  }

  it('the tab that draws the screen asks for it', async () => {
    const run = paneRunner(`${mark('1', 0, 0, '2')}h0\nh1\ns0\n`);
    const view = await readSessionPane(run, ATLAS);
    expect(view).toMatchObject({ kind: 'ok', text: 'h0\nh1\ns0\n', cursor: { row: 2 } });
    const capture = run.calls.find((argv) => argv.includes('capture-pane'));
    expect(capture).toContain('-S');
  });
});
