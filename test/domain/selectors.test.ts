import { describe, expect, it } from 'vitest';
import type { CanvasModel, Decision, Project, Session } from '../../src/renderer/domain/model.js';
import {
  allSessions,
  copyableCommands,
  decisionAwaitingYou,
  orderedPaneTabs,
  orderedSessions,
  runningAgentTotal,
  visibleDecisions,
  waitingCount,
} from '../../src/renderer/domain/selectors.js';

function decision(id: string, output: string | null = 'done'): Decision {
  return { id, label: `step-${id}`, input: `in-${id}`, output, commands: [] };
}

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status: 'running',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
    ...over,
  };
}

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p-bs',
      name: 'factory',
      source: 'factory',
      sessions: [
        session('D-257', { runningAgents: 3, status: 'waiting' }),
        session('D-263', { runningAgents: 0, status: 'done' }),
      ],
    },
    {
      id: 'p-vam',
      name: 'vam',
      source: 'orca',
      sessions: [session('epic-1', { runningAgents: 1, status: 'waiting' })],
    },
  ],
};

describe('allSessions', () => {
  it('flattens both layers, keeping the project each session belongs to', () => {
    expect(allSessions(MODEL).map((entry) => [entry.project.name, entry.session.id])).toEqual([
      ['factory', 'D-257'],
      ['factory', 'D-263'],
      ['vam', 'epic-1'],
    ]);
  });

  it('is empty for an empty canvas rather than throwing', () => {
    expect(allSessions({ projects: [] })).toEqual([]);
  });
});

describe('runningAgentTotal', () => {
  it('sums the running agents across every project', () => {
    expect(runningAgentTotal(MODEL)).toBe(4);
  });

  it('is 0 when nothing is running', () => {
    expect(runningAgentTotal({ projects: [] })).toBe(0);
  });
});

describe('waitingCount', () => {
  it('counts the sessions that are waiting on a person', () => {
    expect(waitingCount(MODEL)).toBe(2);
  });
});

describe('visibleDecisions', () => {
  it('shows the three most recent, oldest first — newest at the bottom', () => {
    // The model stores decisions newest-first; the node reads top to bottom like
    // a log, so the newest lands at the bottom, nearest the eye's resting place
    // after reading the ones before it.
    const s = session('x', {
      decisions: [decision('4'), decision('3'), decision('2'), decision('1')],
    });
    expect(visibleDecisions(s).map((d) => d.id)).toEqual(['2', '3', '4']);
  });

  it('drops the oldest, not the newest, when there are more than three', () => {
    const s = session('x', {
      decisions: [decision('newest'), decision('mid'), decision('old'), decision('ancient')],
    });
    const shown = visibleDecisions(s).map((d) => d.id);
    expect(shown).toEqual(['old', 'mid', 'newest']);
    expect(shown).not.toContain('ancient');
  });

  it('shows all of them when there are fewer than three', () => {
    const s = session('x', { decisions: [decision('1')] });
    expect(visibleDecisions(s).map((d) => d.id)).toEqual(['1']);
  });

  it('shows none for a session that has not decided anything yet', () => {
    expect(visibleDecisions(session('x'))).toEqual([]);
  });
});

