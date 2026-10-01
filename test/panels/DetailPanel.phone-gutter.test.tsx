// @vitest-environment happy-dom

/**
 * Operator event #80: on a phone the Response view is full width. The jump
 * buttons float over the transcript as chips and reserve no right column; the
 * desktop keeps its 44px gutter.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

const turn = (id: string): Decision => ({
  id,
  label: `step ${id}`,
  input: `ask ${id}`,
  output: `answer ${id}`,
  commands: [],
});

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

function draw(over: Partial<DetailPanelProps> = {}) {
  const entry: SessionEntry = { project: PROJECT, session: SESSION };
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
const column = () => q<HTMLElement>('[data-detail-column]') as HTMLElement;

afterEach(cleanup);

/** Mid-scroll, so both jump buttons are drawn. */
const scrollToMiddle = () => {
  const box = column();
  Object.defineProperty(box, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(box, 'clientHeight', { value: 100, configurable: true });
  box.scrollTop = 500;
  fireEvent.scroll(box);
};

const classes = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/);
const giveBackBlocks = () =>
  [...document.querySelectorAll<HTMLElement>('[data-detail-column] *')].filter((el) =>
    classes(el).includes('-ml-3.5'),
  );

describe('phone Response view gutter (#80)', () => {
  it('has no right gutter: scroller, give-back blocks and floating chips', () => {
    draw({ phone: true });
    scrollToMiddle();
    const cls = classes(column());
    expect(cls).toContain('pr-3.5');
    expect(cls).not.toContain('pr-11');
    const blocks = giveBackBlocks();
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(classes(block)).not.toContain('-mr-11');
      expect(classes(block)).not.toContain('pr-11');
    }
    expect(classes(q('[data-column-jumps]') as Element)).toContain('absolute');
    expect(classes(q('[data-out-to-top]') as Element)).toContain('absolute');
    expect(classes(q('[data-out-to-bottom]') as Element)).toContain('absolute');
  });

  it('keeps the 44px gutter on desktop', () => {
    draw();
    scrollToMiddle();
    expect(classes(column())).toContain('pr-11');
    const blocks = giveBackBlocks();
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(classes(block)).toContain('-mr-11');
  });
});
