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

  it('hides the cursor (DECTCEM off) and does not reposition it when cursor_flag is 0', () => {
    const body = 'x\n';
    expect(seedWithCursor(body, '@vam-cursor 0 5 5 0 0')).toBe('x\x1b[?25l');
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
