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
import {
  SessionFanNode,
  type SessionFanNodeData,
  type SessionFanStatus,
} from '../../src/renderer/canvas/SessionFanNode.js';
import { StepSlotNode } from '../../src/renderer/canvas/StepSlotNode.js';

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
    const { container } = render(<SessionFanNode id="fan-3" data={fanData({ totalSteps: 7 })} />);
    const pills = container.querySelectorAll('[data-fan-pill]');
    expect(pills.length).toBe(1);
    expect(pills[0]?.textContent).toBe('7 steps');
  });

  it("positions the pill's box at svg-local left:16px top:135px 44x15", () => {
    const { container } = render(<SessionFanNode id="fan-4" data={fanData({ totalSteps: 5 })} />);
    const pill = container.querySelector('[data-fan-pill]') as HTMLElement;
    expect(pill.style.left).toBe('16px');
    expect(pill.style.top).toBe('135px');
    expect(pill.style.width).toBe('44px');
    expect(pill.style.height).toBe('15px');
  });

  it('gives the pill two tones: the number carries the status colour, the word `steps` stays fixed', () => {
    // The mockup's pill is two-tone (visual-hds finding f-...-659560fc): the
    // number takes the session's status colour, `steps` stays neutral. This
    // discriminates three ways: a waiting session's number is
    // var(--color-waiting); a non-waiting (running) session's number is NOT
    // var(--color-waiting) — per the canvas colour rule (epic.md §13.4) it is
    // the neutral var(--color-ink-dim), since colour is reserved for what
    // needs a person and `running` does not; the word `steps` is
    // var(--color-ink-faint) in both. A one-tone pill (both spans sharing
    // var(--color-ink-faint)) fails the first two assertions.
    const { container, rerender } = render(
      <SessionFanNode id="fan-6" data={fanData({ sessionStatus: 'waiting' })} />,
    );
    let pill = container.querySelector('[data-fan-pill]') as HTMLElement;
    let numberSpan = pill.querySelector('[data-fan-pill-count]') as HTMLElement;
    let wordSpan = pill.querySelector('[data-fan-pill-word]') as HTMLElement;
    expect(numberSpan.style.color).toBe('var(--color-waiting)');
    expect(wordSpan.style.color).toBe('var(--color-ink-faint)');

    rerender(<SessionFanNode id="fan-6" data={fanData({ sessionStatus: 'running' })} />);
    pill = container.querySelector('[data-fan-pill]') as HTMLElement;
    numberSpan = pill.querySelector('[data-fan-pill-count]') as HTMLElement;
    wordSpan = pill.querySelector('[data-fan-pill-word]') as HTMLElement;
    expect(numberSpan.style.color).not.toBe('var(--color-waiting)');
    expect(numberSpan.style.color).toBe('var(--color-ink-dim)');
    expect(wordSpan.style.color).toBe('var(--color-ink-faint)');
  });

  it('reads the canvas colour rule off the drawn fan, one report line per status', () => {
    // Criterion 9 (plan-v4). Colour is reserved for what needs a person:
    // zero green (--color-running), zero blue (--color-done) anywhere on
    // the canvas. For each domain status, render the fan and reduce the
    // trunk stroke, the pill number's colour and the pill word's colour to
    // their token names — or LITERAL:<value> if no var() wraps it.
    const statuses: SessionFanStatus[] = ['waiting', 'running', 'done', 'failed'];
    const tokenOf = (value: string | null): string => {
      const match = value?.match(/var\((--[a-z-]+)\)/);
      return match?.[1] ? match[1] : `LITERAL:${value}`;
    };
    const lines = statuses.map((status) => {
      const { container, unmount } = render(
        <SessionFanNode
          id={`fan-rule-${status}`}
          data={fanData({ sessionStatus: status, totalSteps: 7 })}
        />,
      );
      const trunkStroke = container.querySelector('svg path')?.getAttribute('stroke') ?? null;
      const pill = container.querySelector('[data-fan-pill]') as HTMLElement;
      const numberSpan = pill.querySelector('[data-fan-pill-count]') as HTMLElement;
      const wordSpan = pill.querySelector('[data-fan-pill-word]') as HTMLElement;
      const line = `${status} trunk=${tokenOf(trunkStroke)} num=${tokenOf(numberSpan.style.color)} word=${tokenOf(wordSpan.style.color)}`;
      unmount();
      return line;
    });
    expect(lines.sort()).toEqual([
      'done trunk=--color-line-loud num=--color-ink-dim word=--color-ink-faint',
      'failed trunk=--color-failed num=--color-failed word=--color-ink-faint',
      'running trunk=--color-line-loudest num=--color-ink-dim word=--color-ink-faint',
      'waiting trunk=--color-waiting num=--color-waiting word=--color-ink-faint',
    ]);
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
    const pills = container.querySelectorAll('[data-fan-pill]');
    expect(pills.length).toBe(1);
    expect(pills[0]?.textContent).toBe('1 steps');
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

/**
 * The rendering half of the same rule. `layout.ts` decides WHICH branch is the
 * route (see layout.test.ts); this asserts the fan draws that one in colour and
 * the others in the plain line tone, at the mockup's opacities.
 */
describe('SessionFanNode: the route branch is the only coloured one', () => {
  function strokesOf(container: HTMLElement): { stroke: string; opacity: string }[] {
    const paths = Array.from(container.querySelectorAll('svg path'));
    expect(paths.length).toBe(5);
    // Paths 2..4 are the branches; 0 and 1 are trunk and spine.
    return paths.slice(2).map((p) => ({
      stroke: p.getAttribute('stroke') ?? '',
      opacity: p.getAttribute('opacity') ?? '',
    }));
  }

  it('draws idle branches in the plain line tone and only the active one in status colour', () => {
    const { container } = render(
      <SessionFanNode
        id="fan-route"
        data={fanData({ sessionStatus: 'waiting', branchStatuses: ['idle', 'waiting', 'idle'] })}
      />,
    );
    expect(strokesOf(container)).toEqual([
      { stroke: 'var(--color-line-strong)', opacity: '1' },
      { stroke: 'var(--color-waiting)', opacity: '0.7' },
      { stroke: 'var(--color-line-strong)', opacity: '1' },
    ]);
  });

  it('draws an idle branch identically to an empty one — neither is a route', () => {
    const { container } = render(
      <SessionFanNode
        id="fan-idle-empty"
        data={fanData({ sessionStatus: 'done', branchStatuses: ['idle', 'done', 'empty'] })}
      />,
    );
    const [first, , third] = strokesOf(container);
    expect(first).toEqual(third);
  });

  it('outlines the steps pill, which is what separates it from the line it sits on', () => {
    const { container } = render(<SessionFanNode id="fan-pill" data={fanData()} />);
    const pill = container.querySelector('[data-fan-pill]');
    expect(pill).not.toBeNull();
    const style = (pill as HTMLElement).style;
    expect(style.borderWidth).toBe('1px');
    expect(style.borderStyle).toBe('solid');
    expect(style.borderColor).toBe('var(--color-waiting-tint)');
    expect(style.borderRadius).toBe('999px');
  });
});
