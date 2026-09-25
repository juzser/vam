/**
 * `readStartScreen`/`answerTrustOnPane` -- aimed by the SAME `targetSession`
 * rule `readSessionPrompt`/`answerQuestion` (`answer.ts`) already use, proven
 * against the real fixtures `claude-code-start-screen.test.ts` already
 * verified the classifier against.
 */

import { describe, expect, it } from 'vitest';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import {
  answerTrustOnPane,
  identifyRunningProvider,
  readStartScreen,
} from '../../../src/main/terminal/start-screen.js';
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

  it('answers `unaimed` for a pane-row id naming a session that has since ended', async () => {
    const { run } = runner({ 'list-sessions': ok('') });
    expect(await readStartScreen(run, ATLAS, ROW, undefined)).toEqual({ kind: 'unaimed' });
  });

  it('answers `unavailable` when tmux itself could not be asked', async () => {
    const { run } = runner({ 'list-sessions': failed('permission denied') });
    expect(await readStartScreen(run, ATLAS, ROW, undefined)).toEqual({ kind: 'unavailable' });
  });
});

describe('identifyRunningProvider', () => {
  it('names codex directly, by its own bare command', () => {
    expect(identifyRunningProvider('codex')).toBe('codex');
  });

  it('names claude-code from the literal command, before it has replaced argv[0]', () => {
    expect(identifyRunningProvider('claude')).toBe('claude-code');
  });

  it('names claude-code from its own measured version-string quirk', () => {
    expect(identifyRunningProvider('2.1.282')).toBe('claude-code');
  });

  it('strips a login shell’s leading dash, the same way isShellCommand does', () => {
    expect(identifyRunningProvider('-codex')).toBe('codex');
  });

  it('answers null for a shell, an unrecognised command, or no command at all', () => {
    expect(identifyRunningProvider('zsh')).toBeNull();
    expect(identifyRunningProvider('htop')).toBeNull();
    expect(identifyRunningProvider(undefined)).toBeNull();
    expect(identifyRunningProvider('')).toBeNull();
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
