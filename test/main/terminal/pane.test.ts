/**
 * The Terminal tab's read path -- and the first place `listVamSessions`'s
 * no-server-to-empty-list mapping runs for anything but a test.
 *
 * The runner is a parameter for `spawn.ts`'s reason: a test that really ran
 * these would create and kill sessions on the operator's tmux server. Nothing
 * here spawns; the argv each call produced is asserted instead, which is the
 * part a wrong answer would come from.
 *
 * WHY EVERY FIXTURE BELOW SPELLS THE NAME AND THE PROJECT ID SEPARATELY, and
 * it is the whole reason this file was rewritten. The matcher used to be fed
 * the same literal that built the name it was asked to find, so the suite
 * agreed with itself whatever the rule was: a wrong rule and a right one both
 * passed. The pairing is now a RECORDED fact (`@vam-project`, set on the
 * session at creation), so a fixture can hold a name that disagrees with it --
 * a renamed session, two names that truncate to the same slug -- and those are
 * exactly the cases a derived rule got wrong.
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

const ATLAS = 'claude-code:atlas-11111111';
const BEACON = 'claude-code:beacon-22222222';

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

describe('matching a project to the tmux session vam started for it', () => {
  it('finds the session vam recorded, whatever its name says', () => {
    // The name is not consulted at all beyond being the answer. This one was
    // built from a project NAME while the tab asks by project ID -- the exact
    // mismatch that made every session read as "vam started nothing here".
    const sessions = [{ project: ATLAS, name: 'vam-atlas-frontend-rewrite-a1b2c3' }];
    expect(matchVamSession(sessions, ATLAS)).toEqual({
      kind: 'one',
      name: 'vam-atlas-frontend-rewrite-a1b2c3',
    });
  });

  it('still finds it after the operator renamed the tmux session', () => {
    // A recorded option survives `rename-session` -- measured against a real
    // tmux on a private socket. A name-derived rule loses the session outright.
    const sessions = [{ project: ATLAS, name: 'vam-something-else-entirely' }];
    expect(matchVamSession(sessions, ATLAS)).toEqual({
      kind: 'one',
      name: 'vam-something-else-entirely',
    });
  });

  it('never matches a session vam did not start', () => {
    // An option nobody set formats as the EMPTY STRING in `list-sessions -F`
    // (measured). The operator's own sessions cannot be adopted -- no process
    // may take over another's controlling TTY -- so they must not be offered.
    const sessions = [
      { project: '', name: 'notes' },
      { project: '', name: 'vam-atlas-a1b2c3' },
    ];
    expect(matchVamSession(sessions, ATLAS)).toEqual({ kind: 'none' });
    // And an empty project id must not sweep up every untagged session.
    expect(matchVamSession(sessions, '')).toEqual({ kind: 'none' });
  });

  it('does not let one project reach another project-s session', () => {
    const sessions = [{ project: BEACON, name: 'vam-atlas-a1b2c3' }];
    expect(matchVamSession(sessions, ATLAS)).toEqual({ kind: 'none' });
  });

  it('keeps two sessions whose names collide apart, because the id decides', () => {
    // `vamSessionName` slugs and truncates to 24 characters, so
    // `atlas frontend rewrite phase two` and `atlas frontend rewrite plan`
    // share the prefix `vam-atlas-frontend-rewrite-p-`. Under a prefix rule
    // both matched and the tie-break picked by random suffix: stably, silently
    // the wrong screen. The recorded id makes them two different sessions.
    const sessions = [
      { project: ATLAS, name: 'vam-atlas-frontend-rewrite-p-a1b2c3' },
      { project: BEACON, name: 'vam-atlas-frontend-rewrite-p-z9y8x7' },
    ];
    expect(matchVamSession(sessions, ATLAS)).toEqual({
      kind: 'one',
      name: 'vam-atlas-frontend-rewrite-p-a1b2c3',
    });
    expect(matchVamSession(sessions, BEACON)).toEqual({
      kind: 'one',
      name: 'vam-atlas-frontend-rewrite-p-z9y8x7',
    });
  });

  it('refuses to choose when one project really has two sessions', () => {
    // Two sessions vam started for one project are two screens, and nothing
    // here can say which the operator means. The old rule sorted the names and
    // took the last -- stable, and stably wrong half the time. Reporting the
    // ambiguity is the only answer that is not a guess.
    const sessions = [
      { project: ATLAS, name: 'vam-atlas-zz0000' },
      { project: ATLAS, name: 'vam-atlas-aa0000' },
    ];
    expect(matchVamSession(sessions, ATLAS)).toEqual({
      kind: 'ambiguous',
      names: ['vam-atlas-aa0000', 'vam-atlas-zz0000'],
    });
    // Order in, order out: the answer is about the set, not about the order
    // tmux happened to print.
    expect(matchVamSession([...sessions].reverse(), ATLAS)).toEqual({
      kind: 'ambiguous',
      names: ['vam-atlas-aa0000', 'vam-atlas-zz0000'],
    });
  });
});

describe('reading the pane', () => {
  it('captures the matched session and returns its screen', async () => {
    const { run, argvs } = runner({
      'list-sessions': ok(`${ATLAS}\tvam-atlas-a1b2c3\n\tnotes\n`),
      'capture-pane': ok('$ claude\n'),
    });
    expect(await readSessionPane(run, ATLAS)).toEqual({
      kind: 'ok',
      name: 'vam-atlas-a1b2c3',
      text: '$ claude\n',
    });
    // The listing has to ASK for the recorded id, or there is nothing to match
    // on and the code falls back to guessing from a name.
    expect(argvs[0]).toEqual(['list-sessions', '-F', '#{@vam-project}\t#{session_name}']);
    // Exact targeting: `-t vam-atlas-a1` would reach `vam-atlas-a1b2c3` by
    // tmux's own prefix resolution, and on send-keys that is someone else's
    // session.
    expect(argvs[1]).toEqual(['capture-pane', '-p', '-t', '=vam-atlas-a1b2c3:']);
  });

  it('reports no session of vam-s, and captures nothing, when nothing matches', async () => {
    const { run, verbs } = runner({ 'list-sessions': ok('\tnotes\n') });
    expect(await readSessionPane(run, ATLAS)).toEqual({ kind: 'not-vam' });
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('captures nothing when two sessions answer to one project', async () => {
    const { run, verbs } = runner({
      'list-sessions': ok(`${ATLAS}\tvam-atlas-a1b2c3\n${ATLAS}\tvam-atlas-d4e5f6\n`),
    });
    expect(await readSessionPane(run, ATLAS)).toEqual({
      kind: 'ambiguous',
      names: ['vam-atlas-a1b2c3', 'vam-atlas-d4e5f6'],
    });
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('treats no server running as no sessions, not as a failure', async () => {
    // The mapping `spawn.ts` records as asserted-by-test-only. This is the
    // caller that finally runs it: no server means nothing was ever started,
    // which is an answer.
    const { run } = runner({
      'list-sessions': failed('no server running on /tmp/tmux-501/default'),
    });
    expect(await readSessionPane(run, ATLAS)).toEqual({ kind: 'not-vam' });
  });

  it('says vam could not ask for every other listing failure', async () => {
    const { run } = runner({ 'list-sessions': failed('permission denied') });
    const view = await readSessionPane(run, ATLAS);
    expect(view.kind).toBe('unavailable');
    if (view.kind !== 'unavailable') throw new Error('unreachable');
    expect(view.error.message).toContain('permission denied');
  });

  it('says the session ended when it disappears between the list and the capture', async () => {
    const { run } = runner({
      'list-sessions': ok(`${ATLAS}\tvam-atlas-a1b2c3\n`),
      'capture-pane': failed("can't find session: vam-atlas-a1b2c3"),
    });
    expect(await readSessionPane(run, ATLAS)).toEqual({ kind: 'gone' });
  });

  it('says vam could not ask when the capture fails for any other reason', async () => {
    const { run } = runner({
      'list-sessions': ok(`${ATLAS}\tvam-atlas-a1b2c3\n`),
      'capture-pane': failed('server exited unexpectedly'),
    });
    expect((await readSessionPane(run, ATLAS)).kind).toBe('unavailable');
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
      'list-sessions': ok(`${ATLAS}\tvam-atlas-a1b2c3\n`),
      'capture-pane': ok('screen'),
    });
    expect(await harness(run)(ATLAS)).toEqual({
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
