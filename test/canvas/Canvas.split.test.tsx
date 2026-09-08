// @vitest-environment happy-dom

/**
 * A15.1 — splitting a tab, horizontally or vertically, by dragging or by
 * keyboard, same project only.
 *
 * The pure tree mechanics (`splitPane`/`closePane`/`stepPane`/`nearestEdge`)
 * are pinned in isolation at `test/canvas/split.test.ts`. This file proves
 * the wiring: a real keydown or a real drag sequence actually reaches
 * `Canvas.tsx`'s handlers and produces the DOM this feature promises —
 * `[data-split]`, `[data-split-pane]`, `[data-split-focused]` — and that the
 * cross-project refusal is ALOUD (a status-bar message), never a drop that
 * silently does nothing.
 *
 * happy-dom carries no real layout engine (`getBoundingClientRect` is
 * always zeroed, per `PaneResizer.test.tsx`'s own note — worked around here
 * the same way, by stubbing it) and IMPLEMENTS NO `DragEvent` CLASS AT ALL
 * (verified by reading `happy-dom/src/event/events/` — there is a
 * `MouseEvent.ts` and a `PointerEvent.ts`, no `DragEvent.ts`). Two
 * consequences, both proven by running throwaway probes before writing this
 * file for real:
 *
 * 1. `fireEvent.dragStart`/`dragOver`/`drop` dispatch SOMETHING with the
 *    right `type`, but whatever global `DragEvent` happy-dom falls back to
 *    carries no `dataTransfer` and, worse, no `clientX`/`clientY` at all —
 *    every coordinate reads back `undefined`. `Canvas.tsx`'s own drop
 *    handler already does not depend on (1): the dragged session id
 *    travels in React state (`draggingSessionId`), not `dataTransfer`.
 * 2. For (2) — the edge a drop lands near — this file dispatches a genuine
 *    `MouseEvent` typed `"dragover"`/`"drop"` directly, via `el.dispatchEvent`
 *    rather than `fireEvent`: happy-dom's `MouseEvent` DOES implement
 *    `clientX`/`clientY` correctly, and React's delegated listener at the
 *    root only cares that `event.type` matches — it reads `clientX` off
 *    whatever object bubbles up, never checks its constructor.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';

function decision(id: string, over: Partial<Decision> = {}): Decision {
  return { id, label: id, input: `in-${id}`, output: `out-${id}`, commands: [], ...over };
}

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [decision(`d-${id}`)],
    ...over,
  };
}

/** Two projects, so a drag between them is the refusal case; two sessions in
 *  the first project, so a same-project drag has a second pane to land on. */
const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1'), session('a2')] },
    { id: 'p2', name: 'beta', source: 'claude-code', sessions: [session('b1')] },
  ],
};

afterEach(cleanup);

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function pressChord(prefix: string, key: string) {
  press(prefix);
  press(key);
}

const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
const splitPanes = () => [...document.querySelectorAll('[data-split-pane]')];
const focusedPane = () => document.querySelector('[data-split-focused="true"]');
const splitContainer = () => document.querySelector('[data-split]');
const paneFor = (id: string) => document.querySelector(`[data-split-pane="${id}"]`);
const tabSelect = (title: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-tab-select]')].find(
    (el) => el.textContent === title,
  );
/** The sidebar rows, in source order: a1, a2, b1. Opening a session that no
 *  pane holds yet goes through the sidebar — A15.5 made a strip list the
 *  tabs of ITS OWN pane, not every session in the project. */
const sidebarRow = (at: number) =>
  [...document.querySelectorAll('[data-session-row]')][at] as HTMLElement;
const promptInputIn = (paneEl: Element | null) =>
  paneEl?.querySelector<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]') ?? null;
/** A12.2 removed `DetailPanel`'s own header, so the session's NAME is not
 *  drawn inside the pane at all any more — the tab strip is the only place
 *  that names it. What each pane's `in` block DOES still carry is that
 *  session's own decision text, which this file's `session()`/`decision()`
 *  helpers make unique per session (`in-d-<id>`), so it doubles as a content
 *  fingerprint for "which session is THIS pane actually showing". */
