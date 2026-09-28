/**
 * THE STREAMING SEED PLACES XTERM'S CURSOR WHERE TMUX'S REAL CURSOR IS.
 *
 * The operator's own report, translated: typing lands on the row BELOW a
 * Claude Code-style input box, overwriting its bottom border -- a real
 * screenshot (`docs/design/ref/stream-cursor-offset-report.png`) shows
 * `hello` landing one row under `❯ Try "..."`. `capture-pane`'s own text
 * dump carries no cursor position at all (`argv.ts`'s own `CURSOR_FORMAT`
 * exists for exactly this reason, already used by the POLLING
 * `TerminalTab.tsx` path, `spawn.ts#readCursorLine`) -- the STREAMING path
 * (`client.ts#reseed`) never asked, so xterm's cursor, once a seed is
 * written, simply sits wherever the text left it.
 *
 * A SECOND, COMPOUNDING BUG, found chasing the first: `capture-pane`'s block
 * body (`client.ts`'s own `${line}\n` join) carries a trailing `\n` after
 * the LAST captured line too. MEASURED against a real `@xterm/xterm`
 * `Terminal`: writing exactly `pane_height` `\r\n`-terminated lines into a
 * `pane_height`-row terminal SCROLLS it by one line the instant that final
 * `\r\n` lands with the cursor already on the bottom row -- the pane's own
 * top row silently drops into scrollback before any cursor placement even
 * runs, which would misplace a naively-computed `cursor_y` by one row all
 * over again. `seedWithCursor` fixes both in the one place that already
 * holds the raw capture-pane body and the raw cursor-query reply.
 *
 * `-N`, NOT THIS FILE'S OLD `-J`: `-J` joins wrapped rows AND (its own
 * implied `-T`) trims trailing blank rows, both of which change the
 * CAPTURED LINE COUNT away from `#{pane_height}` -- MEASURED, a 98x24 real
 * tmux fixture: `-J` returned 23 lines, `-N` (preserves trailing spaces,
 * never joins or trims) returned the full 24, matching `cursor_y`'s own
 * frame of reference (`argv.ts`'s `CURSOR_FORMAT` doc: "`cursor_y` are CELLS
 * from the left and lines from the top of the pane").
 */

import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readCursorLine } from '../../../../src/main/sources/tmux/spawn.js';
import { StreamClient } from '../../../../src/main/terminal/stream/client.js';
import { seedWithCursor } from '../../../../src/main/terminal/stream/seed.js';

/** The same generous, condition-based poll `stream-client-pause-after.test.ts`
 * already uses for real-tmux timing: a loaded CI runner can be slower than
 * any one fixed wait to have actually scheduled and run a `send-keys`, so
 * this polls the real condition (the cursor reply actually hidden) rather
 * than gambling on a wall-clock number. */
