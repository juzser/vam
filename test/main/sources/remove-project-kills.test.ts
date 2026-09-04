/**
 * Removing a project ends EXACTLY the sessions vam started, by argv.
 *
 * The two halves of removal are tested apart -- `removalPlan` decides, and
 * `stopSession` kills -- so this is the seam between them, and the seam is
 * where the unrecoverable mistake lives: an id that leaks from `hide` into
 * `end` becomes a `kill-session` aimed at a terminal the operator is sitting
 * in. So the assertion is the argv BY VALUE, both what it must contain and
 * what it must not, rather than a call count.
 *
 * Nothing real is touched: the runner is a fake that records argv and answers
 * the listing from a fixture. No tmux server is contacted, no session is
 * created, and the operator's own sessions are not named here.
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

describe('removing a project', () => {
  it('kills the pane of the vam-controlled session and no other', async () => {
    const { calls, run } = runner();
    const plan = removalPlan(sessions);
    for (const id of plan.end) {
      await stopSession(
        agents,
        `${id}#1`,
        vi.fn(async () => null),
        run,
        panes,
      );
    }
    expect(calls).toContainEqual(['kill-session', '-t', `=${OWNED_PANE}`]);
    expect(calls).not.toContainEqual(['kill-session', '-t', `=${OTHER_PANE}`]);
    expect(calls.filter((argv) => argv[0] === 'kill-session')).toHaveLength(1);
  });

  it('SPAWNS NOTHING when the plan ends nothing', async () => {
    const { calls, run } = runner();
    const plan = removalPlan([session('theirs')]);
    for (const id of plan.end) {
      await stopSession(
        agents,
        `${id}#1`,
        vi.fn(async () => null),
        run,
        panes,
      );
    }
    expect(plan.end).toEqual([]);
    expect(calls).toEqual([]);
  });
});

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
