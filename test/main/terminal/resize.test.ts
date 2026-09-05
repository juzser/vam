/**
 * Telling tmux how big the pane is -- the only half of "make it fit" that can
 * possibly work, and the one that can reach into someone else's terminal.
 *
 * `capture-pane` hands back a screen tmux composed at the session's own size,
 * so the fit is a `resize-window` or it is nothing. That makes this the first
 * thing in vam that CHANGES a tmux session on the operator's server rather
 * than reading one, and every test here is about the guard rather than the
 * arithmetic: vam resizes a session it can PROVE it started for this project,
 * by the recorded `@vam-project` pairing, and no other session ever.
 *
 * Nothing spawns. The runner is a parameter for `spawn.ts`'s reason -- a test
 * that really ran these would reflow a live agent's screen -- so the argv is
 * what is asserted.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import { registerTerminalIpc } from '../../../src/main/terminal/ipc.js';
import { resizeSessionPane } from '../../../src/main/terminal/pane.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });
const failed = (stderr: string): TmuxRunResult => ({
  failure: { message: 'tmux failed' },
  stdout: '',
  stderr,
});

const ATLAS = 'claude-code:atlas-11111111';
const BEACON = 'claude-code:beacon-22222222';
const SIZE = { columns: 120, rows: 40 };

function runner(answers: Record<string, TmuxRunResult>) {
  const argvs: (readonly string[])[] = [];
  const run: TmuxRun = async (argv) => {
    argvs.push(argv);
    return answers[argv[0] ?? ''] ?? failed(`no stub for ${argv[0] ?? ''}`);
  };
  return { run, argvs, verbs: () => argvs.map((argv) => argv[0]) };
}

describe('resizing the session vam started for a project', () => {
  it('resizes the recorded session, exactly targeted, in columns and rows', async () => {
    const { run, argvs } = runner({
      'list-sessions': ok(`${ATLAS}\tvam-atlas-a1b2c3\n`),
      'resize-window': ok(''),
    });
    expect(await resizeSessionPane(run, ATLAS, SIZE)).toBe(true);
    // `=name:` and not a bare name: tmux resolves a bare `-t` by prefix and
    // then by fnmatch, so `vam-a1` can reach `vam-a1b2c3`. Resizing the wrong
    // session reflows work vam has nothing to do with.
    expect(argvs[1]).toEqual([
      'resize-window',
      '-t',
      '=vam-atlas-a1b2c3:',
      '-x',
      '120',
      '-y',
      '40',
    ]);
  });

  it('resizes the pane the SESSION published, not the project-wide guess', async () => {
    // A project vam started two sessions in has two panes, and the project
    // alone answers `ambiguous` for both. The row resolves it -- the same rule
    // the read draws by, so the session resized is the one on screen.
    const { run, argvs } = runner({
      'list-sessions': ok(`${ATLAS}\tvam-atlas-a1b2c3\n${ATLAS}\tvam-atlas-d4e5f6\n`),
      'resize-window': ok(''),
    });
    const panes = new Map([['sess-beta', 'vam-atlas-d4e5f6']]);
    expect(await resizeSessionPane(run, ATLAS, SIZE, 'sess-beta#8', panes)).toBe(true);
    expect(argvs[1]?.[2]).toBe('=vam-atlas-d4e5f6:');
  });

  it('will not resize a pane a session published that vam did not start', async () => {
    // The operator's own sessions publish into the same directory. A published
    // name is checked against vam's own listing before anything acts on it --
    // this is the difference between fitting a pane and reflowing someone
    // else's terminal.
    const { run, verbs } = runner({
      'list-sessions': ok(`${ATLAS}\tvam-atlas-a1b2c3\n`),
      'resize-window': ok(''),
    });
    const panes = new Map([['sess-beta', 'notes']]);
    await resizeSessionPane(run, BEACON, SIZE, 'sess-beta#8', panes);
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('does nothing at all for a session vam did not start', async () => {
    // The operator's own sessions are on the same server. vam can see them and
    // must never touch them: no `@vam-project`, no resize.
    const { run, verbs } = runner({
      'list-sessions': ok(`\tirc\n\tnotes\n${BEACON}\tvam-beacon-b2c3d4\n`),
      'resize-window': ok(''),
    });
    expect(await resizeSessionPane(run, ATLAS, SIZE)).toBe(false);
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('does nothing when two sessions answer to one project', async () => {
    // The tab shows neither screen in this case, so there is nothing on it to
    // fit -- and resizing one of two would be a coin toss landing in a real
    // terminal.
    const { run, verbs } = runner({
      'list-sessions': ok(`${ATLAS}\tvam-atlas-a1b2c3\n${ATLAS}\tvam-atlas-d4e5f6\n`),
      'resize-window': ok(''),
    });
    expect(await resizeSessionPane(run, ATLAS, SIZE)).toBe(false);
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('does nothing when vam could not even list the sessions', async () => {
    // Not knowing which sessions exist is not permission to guess at one.
    const { run, verbs } = runner({ 'list-sessions': failed('server exited unexpectedly') });
    expect(await resizeSessionPane(run, ATLAS, SIZE)).toBe(false);
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('reports a refused resize rather than claiming the pane now fits', async () => {
    const { run } = runner({
      'list-sessions': ok(`${ATLAS}\tvam-atlas-a1b2c3\n`),
      'resize-window': failed("can't find window"),
    });
    expect(await resizeSessionPane(run, ATLAS, SIZE)).toBe(false);
  });
});

describe('the terminal resize channel', () => {
  function harness(run: TmuxRun) {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    registerTerminalIpc(
      { handle: (channel, listener) => void handlers.set(channel, listener) },
      run,
    );
    const handler = handlers.get(CHANNELS.terminalResize);
    if (handler === undefined) throw new Error('the resize channel was never registered');
    return (...args: unknown[]) => handler({}, ...args) as Promise<unknown>;
  }

  it('resizes for a well-formed ask', async () => {
    const { run, verbs } = runner({
      'list-sessions': ok(`${ATLAS}\tvam-atlas-a1b2c3\n`),
      'resize-window': ok(''),
    });
    expect(await harness(run)(ATLAS, 120, 40)).toBe(true);
    expect(verbs()).toEqual(['list-sessions', 'resize-window']);
  });

  it.each([
    ['no arguments at all', []],
    ['a project id that is not a string', [7, 120, 40]],
    ['a size that is not a number', [ATLAS, '120', 40]],
    ['a fractional column count', [ATLAS, 120.5, 40]],
    ['zero columns, which tmux cannot draw in', [ATLAS, 0, 40]],
    ['more rows than any screen has', [ATLAS, 120, 100_000]],
    ['a NaN row count', [ATLAS, 120, Number.NaN]],
    ['a row id that is not a string', [ATLAS, 120, 40, 7]],
    ['an extra argument nobody sent', [ATLAS, 120, 40, 'row', 'and more']],
  ])('refuses %s, and spawns nothing', async (_why, args) => {
    // The renderer is the least trusted process in the app. A size it sends is
    // an allocation request to a program on the operator's machine, so it is
    // checked here and not only where it was measured.
    const { run, argvs } = runner({ 'list-sessions': ok(`${ATLAS}\tvam-atlas-a1b2c3\n`) });
    expect(await harness(run)(...args)).toBe(false);
    expect(argvs).toEqual([]);
  });
});

/**
 * THE SHARPEST CASE OF THE CLAIM RULE, and the one the operator saw. A row
 * that published nothing shares a project with one vam session, and that
 * session is the pane ANOTHER row published. Before the rule, the tag path
 * answered with it and the resize landed: the session measured 130x57 rather
 * than the 80x24 a detached session starts at, so a terminal belonging to a
 * row that never asked had already been reflowed by the time anybody looked.
 *
 * A resize is where a display mistake becomes a change to somebody's session,
 * so the assertion is that tmux is never asked at all beyond the listing.
 */
describe('a session another row claimed is not resized on this row’s behalf', () => {
  it('lists, finds only a claimed session, and stops there', async () => {
    const { run, verbs } = runner({
      'list-sessions': ok(`${ATLAS}\tvam-atlas-a1b2c3\n`),
      'resize-window': ok(''),
    });
    const panes = new Map([['sess-alpha', 'vam-atlas-a1b2c3']]);
    expect(await resizeSessionPane(run, ATLAS, SIZE, 'sess-gamma#9', panes)).toBe(false);
    expect(verbs()).toEqual(['list-sessions']);
  });

  it('still resizes a session nobody claimed for a row that published nothing', async () => {
    const { run, argvs } = runner({
      'list-sessions': ok(`${ATLAS}\tvam-atlas-a1b2c3\n`),
      'resize-window': ok(''),
    });
    expect(await resizeSessionPane(run, ATLAS, SIZE, 'sess-gamma#9', new Map())).toBe(true);
    expect(argvs[1]?.[2]).toBe('=vam-atlas-a1b2c3:');
  });
});
