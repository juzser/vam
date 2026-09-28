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
import { parseTmuxVersion } from '../../../../src/main/terminal/stream-ipc.js';

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

/** `tmux -V`'s own text, or `''` when tmux is not on `PATH` at all -- the
 * one probe both `live` and `supportsBracketPasteFlag` below are read from,
 * so a single `execFileSync` failure (no tmux) answers both. */
const tmuxVersionText = (): string => {
  try {
    return execFileSync('tmux', ['-V'], { encoding: 'utf8' });
  } catch {
    return '';
  }
};

const SOCKET = `vamtest${process.pid}bp`;
const SESSION = `vam-seedbracket-${process.pid}`;
const COLUMNS = 60;
const ROWS = 20;

const tmux = (...argv: string[]): string =>
  execFileSync('tmux', ['-L', SOCKET, ...argv], { encoding: 'utf8' });

/** The same generous, condition-based poll `stream-client-pause-after.test.ts`
 * already uses for real-tmux timing in general: a loaded runner can be slow
 * enough that the fake program's own `printf` has not yet run by the time a
 * FIXED wait would have given up. Polling the actual condition, rather than
 * gambling on one wall-clock number, is what makes this hold on a loaded
 * runner and a fast laptop alike. */
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

const versionText = tmuxVersionText();
const live = versionText !== '';
/** `#{bracket_paste_flag}` was ADDED IN TMUX 3.7 (MEASURED: `git grep` over
 * the installed tmux's own `CHANGES` file finds it exactly once, under the
 * "CHANGES FROM 3.6b TO 3.7" section, nowhere earlier) -- older than that,
 * the key is one this parse does not know, which `readCursorLine`'s own
 * "a key tmux does not know expands to the empty string" rule already
 * degrades gracefully (`bracketPaste` reads `null`, exactly like an old
 * tmux with no `#{mouse_any_flag}` either): the SHIPPED fix does the right,
 * safe thing on tmux 3.2-3.6 (nothing -- no CSI seeded, no crash), it is
 * only THIS TEST's ground-truth assertion that needs tmux new enough to
 * answer the question at all. Ubuntu 24.04's own `apt` tmux (CI's own
 * runner, MEASURED against a real failure: `juzser/vam#540` run
 * 36378584146 read back `bracket_paste_flag` as an empty field, five tokens
 * instead of six, on tmux 3.4) is one minor version short of it. */
const version = parseTmuxVersion(versionText);
const supportsBracketPasteFlag =
  version !== null && (version.major > 3 || (version.major === 3 && version.minor >= 7));

if (live && !supportsBracketPasteFlag) {
  console.warn(
    `SKIP  stream-client-seed-bracket-paste.test.ts's real-tmux test: tmux ${versionText.trim()} predates 3.7, which is what added #{bracket_paste_flag} -- this test cannot ask tmux the question it needs answered, though the shipped fix itself still degrades safely on it (readCursorLine's own null case).`,
  );
}

describe.skipIf(!live || !supportsBracketPasteFlag)(
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

    // EXPLICIT TIMEOUT ON THE TEST BELOW, LARGER THAN THE POLL'S OWN
    // DEADLINE -- a review finding: vitest's own default `testTimeout`
    // (5000ms) killed this test before the 10s poll ever got the chance
    // CI's own slower runner needed (MEASURED: CI failed with "Test timed
    // out in 5000ms" even after the poll fix, the poll never actually
    // being the thing that ran out).
    it('the seed carries CSI ?2004h -- xterm is primed the instant it is written, with no live %output ever needed', {
      timeout: 15_000,
    }, async () => {
      // Ground truth: the fake program's own escape sequences already ran
      // and the pane already carries both facts, before `StreamClient` ever
      // attaches. POLLED, not a fixed sleep (this test's own header) -- a
      // loaded CI runner can take longer than any one fixed wait to have
      // actually scheduled and run the fake program's `printf`.
      let groundTruth = '';
      const settled = await pollUntil(() => {
        groundTruth = tmux(
          'display-message',
          '-p',
          '-t',
          SESSION,
          '-F',
          '@vam-cursor #{cursor_flag} #{cursor_x} #{cursor_y} #{history_size} #{mouse_any_flag} #{bracket_paste_flag}',
        ).trim();
        return groundTruth.endsWith(' 1');
      }, 10_000);
      expect(settled, `ground truth never showed bracket_paste_flag=1: ${groundTruth}`).toBe(true);

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
