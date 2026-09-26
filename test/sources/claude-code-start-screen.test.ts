/**
 * `detectStartScreen` and `answerTrustDialog` -- the operator's two reports
 * about the Start flow:
 *
 *  (1) "if the CLI has an update or needs to trust the folder, the Response
 *      view is stuck loading while the terminal is asking about the update
 *      and trust" -- because nothing ever looked at the pane's own screen.
 *  (2) "even when the terminal has finished starting the session, the
 *      Response view is still stuck loading" -- because the loading state
 *      only ever cleared once `claude agents --json` listed the row, and
 *      the pane itself already proves the CLI is up sooner than that poll
 *      does.
 *
 * `detectStartScreen` is the pane-text classifier both card and the "ready"
 * short-circuit are built on; `answerTrustDialog` is the one screen this
 * module is allowed to answer on its own (the operator's own sentence:
 * "answer the simple ones inline where it's safe and unambiguous").
 *
 * Fixtures are real captures (`start-screen-live-screens.ts`'s own header) --
 * nothing here is invented prose.
 */

import { describe, expect, it } from 'vitest';
import {
  answerTrustDialog,
  detectStartScreen,
} from '../../src/main/sources/claude-code/start-screen.js';
import { VAM_CURSOR_MARK } from '../../src/main/sources/tmux/argv.js';
import type { TmuxRunResult } from '../../src/main/sources/tmux/spawn.js';
import {
  CLAUDE_READY,
  CLAUDE_TRUST,
  CLAUDE_TRUST_CURSOR_ON_YES,
  CLAUDE_TRUST_NARROW,
  CODEX_READY_PLAIN,
  CODEX_TRUST,
} from '../main/terminal/start-screen-live-screens.js';

describe('detectStartScreen', () => {
  it('reads the real claude trust dialog as trust, cursor on the default "No"', () => {
    expect(detectStartScreen(CLAUDE_TRUST)).toBe('trust');
  });

  it('reads the same dialog as trust after the cursor has moved to "Yes"', () => {
    expect(detectStartScreen(CLAUDE_TRUST_CURSOR_ON_YES)).toBe('trust');
  });

  it('reads the real claude ready TUI (idle, no message ever sent) as ready', () => {
    expect(detectStartScreen(CLAUDE_READY)).toBe('ready');
  });

  it('reads the real codex trust dialog (numbered, unlike claude’s) as trust', () => {
    expect(detectStartScreen(CODEX_TRUST)).toBe('trust');
  });

  it('reads the real codex ready TUI as ready', () => {
    expect(detectStartScreen(CODEX_READY_PLAIN)).toBe('ready');
  });

  it('reads the same claude trust dialog wrapped at a real 40-column width as trust', () => {
    expect(detectStartScreen(CLAUDE_TRUST_NARROW)).toBe('trust');
  });

  it('is unmoved by NFD-decomposed text sitting elsewhere on the screen', () => {
    // "café" decomposed into 'e' + U+0301 (combining acute), the shape a real
    // HFS+/APFS path can hand back for an accented directory name -- nowhere
    // near the option labels the detector actually keys on.
    const nfd = CLAUDE_TRUST.replace('new-proj', 'café-proj');
    expect(detectStartScreen(nfd)).toBe('trust');
  });

  it('is unmoved by the identical text pre-composed (NFC)', () => {
    const nfc = CLAUDE_TRUST.replace('new-proj', 'café-proj');
    expect(detectStartScreen(nfc)).toBe('trust');
  });

  it('reads an update prompt as update', () => {
    const text = [
      '╭──────────────────────────────╮',
      '│ Update available · v2.1.283   │',
      '│                                │',
      '│ ❯ Update now                  │',
      '│   Not now                     │',
      '╰──────────────────────────────╯',
    ].join('\n');
    expect(detectStartScreen(text)).toBe('update');
  });

  it('reads a login/auth screen as login', () => {
    const text = ['Select login method', '', '❯ Claude account', '  API key'].join('\n');
    expect(detectStartScreen(text)).toBe('login');
  });

  it('reads a first-run theme picker as onboarding', () => {
    const text = ['Choose the text style that looks best', '', '❯ Dark mode', '  Light mode'].join(
      '\n',
    );
    expect(detectStartScreen(text)).toBe('onboarding');
  });

  it('reads a shell prompt as unknown — this function is never handed one in practice', () => {
    // `Canvas.tsx`'s own caller only polls once `pane_current_command` is no
    // longer a shell; this just proves the classifier does not crash or lie
    // about plain, ordinary shell output.
    expect(detectStartScreen('➜  new-project ')).toBe('unknown');
  });

  it('reads output that matches nothing known as unknown, never guessing ready', () => {
    const text = ['Checking for updates…', 'This may take a moment.'].join('\n');
    expect(detectStartScreen(text)).toBe('unknown');
  });

  it('never throws on empty input', () => {
    expect(detectStartScreen('')).toBe('unknown');
  });
});

