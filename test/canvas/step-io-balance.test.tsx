// @vitest-environment happy-dom

/**
 * The two steps just before the current one lean on their `IN`.
 *
 * The reasoning, so a later editor does not "even them up" again: for a step
 * already behind you, what you scan back for is WHAT WAS ASKED. The answer is
 * why you moved on from it — it has already done its work. So the two most
 * recent past steps trade a line of `OUT` for a line of `IN`, and no other
 * step changes.
 *
 * Two halves, because the truth lives in two places: `layout.ts` decides WHICH
 * steps those are (it is the module that knows the chain), and `StepNode`
 * decides what that does to the card. The render assertions compare the two
 * rows against EACH OTHER rather than against a pixel count: the claim is a
 * proportion, and a test pinned to 32px would fail on a font change while
 * passing on a real inversion.
 */

import { cleanup, render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, describe, expect, it } from 'vitest';
import { layoutCanvas, type StepNodeSpec } from '../../src/renderer/canvas/layout.js';
import { StepNode } from '../../src/renderer/canvas/StepNode.js';
import type {
  CanvasModel,
  Decision,
  Project,
  Session,
  SourceId,
} from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';

afterEach(cleanup);

function decision(id: string): Decision {
  return { id, label: `step-${id}`, input: `in-${id}`, output: `out-${id}`, commands: [] };
}

/** `decisions` is newest-first, the order the model uses. */
function sessionWith(...decisions: Decision[]): Session {
  return {
    id: 's1',
    title: 's1',
    icon: null,
    epic: null,
    branch: null,
    status: 'running',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions,
    ...{},
  };
}

function modelOf(session: Session): CanvasModel {
  return {
    projects: [{ id: 'p1', name: 'repo', source: 'black-smith' as SourceId, sessions: [session] }],
  };
}

/** The step specs of the single session, in drawn order (oldest first). */
function stepsOf(session: Session): StepNodeSpec[] {
  return layoutCanvas(modelOf(session)).nodes.filter(
    (node): node is StepNodeSpec => node.kind === 'step',
  );
}

const FLOW_PROPS = {
  selected: false,
  dragging: false,
  draggable: false,
  selectable: false,
  deletable: false,
  type: 'step',
  zIndex: 0,
  isConnectable: false,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
} as const;

/**
 * How many lines of text a row is allotted, read off the treatment it wears:
 * the two-line clamp, or the single truncated line. Not a pixel measurement —
 * happy-dom loads no stylesheet, so a height here would be zero for both rows
 * and the comparison would be vacuous either way it went.
 */
function allottedLines(row: HTMLElement): number {
  return row.className.includes('vam-clamp-2') ? 2 : 1;
}

function renderStep(recall: boolean): { input: number; output: number } {
  const session = sessionWith(decision('d1'), decision('d0'));
  const target = session.decisions[1] as Decision;
  const project: Project = {
    id: 'p1',
    name: 'repo',
    source: 'black-smith' as SourceId,
    sessions: [session],
  };
  const entry: SessionEntry = { project, session };
  const { container } = render(
    <ReactFlowProvider>
      <StepNode
        id="step"
        data={{ entry, decision: target, focused: false, jumpLabel: null, recall }}
        {...FLOW_PROPS}
      />
    </ReactFlowProvider>,
  );
  const input = container.querySelector<HTMLElement>('[data-step-input]');
  const output = container.querySelector<HTMLElement>('[data-step-output]');
  expect(input, 'no `IN` row rendered; the comparison below would be vacuous').not.toBe(null);
  expect(output, 'no `OUT` row rendered; the comparison below would be vacuous').not.toBe(null);
  return {
    input: allottedLines(input as HTMLElement),
    output: allottedLines(output as HTMLElement),
  };
}

describe('layout marks the two steps before the current one', () => {
  it('marks exactly the two before the newest drawn step, and never the newest', () => {
    const steps = stepsOf(sessionWith(decision('c'), decision('b'), decision('a')));
    expect(steps.map((s) => s.decision.id)).toEqual(['a', 'b', 'c']);
    expect(steps.map((s) => s.recall)).toEqual([true, true, false]);
  });

  it('marks the single prior step when a chain has only two', () => {
    const steps = stepsOf(sessionWith(decision('b'), decision('a')));
    expect(steps.map((s) => s.recall)).toEqual([true, false]);
  });

  it('marks nothing when the current step is the only one', () => {
    const steps = stepsOf(sessionWith(decision('a')));
    expect(steps.map((s) => s.recall)).toEqual([false]);
  });

  it('draws no step at all for a chain with none', () => {
    expect(stepsOf(sessionWith())).toEqual([]);
  });
});

describe('a marked step gives `IN` the larger share', () => {
  it('allots `IN` more room than `OUT`', () => {
    const { input, output } = renderStep(true);
    expect(input).toBeGreaterThan(output);
  });

  it('leaves the ordinary step with `OUT` ahead, as it has always been', () => {
    const { input, output } = renderStep(false);
    expect(output).toBeGreaterThan(input);
  });

  it('keeps both rows legible either way — neither is ever clipped to nothing', () => {
    for (const recall of [true, false]) {
      const { input, output } = renderStep(recall);
      expect(input).toBeGreaterThanOrEqual(1);
      expect(output).toBeGreaterThanOrEqual(1);
      // The card's declared height in `grid.ts` does not move, so the two rows
      // must go on costing the same total. That is what keeps the layout — and
      // the 300px strip, which draws the same cards — honest without a measure.
      expect(input + output).toBe(3);
    }
  });
});
