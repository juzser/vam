/**
 * Where the cursor is, asked of tmux and carried back honestly.
 *
 * THE ONE RULE UNDER TEST is `pull-requests.ts`'s rule applied to a cursor:
 * "vam could not read the cursor" and "the cursor is at the top-left corner"
 * must never be the same value. tmux makes that easy to get wrong -- MEASURED
 * on tmux 3.7b, `display-message -p -t <a target that does not exist>` EXITS
 * ZERO and prints the format with every field EMPTY -- and `Number('')` is 0,
 * so the naive parse of that answer is a confident cursor at column 0, row 0.
 *
 * The runner is a fake here for the reason `spawn.ts` gives for all of its
 * own: a test that ran these would read, and could resize, sessions on the
 * operator's real tmux server.
 */

import { describe, expect, it } from 'vitest';
import { capturePaneArgv } from '../../src/main/sources/tmux/argv.js';
import { readPane, type TmuxRun } from '../../src/main/sources/tmux/spawn.js';
import { readSessionPane } from '../../src/main/terminal/pane.js';

/** A runner that answers with one canned result and records the argv. */
function fakeTmux(stdout: string): TmuxRun & { calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const run = (async (argv: readonly string[]) => {
    calls.push(argv);
    return { failure: null, stdout, stderr: '' };
  }) as TmuxRun & { calls: (readonly string[])[] };
  run.calls = calls;
  return run;
}

/** The line tmux prints for the cursor query, spelled as tmux would print it. */
const cursorLine = (body: string) => `@vam-cursor ${body}\n`;

describe('the cursor query costs no second tmux process', () => {
  it('asks for the cursor and the screen in ONE invocation, aimed at one pane', () => {
    const argv = capturePaneArgv('vam-a1b2c3');
    // The COST claim, and it is the whole reason for the shape: one spawn per
    // refresh, not two. tmux runs a command SEQUENCE given a bare `;` element
    // (measured on 3.7b through `execFile` with an argv array), so both
    // answers arrive on one stdout.
    expect(argv.filter((word) => word === ';')).toHaveLength(1);
    expect(argv.filter((word) => word === 'capture-pane')).toHaveLength(1);
    expect(argv.filter((word) => word === 'display-message')).toHaveLength(1);
    // BOTH HALVES AIM AT THE SAME PANE, and that is not decoration: a
    // `display-message` with no `-t` answers about whatever pane tmux calls
    // current -- measured, it answered about an unrelated session -- so a
    // dropped target would draw one session's cursor on another's screen.
    expect(argv.filter((word) => word === '=vam-a1b2c3:')).toHaveLength(2);
    // The cursor query runs FIRST, because `readPane` reads its answer off
    // the front of stdout. A screen is many lines and its length is not
    // known in advance; the one-line answer has to be the one at a known end.
    expect(argv.indexOf('display-message')).toBeLessThan(argv.indexOf('capture-pane'));
  });
});

