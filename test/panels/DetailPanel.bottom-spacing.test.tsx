// @vitest-environment happy-dom

/**
 * The transcript scroller ends with a large, viewport-tied bottom spacing, and
 * the stick-to-bottom rule still lands at the end of it.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentQuestion, Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import { BOTTOM_SLACK_PX, isAtBottom } from '../../src/renderer/panels/stick-to-bottom.js';

const turn = (id: string): Decision => ({
  id,
  label: `step ${id}`,
  input: `ask ${id}`,
  output: `answer ${id}`,
  commands: [],
});

/** Newest first, the ordering `model.ts` promises. */
const TURNS: readonly Decision[] = ['d7', 'd6', 'd5', 'd4', 'd3', 'd2', 'd1'].map(turn);

const SESSION: Session = {
  vamControlled: true,
  id: 's1',
  title: 'Colour study',
  epic: 'epic-4',
  branch: null,
  status: 'running',
  runningAgents: 0,
  activity: 'reading files',
  age: '12m',
  decisions: TURNS,
};

const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };

const QUESTION: AgentQuestion = {
  id: 'toolu_1:0',
  header: 'Colours',
  question: 'Which colour do you prefer?',
  multiSelect: false,
  options: [
    { label: 'Crimson', description: null },
    { label: 'Cobalt', description: null },
  ],
  answer: null,
};

function draw(over: Partial<DetailPanelProps> = {}, questions?: readonly AgentQuestion[]) {
  const session: Session = questions === undefined ? SESSION : { ...SESSION, questions };
  const project: Project = { ...PROJECT, sessions: [session] };
  const entry: SessionEntry = { project, session };
  render(
    <DetailPanel
      entry={entry}
      decision={TURNS[0] as Decision}
      draft=""
      onDraftChange={() => {}}
      onSubmit={() => {}}
      composing={false}
      onCompose={() => {}}
      onStopComposing={() => {}}
      active={false}
      actionIndex={0}
      width={408}
      resizeHandle={null}
      delivers
      {...over}
    />,
  );
}

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const column = () => q<HTMLElement>('[data-detail-column]');

afterEach(cleanup);

function stub(box: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(box, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(box, 'clientHeight', { value: clientHeight, configurable: true });
}

describe('the scroller ends with a large bottom spacing', () => {
  it('ends with a viewport-tied trailing spacer, and the scroller carries no bottom padding', () => {
    draw();
    const box = column() as HTMLElement;
    const spacer = box.querySelector('[data-detail-spacer]');
    expect(spacer).not.toBeNull();
    expect(box.lastElementChild).toBe(spacer);
    expect(spacer?.className).toContain('h-[max(12rem,33vh)]');
    expect(box.className).not.toMatch(/(^|\s)pb-/);
  });

  it('phone, no question: keeps the spacer with the phone value, not the desktop one', () => {
    draw({ phone: true });
    const spacer = column()?.querySelector('[data-detail-spacer]');
    expect(spacer).not.toBeNull();
    expect(spacer?.className).toContain('h-[max(6rem,20vh)]');
    expect(spacer?.className).not.toContain('h-[max(12rem,33vh)]');
  });

  it('phone with an open question: no spacer, no fade, the inline card is the column end', () => {
    draw({ phone: true }, [QUESTION]);
    const box = column() as HTMLElement;
    expect(box.querySelector('[data-detail-spacer]')).toBeNull();
    expect(box.lastElementChild).toBe(q('[data-question-bar-inline]'));
    stub(box, 1000, 100);
    box.scrollTop = 0;
    fireEvent.scroll(box);
    expect(q('[data-detail-fade-bottom]')).toBeNull();
  });

  it('desktop with an open question keeps the spacer and the fade rule', () => {
    draw({}, [QUESTION]);
    const box = column() as HTMLElement;
    expect(box.lastElementChild).toBe(box.querySelector('[data-detail-spacer]'));
    stub(box, 1000, 100);
    box.scrollTop = 0;
    fireEvent.scroll(box);
    expect(q('[data-detail-fade-bottom]')).not.toBeNull();
  });

  it('keeps the BOTTOM_SLACK_PX rule as it was', () => {
    expect(BOTTOM_SLACK_PX).toBe(24);
    expect(isAtBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 })).toBe(true);
    expect(isAtBottom({ scrollTop: 800, scrollHeight: 1000, clientHeight: 100 })).toBe(false);
  });

  it('lands scrollTop at scrollHeight and stays stuck when a turn arrives', () => {
    const scrollTo = vi.fn();
    const entry: SessionEntry = { project: PROJECT, session: SESSION };
    const props = {
      entry,
      decision: TURNS[0] as Decision,
      draft: '',
      onDraftChange: () => {},
      onSubmit: () => {},
      composing: false,
      onCompose: () => {},
      onStopComposing: () => {},
      active: false,
      actionIndex: 0,
      width: 408,
      resizeHandle: null,
      delivers: true,
    };
    const view = render(<DetailPanel {...props} />);
    const box = column() as HTMLElement;
    stub(box, 1400, 500);
    box.scrollTo = scrollTo as unknown as typeof box.scrollTo;
    box.scrollTop = 900;
    fireEvent.scroll(box);
    const grown: Session = { ...SESSION, decisions: [turn('d8'), ...TURNS] };
    stub(box, 1600, 500);
    act(() => {
      view.rerender(
        <DetailPanel
          {...props}
          entry={{ project: { ...PROJECT, sessions: [grown] }, session: grown }}
          decision={grown.decisions[0] as Decision}
        />,
      );
    });
    // Stuck means the effect moved the box to the padding's end.
    expect(box.scrollTop === 1600 || scrollTo.mock.calls.length > 0).toBe(true);
  });
});
