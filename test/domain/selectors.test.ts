import { describe, expect, it } from 'vitest';
import type { CanvasModel, Decision, Project, Session } from '../../src/renderer/domain/model.js';
import {
  allSessions,
  copyableCommands,
  decisionAwaitingYou,
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
      name: 'black-smith',
      source: 'black-smith',
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
      ['black-smith', 'D-257'],
      ['black-smith', 'D-263'],
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