describe('decisionAwaitingYou', () => {
  it('is the newest turn once the session has stopped', () => {
    const s = session('x', {
      status: 'waiting',
      decisions: [decision('newest'), decision('older')],
    });
    expect(decisionAwaitingYou(s)?.id).toBe('newest');
  });

  it('is null while the session is running, however it answered', () => {
    // The distinction the whole status hinges on: an unanswered turn is a
    // session mid-thought, not one asking you for something. Flagging it puts a
    // call for help on every session that is merely busy, and a call for help
    // that fires on everything is one you stop reading.
    const s = session('x', { status: 'running', decisions: [decision('1', null)] });
    expect(decisionAwaitingYou(s)).toBeNull();
  });

  it('is null for a finished session even though it has answers', () => {
    const s = session('x', { status: 'done', decisions: [decision('1')] });
    expect(decisionAwaitingYou(s)).toBeNull();
  });

  it('is null for a waiting session with nothing on it yet', () => {
    expect(decisionAwaitingYou(session('x', { status: 'waiting' }))).toBeNull();
  });

  it('never points past the three the canvas actually shows', () => {
    // The newest is always among the three, so this holds by construction —
    // pinned because the day the slice and the pick disagree, the sidebar names
    // a row that is not on the node.
    const s = session('x', {
      status: 'waiting',
      decisions: [decision('1'), decision('2'), decision('3'), decision('4')],
    });
    expect(decisionAwaitingYou(s)?.id).toBe('1');
  });
});

describe('copyableCommands', () => {
  it('collects the commands across the visible decisions, newest first', () => {
    const withCommands: Decision = {
      id: 'gate',
      label: 'gate',
      input: 'plan-v2',
      output: null,
      commands: [
        { id: 'c1', label: 'push', command: 'git push -u origin setup' },
        { id: 'c2', label: 'create', command: 'gh repo create vam --private' },
      ],
    };
    const s = session('x', { decisions: [withCommands, decision('old')] });
    expect(copyableCommands(s).map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('is empty when nothing is asking to be run by hand', () => {
    expect(copyableCommands(session('x', { decisions: [decision('1')] }))).toEqual([]);
  });
});

describe('project shape', () => {
  it('keeps the source label so the canvas can show where a project came from', () => {
    const project = MODEL.projects[1] as Project;
    expect(project.source).toBe('orca');
  });
});

/**
 * THE UNGROUPED PATH IS THE MAJORITY PATH, not a corner case.
 *
 * With no groups stored -- every store that exists today, and the browser
 * build forever, since it has no directory picker to make one with -- every
 * project is ungrouped. So `null` is not the edge this suite checks once; it
 * is what the rest of the file already exercises on every line, and these two
 * tests only make that explicit and non-negotiable.
 *
 * The second is the merge-safety pin the group layer lands behind: with no
 * groups, the flat order is what it was, entry for entry, so nothing between
 * here and the canvas can start behaving differently before there is anything
 * to behave differently about.
 */
describe('the ungrouped path', () => {
  it('gives every session a null group when the model has none', () => {
    const entries = allSessions(MODEL);
    expect(entries).not.toHaveLength(0);
    for (const entry of entries) {
      expect(entry.group).toBeNull();
    }
  });

  it('leaves the flat order and its projects exactly as they were', () => {
    expect(allSessions(MODEL).map((e) => [e.project.id, e.session.id])).toEqual([
      ['p-bs', 'D-257'],
      ['p-bs', 'D-263'],
      ['p-vam', 'epic-1'],
    ]);
  });
});

/**
 * Relocated from `test/canvas/layout.test.ts` (0.2 migration step 2):
 * `orderedSessions` was always list-ordering logic with no graph dependency
 * of its own, and this is the single sequence `j`/`k` walks and the sidebar
 * prints. Only `orderedForCanvas` (the canvas's own urgency-first,
 * project-blind arrangement) and `layoutCanvas` itself stayed behind and
 * died with the graph.
 */
describe('orderedSessions', () => {
  it('puts what is waiting on you first, then what is running, then what is over', () => {
    const model: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'repo',
          source: 'factory',
          sessions: [
            session('done-1', { status: 'done' }),
            session('running-1', { status: 'running' }),
            session('waiting-1', { status: 'waiting' }),
          ],
        },
      ],
    };
    expect(orderedSessions(model).map((e) => e.session.id)).toEqual([
      'waiting-1',
      'running-1',
      'done-1',
    ]);
  });

  it('keeps the source order inside a tier, so nothing jumps for no reason', () => {
    const model: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'repo',
          source: 'factory',
          sessions: [session('a', { status: 'waiting' }), session('b', { status: 'waiting' })],
        },
      ],
    };
    expect(orderedSessions(model).map((e) => e.session.id)).toEqual(['a', 'b']);
  });

  it('ranks a failed session with the finished ones, not with the urgent ones', () => {
    const model: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'repo',
          source: 'factory',
          sessions: [
            session('failed', { status: 'failed' }),
            session('waiting', { status: 'waiting' }),
          ],
        },
      ],
    };
    expect(orderedSessions(model).map((e) => e.session.id)).toEqual(['waiting', 'failed']);
  });

  it('keeps a project’s sessions contiguous, so a group heading is never interrupted', () => {
    // The price of grouping: a waiting session in the second project can no
    // longer jump ahead of the first project's idle ones. It rises within its
    // own group instead, and its project rises as a whole.
    const two: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'factory',
          sessions: [
            session('a-idle', { status: 'done' }),
            session('a-run', { status: 'running' }),
          ],
        },
        {
          id: 'p2',
          name: 'beta',
          source: 'orca',
          sessions: [session('b-idle', { status: 'done' })],
        },
      ],
    };
    expect(orderedSessions(two).map((e) => e.session.id)).toEqual(['a-run', 'a-idle', 'b-idle']);
  });

  it('floats the project holding the most urgent session to the top', () => {
    // The half of the flat ordering worth keeping: what needs you still rises,
    // just as a whole project rather than as a loose session.
    const two: CanvasModel = {
      projects: [
        { id: 'p1', name: 'calm', source: 'factory', sessions: [session('c', { status: 'done' })] },
        {
          id: 'p2',
          name: 'urgent',
          source: 'orca',
          sessions: [session('u', { status: 'waiting' })],
        },
      ],
    };
    expect(orderedSessions(two).map((e) => e.project.name)).toEqual(['urgent', 'calm']);
  });
});