const pollUntil = async (
  check: () => boolean,
  deadlineMs: number,
  intervalMs = 100,
): Promise<boolean> => {
  const deadline = Date.now() + deadlineMs;
  while (!check() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return check();
};

describe('seedWithCursor (pure)', () => {
  it('places the cursor at cursor_x/cursor_y (0-based) as a 1-based CSI row;col H, and shows it', () => {
    const body = 'line0\nline1\nline2\n';
    const cursorLine = '@vam-cursor 1 8 1 0 0';
    expect(seedWithCursor(body, cursorLine)).toBe('line0\nline1\nline2\x1b[2;9H\x1b[?25h');
  });

  it('drops exactly the single trailing newline, never more, regardless of the cursor reply', () => {
    const body = 'a\nb\n';
    expect(seedWithCursor(body, 'not a cursor line')).toBe('a\nb');
  });

  it('leaves a body with no trailing newline alone (defensive: capture-pane always sends one, but never assume)', () => {
    const body = 'a\nb';
    expect(seedWithCursor(body, 'not a cursor line')).toBe('a\nb');
  });

  it('places the cursor at its real cell, THEN hides it, when cursor_flag is 0 (review finding: the position used to be discarded)', () => {
    // Claude Code's own UI hides the cursor and redraws relatively -- a
    // seed that dropped the position here left every later relative redraw
    // landing on the wrong row. tmux keeps tracking `cursor_x`/`cursor_y`
    // even while the cursor is hidden (MEASURED against a real tmux 3.7b on
    // a private `-L` socket: hiding the cursor, then moving it with a CUP,
    // both changed `#{cursor_x}`/`#{cursor_y}` on the very next
    // `display-message`), so this is real data to place, not a guess.
    const body = 'x\n';
    expect(seedWithCursor(body, '@vam-cursor 0 5 5 0 0')).toBe('x\x1b[6;6H\x1b[?25l');
  });

  it('hides the cursor with no CUP when its position could not be read either (defensive, never invents 0,0)', () => {
    const body = 'x\n';
    expect(seedWithCursor(body, '@vam-cursor 0  ')).toBe('x\x1b[?25l');
  });

  it('appends nothing beyond the trailing-newline strip when the cursor reply is unreadable', () => {
    const body = 'x\n';
    // Empty fields -- exactly what a `display-message` against a dead
    // target answers with (`spawn.ts`'s own `readCursorLine` header).
    expect(seedWithCursor(body, '@vam-cursor   ')).toBe('x');
  });

  it('reads only the FIRST line of the cursor reply (defensive against a multi-line body)', () => {
    const body = 'x\n';
    expect(seedWithCursor(body, '@vam-cursor 1 0 0 0 0\nsomething else')).toBe(
      'x\x1b[1;1H\x1b[?25h',
    );
  });

  it('agrees with readCursorLine’s own parse of the identical line (single source of truth)', () => {
    const cursorLine = '@vam-cursor 1 12 4 0 1';
    const mark = readCursorLine(cursorLine);
    expect(mark.cursor.kind).toBe('at');
    const body = 'unused\n';
    const result = seedWithCursor(body, cursorLine);
    if (mark.cursor.kind !== 'at') throw new Error('unreachable');
    expect(result).toBe(`unused\x1b[${mark.cursor.row + 1};${mark.cursor.column + 1}H\x1b[?25h`);
  });
});

const tmuxWorks = (): boolean => {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const SOCKET = `vamtest${process.pid}sk`;
const SESSION = `vam-seedcursor-${process.pid}`;
// A SECOND, dedicated session whose own fake program hides its cursor and
// then moves it -- the real-tmux falsification for the "keep the
// coordinates" fix: `readCursorLine` used to discard `cursor_x`/`cursor_y`
// outright whenever `cursor_flag` was 0 (`spawn.ts:388`), so a hidden
// cursor's redraw-relative UI (Claude Code's own) landed on the wrong row
// after a reseed. MEASURED separately (this task's own probe, a private
// `-L` socket) that tmux keeps tracking `#{cursor_x}`/`#{cursor_y}` while
// hidden, so there is a real position here to place, not a guess.
const HIDDEN_SESSION = `vam-seedcursor-hidden-${process.pid}`;
const COLUMNS = 60;
const ROWS = 20;

const tmux = (...argv: string[]): string =>
  execFileSync('tmux', ['-L', SOCKET, ...argv], { encoding: 'utf8' });

const live = tmuxWorks();

describe.skipIf(!live)('StreamClient#connect seed (real tmux)', () => {
  beforeAll(() => {
    tmux('new-session', '-d', '-s', SESSION, '-x', String(COLUMNS), '-y', String(ROWS), 'sh');
    // A prompt mid-screen, well short of the pane's own bottom row -- the
    // exact shape of the operator's own report (the input box is nowhere
    // near the last line of the screen).
    tmux('send-keys', '-t', SESSION, '-l', '--', 'printf "one\\ntwo\\nthree\\n"');
    tmux('send-keys', '-t', SESSION, 'Enter');

    tmux(
      'new-session',
      '-d',
      '-s',
      HIDDEN_SESSION,
      '-x',
      String(COLUMNS),
      '-y',
      String(ROWS),
      'sh',
    );
    // DECTCEM off (hide), then a CUP well away from the origin -- so a fix
    // that quietly fell back to `0,0` (or to no position at all) is
    // distinguishable from one that genuinely read tmux's own tracked cell.
    tmux('send-keys', '-t', HIDDEN_SESSION, '-l', '--', 'printf "\\033[?25l\\033[3;10H"');
    tmux('send-keys', '-t', HIDDEN_SESSION, 'Enter');
  }, 20_000);

  afterAll(() => {
    try {
      tmux('kill-server');
    } catch {
      // Already gone.
    }
  });

  it('the seed places xterm’s cursor at the SAME cell real tmux reports, never at the end of the text', async () => {
    // Ground truth, read independently of the client under test.
    await new Promise((r) => setTimeout(r, 200));
    const cursorLine = tmux(
      'display-message',
      '-p',
      '-t',
      SESSION,
      '-F',
      '@vam-cursor #{cursor_flag} #{cursor_x} #{cursor_y} #{history_size} #{mouse_any_flag}',
    ).trim();
    const mark = readCursorLine(cursorLine);
    expect(mark.cursor.kind).toBe('at');
    if (mark.cursor.kind !== 'at') throw new Error('unreachable');
    // A real shell prompt sits well before the pane's last row.
    expect(mark.cursor.row).toBeLessThan(ROWS - 1);

    const client = new StreamClient({ prefix: ['-L', SOCKET], target: SESSION });
    try {
      const seed = await client.connect();
      const expectedEscape = `\x1b[${mark.cursor.row + 1};${mark.cursor.column + 1}H\x1b[?25h`;
      expect(seed.endsWith(expectedEscape)).toBe(true);
    } finally {
      client.dispose();
    }
  });

  // EXPLICIT TIMEOUT ON THE TEST BELOW, LARGER THAN THE POLL'S OWN 10s
  // DEADLINE: this file's own bracket-paste sibling test was killed by
  // vitest's default `testTimeout` (5000ms) before its identically-shaped
  // poll ever got the time CI's slower runner needed; matched here too
  // rather than trusting this one to keep passing by a margin.
  it('a HIDDEN cursor still seeds its real position, not just the hide escape (review finding)', {
    timeout: 15_000,
  }, async () => {
    // POLLED, not a fixed sleep: a loaded CI runner can take longer than
    // any one fixed wait to have actually scheduled and run the fake
    // program's own `printf` (MEASURED: CI's own run of this file's
    // bracket-paste sibling test saw a flat 300ms miss the same class of
    // race).
    let cursorLine = '';
    const settled = await pollUntil(() => {
      cursorLine = tmux(
        'display-message',
        '-p',
        '-t',
        HIDDEN_SESSION,
        '-F',
        '@vam-cursor #{cursor_flag} #{cursor_x} #{cursor_y} #{history_size} #{mouse_any_flag}',
      ).trim();
      return readCursorLine(cursorLine).cursor.kind === 'hidden';
    }, 10_000);
    expect(settled, `cursor never read hidden: ${cursorLine}`).toBe(true);
    const mark = readCursorLine(cursorLine);
    expect(mark.cursor.kind).toBe('hidden');
    expect(mark.position).not.toBeNull();
    if (mark.position === null) throw new Error('unreachable');

    const client = new StreamClient({ prefix: ['-L', SOCKET], target: HIDDEN_SESSION });
    try {
      const seed = await client.connect();
      const expectedEscape = `\x1b[${mark.position.row + 1};${mark.position.column + 1}H\x1b[?25l`;
      expect(seed.endsWith(expectedEscape)).toBe(true);
    } finally {
      client.dispose();
    }
  });

  it('the seed carries exactly #{pane_height} lines of screen content before the cursor escape (no row dropped by -J, no row lost to a trailing-newline scroll)', async () => {
    const client = new StreamClient({ prefix: ['-L', SOCKET], target: SESSION });
    try {
      const seed = await client.connect();
      // biome-ignore lint/suspicious/noControlCharactersInRegex: matching the literal ESC byte is the whole point -- stripping the CSI sequences the cursor fix appends before counting screen rows.
      const withoutEscape = seed.replace(/\x1b\[[\d;]*[Hh]|\x1b\[\?25[hl]/g, '');
      const lineCount = withoutEscape.split('\n').length;
      expect(lineCount).toBe(ROWS);
    } finally {
      client.dispose();
    }
  });
});