const inBlockIn = (paneEl: Element | null | undefined) =>
  paneEl?.querySelector('[data-detail-scroll="in"]')?.textContent ?? '';

function typeInto(input: HTMLTextAreaElement, text: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set as (
      this: HTMLElement,
      v: string,
    ) => void;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Gives an element a fixed, non-zero rect — happy-dom's own is always
 *  zeroed, per `PaneResizer.test.tsx`'s note, so a drop's edge math needs a
 *  real one to test against. */
function stubRect(el: Element, rect: { left: number; top: number; width: number; height: number }) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => rect,
    }) as DOMRect;
}

/** See the file header: a genuine `MouseEvent` typed `dragover`/`drop`,
 *  dispatched directly, because happy-dom's own `DragEvent` fallback carries
 *  no `clientX`/`clientY` through `fireEvent`. */
function dragAt(el: Element, type: 'dragover' | 'drop', clientX: number, clientY: number) {
  const event = new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(event);
  });
}

describe('keyboard: zs / zv split the focused pane, zc closes it, zw/zW move between them', () => {
  it('starts as a single, unsplit pane', () => {
    render(<Canvas model={MODEL} />);
    expect(splitPanes()).toHaveLength(1);
    expect(splitContainer()).toBeNull();
  });

  it('zv splits vertically — a row, side by side — and focuses the new pane', () => {
    render(<Canvas model={MODEL} />);
    pressChord('z', 'v');
    expect(splitPanes()).toHaveLength(2);
    expect(splitContainer()?.getAttribute('data-split-orientation')).toBe('row');
    // The new pane, not the old one, now holds the keyboard.
    const focusedId = focusedPane()?.getAttribute('data-split-pane');
    expect(focusedId).not.toBeNull();
    expect(splitPanes().map((p) => p.getAttribute('data-split-pane'))).toContain(focusedId);
  });

  it('zs splits horizontally — a column, stacked', () => {
    render(<Canvas model={MODEL} />);
    pressChord('z', 's');
    expect(splitPanes()).toHaveLength(2);
    expect(splitContainer()?.getAttribute('data-split-orientation')).toBe('column');
  });

  it('the new pane TAKES the tab, and the one it came from is left empty', () => {
    // This case read "the new pane starts as a mirror of the one it split
    // from" and asserted a composer in both halves. The mirror is what the
    // operator reported against ("when I split a tab, I still see that tab
    // showing in both panes"), so the same setup now pins the opposite: the
    // session is in the new pane, and the pane it came from is empty and says
    // so rather than disappearing.
    render(<Canvas model={MODEL} />);
    pressChord('z', 'v');
    const [first, second] = splitPanes();
    // Empty means it holds no session, not that it is a blank rectangle: the
    // strip says so, once, and the composer is WITHDRAWN.
    //
    // WAS: "the composer is present but read-only, which is the pane's own
    // pre-existing 'holding nothing' presentation". That presentation was
    // audit F8 — a `readOnly` box under an enabled record button that did
    // nothing and did not even change the status bar, plus attach, the
    // provider picker and the model field, six controls that cannot act. A
    // control that cannot act is withdrawn or refuses aloud; this one is
    // withdrawn, and `Canvas.empty-pane-composer.test.tsx` holds the whole
    // set. What "Pick a session first" was pinning here — that the two panes
    // present differently — the assertion below still pins from the live half.
    expect(first?.querySelector('[data-tab-strip]')?.textContent).toContain('no sessions open');
    expect(promptInputIn(first as Element) ?? null).toBeNull();
    // The pane that took the tab is pointed at a session, so its composer is
    // not the "pick one" placeholder. (Whether it is READ-ONLY is a question
    // about the source's capabilities, not about panes — this MODEL has no
    // source at all, so both are read-only and that would prove nothing.)
    expect(promptInputIn(second as Element)?.placeholder).not.toContain('Pick a session first');
    expect(inBlockIn(second as Element)).toContain('in-d-a1');
  });

  it('zc closes the focused split — the other pane survives, unsplit', () => {
    render(<Canvas model={MODEL} />);
    pressChord('z', 'v');
    expect(splitPanes()).toHaveLength(2);
    pressChord('z', 'c');
    expect(splitPanes()).toHaveLength(1);
    expect(splitContainer()).toBeNull();
  });

  it('zc refuses aloud with only one pane — it does not close the session', () => {
    render(<Canvas model={MODEL} />);
    pressChord('z', 'c');
    expect(splitPanes()).toHaveLength(1);
    expect(statusBar()).toContain('only one pane open');
  });

  it('zw and zW cycle focus between two panes, wrapping', () => {
    render(<Canvas model={MODEL} />);
    pressChord('z', 'v');
    const afterSplit = focusedPane()?.getAttribute('data-split-pane');
    pressChord('z', 'w');
    const afterNext = focusedPane()?.getAttribute('data-split-pane');
    expect(afterNext).not.toBe(afterSplit);
    // Two panes: one more step wraps back to where the split left off.
    pressChord('z', 'w');
    expect(focusedPane()?.getAttribute('data-split-pane')).toBe(afterSplit);
    pressChord('z', 'W');
    expect(focusedPane()?.getAttribute('data-split-pane')).toBe(afterNext);
  });

  it('zw refuses aloud with only one pane', () => {
    render(<Canvas model={MODEL} />);
    pressChord('z', 'w');
    expect(statusBar()).toContain('only one pane open');
  });
});

