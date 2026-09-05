// @vitest-environment happy-dom

/**
 * Two strips claimed `role="tablist"` over a `tabpanel` that does not exist.
 *
 * `grep -n tabpanel src/renderer/panels/DetailPanel.tsx` returns nothing, and
 * returned nothing for the whole life of both claims. A `tab` without its
 * panel fails `aria-required-parent`/`aria-required-children` -- WCAG 1.3.1,
 * Level A -- and it lands hardest at 390px, where a screen reader is standard
 * equipment rather than an accessory.
 *
 * `StepRail` in `phone/PhoneShell.tsx` had already reached this conclusion in
 * its own comment and refused the role. This file holds the same answer for
 * the two that did not: buttons in a named `<nav>`, saying `aria-pressed`.
 *
 * MEASURED AGAINST THE TREE, not the source: every question below is a DOM
 * query on markup `DetailPanel` rendered. What it cannot see is the phone's
 * typing rule, which is keyed on `data-view-tabs` rather than on the role
 * precisely so this change could not silently switch it off --
 * `test/phone/touch-targets.test.tsx` asks the cascade about that.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentQuestion, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel } from '../../src/renderer/panels/DetailPanel.js';

const ask = (id: string, header: string): AgentQuestion => ({
  id,
  header,
  question: `Which ${header.toLowerCase()} do you prefer?`,
  multiSelect: false,
  options: [{ label: 'one', description: null }],
  answer: null,
});

const SESSION: Session = {
  vamControlled: true,
  id: 's1',
  title: 'colour study',
  icon: null,
  epic: null,
  branch: null,
  status: 'waiting',
  runningAgents: 2,
  activity: null,
  age: '3m',
  decisions: [{ id: 'd1', label: 'plan', input: 'ask me', output: 'asked', commands: [] }],
  questions: [ask('t:0', 'Colour'), ask('t:1', 'Fruit')],
};

afterEach(() => cleanup());

function draw() {
  const project: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
  const entry: SessionEntry = { project, session: SESSION };
  render(
    <DetailPanel
      entry={entry}
      decision={SESSION.decisions[0] ?? null}
      draft=""
      onDraftChange={() => {}}
      onSubmit={() => {}}
      composing={false}
      onCompose={() => {}}
      onStopComposing={() => {}}
      active
      actionIndex={0}
      width={408}
      resizeHandle={null}
      delivers
      answer={async () => ({ kind: 'sent', answer: 'x' })}
    />,
  );
}

describe('the detail pane’s two segmented strips', () => {
  it('claims no tab role anywhere, because no tabpanel exists to parent one', () => {
    draw();
    expect([...document.querySelectorAll('[role="tablist"]')].length).toBe(0);
    expect([...document.querySelectorAll('[role="tab"]')].length).toBe(0);
    expect(document.querySelectorAll('[role="tabpanel"]').length, 'the missing half').toBe(0);
  });

  it('names both strips, because a bare box cannot carry a name', () => {
    draw();
    expect(document.querySelector('[data-view-tabs]')?.tagName).toBe('NAV');
    expect(document.querySelector('[data-view-tabs]')?.getAttribute('aria-label')).toBe('views');
    expect(document.querySelector('[data-question-steps]')?.tagName).toBe('NAV');
    expect(document.querySelector('[data-question-steps]')?.getAttribute('aria-label')).toBe(
      'the questions this call asked',
    );
  });

  it('says which one is on with aria-pressed, which needs no panel', () => {
    draw();
    const tabs = [...document.querySelectorAll('[data-tab]')];
    expect(tabs.length).toBeGreaterThan(1);
    expect(tabs.map((t) => t.getAttribute('aria-pressed'))).toEqual(
      tabs.map((t) => (t.getAttribute('data-tab') === 'response' ? 'true' : 'false')),
    );
    for (const tab of tabs) expect(tab.getAttribute('aria-selected'), 'a stale claim').toBeNull();

    const steps = [...document.querySelectorAll('[data-question-step]')];
    expect(steps.length).toBe(2);
    expect(steps.map((s) => s.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
  });
});
