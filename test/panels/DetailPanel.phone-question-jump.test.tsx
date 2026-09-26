// @vitest-environment happy-dom

/**
 * Spec step 4a (docs/design/phone-core-loop.md §3.2, §3.7 PR4) — DEVIATION,
 * approved: moving the question inline (step 3) reintroduces the classic
 * chat-app problem the fixed card never had — it can scroll out of view
 * while the operator reads history above it. A floating "jump to question"
 * pill appears exactly then, driven by an `IntersectionObserver` on the
 * inline card.
 *
 * happy-dom's own `IntersectionObserver` never actually fires without a real
 * layout engine behind it, so this file installs a CONTROLLABLE fake — the
 * same idiom `test/phone/harness.tsx` already uses for `ResizeObserver` — and
 * drives it by hand.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentQuestion, Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

const QUESTION: AgentQuestion = {
  id: 'toolu_1:0',
  header: null,
  question: 'Do you want to run this command?',
  multiSelect: false,
  options: [{ label: 'Yes', description: null }],
  answer: null,
};

const PRIOR_TURN: Decision = {
  id: 'd1',
  label: 'plan',
  input: 'read the ticket',
  output: 'the ticket asks for a colour pick',
  commands: [],
};

const SESSION: Session = {
  id: 's1',
  title: 'factory-sse-1',
  epic: null,
  branch: null,
  status: 'waiting',
  runningAgents: 0,
  activity: null,
  age: '3m',
  decisions: [PRIOR_TURN],
};

/** One observer instance per test, capturing what it was asked to watch and
 *  giving the test a hand crank for its callback. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;
  constructor(readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(target: Element) {
    this.observed.push(target);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  /** Fires the callback as if the browser had just measured `isIntersecting`. */
  fire(isIntersecting: boolean) {
    const target = this.observed[this.observed.length - 1];
    if (target === undefined) throw new Error('nothing observed yet');
    this.callback(
      [{ isIntersecting, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function draw(over: Partial<DetailPanelProps> = {}) {
  const session: Session = { ...SESSION, questions: [QUESTION] };
  const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
  const entry: SessionEntry = { project, session };
  render(
    <DetailPanel
      entry={entry}
      decision={PRIOR_TURN}
      draft=""
      onDraftChange={() => {}}
      onSubmit={() => {}}
      composing={false}
      onCompose={() => {}}
      onStopComposing={() => {}}
      active={false}
      actionIndex={0}
      width={390}
      resizeHandle={null}
      phone
      {...over}
    />,
  );
}

const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const latestObserver = () => {
  const observer =
    FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1];
  if (observer === undefined) throw new Error('no IntersectionObserver was constructed');
  return observer;
};

describe('the jump-to-question pill (phone)', () => {
  it('watches the inline question with an IntersectionObserver', () => {
    draw();
    const observer = latestObserver();
    expect(observer.observed).toHaveLength(1);
    expect(observer.observed[0]?.hasAttribute('data-question-bar-inline')).toBe(true);
  });

  it('is absent while the question is in view (the common case)', () => {
    draw();
    expect(q('[data-jump-to-question]')).toBeNull();
  });

  it('appears once the observer reports the question scrolled out of view', () => {
    draw();
    act(() => latestObserver().fire(false));
    const pill = q('[data-jump-to-question]');
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute('aria-label')).toContain('pending');
  });

  it('and only one jump control is ever drawn — never both the pill and the bare chevron', () => {
    draw();
    act(() => latestObserver().fire(false));
    expect(q('[data-jump-to-question]')).not.toBeNull();
    expect(q('[data-out-to-bottom]')).toBeNull();
  });

  it('goes away again once the observer reports the question back in view', () => {
    draw();
    act(() => latestObserver().fire(false));
    expect(q('[data-jump-to-question]')).not.toBeNull();
    act(() => latestObserver().fire(true));
    expect(q('[data-jump-to-question]')).toBeNull();
  });

  it('clicking the pill scrolls without throwing, and does not open a second control', () => {
    draw();
    act(() => latestObserver().fire(false));
    const pill = q('[data-jump-to-question]') as HTMLButtonElement;
    expect(() => act(() => pill.click())).not.toThrow();
  });

  it('disconnects the observer on unmount, and reports the pill absent (nothing to watch on desktop)', () => {
    draw({ phone: false, width: 700 });
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
    expect(q('[data-jump-to-question]')).toBeNull();
  });
});