describe('dragging a tab splits — same project only, refused aloud otherwise', () => {
  it('dropping near the right edge makes a row split holding the DRAGGED session', () => {
    render(<Canvas model={MODEL} />);
    // pane-1 shows a1 (focus lands there on mount, first entry); open a2 in
    // it too, so its own strip has a second tab to drag.
    act(() => sidebarRow(1).click());
    act(() => sidebarRow(0).click());
    const targetPane = paneFor('pane-1') as HTMLElement;
    stubRect(targetPane, { left: 0, top: 0, width: 200, height: 100 });
    const tab = tabSelect('a2') as HTMLButtonElement;
    fireEvent.dragStart(tab);
    dragAt(targetPane, 'dragover', 190, 50);
    dragAt(targetPane, 'drop', 190, 50);
    expect(splitPanes()).toHaveLength(2);
    expect(splitContainer()?.getAttribute('data-split-orientation')).toBe('row');
    const [first, second] = splitPanes();
    expect(inBlockIn(first)).toContain('in-d-a1'); // untouched
    expect(inBlockIn(second)).toContain('in-d-a2'); // the dragged one, freshly split in
  });

  it('dropping near the top edge makes a column split', () => {
    render(<Canvas model={MODEL} />);
    act(() => sidebarRow(1).click());
    const targetPane = paneFor('pane-1') as HTMLElement;
    stubRect(targetPane, { left: 0, top: 0, width: 200, height: 100 });
    const tab = tabSelect('a2') as HTMLButtonElement;
    fireEvent.dragStart(tab);
    dragAt(targetPane, 'dragover', 100, 2);
    dragAt(targetPane, 'drop', 100, 2);
    expect(splitContainer()?.getAttribute('data-split-orientation')).toBe('column');
  });

  /**
   * RETIRED with A15.5: "a cross-project drop is refused ALOUD, and nothing
   * splits". The gesture it drove is no longer reachable. It needed two
   * panes disagreeing about their project, which it produced by moving the
   * focused pane onto another project's session while the first pane stayed
   * behind — exactly the stale state the operator then reported as a bug,
   * and which switching project now reconciles by collapsing to a single
   * pane (`Canvas.tsx`'s `setFocusedSessionId`, guarded in
   * `Canvas.pane-tabs.test.tsx`). Every pane on screen therefore holds the
   * active project's sessions, and every strip lists only those, so a drag
   * cannot pick up a tab that disagrees with its target. The refusal itself
   * is KEPT in `onPaneDrop` as a defensive check on two pieces of state
   * (the drag payload, the pane tree) that are written a gesture apart.
   */
});

