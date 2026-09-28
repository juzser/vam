/**
 * `readStartScreen`/`answerTrustOnPane` -- aimed by the SAME `targetSession`
 * rule `readSessionPrompt`/`answerQuestion` (`answer.ts`) already use, proven
 * against the real fixtures `claude-code-start-screen.test.ts` already
 * verified the classifier against.
 */

import { describe, expect, it } from 'vitest';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import { answerTrustOnPane, readStartScreen } from '../../../src/main/terminal/start-screen.js';
import { CLAUDE_READY, CLAUDE_TRUST } from './start-screen-live-screens.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });
const failed = (stderr: string): TmuxRunResult => ({
  failure: { message: 'tmux failed' },
  stdout: '',
  stderr,
});

const ATLAS = 'claude-code:atlas-11111111';
const PANE = 'vam-atlas-a1b2c3';
const ROW = `pane:${PANE}`;

/** Records every argv and answers each command from `answers`, by verb --
 *  `pane.test.ts`'s own helper, unchanged. */
function runner(answers: Record<string, TmuxRunResult>) {
  const argvs: (readonly string[])[] = [];
  const run: TmuxRun = async (argv) => {
    argvs.push(argv);
    const verb = argv.includes('capture-pane') ? 'capture-pane' : (argv[0] ?? '');
    return answers[verb] ?? failed(`no stub for ${verb}`);
  };
  return { run, argvs };
}

describe('readStartScreen', () => {
  it('reads the real trust dialog off the pane a pane-row id names, and which provider is running it', async () => {
    const { run } = runner({
      'list-sessions': ok(`${ATLAS}\t\t${PANE}\t2.1.282\n`),
      'capture-pane': ok(`@vam-cursor 0 0 0\n${CLAUDE_TRUST}`),
    });
    expect(await readStartScreen(run, ATLAS, ROW, undefined)).toEqual({
      kind: 'ok',
      screen: 'trust',
      provider: 'claude-code',
    });
  });

  it('reads the real ready TUI the same way, naming codex when that is the foreground command', async () => {
    const { run } = runner({
      'list-sessions': ok(`${ATLAS}\t\t${PANE}\tcodex\n`),
      'capture-pane': ok(`@vam-cursor 0 0 0\n${CLAUDE_READY}`),
    });
    expect(await readStartScreen(run, ATLAS, ROW, undefined)).toEqual({
      kind: 'ok',
      screen: 'ready',
      provider: 'codex',
    });
  });

  it('answers a null provider, never a guess, when the listing carries no foreground command at all', async () => {
    const { run } = runner({
      'list-sessions': ok(`${ATLAS}\t\t${PANE}\n`),
      'capture-pane': ok(`@vam-cursor 0 0 0\n${CLAUDE_READY}`),
    });
    expect(await readStartScreen(run, ATLAS, ROW, undefined)).toEqual({
      kind: 'ok',
      screen: 'ready',
      provider: null,
    });
  });

  /**
   * THE S2 THIS PINS: a shell's OWN foreground command (`isShellCommand`,
   * `sources/tmux/shell.ts`) is folded into the SAME `undefined`
   * `identifyRunningProvider` also answers for "no command at all" -- but
   * this reader has more information than that classifier alone: it just
   * READ the pane's own text, and starship/pure prompts draw their OWN `❯`
   * glyph before an operator has even pressed Enter on a typed `claude`,
   * which `detectStartScreen`'s READY_CARET (measured against the real CLI,
   * deliberately blind to `pane_current_command` -- that file's own header)
   * reads as `ready`. `provider: undefined` here is the distinct signal a
   * caller needs to know this is NOT actually ready -- `null` stays reserved
   * for "confirmed running, command unrecognised", never a shell wearing a
   * borrowed glyph.
   */
  it('answers an undefined provider, distinct from a confirmed-unidentified null, when the pane’s own foreground is a shell', async () => {
    const { run } = runner({
      'list-sessions': ok(`${ATLAS}\t\t${PANE}\tzsh\n`),
      'capture-pane': ok('@vam-cursor 0 0 0\n❯ claude'),
    });
    expect(await readStartScreen(run, ATLAS, ROW, undefined)).toEqual({
      kind: 'ok',
      screen: 'ready',
      provider: undefined,
    });
  });

  it('answers `unaimed` for a pane-row id naming a session that has since ended', async () => {
    const { run } = runner({ 'list-sessions': ok('') });
    expect(await readStartScreen(run, ATLAS, ROW, undefined)).toEqual({ kind: 'unaimed' });
  });

  it('answers `unavailable` when tmux itself could not be asked', async () => {
    const { run } = runner({ 'list-sessions': failed('permission denied') });
    expect(await readStartScreen(run, ATLAS, ROW, undefined)).toEqual({ kind: 'unavailable' });
  });
});

describe('answerTrustOnPane', () => {
  it('answers the trust dialog on the pane a pane-row id names', async () => {
    const { run, argvs } = runner({
      'list-sessions': ok(`${ATLAS}\t\t${PANE}\n`),
      'capture-pane': ok(`@vam-cursor 0 0 0\n${CLAUDE_TRUST}`),
      'send-keys': ok(''),
    });
    const result = await answerTrustOnPane(run, ATLAS, ROW, true, undefined);
    expect(result).toBeNull();
    const sendKeys = argvs.filter((argv) => argv[0] === 'send-keys');
    // Default cursor is on "No, exit" -- trusting needs one Down then Enter.
    expect(sendKeys).toHaveLength(2);
  });

  it('refuses `unaimed` rather than guessing at a pane, for a row with no live session', async () => {
    const { run, argvs } = runner({ 'list-sessions': ok('') });
    const result = await answerTrustOnPane(run, ATLAS, ROW, true, undefined);
    expect(result).toEqual({ kind: 'unaimed' });
    expect(argvs.some((argv) => argv[0] === 'send-keys')).toBe(false);
  });
});
