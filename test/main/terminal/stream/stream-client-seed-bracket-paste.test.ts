/**
 * (S2) PASTE INTO AN ALREADY-RUNNING SESSION WAS NEVER BRACKETED.
 *
 * `TerminalStreamTab.tsx`'s own paste listener wraps a paste in `CSI
 * 200~`/`201~` only when xterm's `modes.bracketedPasteMode` is already
 * `true` -- and xterm sets that ONLY by parsing a `CSI ?2004h` out of data
 * this component actually wrote to it (its own seed, or a later `%output`
 * chunk). A program requests bracketed paste ONCE, at its own startup --
 * `claude`'s does -- so ATTACHING to a session already running one (this
 * whole client's reason for being: `client.ts`'s own module header) never
 * sees that request at all. `term.reset()` (`TerminalStreamTab.tsx`, run
 * before every reconnect/pause-continue seed) then leaves the mode
 * permanently off for that view, and a multi-line paste submits one line at
 * a time -- the operator's own report.
 *
 * THE FIX: `argv.ts`'s own `CURSOR_FORMAT` now also asks tmux for
 * `#{bracket_paste_flag}` -- the SAME per-pane fact `mouse_any_flag`
 * already rides this line for. `seedWithCursor` re-emits the identical `CSI
 * ?2004h` the pane's own program would have sent at its own startup, so
 * xterm's mode is primed the instant the seed lands, with no new IPC round
 * trip and no client-side guessing.
 *
 * PURE HALF (`seedWithCursor` directly) plus a REAL-TMUX FALSIFICATION: a
 * fake program (never the real, paid `claude` CLI -- a private-socket `sh`
 * one-liner) that enables bracketed paste and hides its cursor, exactly the
 * shape this task asked to verify against.
 */

import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StreamClient } from '../../../../src/main/terminal/stream/client.js';
import { seedWithCursor } from '../../../../src/main/terminal/stream/seed.js';

describe('seedWithCursor: bracketed paste (pure)', () => {
  it('re-emits CSI ?2004h when the sixth field says the pane asked for bracketed paste', () => {
    const body = 'x\n';
    expect(seedWithCursor(body, '@vam-cursor 1 0 0 0 0 1')).toBe('x\x1b[1;1H\x1b[?25h\x1b[?2004h');
  });

  it('emits nothing extra when the pane declined bracketed paste', () => {
    const body = 'x\n';
    expect(seedWithCursor(body, '@vam-cursor 1 0 0 0 0 0')).toBe('x\x1b[1;1H\x1b[?25h');
  });

  it('emits nothing extra when the line carries no sixth field at all (an older tmux, or a stub predating it)', () => {
    const body = 'x\n';
    expect(seedWithCursor(body, '@vam-cursor 1 0 0 0 0')).toBe('x\x1b[1;1H\x1b[?25h');
  });

  it('rides along even for a HIDDEN cursor, after the hide escape', () => {
    const body = 'x\n';
    expect(seedWithCursor(body, '@vam-cursor 0 5 5 0 0 1')).toBe('x\x1b[6;6H\x1b[?25l\x1b[?2004h');
  });

  it('rides along even when the cursor reply itself is unreadable', () => {
    const body = 'x\n';
    // Six real digits with an unreadable flag (2 is neither 0 nor 1) --
    // `cursor` and `position` both fall back, but `bracketPaste` is its own
    // independent field and still reads.
    expect(seedWithCursor(body, '@vam-cursor 2 0 0 0 0 1')).toBe('x\x1b[?2004h');
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

const SOCKET = `vamtest${process.pid}bp`;
const SESSION = `vam-seedbracket-${process.pid}`;
const COLUMNS = 60;
const ROWS = 20;

const tmux = (...argv: string[]): string =>
  execFileSync('tmux', ['-L', SOCKET, ...argv], { encoding: 'utf8' });

const live = tmuxWorks();

describe.skipIf(!live)(
  'StreamClient#connect seed: bracketed paste, ATTACHING to an already-running pane (real tmux)',
  () => {
    beforeAll(() => {
      tmux('new-session', '-d', '-s', SESSION, '-x', String(COLUMNS), '-y', String(ROWS), 'sh');
      // A FAKE PROGRAM, never the real (paid) `claude` CLI: enables bracketed
      // paste and hides its cursor, exactly the two facts this task asked to
      // verify against a real tmux -- then sleeps so the session stays alive
      // long enough for `StreamClient#connect` to attach to it AFTER both
      // sequences have already run (the whole bug: the enable sequence is
      // sent once, at this fake program's own startup, well before this
      // client ever opens a connection).
      tmux('send-keys', '-t', SESSION, '-l', '--', 'printf "\\033[?25l\\033[?2004h"; sleep 100');
      tmux('send-keys', '-t', SESSION, 'Enter');
    }, 20_000);

    afterAll(() => {
      try {
        tmux('kill-server');
      } catch {
        // Already gone.
      }
    });

    it('the seed carries CSI ?2004h -- xterm is primed the instant it is written, with no live %output ever needed', async () => {
      // Ground truth: the fake program's own escape sequences already ran
      // and the pane already carries both facts, before `StreamClient` ever
      // attaches.
      await new Promise((r) => setTimeout(r, 300));
      const groundTruth = tmux(
        'display-message',
        '-p',
        '-t',
        SESSION,
        '-F',
        '@vam-cursor #{cursor_flag} #{cursor_x} #{cursor_y} #{history_size} #{mouse_any_flag} #{bracket_paste_flag}',
      ).trim();
      expect(groundTruth.endsWith(' 1')).toBe(true);

      const client = new StreamClient({ prefix: ['-L', SOCKET], target: SESSION });
      try {
        const seed = await client.connect();
        expect(seed).toContain('\x1b[?2004h');
      } finally {
        client.dispose();
      }
    });
  },
);
