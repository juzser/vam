// @vitest-environment happy-dom

/**
 * WHICH SURFACES THE NARROWED WIDTH CAPS, AND WHERE THE NUMBER COMES FROM.
 *
 * happy-dom performs no layout, so nothing here can say how wide anything
 * actually PAINTED — `e2e/view-width-shots.mjs` measures that in Chromium, in
 * characters. What this file holds is the part a layout engine is not needed
 * for and that a screenshot cannot state: WHICH surfaces the cap is put on,
 * that the number is DIVIDED OUT OF A RULER rather than read from a constant,
 * that it is a MAXIMUM and never a width, and that the two views the operator
 * did not name are left alone by the same flag.
 *
 * THE RULER'S RECTANGLE IS WRITTEN BY THE TEST, the idiom
 * `TerminalTab.fit.test.tsx` established for exactly this environment: the
 * measurement is the subject, so the engine's absence is filled in by hand and
 * the arithmetic is what gets asserted.
 *
 * The one-list rule is honoured by deriving the capped set from `TABS` through
 * `narrowsAsProse` rather than restating three names: a fifth tab appended to
 * `TABS` has to be classified by the predicate, and this file fails until it
 * is.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentQuestion, Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import { narrowsAsProse, TABS, type Tab } from '../../src/renderer/panels/tabs.js';
import {
  DEFAULT_NARROW_VIEWS,
  NARROW_FLOOR_CHARACTERS,
  narrowProseMaxWidth,
  PROSE_RULER_CLASS,
  setActiveNarrowViews,
} from '../../src/renderer/prefs/view-width.js';

const DECISION: Decision = {
  id: 'd1',
  label: 'step 1',
  input: 'ask',
  output: 'answered',
  commands: [],
};

const QUESTION: AgentQuestion = {
  id: 'toolu_1:0',
  header: null,
  question: 'Do you want to run this command?',
  multiSelect: false,
  options: [
    { label: 'Yes', description: null },
    { label: 'No', description: null },
  ],
  answer: null,
};

const SESSION: Session = {
  id: 's1',
  title: 'atlas work',
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

/** The observer happy-dom will not run for us; its callbacks are fired by
 *  `layout` below, which is also what a real engine does on `observe`. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed: Element[] = [];
  constructor(readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  disconnect() {}
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setActiveNarrowViews(DEFAULT_NARROW_VIEWS);
});

/**
 * Give the ruler a rectangle, as if a browser had drawn it, and let the panel
 * measure. `advance` is pixels per character — the thing the platform decides.
 */
function layout(advance: number) {
  const ruler = q<HTMLElement>('[data-prose-ruler]');
  if (ruler === null) throw new Error('the panel drew no prose ruler');
  const characters = (ruler.textContent ?? '').length;
  ruler.getBoundingClientRect = () => ({ width: advance * characters, height: 16 }) as DOMRect;
  act(() => {
    for (const observer of FakeResizeObserver.instances) observer.callback();
  });
}

