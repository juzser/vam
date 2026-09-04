/**
 * The Terminal tab's read path -- and the first place `listVamSessions`'s
 * no-server-to-empty-list mapping runs for anything but a test.
 *
 * The runner is a parameter for `spawn.ts`'s reason: a test that really ran
 * these would create and kill sessions on the operator's tmux server. Nothing
 * here spawns; the argv each call produced is asserted instead, which is the
 * part a wrong answer would come from.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import { registerTerminalIpc } from '../../../src/main/terminal/ipc.js';
import { matchVamSession, readSessionPane } from '../../../src/main/terminal/pane.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });
const failed = (stderr: string): TmuxRunResult => ({
  failure: { message: 'tmux failed' },
  stdout: '',
  stderr,
});

/** Records every argv and answers each command from `answers`, by verb. */
function runner(answers: Record<string, TmuxRunResult>) {
  const argvs: (readonly string[])[] = [];
  const run: TmuxRun = async (argv) => {
    argvs.push(argv);
    const verb = argv[0] ?? '';
    return answers[verb] ?? failed(`no stub for ${verb}`);
  };
  return { run, argvs, verbs: () => argvs.map((argv) => argv[0]) };
}

describe('matching a session to the tmux session vam started for it', () => {
  it('finds the session created from the same title, whatever its random tail', () => {
    expect(matchVamSession(['vam-atlas-a1b2c3'], 'atlas')).toBe('vam-atlas-a1b2c3');
  });

  it('never matches a session vam did not start', () => {
    // The operator's own sessions cannot be adopted, so they must not even be
    // offered: no process may take over another's controlling TTY.
    expect(matchVamSession(['notes', 'irc', 'atlas'], 'atlas')).toBeNull();
  });

  it('does not let one title reach another title-s session', () => {
    // A bare prefix match would let `atlas` reach `vam-atlas-two-...`, which is
    // a different session with a different screen.
    expect(matchVamSession(['vam-atlas-two-a1b2c3'], 'atlas')).toBeNull();
  });

  it('picks the same one every refresh when a title has two sessions', () => {
    const names = ['vam-atlas-zz0000', 'vam-atlas-aa0000'];
    expect(matchVamSession(names, 'atlas')).toBe('vam-atlas-zz0000');
    expect(matchVamSession([...names].reverse(), 'atlas')).toBe('vam-atlas-zz0000');
  });

  it('normalises a title the way the creator did', () => {
    // `vamSessionName` slugs the label; matching has to slug it identically or
    // every session with a space in its title is invisible.
    expect(matchVamSession(['vam-sprint-board-a1b2c3'], 'sprint board')).toBe(
      'vam-sprint-board-a1b2c3',
    );
  });
});

describe('reading the pane', () => {
  it('captures the matched session and returns its screen', async () => {
    const { run, argvs } = runner({
      'list-sessions': ok('vam-atlas-a1b2c3\nnotes\n'),
      'capture-pane': ok('$ claude\n'),
    });
    expect(await readSessionPane(run, 'atlas')).toEqual({
      kind: 'ok',
      name: 'vam-atlas-a1b2c3',
      text: '$ claude\n',
    });
    // Exact targeting: `-t vam-atlas-a1` would reach `vam-atlas-a1b2c3` by
    // tmux's own prefix resolution, and on send-keys that is someone else's
    // session.
    expect(argvs[1]).toEqual(['capture-pane', '-p', '-t', '=vam-atlas-a1b2c3:']);
  });

  it('reports no session of vam-s, and captures nothing, when nothing matches', async () => {
    const { run, verbs } = runner({ 'list-sessions': ok('notes\n') });
    expect(await readSessionPane(run, 'atlas')).toEqual({ kind: 'not-vam' });
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('treats no server running as no sessions, not as a failure', async () => {
    // The mapping `spawn.ts` records as asserted-by-test-only. This is the
    // caller that finally runs it: no server means nothing was ever started,
    // which is an answer.
    const { run } = runner({
      'list-sessions': failed('no server running on /tmp/tmux-501/default'),
    });
    expect(await readSessionPane(run, 'atlas')).toEqual({ kind: 'not-vam' });
  });

  it('says vam could not ask for every other listing failure', async () => {
    const { run } = runner({ 'list-sessions': failed('permission denied') });
    const view = await readSessionPane(run, 'atlas');
    expect(view.kind).toBe('unavailable');
    if (view.kind !== 'unavailable') throw new Error('unreachable');
    expect(view.error.message).toContain('permission denied');
  });

  it('says the session ended when it disappears between the list and the capture', async () => {
    const { run } = runner({
      'list-sessions': ok('vam-atlas-a1b2c3\n'),
      'capture-pane': failed("can't find session: vam-atlas-a1b2c3"),
    });
    expect(await readSessionPane(run, 'atlas')).toEqual({ kind: 'gone' });
  });

  it('says vam could not ask when the capture fails for any other reason', async () => {
    const { run } = runner({
      'list-sessions': ok('vam-atlas-a1b2c3\n'),
      'capture-pane': failed('server exited unexpectedly'),
    });
    expect((await readSessionPane(run, 'atlas')).kind).toBe('unavailable');
  });
});

describe('the terminal channel', () => {
  function harness(run: TmuxRun) {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    registerTerminalIpc(
      { handle: (channel, listener) => void handlers.set(channel, listener) },
      run,
    );
    const handler = handlers.get(CHANNELS.terminalRead);
    if (handler === undefined) throw new Error('the terminal channel was never registered');
    return (...args: unknown[]) => handler({}, ...args) as Promise<unknown>;
  }

  it('answers a bare PaneView, with no IpcResult envelope around it', async () => {
    const { run } = runner({
      'list-sessions': ok('vam-atlas-a1b2c3\n'),
      'capture-pane': ok('screen'),
    });
    expect(await harness(run)('atlas')).toEqual({
      kind: 'ok',
      name: 'vam-atlas-a1b2c3',
      text: 'screen',
    });
  });

  it('refuses a malformed request without spawning tmux, and not as an empty pane', async () => {
    const { run, argvs } = runner({});
    for (const bad of [[], [42], ['a', 'b'], ['x'.repeat(501)]]) {
      const view = (await harness(run)(...bad)) as { kind: string };
      expect(view.kind, JSON.stringify(bad)).toBe('unavailable');
    }
    expect(argvs).toEqual([]);
  });
});