/**
 * A pane's tab strip is a VIEW of the same order the sidebar prints, narrowed
 * to the sessions that pane holds. The operator's report was that picking a
 * session in the sidebar dropped its tab somewhere unrelated to where they had
 * just been looking: the strip drew `Leaf.sessionIds`, which is the order the
 * tabs happened to be OPENED in, so the two surfaces listed the same sessions
 * two different ways. One order, read twice — hence a selector here rather
 * than a sort in the render.
 */
describe('orderedPaneTabs', () => {
  const model: CanvasModel = {
    projects: [
      {
        id: 'p1',
        name: 'repo',
        source: 'factory',
        sessions: [
          session('done-1', { status: 'done' }),
          session('running-1', { status: 'running' }),
          session('waiting-1', { status: 'waiting' }),
        ],
      },
    ],
  };
  const ordered = orderedSessions(model);

  it('re-reads the pane’s ids in the order the sidebar lists them', () => {
    // Held in the order they were opened, which is the reverse of the order
    // that matters.
    expect(
      orderedPaneTabs(ordered, ['done-1', 'running-1', 'waiting-1']).map((e) => e.session.id),
    ).toEqual(['waiting-1', 'running-1', 'done-1']);
  });

  it('holds only what the pane holds — never the rest of the sidebar', () => {
    expect(orderedPaneTabs(ordered, ['done-1']).map((e) => e.session.id)).toEqual(['done-1']);
    expect(orderedPaneTabs(ordered, [])).toEqual([]);
  });

  it('draws a session once even if the pane’s list names it twice', () => {
    expect(orderedPaneTabs(ordered, ['done-1', 'done-1']).map((e) => e.session.id)).toEqual([
      'done-1',
    ]);
  });

  it('skips an id whose session has gone rather than drawing a hole', () => {
    expect(orderedPaneTabs(ordered, ['gone', 'done-1']).map((e) => e.session.id)).toEqual([
      'done-1',
    ]);
  });
});