describe('readPane, on what tmux actually answers', () => {
  it('reads a visible cursor and hands back the screen without the cursor line', async () => {
    const run = fakeTmux(`${cursorLine('1 7 2')}> hello\nworking...\n`);
    await expect(readPane(run, 'vam-a1b2c3')).resolves.toEqual({
      kind: 'ok',
      // The cursor line is CONSUMED. Left in, it would be drawn as the first
      // line of the operator's screen and would shift every row down one.
      text: '> hello\nworking...\n',
      cursor: { kind: 'at', column: 7, row: 2 },
    });
  });

  it('draws no cursor when the application has hidden it', async () => {
    // `cursor_flag` is 0 when a program in the pane turned the cursor off
    // (DECTCEM). A pager, a full-screen editor and a spinner all do it, and
    // drawing one anyway would claim a caret where the program deliberately
    // removed it.
    const run = fakeTmux(`${cursorLine('0 7 2')}> hello\n`);
    const pane = await readPane(run, 'vam-a1b2c3');
    expect(pane).toEqual({ kind: 'ok', text: '> hello\n', cursor: { kind: 'hidden' } });
  });

  it('says UNREADABLE, not 0,0, for the empty answer a bad target really gives', async () => {
    // THE MEASURED SHAPE. On tmux 3.7b, `display-message -p -t '=nope:' -F
    // '...'` exits 0 with every field empty -- no stderr, no failure for the
    // classifier to catch. `Number('')` is 0, so the obvious parse turns that
    // silence into a cursor sitting in the corner of somebody's screen.
    const run = fakeTmux(`${cursorLine('  ')}> hello\n`);
    const pane = await readPane(run, 'vam-a1b2c3');
    expect(pane).toEqual({ kind: 'ok', text: '> hello\n', cursor: { kind: 'unreadable' } });
    expect(pane).not.toMatchObject({ cursor: { column: 0, row: 0 } });
  });

  it('eats no screen line when there is no cursor line to eat', async () => {
    // The sentinel is what makes the strip SAFE. A tmux too old for
    // `cursor_flag`, a build where the sequence did not run, a stub in a test
    // that predates this -- all of them answer with a screen and no cursor
    // line, and the screen must survive whole.
    const run = fakeTmux('> hello\nworking...\n');
    await expect(readPane(run, 'vam-a1b2c3')).resolves.toEqual({
      kind: 'ok',
      text: '> hello\nworking...\n',
      cursor: { kind: 'unreadable' },
    });
  });

  it('refuses a cursor line that is not shaped like one', async () => {
    for (const body of ['1 7', '1 x 2', '2 7 2', '1 -1 2', '1 7 2 9', '1 7.5 2', '']) {
      const run = fakeTmux(`${cursorLine(body)}screen\n`);
      const pane = await readPane(run, 'vam-a1b2c3');
      expect(pane, `for ${JSON.stringify(body)}`).toEqual({
        kind: 'ok',
        text: 'screen\n',
        cursor: { kind: 'unreadable' },
      });
    }
  });

  it('refuses a position too large to be a screen', async () => {
    // Not a size policy -- the renderer decides what fits. This is the bound
    // against a value that is not a position at all, so nothing downstream
    // pads a line to a hundred thousand cells.
    const run = fakeTmux(`${cursorLine('1 999999 2')}screen\n`);
    const pane = await readPane(run, 'vam-a1b2c3');
    expect(pane).toEqual({ kind: 'ok', text: 'screen\n', cursor: { kind: 'unreadable' } });
  });
});

describe('the cursor reaches the tab, or the tab is told nothing was read', () => {
  const ATLAS = 'claude-code:atlas-11111111';

  /** Answers `list-sessions` with one vam session, and the read with `stdout`. */
  const paneRunner =
    (stdout: string): TmuxRun =>
    async (argv) =>
      argv[0] === 'list-sessions'
        ? { failure: null, stdout: `${ATLAS}\tvam-atlas-a1b2c3\n`, stderr: '' }
        : { failure: null, stdout, stderr: '' };

  it('carries the position through to the PaneView the renderer draws', async () => {
    const view = await readSessionPane(
      paneRunner(`${cursorLine('1 4 1')}line one\nline two\n`),
      ATLAS,
    );
    expect(view).toEqual({
      kind: 'ok',
      name: 'vam-atlas-a1b2c3',
      text: 'line one\nline two\n',
      cursor: { kind: 'at', column: 4, row: 1 },
    });
  });

  it('hands the tab `unreadable` rather than an origin it never measured', async () => {
    // The tab must be able to tell "vam did not find out" from "the cursor is
    // in the corner". This is the read path's half of that promise.
    const view = await readSessionPane(paneRunner(`${cursorLine('  ')}line one\n`), ATLAS);
    expect(view).toMatchObject({ kind: 'ok', cursor: { kind: 'unreadable' } });
  });
});
