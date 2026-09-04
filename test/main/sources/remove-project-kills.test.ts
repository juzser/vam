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