/**
 * The mirrored-pane case that used to open this block is gone with the
 * mirror: `zv` MOVES the active tab now, so no gesture can put one session in
 * two panes and "two panes showing the SAME session share one draft" is a
 * state the shell cannot reach. What is left to pin — and the half that was
 * always load-bearing — is that two panes showing DIFFERENT sessions never
 * leak a draft between them.
 */
describe('per-pane isolation — the composer draft is per SESSION, and two panes never share one', () => {
  it('two panes showing DIFFERENT sessions never leak a draft between them', () => {
    render(<Canvas model={MODEL} />);
    // pane-1 holds a1 and a2, a2 in front; `zv` takes a2 to pane-2 and leaves
    // a1 behind, which is the two-panes-two-sessions shape in one chord.
    act(() => sidebarRow(1).click());
    pressChord('z', 'v');
    const [first, second] = splitPanes();
    const firstInput = promptInputIn(first as Element) as HTMLTextAreaElement; // a1
    const secondInput = promptInputIn(second as Element) as HTMLTextAreaElement; // a2
    typeInto(firstInput, 'a1’s own words');
    typeInto(secondInput, 'a2’s own words');
    expect(firstInput.value).toBe('a1’s own words');
    expect(secondInput.value).toBe('a2’s own words');
  });
});

describe('the default-provider picker (#261) is wired to every pane, not only the focused one', () => {
  it('renders its toggle inside a background (non-focused) split pane too', () => {
    render(<Canvas model={MODEL} />);
    act(() => sidebarRow(1).click()); // pane-1: a1, a2 — a2 in front
    pressChord('z', 'v'); // pane-1: a1 (unfocused) | pane-2: a2 (focused)
    const [first] = splitPanes();
    // `defaultProvider`/`onSetDefaultProvider` are global-preference props,
    // identical for every pane (A15.4's own contract) — proving the
    // BACKGROUND pane draws the control is the one case a focused-pane-only
    // wiring mistake would miss.
    expect(first?.querySelector('[data-provider-picker-toggle]')).not.toBeNull();
  });
});

/**
 * The focused pane wears NO ring. Operator instruction: "also remove the
 * focus border on the pane."
 *
 * It shipped as `ring-1 ring-inset ring-cursor-ring`, drawn only once a
 * second pane existed. What answers "which pane has the keyboard" now is the
 * view-icon overlay, which the pane-focus change already draws in the focused pane and nowhere
 * else — that is asserted here as well, because removing the last visible
 * indicator would be a different change from removing one of two, and the
 * assertion is what keeps this from becoming that quietly.
 *
 * `data-split-focused` stays on the element and is untouched: the attribute is
 * the machine-readable half and this file, the browser guard and
 * `Canvas.view-icons-focus.test.tsx` all read it.
 */
describe('no pane wears a focus ring', () => {
  it('draws no ring on the focused pane of a split — nor on the other', () => {
    render(<Canvas model={MODEL} />);
    pressChord('z', 'v');
    expect(splitPanes()).toHaveLength(2);
    for (const pane of splitPanes()) {
      expect(pane.className).not.toMatch(/\bring-/);
    }
  });

  it('draws none on the single pane either', () => {
    render(<Canvas model={MODEL} />);
    expect(splitPanes()[0]?.className).not.toMatch(/\bring-/);
  });

  it('still says which pane holds the keyboard, in the attribute and in paint', () => {
    render(<Canvas model={MODEL} />);
    pressChord('z', 'v');
    // The machine-readable half, which the browser guard and the tests read.
    expect(splitPanes().map((pane) => pane.getAttribute('data-split-focused'))).toEqual([
      'false',
      'true',
    ]);
    // The half an operator can see: the view icons, in the focused pane only.
    // `visibleTabs` never returns an empty bar, so this overlay is not a
    // signal that can silently become nothing.
    const focused = focusedPane();
    expect(focused?.querySelectorAll('[data-view]').length).toBeGreaterThan(0);
    const other = splitPanes().find((pane) => pane !== focused);
    expect(other?.querySelectorAll('[data-view]')).toHaveLength(0);
  });
});
