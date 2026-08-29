import { describe, expect, it } from 'vitest';
import { CELL, cellOrigin, FAN, INFO_OFFSET, stepSlotOffset } from '../../src/canvas/grid.js';
import {
  fanNodeId,
  INFO_SIZE,
  infoNodeId,
  layoutCanvas,
  orderedForCanvas,
  orderedSessions,
  slotNodeId,
  STEP_SIZE,
  stepNodeId,
} from '../../src/canvas/layout.js';
import { toNavNodes } from '../../src/canvas/nav-nodes.js';
import type { CanvasModel, Decision, Session } from '../../src/domain/model.js';
import { nextNode } from '../../src/keyboard/spatial-nav.js';

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

  it('runs the steps oldest to newest, top to bottom', () => {
    const { nodes } = layoutCanvas(three);
    const steps = nodes.filter((n) => n.kind === 'step').filter((n) => n.id.includes('s1'));
    expect(steps.map((n) => (n.kind === 'step' ? n.decision.id : ''))).toEqual(['d1', 'd2', 'd3']);
    expect(steps[0]?.position.y).toBeLessThan(steps[2]?.position.y ?? 0);
  });

  it('places info nodes at the mockup grid origin, one cell per session', () => {
    const five = model(session('a'), session('b'), session('c'), session('d'), session('e'));
    const { nodes } = layoutCanvas(five);
    const infos = ['a', 'b', 'c', 'd', 'e'].map((id) => nodes.find((n) => n.id === infoNodeId(id)));
    infos.forEach((info, i) => {
      expect(info?.position).toEqual({
        x: 16 + (i % 2) * 652,
        y: 16 + Math.floor(i / 2) * 354 + 58,
      });
      expect(info?.size).toEqual({ width: 220, height: 174 });
    });
  });

  it('stacks a session’s steps in one column, 100px apart, sized 250x90', () => {
    const one = model(
      session('s1', { decisions: [decision('d3'), decision('d2'), decision('d1')] }),
    );
    const { nodes } = layoutCanvas(one);
    const cellX = cellOrigin(0).x;
    const steps = nodes.filter((n) => n.kind === 'step');
    expect(steps.map((n) => n.position.x)).toEqual([cellX + 330, cellX + 330, cellX + 330]);
    expect(steps[1]?.position.y).toBe((steps[0]?.position.y ?? 0) + 100);
    expect(steps[2]?.position.y).toBe((steps[0]?.position.y ?? 0) + 200);
    for (const step of steps) {
      expect(step.size).toEqual({ width: 250, height: 90 });
    }
  });

  it('imports geometry from grid.ts instead of declaring its own', () => {
    expect(INFO_SIZE).toEqual({ width: 220, height: 174 });
    expect(STEP_SIZE).toEqual({ width: 250, height: 90 });
    const origin = cellOrigin(1);
    const offset = stepSlotOffset(1);
    expect(origin).toEqual({ x: 668, y: 16 });
    expect(offset).toEqual({ x: 330, y: 100 });
  });

  it('places the info node at cellOrigin + INFO_OFFSET', () => {
    const { nodes } = layoutCanvas(three);
    const info = nodes.find((n) => n.id === infoNodeId('s2'));
    const origin = cellOrigin(1);
    expect(info?.position).toEqual({ x: origin.x + INFO_OFFSET.x, y: origin.y + INFO_OFFSET.y });
  });

  it('places sessions into cells in flat urgency order', () => {
    const mixed = model(
      session('idle', { status: 'done' }),
      session('urgent', { status: 'waiting' }),
    );
    const { nodes } = layoutCanvas(mixed);
    const urgent = nodes.find((n) => n.id === infoNodeId('urgent'));
    const idle = nodes.find((n) => n.id === infoNodeId('idle'));
    // Waiting outranks done, so `urgent` takes cell 0 (leftmost) and `idle`
    // cell 1, even though `idle` was declared first.
    expect(urgent?.position.x).toBeLessThan(idle?.position.x ?? 0);
  });

  it('emits one fan per session, sized 110x290 at cell offset (220, 0)', () => {
    const { fans } = layoutCanvas(three);
    const fan = fans.find((f) => f.id === fanNodeId('s1'));
    const origin = cellOrigin(0);
    expect(fan?.position).toEqual({ x: origin.x + FAN.x, y: origin.y });
    expect(fan?.size).toEqual({ width: FAN.width, height: CELL.height });
  });

  it('carries totalSteps as the full decision count, not the number drawn', () => {
    const many = model(
      session('s', { decisions: Array.from({ length: 9 }, (_, i) => decision(`d${i}`)) }),
    );
    const { fans } = layoutCanvas(many);
    expect(fans.find((f) => f.id === fanNodeId('s'))?.totalSteps).toBe(9);
  });

  it('marks a branch empty where no step fills the position', () => {
    const one = model(session('s', { decisions: [decision('only')] }));
    const { fans } = layoutCanvas(one);
    const fan = fans.find((f) => f.id === fanNodeId('s'));
    expect(fan?.branchStatuses).toEqual(['done', 'empty', 'empty']);
  });

  it('emits exactly three slots per session regardless of decision count', () => {
    const one = model(session('s', { decisions: [decision('only')] }));
    const { nodes, fans, slots } = layoutCanvas(one);
    const ownSlots = [0, 1, 2].map((position) =>
      slots.find((s) => s.id === slotNodeId('s', position)),
    );
    expect(ownSlots.every((s) => s !== undefined)).toBe(true);
    expect(slots).toHaveLength(3);
    expect(ownSlots.filter((s) => s?.placeholder)).toHaveLength(2);
    expect(fans).toHaveLength(1);
    expect(nodes).toHaveLength(2);
  });

  it('sizes every placeholder slot 250x90, at the step slot offsets', () => {
    const empty = model(session('s'));
    const { slots } = layoutCanvas(empty);
    expect(slots.map((s) => s.position)).toEqual([
      { x: cellOrigin(0).x + stepSlotOffset(0).x, y: cellOrigin(0).y + stepSlotOffset(0).y },
      { x: cellOrigin(0).x + stepSlotOffset(1).x, y: cellOrigin(0).y + stepSlotOffset(1).y },
      { x: cellOrigin(0).x + stepSlotOffset(2).x, y: cellOrigin(0).y + stepSlotOffset(2).y },
    ]);
    for (const slot of slots) {
      expect(slot.size).toEqual({ width: 250, height: 90 });
      expect(slot.placeholder).toBe(true);
    }
  });

  it('draws a session that has not decided anything as an info node alone', () => {
    const quiet = model(session('quiet'));
    const { nodes, fans, slots } = layoutCanvas(quiet);
    expect(nodes).toHaveLength(1);
    expect(fans).toHaveLength(1);
    expect(slots).toHaveLength(3);
    expect(slots.every((s) => s.placeholder)).toBe(true);
  });

  it('lays out an empty canvas without inventing anything', () => {
    expect(layoutCanvas({ projects: [] })).toEqual({ nodes: [], fans: [], slots: [] });
  });

  it('gives every node an absolute position with no parent', () => {
    const { nodes } = layoutCanvas(three);
    for (const node of nodes) {
      expect('parentId' in node).toBe(false);
    }
  });

  it('stacks sessions flat, ignoring project boundaries', () => {
    // Frame gone: waiting-in-p2 takes the earlier cell than done-in-p1, which a
    // frame blocked.
    const { nodes } = layoutCanvas(twoProjects('waiting'));
    const a = nodes.find((n) => n.id === infoNodeId('a'));
    const b = nodes.find((n) => n.id === infoNodeId('b'));
    expect(b?.position.x).toBeLessThan(a?.position.x ?? 0);
  });

  it('never lets two grid rows overlap', () => {
    const three_in_a_row = model(session('s1'), session('s2'), session('s3'));
    const { nodes } = layoutCanvas(three_in_a_row);
    const row0 = nodes.find((n) => n.id === infoNodeId('s1'));
    const row1 = nodes.find((n) => n.id === infoNodeId('s3'));
    expect(row1?.position.y).toBeGreaterThanOrEqual(
      (row0?.position.y ?? 0) + (row0?.size.height ?? 0),
    );
  });

  it('emits a status-derived opacity for each cell, inferred for failed', () => {
    const statuses = model(
      session('w', { status: 'waiting' }),
      session('r', { status: 'running' }),
      session('d', { status: 'done' }),
      session('f', { status: 'failed' }),
    );
    const { nodes } = layoutCanvas(statuses);
    const opacityOf = (id: string) => nodes.find((n) => n.id === infoNodeId(id))?.opacity;
    expect(opacityOf('w')).toBe(0.72);
    expect(opacityOf('r')).toBe(0.6);
    expect(opacityOf('d')).toBe(0.45);
    expect(opacityOf('f')).toBe(0.45);
  });

  it('does not emit a focused opacity: focus is not in the model', () => {
    const { nodes } = layoutCanvas(three);
    for (const node of nodes) {
      expect('focused' in node).toBe(false);
    }
  });
});

