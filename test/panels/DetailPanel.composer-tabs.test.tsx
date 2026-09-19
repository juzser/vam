// @vitest-environment happy-dom

/**
 * WHICH VIEWS DRAW A PROMPT BOX — pinned, so a sixth tab has to answer the
 * question instead of inheriting an answer.
 *
 * The operator's report, on the PRs tab: "it does not need the prompt input."
 * It is right, and the reason generalises: the composer prompts the AGENT, so
 * it belongs to a view that is a CONVERSATION with one. A list of pull
 * requests is not; there is nothing on that view a typed sentence is addressed
 * to, and a box that takes text nothing will read is the same defect
 * `DetailPanel`'s own first rule names -- absent, not dimmed.
 *
 * THE SHAPE OF THIS FILE IS THE POINT, and it is `DetailPanel.view-width`'s:
 * the set is derived from `TABS` through `drawsComposer` rather than restated
 * as three names, so appending a sixth tab fails this file until somebody
 * classifies it. Withdrawing the box from PRs by adding a third `!==` at the
 * render site would have left the next tab to inherit whatever the chain
 * happened to give it, which is the accident this pins shut.
 *
 * It asserts the PAINT, not the predicate alone: every drawable view is opened
 * the way an operator opens it -- the bar's own button -- and the DOM is asked
 * whether `[data-composer-bar]` is there. A predicate nothing consults is a
 * fact about a function, not about the app.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import { drawsComposer, TABS, type Tab, visibleTabs } from '../../src/renderer/panels/tabs.js';

const DECISION: Decision = {
  id: 'd1',
  label: 'step 1',
  input: 'ask',
  output: 'answered',
  commands: [],
};

const SESSION: Session = {
  id: 's1',
  title: 'atlas work',
  icon: null,
  epic: null,
  branch: 'feature/atlas',
  status: 'waiting',
  runningAgents: 0,
  activity: null,
  age: '12m',
  decisions: [DECISION],
};

const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };

class FakeResizeObserver {
  constructor(readonly callback: () => void) {}
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);

/** Every tab drawable at once: a source with a terminal, and the file bridge on. */
function draw(over: Partial<DetailPanelProps> = {}) {
  const props: DetailPanelProps = {
    entry: { project: PROJECT, session: SESSION },
    decision: DECISION,
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
    terminal: true,
    files: true,
    ...over,
  };
  render(<DetailPanel {...props} />);
}

/** Open a view the way the operator does — the bar's own button. */
const open = (tab: Tab) => {
  act(() => {
    q<HTMLButtonElement>(`[data-view="${tab.toLowerCase()}"]`)?.click();
  });
};

describe('the views that draw a prompt box', () => {
  it('is every conversational view — and PRs is not one of them', () => {
    // The pin, stated once. Everything below derives from the predicate.
    expect(TABS.filter(drawsComposer)).toEqual(['Response', 'Agents']);
    expect(drawsComposer('PRs')).toBe(false);
    expect(drawsComposer('Terminal')).toBe(false);
    expect(drawsComposer('Files')).toBe(false);
  });

  it('paints a composer on exactly those views and on no other', () => {
    draw();
    // `false` for `phone`: this case is about the DESKTOP bar, which is the
    // only shell that draws all five names -- a phone has no strip at all, and
    // no PRs view to ask about.
    const drawn = visibleTabs(true, true, false);
    // The harness has to actually reach every name, or this loop would be
    // green having examined two of five.
    expect(drawn).toEqual(TABS);
    for (const tab of drawn) {
      open(tab);
      expect({ tab, composer: q('[data-composer-bar]') !== null }).toEqual({
        tab,
        composer: drawsComposer(tab),
      });
    }
  });

  it('withdraws the box on PRs even though the session can be prompted', () => {
    // The falsification: the SAME panel, the same session, one view apart.
    draw();
    open('Response');
    expect(q('[data-composer-bar]')).not.toBeNull();
    open('PRs');
    expect(q('[data-composer-bar]')).toBeNull();
    // And it comes back, so this is a fact about the view and not about a
    // composer that was torn down for good.
    open('Response');
    expect(q('[data-composer-bar]')).not.toBeNull();
  });
});
