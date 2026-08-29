import { describe, expect, it } from 'vitest';
import {
  INFO_SIZE,
  infoNodeId,
  layoutCanvas,
  orderedForCanvas,
  orderedSessions,
  stepNodeId,
} from '../../src/canvas/layout.js';
import type { CanvasModel, Decision, Session } from '../../src/domain/model.js';

function decision(id: string): Decision {
  return { id, label: `step-${id}`, input: `in-${id}`, output: `out-${id}`, commands: [] };
}

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
    ...over,
  };
}

function model(...sessions: Session[]): CanvasModel {
  return {
    projects: [{ id: 'p1', name: 'repo', source: 'black-smith', sessions }],
  };
}

function twoProjects(bStatus: Session['status']): CanvasModel {
  return {
    projects: [
      { id: 'p1', name: 'alpha', source: 'black-smith', sessions: [session('a')] },
      { id: 'p2', name: 'beta', source: 'orca', sessions: [session('b', { status: bStatus })] },
    ],
  };
}

describe('orderedSessions', () => {
  it('puts what is waiting on you first, then what is running, then the rest', () => {
    const ordered = orderedSessions(
      model(
        session('done-1'),
        session('running-1', { status: 'running' }),
        session('waiting-1', { status: 'waiting' }),
      ),
    );
    expect(ordered.map((e) => e.session.id)).toEqual(['waiting-1', 'running-1', 'done-1']);
  });

  it('keeps the source order inside a tier, so nothing jumps for no reason', () => {
    const ordered = orderedSessions(
      model(session('a', { status: 'waiting' }), session('b', { status: 'waiting' })),
    );
    expect(ordered.map((e) => e.session.id)).toEqual(['a', 'b']);
  });

  it('ranks a failed session with the finished ones, not with the urgent ones', () => {
    const ordered = orderedSessions(
      model(session('failed', { status: 'failed' }), session('waiting', { status: 'waiting' })),
    );
    expect(ordered.map((e) => e.session.id)).toEqual(['waiting', 'failed']);
  });

  it('keeps a project’s sessions contiguous, because a frame has to wrap them', () => {
    // The price of grouping: a waiting session in the second project can no
    // longer jump ahead of the first project's idle ones. It rises within its
    // own group instead, and its project rises as a whole.
    const two: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'black-smith',
          sessions: [session('a-idle'), session('a-run', { status: 'running' })],
        },
        { id: 'p2', name: 'beta', source: 'orca', sessions: [session('b-idle')] },
      ],
    };
    expect(orderedSessions(two).map((e) => e.session.id)).toEqual(['a-run', 'a-idle', 'b-idle']);
  });

  it('floats the project holding the most urgent session to the top', () => {
    // The half of the flat ordering worth keeping: what needs you still rises,
    // just as a whole project rather than as a loose session.
    const two: CanvasModel = {
      projects: [
        { id: 'p1', name: 'calm', source: 'black-smith', sessions: [session('c')] },
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

describe('orderedForCanvas', () => {
  it('ignores projects: a waiting session in project B beats a done session in project A', () => {
    expect(orderedForCanvas(twoProjects('waiting')).map((e) => e.session.id)).toEqual(['b', 'a']);
  });
});

describe('layoutCanvas', () => {
  const three = model(
    session('s1', { decisions: [decision('d3'), decision('d2'), decision('d1')] }),
    session('s2', { decisions: [decision('e1')] }),
  );

  it('gives each session one info node followed by its steps', () => {
    const { nodes } = layoutCanvas(three);
    expect(nodes.filter((n) => n.kind === 'info').map((n) => n.id)).toEqual([
      infoNodeId('s1'),
      infoNodeId('s2'),
    ]);
    expect(nodes.filter((n) => n.kind === 'step')).toHaveLength(4);
  });

  it('runs the steps oldest to newest, left to right', () => {
    const { nodes } = layoutCanvas(three);
    const steps = nodes.filter((n) => n.kind === 'step').filter((n) => n.id.includes('s1'));
    expect(steps.map((n) => (n.kind === 'step' ? n.decision.id : ''))).toEqual(['d1', 'd2', 'd3']);
    expect(steps[0]?.position.x).toBeLessThan(steps[2]?.position.x ?? 0);
  });

  it('keeps every node of a session on one row', () => {
    const { nodes } = layoutCanvas(three);
    const row = nodes.filter((n) => n.id.includes('s1'));
    const ys = new Set(row.map((n) => n.position.y));
    expect(ys.size).toBe(1);
  });

  it('stacks sessions down the canvas in flat urgency order', () => {
    const { nodes } = layoutCanvas(three);
    const first = nodes.find((n) => n.id === infoNodeId('s1'));
    const second = nodes.find((n) => n.id === infoNodeId('s2'));
    expect(second?.position.y).toBeGreaterThan(first?.position.y ?? 0);
  });

  it('leaves a wider gap before the first step than between the steps', () => {
    // That gap is where the "there is history you are not seeing" mark goes, so
    // it has to be visibly different from an ordinary link.
    const { nodes } = layoutCanvas(three);
    const steps = nodes
      .filter((n) => n.kind === 'step' && n.id.includes('s1'))
      .sort((a, b) => a.position.x - b.position.x);
    const firstGap = (steps[0]?.position.x ?? 0) - INFO_SIZE.width;
    const nextGap =
      (steps[1]?.position.x ?? 0) - ((steps[0]?.position.x ?? 0) + (steps[0]?.size.width ?? 0));
    expect(firstGap).toBeGreaterThan(nextGap);
  });

  it('chains the nodes of a row with edges', () => {
    const { edges } = layoutCanvas(three);
    const row = edges.filter((e) => e.source.includes('s1') || e.target.includes('s1'));
    expect(row.map((e) => [e.source, e.target])).toEqual([
      [infoNodeId('s1'), stepNodeId('s1', 'd1')],
      [stepNodeId('s1', 'd1'), stepNodeId('s1', 'd2')],
      [stepNodeId('s1', 'd2'), stepNodeId('s1', 'd3')],
    ]);
  });

  it('marks only the first edge as the elided one', () => {
    const { edges } = layoutCanvas(three);
    const row = edges.filter((e) => e.source.includes('s1') || e.target.includes('s1'));
    expect(row.map((e) => e.elided)).toEqual([true, false, false]);
  });

  it('counts the steps it did not draw', () => {
    const many = model(
      session('s', { decisions: Array.from({ length: 9 }, (_, i) => decision(`d${i}`)) }),
    );
    expect(layoutCanvas(many).edges[0]?.label).toBe('+6');
  });

  it('does not label the break when nothing was skipped', () => {
    // `+0` would be a mark that means "nothing", which is worse than no mark.
    const exact = model(session('s', { decisions: [decision('a'), decision('b'), decision('c')] }));
    expect(layoutCanvas(exact).edges[0]?.label).toBeNull();
  });

  it('draws a session that has not decided anything as an info node alone', () => {
    const quiet = model(session('quiet'));
    const { nodes, edges } = layoutCanvas(quiet);
    expect(nodes).toHaveLength(1);
    expect(edges).toEqual([]);
  });

  it('lays out an empty canvas without inventing anything', () => {
    expect(layoutCanvas({ projects: [] })).toEqual({ nodes: [], edges: [] });
  });

  it('gives every node an absolute position with no parent', () => {
    const { nodes } = layoutCanvas(three);
    for (const node of nodes) {
      expect('parentId' in node).toBe(false);
    }
  });

  it('stacks sessions flat, ignoring project boundaries', () => {
    // Frame gone: waiting-in-p2 floats above done-in-p1, which a frame blocked.
    const { nodes } = layoutCanvas(twoProjects('waiting'));
    const a = nodes.find((n) => n.id === infoNodeId('a'));
    const b = nodes.find((n) => n.id === infoNodeId('b'));
    expect(b?.position.y).toBeLessThan(a?.position.y ?? 0);
  });

  it('never lets two rows overlap', () => {
    const { nodes } = layoutCanvas(three);
    const first = nodes.find((n) => n.id === infoNodeId('s1'));
    const second = nodes.find((n) => n.id === infoNodeId('s2'));
    expect(second?.position.y).toBeGreaterThanOrEqual(
      (first?.position.y ?? 0) + (first?.size.height ?? 0),
    );
  });
});
