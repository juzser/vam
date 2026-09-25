// @vitest-environment happy-dom

/**
 * THE OTHER HALF of what `Canvas.sidebar-keystroke-scaling.test.tsx` already
 * proves for `SessionList` -- but `DetailPanel` starts from a WORSE place.
 * `SessionList` was already a plain function receiving unstable props;
 * `DetailPanel` was that AND its export was not even wrapped in `memo()`
 * (`src/renderer/panels/DetailPanel.tsx:3696` at HEAD `319afed9` reads
 * `export function DetailPanel(props: DetailPanelProps) {`), and the props
 * object Canvas built for it (`buildDetailProps`) was rebuilt fresh, inline,
 * on every render of `renderLeaf` -- so wrapping the export alone would have
 * bought nothing (a fresh props object every render still reads as "props
 * changed" to `memo()`), and stabilising the props alone would also have
 * bought nothing (an unmemoized export re-renders regardless of what its
 * props look like).
 *
 * TWO INSTRUMENTS, BECAUSE ONE CANNOT DO THE JOB ALONE. Instrument one is an
 * EXPORT-SHAPE GUARD, and it runs first: the render-count technique below
 * reads `(actual.DetailPanel as unknown as { type: ... }).type` to get back
 * the unwrapped function `memo()` closes over, the same technique
 * `Canvas.sidebar-keystroke-scaling.test.tsx` already uses for
 * `SessionList`. At HEAD that `.type` is `undefined` (the export is a plain
 * function, not a `memo()` object), and calling `undefined` as a component
 * throws a TypeError from inside a render rather than printing any count at
 * all -- so this file asserts the export's shape directly, BEFORE any
 * render, so a regression here fails with a readable message instead of an
 * opaque throw.
 *
 * Instrument two is a PER-PANE render count, keyed on `props.entry.session.id`
 * -- there is no `paneId` prop (`buildDetailProps`'s returned object carries
 * 32 top-level keys, none of them `paneId`; the nearest is the boolean
 * `paneFocused`, and `entry` is typed `SessionEntry | null`, read
 * null-tolerantly below). A SHARED counter cannot express this criterion:
 * `DetailPanel` draws its own composer, so the pane being typed into
 * legitimately re-renders once for that keystroke (see the `TurnBlock`
 * memo's own comment at `DetailPanel.tsx:3102`), and a shared counter would
 * read at least 1 even with a perfect fix. What has to stay at zero is the
 * OTHER pane's count.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { memo, type ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';
import type { DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

const renderCounts = vi.hoisted(() => ({ byPane: new Map<string, number>() }));

vi.mock('../../src/renderer/panels/DetailPanel.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/renderer/panels/DetailPanel.js')>();
  const rawDetailPanel = (
    actual.DetailPanel as unknown as { type: (props: DetailPanelProps) => ReactNode }
  ).type;
  const Wrapped = memo((props: DetailPanelProps) => {
    const key = props.entry?.session.id ?? '(none)';
    renderCounts.byPane.set(key, (renderCounts.byPane.get(key) ?? 0) + 1);
    return rawDetailPanel(props);
  });
  return { ...actual, DetailPanel: Wrapped };
});

function decision(id: string, over: Partial<Decision> = {}): Decision {
  return { id, label: id, input: `in-${id}`, output: `out-${id}`, commands: [], ...over };
}

function session(id: string): Session {
  return {
    id,
    title: id,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [decision(`d-${id}-1`), decision(`d-${id}-2`)],
  };
}

/** One project, two sessions -- the same shape `Canvas.split.test.tsx` uses
 *  for its "two panes, two different sessions, no leak between them" case. */
const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1'), session('a2')] },
  ],
};

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function pressChord(prefix: string, key: string) {
  press(prefix);
  press(key);
}

const splitPanes = () => [...document.querySelectorAll('[data-split-pane]')];
const sidebarRow = (at: number) =>
  [...document.querySelectorAll('[data-session-row]')][at] as HTMLElement;
const promptInputIn = (paneEl: Element | null) =>
  paneEl?.querySelector<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]') ?? null;

describe('DetailPanel export shape (instrument one)', () => {
  it('is a memo() object at HEAD of this diff -- `.type` gives back a function', async () => {
    const actual = await vi.importActual<typeof import('../../src/renderer/panels/DetailPanel.js')>(
      '../../src/renderer/panels/DetailPanel.js',
    );
    expect(typeof (actual.DetailPanel as unknown as { type: unknown }).type).toBe('function');
  });
});

describe('a composer keystroke in one split pane against the DetailPanel of another', () => {
  it('re-renders the pane typed into and none of the others', () => {
    render(<Canvas model={MODEL} />);
    // pane-1 starts holding a1 (focus lands there on mount, first entry).
    // Open a2 in pane-1 too, then split -- `zv` takes the FRONT tab (a2) to
    // a new pane and leaves a1 behind, the same sequence
    // `Canvas.split.test.tsx`'s per-pane-isolation case uses. The SPLIT also
    // focuses the new pane (a2), so it -- not a1 -- is typed into first:
    // `onDraftChange` moves focus to whichever pane the operator typed into
    // when it was not already focused (real product behaviour: the strip's
    // pointer path already focuses a pane before typing reaches it), and
    // typing into the UNFOCUSED pane here would flip `isFocused` on BOTH
    // panes -- a genuine prop change this criterion is not about.
    act(() => sidebarRow(1).click());
    pressChord('z', 'v');
    const [first, second] = splitPanes();
    const firstInput = promptInputIn(first as Element) as HTMLTextAreaElement; // a1
    const secondInput = promptInputIn(second as Element) as HTMLTextAreaElement; // a2, focused
    expect(firstInput).not.toBeNull();
    expect(secondInput).not.toBeNull();

    // Reset AFTER the mount's own (legitimate) renders, so only the
    // keystroke's renders are counted.
    renderCounts.byPane.clear();
    act(() => {
      fireEvent.change(secondInput, { target: { value: 'y' } });
    });
    expect(renderCounts.byPane.get('a1') ?? 0).toBe(0);
    expect(renderCounts.byPane.get('a2') ?? 0).toBeGreaterThanOrEqual(1);

    // Swap roles WITHOUT typing into the unfocused pane: `zw` moves the
    // keyboard the same way the operator's own chord does, so a1 becomes
    // focused and a2's `isFocused` flip (a genuine prop change) happens
    // OUTSIDE the keystroke this test measures next.
    pressChord('z', 'w');
    renderCounts.byPane.clear();
    act(() => {
      fireEvent.change(firstInput, { target: { value: 'x' } });
    });
    expect(renderCounts.byPane.get('a2') ?? 0).toBe(0);
    expect(renderCounts.byPane.get('a1') ?? 0).toBeGreaterThanOrEqual(1);

    // AND the characters typed into each pane actually reached that pane's
    // own composer -- a memo that never recomputes would pass the render
    // count above while showing a stale composer, which is worse than the
    // finding this task closes.
    expect(firstInput.value).toBe('x');
    expect(secondInput.value).toBe('y');
  });
});