describe('layoutCanvas keyboard grammar (docs/design/canvas-layout.md §4)', () => {
  // Model order is newest-first (`visibleDecisions` reverses it for display), so
  // this produces d3, d2, d1 — reversed to d1, d2, d3 oldest-first on the canvas.
  function stepsOf(count: number, prefix: string): Decision[] {
    return Array.from({ length: count }, (_, i) => decision(`${prefix}${count - i}`));
  }

  it('reaches the middle step slot from each column, and the cell below from the info node', () => {
    const four = model(
      session('s0', { decisions: stepsOf(3, 's0d') }),
      session('s1', { decisions: stepsOf(3, 's1d') }),
      session('s2', { decisions: stepsOf(3, 's2d') }),
      session('s3', { decisions: stepsOf(3, 's3d') }),
    );
    const { nodes } = layoutCanvas(four);
    const navigableIds = nodes.map((n) => n.id);
    const flowNodes = nodes.map((n) => ({
      id: n.id,
      position: n.position,
      width: n.size.width,
      height: n.size.height,
    }));
    const navNodes = toNavNodes(flowNodes, navigableIds);

    for (const sessionId of ['s0', 's1']) {
      const infoId = infoNodeId(sessionId);
      const middleId = stepNodeId(sessionId, `${sessionId}d2`);
      const topId = stepNodeId(sessionId, `${sessionId}d1`);
      const bottomId = stepNodeId(sessionId, `${sessionId}d3`);

      expect(nextNode(navNodes, infoId, 'right')).toBe(middleId);
      expect(nextNode(navNodes, middleId, 'up')).toBe(topId);
      expect(nextNode(navNodes, middleId, 'down')).toBe(bottomId);
      expect(nextNode(navNodes, middleId, 'left')).toBe(infoId);
    }

    expect(nextNode(navNodes, infoNodeId('s0'), 'down')).toBe(infoNodeId('s2'));
  });
});