function draw(over: Partial<DetailPanelProps> = {}, questions?: readonly AgentQuestion[]) {
  const session: Session = questions === undefined ? SESSION : { ...SESSION, questions };
  const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
  const props: DetailPanelProps = {
    entry: { project, session },
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

// Unused in assertions, but it keeps the entry constant honest against the
// props shape above.
void ENTRY;
void PROJECT;

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

describe('the cap is divided out of a ruler, never read from a constant', () => {
  it('draws a ruler of real prose, hidden, unselectable, and out of the flow', () => {
    // Every one of these is load-bearing and none of them is visible.
    // `absolute` keeps the ruler's width its own content's rather than the
    // container's, so the cap cannot feed back into the thing it is measured
    // from; `select-none` keeps three hundred invisible characters out of the
    // operator's clipboard, which a `select-text` body would otherwise put
    // there; `aria-hidden` keeps them out of a screen reader.
    draw();
    const ruler = q<HTMLElement>('[data-prose-ruler]');
    expect(ruler).not.toBeNull();
    // ASKED AS A PROPERTY, not as an attribute on one element: the ruler is
    // hidden from assistive technology if ANY ancestor hides it, and it moved
    // inside a clipping wrapper the day the page learned not to scroll
    // sideways. Spelling it `ruler.getAttribute('aria-hidden')` made this fail
    // for a change that kept the property perfectly.
    expect(ruler?.closest('[aria-hidden="true"]')).not.toBeNull();
    // Out of the flow -- on the ruler itself or on the box that clips it.
    expect(
      ruler?.className.includes('absolute') === true ||
        ruler?.parentElement?.className.includes('absolute') === true,
    ).toBe(true);
    expect(ruler?.className).toContain('select-none');
    expect(ruler?.className).toContain('opacity-0');
    // And it wears the class that gives it a size — the rule itself is in
    // `styles.css` and `prefs.view-width.test.ts` scans for it.
    expect(ruler?.className).toContain(PROSE_RULER_CLASS);
    // Inside the body, so it inherits the face the prose is really set in.
    expect(body().contains(ruler)).toBe(true);
  });

  it('answers whatever the platform measured, not what this machine measures', () => {
    // THE MUTATION THIS BLOCK EXISTS FOR after CI. 6.0079 is this macOS
    // machine, 5.7180 is the ubuntu runner that caught the frozen constant;
    // both have to produce their own column, and neither may be baked in.
    for (const advance of [5.718, 6.0079, 8.4402]) {
      setActiveNarrowViews(true);
      draw();
      layout(advance);
      expect(body().style.maxWidth, `${advance}`).toBe(narrowProseMaxWidth(advance));
      // The floor is spelled out here independently of the helper, so a
      // helper that forgot the floor and returned the bare fraction would
      // still be caught.
      expect(body().style.maxWidth, `${advance}`).toContain(
        `calc(${Math.floor(NARROW_FLOOR_CHARACTERS * advance)}px + 1.75rem)`,
      );
      cleanup();
    }
  });

  it('caps nothing while the ruler has not been measured', () => {
    // happy-dom's zeros are the real state of an element that has not been
    // laid out, and a real browser reports them for one frame too. A cap
    // computed from a zero advance is 28px of padding and no text.
    setActiveNarrowViews(true);
    draw();
    expect(body().style.maxWidth).toBe('');
  });

  it('re-measures when the ruler itself changes size, which is how a font change arrives', () => {
    // The asymmetry `TerminalTab.tsx` documents, solved by observing the right
    // element: a face resolving, a webfont swapping in and the operator
    // stepping `out` text all move THE RULER and none of them moves the pane.
    setActiveNarrowViews(true);
    draw();
    layout(6.0079);
    const first = body().style.maxWidth;
    layout(8.4402);
    expect(body().style.maxWidth).not.toBe(first);
    expect(body().style.maxWidth).toBe(narrowProseMaxWidth(8.4402));
  });

  it('observes the ruler and not the pane', () => {
    draw();
    const ruler = q<HTMLElement>('[data-prose-ruler]');
    const observing = FakeResizeObserver.instances.flatMap((o) => o.observed);
    expect(observing).toContain(ruler);
  });
});

describe('with the flag off, nothing is capped', () => {
  it('leaves the body with no maximum at all, in every view', () => {
    for (const tab of TABS.filter(narrowsAsProse)) {
      draw();
      layout(6.0079);
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
      layout(6.0079);
      open(tab);
      expect(body().style.maxWidth, tab).toBe(narrowProseMaxWidth(6.0079));
      // CENTRED, not pushed against the sidebar: the cap exists to shorten the
      // eye's return sweep, and 1000px of void on one side is a void the eye
      // still has to cross.
      expect(body().className, tab).toContain('mx-auto');
      cleanup();
    }
  });

  it('brings the composer with it — one column, not two that happen to agree', () => {
    // THE OPERATOR'S OWN DECISION, made on a screenshot of the first cut where
    // a narrow column of prose sat on full-width chrome. The two carry the
    // SAME value, so this compares them to each other rather than to a number.
    setActiveNarrowViews(true);
    draw();
    layout(6.0079);
    const composer = q<HTMLElement>('[data-composer-bar]');
    expect(composer, 'the composer bar was not drawn').not.toBeNull();
    expect(composer?.style.maxWidth).toBe(body().style.maxWidth);
    expect(composer?.className).toContain('mx-auto');
  });

  it('brings the question card with it too', () => {
    setActiveNarrowViews(true);
    draw({}, [QUESTION]);
    layout(6.0079);
    const question = q<HTMLElement>('[data-question-bar]');
    expect(question, 'the question bar was not drawn').not.toBeNull();
    expect(question?.style.maxWidth).toBe(body().style.maxWidth);
    expect(question?.className).toContain('mx-auto');
  });

  it('leaves the composer full-pane while the flag is off', () => {
    draw();
    layout(6.0079);
    expect(q<HTMLElement>('[data-composer-bar]')?.style.maxWidth ?? '').toBe('');
  });

  it('caps nothing while the Terminal is open — that tab measures in columns, not pixels', () => {
    // A pixel cap put here would be the defect `view-width.ts` argues against:
    // the same "narrowed" would mean 78 columns at 10.5px and 59 at 14px.
    setActiveNarrowViews(true);
    draw();
    layout(6.0079);
    open('Terminal');
    expect(body().style.maxWidth).toBe('');
  });

  it('caps nothing while Files is open — it shares this body and was not in the ask', () => {
    // `FilesTab` is a child of this same element (always mounted, `hidden`
    // when another view is up), so a cap left on while Files is current would
    // narrow a tree the operator drags the width of themselves.
    setActiveNarrowViews(true);
    draw({ files: true });
    layout(6.0079);
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
    layout(6.0079);
    expect(body().style.width).toBe('');
    expect(body().style.minWidth).toBe('');
    expect(body().style.maxWidth).toBe(narrowProseMaxWidth(6.0079));
    expect(q<HTMLElement>('[data-composer-bar]')?.style.width ?? '').toBe('');
  });
});

describe('the reading-size scope', () => {
  it('is worn by the pane the stylesheet keys it to, around everything the pane draws', () => {
    // THE SELECTOR IS READ OUT OF THE STYLESHEET, not restated: `styles.css`
    // re-declares `--text-body` and `--text-control` under one attribute
    // selector, and this asks the rendered panel for THAT selector. A scope
    // whose attribute was renamed on one side reads exactly like one that
    // works in a content scan — `type-scale.test.ts` holds the declarations,
    // this holds that an element really wears them, and
    // `e2e/view-width-shots.mjs` holds that a computed font-size follows.
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
    const selector = /^(\[data-[a-z-]+\])\s*\{\s*--text-body:/m.exec(css)?.[1];
    expect(selector, 'no attribute-scoped --text-body block in styles.css').toBeDefined();
    draw({}, [QUESTION]);
    const scope = q<HTMLElement>(selector as string);
    expect(scope, `nothing rendered wears ${selector}`).not.toBeNull();
    // Around the transcript, the question card and the composer alike: the
    // operator's report named all three, and a scope on the body alone would
    // leave the card and the composer at the shipped size.
    expect(scope?.contains(body())).toBe(true);
    expect(scope?.contains(q('[data-question-bar]'))).toBe(true);
    cleanup();
    draw();
    expect(q<HTMLElement>(selector as string)?.contains(q('[data-composer-bar]'))).toBe(true);
  });
});
