// @vitest-environment happy-dom

/**
 * SessionFanNode is the scenery node §5.2 chose over a custom edge type: one
 * <svg> per session drawing the whole fan (trunk, spine, three branches) plus
 * the `N steps` pill, transcribed verbatim from epic.md §3.3. StepSlotNode is
 * the dashed `no step yet` placeholder that fills an empty step slot.
 *
 * Neither component reads the ReactFlow graph or the domain model directly —
 * both take everything through props, per the epic's §5.2 contract clause.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionFanNode, type SessionFanNodeData } from '../../src/canvas/SessionFanNode.js';
import { StepSlotNode } from '../../src/canvas/StepSlotNode.js';

afterEach(cleanup);

function fanData(over: Partial<SessionFanNodeData> = {}): SessionFanNodeData {
  return {
    sessionStatus: 'running',
    branchStatuses: ['running', 'running', 'running'],
    totalSteps: 3,
    ...over,
  };
}

describe('SessionFanNode', () => {
  it('renders exactly one 110x290 svg with exactly five paths, in the transcribed order', () => {
    const { container } = render(<SessionFanNode id="fan-1" data={fanData()} />);
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBe(1);
    expect(svgs[0]?.getAttribute('viewBox')).toBe('0 0 110 290');
    const paths = svgs[0]?.querySelectorAll('path') ?? [];
    expect(paths.length).toBe(5);
    expect(Array.from(paths).map((p) => p.getAttribute('d'))).toEqual([
      'M0 145 H45',
      'M45 45 V245',
      'M45 45 H110',
      'M45 145 H110',
      'M45 245 H110',
    ]);
  });

  it('gives the trunk and spine the session colour and each branch its own step colour', () => {
    const { container } = render(
      <SessionFanNode
        id="fan-2"
        data={fanData({
          sessionStatus: 'waiting',
          branchStatuses: ['done', 'done', 'waiting'],
        })}
      />,
    );
    const paths = container.querySelectorAll('svg path');
    const trunkColour = paths[0]?.getAttribute('stroke');
    const spineColour = paths[1]?.getAttribute('stroke');
    const branchColours = Array.from(paths)
      .slice(2)
      .map((p) => p.getAttribute('stroke'));

    expect(trunkColour).toBe(spineColour);
    expect(trunkColour).not.toBe(branchColours[0]);
    expect(branchColours.filter((c) => c === trunkColour).length).toBe(1);
  });

  it('renders the N-steps pill once, reporting totalSteps rather than the branch count', () => {
    render(<SessionFanNode id="fan-3" data={fanData({ totalSteps: 7 })} />);
    const pills = screen.getAllByText('7 steps');
    expect(pills.length).toBe(1);
  });

  it("positions the pill's box at svg-local left:16px top:135px 58x20", () => {
    render(<SessionFanNode id="fan-4" data={fanData({ totalSteps: 5 })} />);
    const pill = screen.getByText('5 steps').closest('[data-fan-pill]') as HTMLElement;
    expect(pill.style.left).toBe('16px');
    expect(pill.style.top).toBe('135px');
    expect(pill.style.width).toBe('58px');
    expect(pill.style.height).toBe('20px');
  });

  it('still draws three branches, one spine and one pill for a session with one visible decision', () => {
    const { container } = render(
      <SessionFanNode
        id="fan-5"
        data={fanData({
          sessionStatus: 'waiting',
          branchStatuses: ['empty', 'empty', 'waiting'],
          totalSteps: 1,
        })}
      />,
    );
    const paths = container.querySelectorAll('svg path');
    expect(paths.length).toBe(5);
    expect(screen.getAllByText('1 steps').length).toBe(1);
  });
});

describe('StepSlotNode', () => {
  it('renders a 250x90 dashed placeholder that reads "no step yet" and nothing else', () => {
    const { container } = render(<StepSlotNode id="slot-1" />);
    const box = container.firstElementChild as HTMLElement;
    expect(box.style.width).toBe('250px');
    expect(box.style.height).toBe('90px');
    expect(box.style.borderStyle).toBe('dashed');
    expect(screen.getByText('no step yet')).toBeTruthy();
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByText('IN')).toBeNull();
    expect(screen.queryByText('OUT')).toBeNull();
  });

  it('is never focusable or selectable', () => {
    const { container } = render(<StepSlotNode id="slot-2" />);
    const box = container.firstElementChild as HTMLElement;
    expect(box.getAttribute('tabindex')).toBeNull();
    expect(box.hasAttribute('data-jump-label')).toBe(false);
  });
});
