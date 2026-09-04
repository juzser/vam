/**
 * Main's own guards on killing a pane, independent of anything the renderer
 * planned.
 *
 * THIS FILE USED TO WIRE `removalPlan` TO `stopSession` BY HAND and call that
 * the seam. It exercised both, but no change to `Canvas` could redden it --
 * not forwarding every session in the project, not dropping the plan's guard,
 * not bypassing the plan altogether -- so it could not detect the very thing
 * it looked like it was testing. That composition is now driven for real, from
 * the menu click down to the port, in `test/canvas/Canvas.remove-project.test.tsx`,
 * and it is mutation-proven there.
 *
 * What is left here is what only main can be asked: given a row and a live
 * tmux listing, which pane -- if any -- may be killed. Nothing real is
 * touched; the runner is a fake that records argv and answers the listing from
 * a fixture. No tmux server is contacted and the operator's own sessions are
 * not named.
 */

import { describe, expect, it, vi } from 'vitest';
import { projectIdOf } from '../../../src/main/sources/claude-code/project-id.js';
import { type StoppableAgent, stopSession } from '../../../src/main/sources/claude-code/stop.js';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import type { Session } from '../../../src/renderer/domain/model.js';
import { removalPlan } from '../../../src/renderer/panels/remove-project.js';

const CWD = '/w/alpha';
const OWNED_PANE = 'vam-alpha-aa11bb';
const OTHER_PANE = 'vam-alpha-cc22dd';

function session(id: string, vamControlled?: boolean): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: 'work',
    status: 'running',
    runningAgents: 0,
    activity: null,
    age: '1m',
    decisions: [],
    ...(vamControlled === undefined ? {} : { vamControlled }),
  };
}

function agent(sessionId: string): StoppableAgent {
  return { key: `${sessionId}#1`, sessionId, kind: 'interactive', name: sessionId, cwd: CWD };
}

/** Two tagged tmux sessions in the project, one per row that published a pane. */
const listed: TmuxRunResult = {
  failure: null,
  stdout: `${projectIdOf(CWD)}\t${OWNED_PANE}\n${projectIdOf(CWD)}\t${OTHER_PANE}\n`,
  stderr: '',
};

function runner() {
  const calls: string[][] = [];
  const run: TmuxRun = async (argv) => {
    calls.push([...argv]);
    return argv[0] === 'list-sessions' ? listed : { failure: null, stdout: '', stderr: '' };
  };
  return { calls, run };
}

/** `mine` is vam's; `theirs` is a terminal vam only found out about. */
const sessions = [session('mine', true), session('theirs')];
const agents = [agent('mine'), agent('theirs')];
const panes = new Map([
  ['mine', OWNED_PANE],
  ['theirs', OTHER_PANE],
]);

/**
 * The second guard, in main, independent of the renderer's.
 *
 * WHAT THE FIRST GUARD IS. `paneForRow` prefers the pane a session PUBLISHES
 * about itself, and checks that name against `listVamSessions` -- vam's own
 * prefix. So a terminal the operator opened themselves publishes a pane here
 * and is already never killed: the claim that main will kill any resolvable
 * pane is not what this code does.
 *
 * WHAT IT DOES NOT CHECK is that the vam session it matched belongs to the
 * ROW'S OWN PROJECT. The published name and the row's cwd come from different
 * places -- one from `~/.claude/sessions/<pid>.json`, one from the process
 * table -- and nothing made them agree. A row in one project that publishes a
 * vam pane belonging to another therefore resolves, and `kill-session` ends a
 * project nobody asked about. That is the case this holds, and it is the
 * guard that does not depend on the renderer having planned correctly: the
 * whole 'only vamControlled' promise otherwise rests on one renderer-side
 * filter, and finding 1 proved a renderer-side filter can be wrong.
 */
describe('the main-side ownership guard', () => {
  const BETA_PANE = 'vam-beta-ff99ee';
  /** alpha's tagged session, and beta's -- both vam's, different projects. */
  const bothProjects: TmuxRunResult = {
    failure: null,
    stdout: `${projectIdOf(CWD)}\t${OWNED_PANE}\n${projectIdOf('/w/beta')}\t${BETA_PANE}\n`,
    stderr: '',
  };

  function runner() {
    const calls: string[][] = [];
    const run: TmuxRun = async (argv) => {
      calls.push([...argv]);
      return argv[0] === 'list-sessions' ? bothProjects : { failure: null, stdout: '', stderr: '' };
    };
    return { calls, run };
  }

  it('REFUSES a vam pane tagged for a different project than the row', async () => {
    const { calls, run } = runner();
    // The row lives in alpha; the pane it published belongs to beta.
    const stray = new Map([['mine', BETA_PANE]]);
    const error = await stopSession(
      [agent('mine')],
      'mine#1',
      vi.fn(async () => null),
      run,
      stray,
    );
    expect(calls.some((argv) => argv[0] === 'kill-session')).toBe(false);
    expect(error?.code).toBe('interactive-session');
  });

  it('still kills the pane tagged for the row’s own project', async () => {
    const { calls, run } = runner();
    const panes = new Map([['mine', OWNED_PANE]]);
    await expect(
      stopSession(
        [agent('mine')],
        'mine#1',
        vi.fn(async () => null),
        run,
        panes,
      ),
    ).resolves.toBeNull();
    expect(calls).toContainEqual(['kill-session', '-t', `=${OWNED_PANE}`]);
  });
});
