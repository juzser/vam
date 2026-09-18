/**
 * VAM'S OWN ARGV, AGAINST A REAL TMUX.
 *
 * WHY THIS FILE EXISTS AND `tmux-history.test.ts` IS NOT ENOUGH. Every other
 * test of this argv is a test of a STRING: it proves vam spelled `-S -500`,
 * and it would go on passing if tmux ignored the flag, clamped it differently,
 * or counted `#{history_size}` from the other end. The claim this feature
 * rests on is about tmux's behaviour -- "a capture that begins N lines above
 * the screen carries exactly min(N, history_size) lines before it" -- and only
 * a real tmux can be asked.
 *
 * THE CURSOR IS PROVEN BY CONTENT, NOT BY ARITHMETIC. The pane prints its
 * lines and then `MARKER` with no newline, so the caret sits immediately after
 * six known characters on a known line. Recomputing the offset here would just
 * be the implementation written twice; finding `MARKER` on the line vam says
 * the cursor is on is a fact neither side can fake.
 *
 * SAFETY. A private `-L` socket named for this process, a session name with no
 * `vam-` prefix, and a `kill-server` afterwards: nothing here can see, resize
 * or type into the operator's own tmux, which is the rule `spawn.ts` states
 * for why every OTHER test in this suite fakes the runner.
 *
 * SKIPPED, LOUDLY, WHERE THERE IS NO TMUX. The provider is optional in a way
 * the rest of vam is not -- a machine without tmux runs vam fine and simply
 * has no terminal -- so this cannot be a hard failure of the suite. It IS the
 * only test in the suite that would notice tmux changing under vam.
 */

import { execFile, execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capturePaneArgv, PANE_HISTORY_LINES } from '../../src/main/sources/tmux/argv.js';
import { readPane, type TmuxRun } from '../../src/main/sources/tmux/spawn.js';

const tmuxWorks = (): boolean => {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const SOCKET = `vamtest${process.pid}h`;
const SESSION = `hist${process.pid}`;
const ROWS = 10;
const PRINTED = 40;
const MARKER = 'MARKER';

/**
 * vam's runner, pinned to a socket of this test's own.
 *
 * `createTmuxRunner` takes a binary and no socket, so the `-L` goes in front
 * of the argv here rather than being smuggled into a wrapper script. What is
 * under test is the ARGV vam builds and the PARSE vam runs; the six lines
 * between them are `execFile`, which `createTmuxRunner` is.
 */
const run: TmuxRun = (argv) =>
  new Promise((resolve) => {
    execFile('tmux', ['-L', SOCKET, ...argv], { maxBuffer: 4 * 1024 * 1024 }, (f, out, err) => {
      resolve({ failure: f, stdout: String(out), stderr: String(err) });
    });
  });

const tmux = (...argv: string[]): void => {
  execFileSync('tmux', ['-L', SOCKET, ...argv], { stdio: 'ignore' });
};

const live = tmuxWorks();

describe.skipIf(!live)('the scrollback vam asks a real tmux for', () => {
  beforeAll(async () => {
    // A pane ten rows tall printing forty lines: thirty of them are in the
    // history before this returns, which is the whole point.
    tmux(
      'new-session',
      '-d',
      '-s',
      SESSION,
      '-x',
      '80',
      '-y',
      String(ROWS),
      'sh',
      '-c',
      `i=1; while [ $i -le ${PRINTED} ]; do echo line-$i; i=$((i+1)); done; printf ${MARKER}; sleep 300`,
    );
    const until = Date.now() + 10_000;
    while (Date.now() < until) {
      const pane = await readPane(run, SESSION);
      if (pane.kind === 'ok' && pane.text.includes(MARKER)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('the probe pane never printed its marker');
  }, 20_000);

  afterAll(() => {
    try {
      tmux('kill-server');
    } catch {
      // The server is already gone, which is the state this wanted.
    }
  });

  it('answers with the SCREEN and nothing else when nothing was asked for', async () => {
    const pane = await readPane(run, SESSION);
    expect(pane.kind).toBe('ok');
    if (pane.kind !== 'ok') return;
    // THE DEFECT, REPRODUCED. Forty lines were printed into a ten-row pane and
    // this answer holds ten of them: the first thirty are in tmux's history,
    // which `capture-pane` does not return unless it is asked. A box exactly
    // as tall as its content is a box with nothing to scroll.
    expect(pane.text.trimEnd().split('\n')).toHaveLength(ROWS);
    expect(pane.text).not.toContain('line-1\n');
    expect(pane.text).toContain(MARKER);
  });

  it('answers with the history above it when it is', async () => {
    const pane = await readPane(run, SESSION, PANE_HISTORY_LINES);
    expect(pane.kind).toBe('ok');
    if (pane.kind !== 'ok') return;
    const lines = pane.text.trimEnd().split('\n');
    expect(lines.length).toBeGreaterThan(ROWS);
    // Every line the pane ever printed, in order, including the ones that
    // scrolled off -- which is what the operator asked to be able to read.
    expect(lines).toContain('line-1');
    expect(lines).toContain(`line-${PRINTED}`);
    expect(lines.indexOf('line-1')).toBeLessThan(lines.indexOf('line-2'));
  });

  it('clamps to the history that EXISTS rather than padding to the ask', async () => {
    // tmux does not invent lines: a request for five hundred against a session
    // forty lines old answers with the forty. The arithmetic in `splitCursor`
    // depends on that (`Math.min`), and this is where it is checked.
    const pane = await readPane(run, SESSION, PANE_HISTORY_LINES);
    if (pane.kind !== 'ok') throw new Error('the pane was not readable');
    expect(pane.text.trimEnd().split('\n').length).toBeLessThan(PANE_HISTORY_LINES);
  });

  it('puts the caret on the line the caret is really on', async () => {
    const pane = await readPane(run, SESSION, PANE_HISTORY_LINES);
    if (pane.kind !== 'ok') throw new Error('the pane was not readable');
    expect(pane.cursor.kind).toBe('at');
    if (pane.cursor.kind !== 'at') return;
    const lines = pane.text.split('\n');
    // THE OFF-BY-N, MEASURED. `cursor_y` is a row of the SCREEN and is at most
    // nine here; the caret's real line in this text is past the thirty lines
    // of history, so a cursor row inside the screen's own range would be the
    // bug this offset exists to prevent.
    expect(pane.cursor.row).toBeGreaterThanOrEqual(ROWS);
    expect(lines[pane.cursor.row]).toContain(MARKER);
    // And the column is where six printed characters leave it.
    expect(pane.cursor.column).toBe(MARKER.length);
  });
});