/** A `TmuxRun` stub that answers `capture-pane` with a fixed screen and
 *  records every argv it was asked to run. */
function stubRun(screens: readonly string[]) {
  const calls: (readonly string[])[] = [];
  let at = 0;
  const run = async (argv: readonly string[]): Promise<TmuxRunResult> => {
    calls.push(argv);
    // `capturePaneArgv` chains `display-message ; capture-pane` as ONE tmux
    // call (`argv.ts`'s own comment) -- it is the FIRST verb, not the second.
    if (argv[0] === 'display-message') {
      const text = screens[Math.min(at, screens.length - 1)];
      at += 1;
      return { failure: null, stdout: `${VAM_CURSOR_MARK} 0 0 0\n${text}`, stderr: '' };
    }
    return { failure: null, stdout: '', stderr: '' };
  };
  return { run, calls };
}

describe('answerTrustDialog', () => {
  it('refuses when the pane is not showing a trust dialog at all — never guesses', async () => {
    const { run, calls } = stubRun([CLAUDE_READY]);
    const result = await answerTrustDialog(run, 'vam-x', true);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('refused');
    // A read only, never a keystroke, once the screen did not match.
    expect(calls.filter((c) => c[0] === 'send-keys')).toHaveLength(0);
  });

  it('trusting from the default cursor (on "No") sends Down then Enter', async () => {
    const { run, calls } = stubRun([CLAUDE_TRUST, CLAUDE_TRUST_CURSOR_ON_YES]);
    const result = await answerTrustDialog(run, 'vam-x', true);
    expect(result).toBeNull();
    const sendKeys = calls.filter((c) => c[0] === 'send-keys');
    expect(sendKeys).toHaveLength(2);
    expect(sendKeys[0]).toContain('Down');
    expect(sendKeys[1]).toContain('Enter');
  });

  it('trusting when the cursor is already on "Yes" sends only Enter', async () => {
    const { run, calls } = stubRun([CLAUDE_TRUST_CURSOR_ON_YES]);
    const result = await answerTrustDialog(run, 'vam-x', true);
    expect(result).toBeNull();
    const sendKeys = calls.filter((c) => c[0] === 'send-keys');
    expect(sendKeys).toHaveLength(1);
    expect(sendKeys[0]).toContain('Enter');
  });

  it('declining from the default cursor (on "No") sends only Enter', async () => {
    const { run, calls } = stubRun([CLAUDE_TRUST]);
    const result = await answerTrustDialog(run, 'vam-x', false);
    expect(result).toBeNull();
    const sendKeys = calls.filter((c) => c[0] === 'send-keys');
    expect(sendKeys).toHaveLength(1);
    expect(sendKeys[0]).toContain('Enter');
  });

  it('declining codex’s numbered dialog from its default cursor sends Down then Enter', async () => {
    // codex defaults to "1. Trust and continue" (accept) -- declining needs
    // one Down onto "2. Back to Agent Command Center" first.
    const { run, calls } = stubRun([CODEX_TRUST]);
    const result = await answerTrustDialog(run, 'vam-x', false);
    expect(result).toBeNull();
    const sendKeys = calls.filter((c) => c[0] === 'send-keys');
    expect(sendKeys).toHaveLength(2);
    expect(sendKeys[0]).toContain('Down');
    expect(sendKeys[1]).toContain('Enter');
  });
});
