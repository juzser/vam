// @vitest-environment happy-dom

/**
 * WHICH VIEWS THE NARROWED WIDTH CAPS, AND HOW.
 *
 * happy-dom performs no layout, so nothing here can say how wide anything
 * actually PAINTED — `e2e/view-width-shots.mjs` measures that in Chromium, in
 * characters. What this file holds is the part a layout engine is not needed
 * for and that a screenshot cannot state: WHICH views the cap is put on, that
 * it is a MAXIMUM and never a width, and that the two views the operator did
 * not name are left alone by the same flag.
 *
 * The one-list rule is honoured by deriving the capped set from `TABS` through
 * `narrowsAsProse` rather than restating three names: a fifth tab appended to
 * `TABS` has to be classified by the predicate, and this file fails until it
 * is.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import { narrowsAsProse, TABS, type Tab } from '../../src/renderer/panels/tabs.js';
import {
  DEFAULT_NARROW_VIEWS,
  NARROW_PROSE_MAX_WIDTH,
  setActiveNarrowViews,
} from '../../src/renderer/prefs/view-width.js';

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
  branch: null,
  status: 'waiting',
  runningAgents: 0,
  activity: null,
  age: '12m',
  decisions: [DECISION],
};

const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
const ENTRY: SessionEntry = { project: PROJECT, session: SESSION };

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);

afterEach(() => {
  cleanup();
  setActiveNarrowViews(DEFAULT_NARROW_VIEWS);
});

function draw(over: Partial<DetailPanelProps> = {}) {
  const props: DetailPanelProps = {
    entry: ENTRY,
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

const body = (): HTMLElement => {
  const el = q<HTMLElement>('[data-detail-body]');
  if (el === null) throw new Error('the panel drew no body');
  return el;
};

describe('the views one flag covers', () => {
  it('is every tab except the Terminal, which caps itself, and Files, which is not in the ask', () => {
    // The pin, stated once. Everything below derives from the predicate, so a
    // sixth tab cannot join the capped set by accident — and cannot escape it
    // by accident either.
    expect(TABS.filter(narrowsAsProse)).toEqual(['Response', 'PRs', 'Agents']);
    expect(narrowsAsProse('Terminal')).toBe(false);
    expect(narrowsAsProse('Files')).toBe(false);
  });
});

describe('with the flag off, nothing is capped', () => {
  it('leaves the body with no maximum at all, in every view', () => {
    for (const tab of TABS.filter(narrowsAsProse)) {
      draw();
      open(tab);
      expect(body().style.maxWidth, tab).toBe('');
      cleanup();
    }
  });
});

describe('with the flag on', () => {
  it('caps each prose view at the measured eighty characters', () => {
    for (const tab of TABS.filter(narrowsAsProse)) {
      setActiveNarrowViews(true);
      draw();
      open(tab);
      expect(body().style.maxWidth, tab).toBe(NARROW_PROSE_MAX_WIDTH);
      // CENTRED, not pushed against the sidebar: the cap exists to shorten the
      // eye's return sweep, and 1000px of void on one side is a void the eye
      // still has to cross.
      expect(body().className, tab).toContain('mx-auto');
      cleanup();
    }
  });

  it('caps nothing while the Terminal is open — that tab measures in columns, not pixels', () => {
    // A pixel cap put here would be the defect `view-width.ts` argues against:
    // the same "narrowed" would mean 78 columns at 10.5px and 59 at 14px.
    setActiveNarrowViews(true);
    draw();
    open('Terminal');
    expect(body().style.maxWidth).toBe('');
  });

  it('caps nothing while Files is open — it shares this body and was not in the ask', () => {
    // `FilesTab` is a child of this same element (always mounted, `hidden`
    // when another view is up), so a cap left on while Files is current would
    // narrow a tree the operator drags the width of themselves.
    setActiveNarrowViews(true);
    draw({ files: true });
    open('Files');
    expect(body().style.maxWidth).toBe('');
  });

  it('never writes a width, only a maximum', () => {
    // A MAXIMUM, NEVER A FLOOR. vam's narrowest legal pane is 320px and the
    // phone is 390px; a `width` here would make both of them scroll
    // sideways, which is the one way this setting could break a surface it
    // was meant to improve.
    setActiveNarrowViews(true);
    draw({ width: 320 });
    expect(body().style.width).toBe('');
    expect(body().style.minWidth).toBe('');
    expect(body().style.maxWidth).toBe(NARROW_PROSE_MAX_WIDTH);
  });
});
