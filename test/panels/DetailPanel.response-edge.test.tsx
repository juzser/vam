// @vitest-environment happy-dom

/**
 * The Response view's edge: no rule above the prompt input, a bottom fade while
 * content sits below, and the model label one step down the type scale.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import { BOTTOM_SLACK_PX } from '../../src/renderer/panels/stick-to-bottom.js';

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
const column = () => q<HTMLElement>('[data-detail-column]');

afterEach(cleanup);

const stubMetrics = (
  box: HTMLElement,
  scrollTop: number,
  scrollHeight = 1000,
  clientHeight = 100,
) => {
  Object.defineProperty(box, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(box, 'clientHeight', { value: clientHeight, configurable: true });
  box.scrollTop = scrollTop;
  fireEvent.scroll(box);
};
const fade = () => q<HTMLElement>('[data-detail-fade-bottom]');

describe('no rule above the prompt input', () => {
  it('draws the composer bar with neither border-t nor border-line', () => {
    draw();
    const bar = q<HTMLElement>('[data-composer-bar]');
    expect(bar).not.toBeNull();
    expect(bar?.className).not.toContain('border-t');
    expect(bar?.className).not.toContain('border-line');
  });
});

describe('the bottom fade', () => {
  it('shows while content sits below, and not at the bottom or when the transcript fits', () => {
    draw();
    const box = column() as HTMLElement;
    stubMetrics(box, 0);
    expect(fade()).not.toBeNull();
    stubMetrics(box, 1000 - 100 - BOTTOM_SLACK_PX);
    expect(fade()).toBeNull();
    stubMetrics(box, 500);
    expect(fade()).not.toBeNull();
    stubMetrics(box, 0, 100, 100);
    expect(fade()).toBeNull();
  });

  it('is decoration in the non-scrolling wrapper, on the pane token, with no colour literal', () => {
    draw();
    stubMetrics(column() as HTMLElement, 0);
    const el = fade() as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.className).toContain('pointer-events-none');
    expect(el.className).toContain('linear-gradient(to_top,var(--color-pane)');
    expect(`${el.className} ${el.getAttribute('style') ?? ''}`).not.toMatch(
      /#[0-9a-f]{3}|rgb|hsl/i,
    );
    expect(el.closest('[data-detail-column]')).toBeNull();
    expect(el.parentElement).toBe(column()?.parentElement);
  });

  it('sits under the jump controls', () => {
    draw();
    stubMetrics(column() as HTMLElement, 0);
    const kids = [...(column()?.parentElement?.children ?? [])];
    expect(kids.indexOf(fade() as Element)).toBeLessThan(
      kids.indexOf(q('[data-column-jumps]') as Element),
    );
    expect(q('[data-out-to-bottom]')).not.toBeNull();
  });

  it('leaves the jump control clickable: a click still jumps while the fade is drawn', () => {
    draw();
    const box = column() as HTMLElement;
    stubMetrics(box, 0);
    expect(fade()).not.toBeNull();
    box.scrollTop = 0;
    fireEvent.click(q('[data-out-to-bottom]') as HTMLElement);
    // jumpTo('bottom') moves the box to its scrollHeight.
    expect(box.scrollTop).toBe(1000);
  });
});

describe('the model label', () => {
  it('is one step down the type scale, with no arbitrary size', () => {
    draw({ delivers: true, terminal: true });
    const label = q<HTMLElement>('[data-model-label]');
    expect(label).not.toBeNull();
    expect(label?.className).toContain('text-meta');
    expect(label?.className).not.toMatch(/text-\[/);
  });
});
