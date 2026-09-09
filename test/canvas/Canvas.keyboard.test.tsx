// @vitest-environment happy-dom

/**
 * The end-to-end keyboard test.
 *
 * Everything under it is unit-tested in isolation — the chord grammar, the
 * prefs it writes through. This is the one that proves they are wired to each
 * other and to a real keydown. docs/design/canvas-layout.md calls keyboard
 * control vam's single most important condition, and a condition nothing
 * exercises end to end is a condition nobody is checking.
 *
 * The shape it asserts is the three-column one: `j`/`k` walk sessions (rows),
 * `h`/`l` walk the open tab strip (0.2 migration step 2 — see
 * `Canvas.tab-cycle.test.tsx` for that binding pinned in isolation), and the
 * sidebar, tab strip and detail panel all follow the same single focus.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmithApiError, type SmithClient } from '../../src/renderer/adapter/client.js';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';
import { DEFAULT_PANES, SIDEBAR_MAX, SIDEBAR_MIN } from '../../src/renderer/prefs/panes.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

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
    decisions: [],
    ...over,
  };
}

/**
 * Every session is `done`, so the status ranking cannot reorder them and the
 * list is exactly source order: a1, a2, b1. A test that also needed to assert
 * the ranking would say so with its own model rather than making every other
 * test reason about it.
 *
 * Decisions are newest-first, so a1's chain draws d-old then d-new.
 */
const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'factory',
      sessions: [
        session('a1', { decisions: [decision('d-new'), decision('d-old')] }),
        session('a2', { decisions: [decision('e1')] }),
      ],
    },
    {
      id: 'p2',
      name: 'beta',
      source: 'orca',
      sessions: [
        session('b1', {
          decisions: [
            decision('gate', {
              commands: [{ id: 'c1', label: 'sign', command: 'smith plan sign plan-v2.json' }],
            }),
          ],
        }),
      ],
    },
  ],
};

/**
 * No projects at all — the state every "a session must be focused" branch has to
 * answer for, and the one a fixture full of sessions can never reach.
 */
const EMPTY: CanvasModel = { projects: [] };

/**
 * Which session the keyboard is on, as `project/session`.
 *
 * Read off the DETAIL PANE'S HEADER, not the status bar: the footer's
 * `project/session` cell was removed at the operator's request (the slash read
 * as a git ref). The header names the same session — it is the one the prompt
 * box writes to — and, unlike the canvas card's focus ring, it stays put while
 * `h`/`l` walk that session's chain. What these tests assert — where focus
 * moved — is unchanged.
 */
/**
 * A12.2 removed `[data-prompt-target]`/`[data-prompt-project]` along with
 * the rest of `DetailPanel`'s header — the tab now carries the session's
 * name, and nothing in this pane carries the project's. Both halves of
 * "which session has the keyboard" are read off the SIDEBAR instead, which
 * this change does not touch: `[data-row-cursor]` marks the focused row
 * (unconditionally, own hook, unrelated to the detail pane), and its
 * project is found by walking up to the `[data-project-rows]` container
 * that groups it and reading the matching heading's own name span (the
 * heading also carries a bare session count with no separator, hence
 * `span.truncate` rather than the heading's whole `textContent`).
 */
const focusedRow = () =>
  document.querySelector('[data-row-cursor]')?.closest('[data-session-row]') ?? null;
const focused = () => {
  const row = focusedRow();
  const title = row?.querySelector('[data-row-title]')?.textContent ?? '';
  if (title === '' || title === 'No session selected') return '';
  const projectId = row?.closest('[data-project-rows]')?.getAttribute('data-project-rows') ?? '';
  const heading = document.querySelector(`[data-project-heading][data-project-id="${projectId}"]`);
  const project = heading?.querySelector('span.truncate')?.textContent ?? '';
  return `${project}/${title}`;
};
const mode = () => document.querySelector('[data-mode]')?.textContent ?? '';
const promptTarget = () => focusedRow()?.querySelector('[data-row-title]')?.textContent ?? '';
/**
 * The full `in` or `out` text of the turn THE PANE IS MARKING.
 *
 * The pane draws the whole session as a column now, oldest first, so an
 * unqualified `[data-detail-block="in"]` is the OLDEST turn's prompt whatever
 * the panel is reading -- which is exactly the substitution the cases below
 * exist to catch, arriving in the assertion instead of in the code.
 */
const detailBlock = (which: 'in' | 'out') =>
  document.querySelector(
    `[data-column-turn][data-turn-current="true"] [data-detail-block="${which}"]`,
  )?.textContent ?? '';
// Named hooks, not positional ones: a row carries a close button of its own and
// an icon picker, so `li button` stopped meaning "a session" the moment the row
// grew controls.
const rows = () => [...document.querySelectorAll('[data-session-row]')];
const headings = () =>
  [...document.querySelectorAll('[data-project-heading]')].map((el) => el.textContent ?? '');
const rowText = (id: string) =>
  document.querySelector(`[data-session-row="${id}"]`)?.textContent ?? '';
/** What the canvas root node draws for a session -- the one icon display left. */
const nodeIcon = (id: string) =>
  document.querySelector(`[data-session-icon="${id}"]`)?.textContent ?? null;
// A <textarea>, not an <input>: the composer is multiline, so a prompt is
// prose rather than the tail of one line.
const promptInput = () =>
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');
const filterInput = () =>
  document.querySelector<HTMLInputElement>('input[aria-label="filter sessions"]');
const renameInput = () =>
  document.querySelector<HTMLInputElement>('input[aria-label="rename session"]');
/** Whether `I` has handed the keyboard to the right pane. */
const iconPicker = () => document.querySelector('[data-icon-picker]');
/** The status bar's own text. The header badge carries the same words in demo
 *  mode, so a bare text query cannot tell "it refused" from "it is a demo". */
const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
/** The status cell shows a shortened message and carries the whole one on its
 *  tooltip, so an assertion about the tail of a message reads THIS, not the
 *  bar's visible text. See `StatusCell` in `Canvas.tsx`. */
const statusFull = () =>
  document.querySelector('[data-status-bar] [data-status]')?.getAttribute('data-note') ?? '';

const actionPane = () =>
  document.querySelector('[data-action-pane]')?.getAttribute('data-action-pane') ?? '';
// The sidebar renders first among the two resizable `<aside>`s.
const sidebarAside = () => document.querySelectorAll('aside')[0] as HTMLElement | undefined;
// A12.1: the width now lives on `[data-detail-pane]`, the wrapper that also
// holds the tab strip — `DetailPanel`'s own root (`[data-action-pane]`) is
// handed `width={undefined}` and fills it via `w-full`, so it carries no
// inline width of its own any more.
const detailAside = () => document.querySelector<HTMLElement>('[data-detail-pane]') ?? undefined;
const width = (el: HTMLElement | undefined) => Number.parseFloat(el?.style.width ?? 'NaN');

/**
 * A real keydown on the window, flushed.
 *
 * `act` is not ceremony here: the listener is a plain DOM one, so React has no
 * idea a render is coming and the assertion would read the previous frame.
 */
function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

// The native setter has to come from the element's OWN prototype: React tracks
// the last value it wrote, and going through the wrong prototype's descriptor
// throws rather than firing a change the component can see.
function typeInto(input: HTMLInputElement | HTMLTextAreaElement, text: string) {
  act(() => {
    const proto =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set as (
      this: HTMLElement,
      v: string,
    ) => void;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/**
 * A keydown whose effect is asynchronous, flushed.
 *
 * Copying is one: it now AWAITS the clipboard and reports what actually
 * happened, so the status bar is written a microtask later than the keypress.
 * `test/canvas/Canvas.clipboard.test.tsx` is where that outcome is asserted in
 * both directions; here it only has to be waited for.
 */
async function pressAsync(key: string) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

/** A clipboard that accepts. Neither happy-dom nor the browser build has one. */
function stubClipboard() {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => {} },
  });
}

function keyOn(element: Element, key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

beforeAll(() => {
  // ReactFlow measures with APIs happy-dom does not implement. The nodes carry
  // explicit width/height, so navigation does not depend on what these return —
  // they only need to exist so the renderer does not throw.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
  // `localStorage` itself is installed for every test file by
  // test/support/storage.ts, regardless of Node version.
});

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  // Canvas now reads localStorage on mount. A pin or an icon left by one test
  // would silently place a node — or draw an emoji — in the next.
  localStorage.clear();
});

/**
 * RETIRED: `'gives the right pane an icon AND the word, and its own scroll
 * per region'` pinned the OLD three-fixed-height-pane layout — `in`,
 * `progress` and `out` each with their own `flex-none`/`flex-1` share of
 * the pane and, once `progress` was toggled open, their own
 * `overflow-y-auto` scroller. A12.2 removes that layout outright: the three
 * are one merged, continuously scrolling column now
 * (`[data-detail-column]`), with no per-region scroller and no toggle to
 * open. That shape is covered at length in `test/panels/DetailPanel.test.tsx`
 * (`describe('`in` still caps its own text, inside one merged scrolling
 * column (A12.2)', ...)` and `describe('the progress region is a single
 * step, not a list of rows (A12.2)', ...)`) — unit-level, not through a full
 * `<Canvas>` render, which is the right place for CSS-class-shaped
 * assertions like these. What is still worth pinning HERE, through the real
 * mount, is that the labelled glyphs survive the trip through `Canvas.tsx`'s
 * own props at all — kept below.
 */
describe('in, progress and out are labelled through the real Canvas mount', () => {
  it('gives the pane an icon AND the word for all three regions', () => {
    render(<Canvas model={MODEL} />);
    const inBlock = document.querySelector('[data-detail-block="in"]');
    const outBlock = document.querySelector('[data-detail-block="out"]');
    const progress = document.querySelector('[data-detail-block="progress"]');
    expect(inBlock?.textContent).toContain('in');
    expect(outBlock?.textContent).toContain('out');
    expect(progress?.textContent).toContain('progress');
    // The one shared scroll column, mounted and reachable through Canvas.
    expect(document.querySelector('[data-detail-column]')).not.toBeNull();
  });
});

/**
 * 0.2 migration, step 2: three describe blocks died here —
 * `'gives the step node icons only, with the word kept for screen readers'`
 * (a step card's own `role="img"` labels — `StepNode` is deleted),
 * `'a canvas card is clickable, and a click focuses that session'`, and
 * `'the focused node says so with an indicator, not a word'`
 * (`[data-focus-indicator]`/`.vam-focus-glow` were `SessionInfoNode`'s own
 * decoration, also deleted).
 *
 * The click-to-focus property is re-pointed, not lost — every session used to
 * be a clickable graph card whether or not it had a tab open, so the
 * narrower thing a tab click can still prove (focus moves among ALREADY-OPEN
 * tabs the same way) is pinned in `Canvas.tab-strip.test.tsx`'s "clicking a
 * tab moves focus to it". The other two have no shell analogue: the sidebar
 * row's own focused styling is a pre-existing, unrelated mechanism this
 * migration did not touch, and there is no shell surface left that shows a
 * step's own speaker (`in`/`out` remain, on the pane, pinned above).
 */

describe('walking sessions with j and k', () => {
  it('starts on the first session in the list', () => {
    render(<Canvas model={MODEL} />);
    expect(focused()).toBe('alpha/a1');
  });

  it('j walks the sidebar in order, one session at a time', () => {
    // The sidebar lists a1, a2, b1 — project-major. `j` follows THAT, not the
    // grid: the grid puts b1 physically below a1 (a2 is in the other column),
    // so geometry-order used to jump straight from alpha into beta and skip a2
    // entirely. The list is how sessions are enumerated, so it is what "next
    // session" means. Crossing into another project happens where the list
    // crosses, not where the columns wrap.
    render(<Canvas model={MODEL} />);
    press('j');
    expect(focused()).toBe('alpha/a2');
    press('j');
    expect(focused()).toBe('beta/b1');
    press('j'); // the ends do not wrap
    expect(focused()).toBe('beta/b1');
  });

  it('k comes back', () => {
    render(<Canvas model={MODEL} />);
    press('j');
    press('k');
    expect(focused()).toBe('alpha/a1');
  });

  it('stops at the ends instead of wrapping', () => {
    render(<Canvas model={MODEL} />);
    press('k');
    expect(focused()).toBe('alpha/a1');
    expect(screen.getByText(/nothing lies/)).toBeTruthy();
  });
});

/**
 * 0.2 migration, step 2: `describe('walking a session's chain with h and l',
 * ...)` died here — all four tests read `detailStep()`/`focused()` against a
 * per-session chain of graph step cards (`nextNode`, deleted with the
 * geometry it walked). `h`/`l` are re-homed to previous/next open tab in the
 * SAME commit as this deletion — see `Canvas.tab-cycle.test.tsx` for that
 * binding pinned on its own terms, including the wrap these four tests never
 * exercised (the graph's chain did not wrap).
 */

/**
 * THE PANE'S OWN VERSION OF THE FOLLOW-UP DEFECT `transcript.ts` fixes.
 *
 * 0.2 migration, step 2: re-pointed, not deleted. It used to click a graph
 * step card (`[data-step-input]`, `stepNodeId(sessionId, decision.id)` in
 * the deleted `layout.ts`); the pane's own turn picker
 * (`[data-progress-jump]`, `DetailPanel.tsx` — a single `<select>` since
 * A12.2, formerly a list of `data-progress-select` rows) is driven by the
 * same content-derived `decision.id` (`transcript.ts`'s `turnFingerprint`),
 * so the defect class is identical: a poll that adds a new turn must not
 * swap the content under a cursor an operator left on an OLDER one just
 * because that turn's position in the list moved. This is what proves that
 * end to end, through the real `<Canvas>` render and the real detail panel
 * it drives.
 */
describe('a focused turn keeps its own content across a model refresh', () => {
  const selectTurnByLabel = (label: string) => {
    const select = document.querySelector<HTMLSelectElement>('[data-progress-jump]');
    const option = [...(select?.querySelectorAll('option') ?? [])].find((o) =>
      o.textContent?.includes(label),
    ) as HTMLOptionElement | undefined;
    if (select === null || option === undefined) throw new Error(`no "${label}" turn to pick`);
    act(() => fireEvent.change(select, { target: { value: option.value } }));
  };

  it('does not let a newly arrived turn swap the content under a focused older one', () => {
    // THREE turns, all visible (`VISIBLE_DECISION_COUNT`) -- the fourth below
    // is what pushes `turnB` from slot 1 to slot 0 while it stays on screen
    // the whole time. A fixture with only two or three turns total never
    // moves anything between slots, so it would pass even against a pane
    // that focused by SLOT rather than by turn -- this shape is the one that
    // actually exercises the difference.
    const turnA = decision('sess:fp-aaa:0', {
      label: 'oldest',
      input: 'ask 0',
      output: 'answer 0',
    });
    const turnB = decision('sess:fp-bbb:0', {
      label: 'middle',
      input: 'ask 1',
      output: 'answer 1',
    });
    const turnC = decision('sess:fp-ccc:0', { label: 'newer', input: 'ask 2', output: 'answer 2' });
    const before: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'factory',
          sessions: [session('a1', { decisions: [turnC, turnB, turnA] })], // newest-first
        },
      ],
    };
    const { rerender } = render(<Canvas model={before} />);

    // Pick the MIDDLE turn -- slot 1 of 3 today, about to become slot 0.
    selectTurnByLabel('middle');
    expect(detailBlock('in')).toContain('ask 1');

    // The poll: a fourth turn arrives with its OWN id. `turnA` (the old
    // slot-0 occupant) falls out of the visible three; `turnB` -- still
    // selected -- slides from slot 1 into slot 0.
    const turnD = decision('sess:fp-ddd:0', {
      label: 'newest',
      input: 'ask 3',
      output: 'answer 3',
    });
    const after: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'factory',
          sessions: [session('a1', { decisions: [turnD, turnC, turnB, turnA] })],
        },
      ],
    };
    act(() => rerender(<Canvas model={after} />));

    // Still the turn that was selected, not whatever now sits in slot 1.
    expect(detailBlock('in')).toContain('ask 1');
  });
});

describe('jumps', () => {
  it('G goes to the last session and gg back to the first', () => {
    render(<Canvas model={MODEL} />);
    press('G');
    expect(focused()).toBe('beta/b1');
    press('g');
    press('g');
    expect(focused()).toBe('alpha/a1');
  });

  it('gt steps to the next session and stops at the end', () => {
    render(<Canvas model={MODEL} />);
    press('g');
    press('t');
    expect(focused()).toBe('alpha/a2');
    press('g');
    press('t');
    press('g');
    press('t'); // would wrap
    expect(focused()).toBe('beta/b1');
    expect(screen.getByText('last session already')).toBeTruthy();
  });

  it('gT stops at the first', () => {
    render(<Canvas model={MODEL} />);
    press('g');
    press('T');
    expect(focused()).toBe('alpha/a1');
    expect(screen.getByText('first session already')).toBeTruthy();
  });

  it('an abandoned chord moves nothing', () => {
    render(<Canvas model={MODEL} />);
    press('g');
    press('x');
    expect(focused()).toBe('alpha/a1');
  });

  it('a bare modifier keydown does not abandon a half-typed chord', () => {
    // Reaching for Cmd and thinking better of it must not eat the `g`.
    render(<Canvas model={MODEL} />);
    press('g');
    press('Meta', { metaKey: true });
    press('t');
    expect(focused()).toBe('alpha/a2');
  });

  it('f arms jump mode, and its first label lands on the first node', () => {
    render(<Canvas model={MODEL} />);
    press('j'); // move away so the jump has somewhere to come back from
    press('f');
    expect(mode()).toBe('JUMP');
    press('a');
    expect(focused()).toBe('alpha/a1');
    expect(mode()).toBe('Select');
  });

  it('Escape leaves jump mode without moving', () => {
    render(<Canvas model={MODEL} />);
    press('f');
    press('Escape');
    expect(mode()).toBe('Select');
    expect(focused()).toBe('alpha/a1');
  });
});

describe('the detail panel', () => {
  it('shows the focused step’s input and output in full', () => {
    // Queried inside the panel: the canvas card carries a clamped copy of the
    // same strings, and a query that could not tell them apart would pass while
    // the panel that exists to show them whole sat empty.
    render(<Canvas model={MODEL} />);
    expect(detailBlock('in')).toContain('in-d-new');
    expect(detailBlock('out')).toContain('out-d-new');
  });

  it('names the session it will send to, and renames on focus change', () => {
    // One input serving many sessions is the easiest possible way to send the
    // right words to the wrong agent, and here the wrong agent is another repo's.
    render(<Canvas model={MODEL} />);
    // The chip that used to sit under the composer is gone at the operator's
    // request; the pane header carries the same guarantee and this now pins it
    // there. What must stay true is that SOMETHING names the session the
    // prompt will be written to, and that it follows the focus.
    expect(promptTarget()).toBe('a1');
    press('j'); // the next row in the sidebar, still inside alpha
    expect(promptTarget()).toBe('a2');
    press('j'); // and on across the project boundary
    expect(promptTarget()).toBe('b1');
  });

  it('offers the agent’s commands when a ! is typed, and not before', () => {
    // The strip that used to draw them on every turn is gone at the operator's
    // request. The extraction behind them is untouched -- this is the same
    // list, asked for.
    render(<Canvas model={MODEL} />);
    press('G'); // beta/b1 carries a command
    expect(screen.queryByText('smith plan sign plan-v2.json')).toBeNull();
    press('i');
    typeInto(promptInput() as HTMLTextAreaElement, '!');
    expect(screen.getByText('smith plan sign plan-v2.json')).toBeTruthy();
  });

  it('says it will not run a command itself', () => {
    render(<Canvas model={MODEL} />);
    press('G');
    press('i');
    typeInto(promptInput() as HTMLTextAreaElement, '!');
    expect(screen.getByText(/vam does not run them/)).toBeTruthy();
  });

  it('yy reports what it copied', async () => {
    stubClipboard();
    render(<Canvas model={MODEL} />);
    press('G');
    press('y');
    await pressAsync('y');
    expect(screen.getByText(/copied 1 command/)).toBeTruthy();
  });

  it('yy on a step with nothing to run says so rather than copying silence', () => {
    render(<Canvas model={MODEL} />);
    press('y');
    press('y');
    expect(screen.getByText(/no command to copy/)).toBeTruthy();
  });
});

describe('the prompt box', () => {
  it('i focuses it', () => {
    render(<Canvas model={MODEL} />);
    press('i');
    expect(mode()).toBe('Insert');
  });

  it('will not write from a canvas that was given no source', () => {
    // The default source carries no client at all, so there is nothing for a
    // write to reach even by mistake. That default is the safe one on purpose:
    // the day someone forgets the prop must not be the day a test writes to a
    // real log.
    render(<Canvas model={MODEL} />);
    press('i');
    const input = promptInput() as HTMLTextAreaElement;
    typeInto(input, 'run it again');
    keyOn(input, 'Enter');
    expect(statusBar()).toContain('read-only');
  });

  it('Escape leaves it and drops the draft', () => {
    render(<Canvas model={MODEL} />);
    press('i');
    typeInto(promptInput() as HTMLTextAreaElement, 'halfway typed');
    keyOn(promptInput() as HTMLTextAreaElement, 'Escape');
    expect(mode()).toBe('Select');
    expect(promptInput()?.value).toBe('');
  });
});

describe('filtering the sidebar with /', () => {
  it('/ opens the filter in the list, and typing narrows it as you go', () => {
    render(<Canvas model={MODEL} />);
    press('/');
    expect(mode()).toBe('FILTER');
    typeInto(filterInput() as HTMLInputElement, 'beta');
    expect(rows().map((el) => el.getAttribute('data-session-row'))).toEqual(['b1']);
    expect(focused()).toBe('beta/b1');
  });

  // 0.2 migration, step 2: `'narrows the canvas with it, so nothing is drawn
  // that cannot be reached'` died here, not merely lost its selector. It
  // pinned the graph drawing exactly the filtered set — a SECOND,
  // independently-computed rendering of "everything the filter left" that
  // could (and once did) disagree with the sidebar's own list. The tab strip
  // that replaced that column draws `openTabEntries` — the open-tab set,
  // curated by the operator — never a re-derivation of the filtered model, so
  // there is no second view left for the filter to fail to reach. See
  // `Canvas.filter-reach.test.tsx`'s header for the general form of this.

  it('gt and gT say no session matches on an empty list, not "last session already"', () => {
    // `entries.findIndex` returns -1 for an empty list exactly as it does for
    // a missing entry, so `-1 + 1` is 0, and `0 >= 0` took the off-the-end
    // branch: `t` claimed there was a LAST session to already be at while the
    // list held none. The `hjkl` path one branch away already says the true
    // thing for the same state, and this is that sentence.
    render(<Canvas model={MODEL} />);
    press('/');
    typeInto(filterInput() as HTMLInputElement, 'zzz');
    keyOn(filterInput() as HTMLInputElement, 'Enter');
    expect(rows().map((el) => el.getAttribute('data-session-row'))).toEqual([]);

    // `gt`/`gT`, not bare `t` -- the chord lives in the AFTER_G table, which
    // the status bar's own hint spells out. A bare `t` is unbound and returns
    // before any of this, so a test pressing it would pass while proving
    // nothing about the code it names.
    press('g');
    press('t');
    expect(statusBar()).toContain('no session matches');
    press('g');
    press('T');
    expect(statusBar()).toContain('no session matches');
    press('T');
    expect(statusBar()).toContain('no session matches');
  });

  it('says so rather than showing an empty list with no reason', () => {
    render(<Canvas model={MODEL} />);
    press('/');
    typeInto(filterInput() as HTMLInputElement, 'zzz');
    expect(rows().map((el) => el.getAttribute('data-session-row'))).toEqual([]);
    expect(screen.getByText('No match')).toBeTruthy();
  });

  it('j walks only what survived the filter', () => {
    render(<Canvas model={MODEL} />);
    press('/');
    typeInto(filterInput() as HTMLInputElement, 'alpha');
    keyOn(filterInput() as HTMLInputElement, 'Enter');
    expect(mode()).toBe('Select');
    press('j');
    // a2 is the next row that survived the filter, so the walk reaches it,
    expect(focused()).toBe('alpha/a2');
    press('j');
    // and stops there: `j` walks the surviving list, not the whole model, so
    // the filtered-out b1 is not somewhere the cursor can still fall into.
    expect(focused()).toBe('alpha/a2');
    expect(screen.getByText(/nothing lies/)).toBeTruthy();
  });

  it('n keeps walking the matches after Enter closed the box', () => {
    render(<Canvas model={MODEL} />);
    press('/');
    typeInto(filterInput() as HTMLInputElement, 'alpha');
    keyOn(filterInput() as HTMLInputElement, 'Enter');
    press('n');
    expect(focused()).toBe('alpha/a2');
    press('n'); // wraps within the matches, which is what vim's n does
    expect(focused()).toBe('alpha/a1');
  });

  it('Escape drops the filter and puts focus back where it started', () => {
    render(<Canvas model={MODEL} />);
    press('j'); // alpha/a2
    press('/');
    typeInto(filterInput() as HTMLInputElement, 'beta');
    expect(focused()).toBe('beta/b1');
    keyOn(filterInput() as HTMLInputElement, 'Escape');
    expect(rows().map((el) => el.getAttribute('data-session-row'))).toEqual(['a1', 'a2', 'b1']);
    expect(focused()).toBe('alpha/a2');
  });

  it('n before anything was typed says so instead of moving', () => {
    render(<Canvas model={MODEL} />);
    press('n');
    expect(focused()).toBe('alpha/a1');
    expect(screen.getByText('nothing searched yet')).toBeTruthy();
  });
});

describe('the command palette', () => {
  it('Ctrl-K and Cmd-K both open it', () => {
    const { unmount } = render(<Canvas model={MODEL} />);
    press('k', { ctrlKey: true });
    expect(screen.getByPlaceholderText('go to session…')).toBeTruthy();
    unmount();

    render(<Canvas model={MODEL} />);
    press('k', { metaKey: true });
    expect(screen.getByPlaceholderText('go to session…')).toBeTruthy();
  });

  it('plain k still moves instead of opening the palette', () => {
    render(<Canvas model={MODEL} />);
    press('j');
    press('k');
    expect(focused()).toBe('alpha/a1');
    expect(screen.queryByPlaceholderText('go to session…')).toBeNull();
  });

  it('Escape closes it from inside, where the window listener cannot hear', () => {
    render(<Canvas model={MODEL} />);
    press('k', { ctrlKey: true });
    keyOn(screen.getByPlaceholderText('go to session…'), 'Escape');
    expect(screen.queryByPlaceholderText('go to session…')).toBeNull();
  });
});

describe('the sidebar', () => {
  it('groups the sessions under a heading per project', () => {
    render(<Canvas model={MODEL} />);
    expect(headings().some((h) => h.includes('alpha'))).toBe(true);
    expect(headings().some((h) => h.includes('beta'))).toBe(true);
  });

  it('lists every session, and one heading per project rather than per row', () => {
    render(<Canvas model={MODEL} />);
    expect(rows()).toHaveLength(3);
    expect(headings()).toHaveLength(2);
  });

  it('j never stops on a heading', () => {
    // The invariant grouping must not cost. Headings are captions, not stops:
    // three sessions means exactly two `j` presses to reach the last one, no
    // matter how many project boundaries lie between them.
    render(<Canvas model={MODEL} />);
    press('j');
    press('j');
    expect(focused()).toBe('beta/b1');
  });

  it('clicking a row moves the same focus the keyboard moves', () => {
    // One focus, three views — the sidebar does not keep a cursor of its own.
    render(<Canvas model={MODEL} />);
    act(() => {
      (rows()[2] as HTMLElement).click();
    });
    expect(focused()).toBe('beta/b1');
    expect(promptTarget()).toBe('b1');
  });

  it('keeps working with the keyboard after a click', () => {
    render(<Canvas model={MODEL} />);
    act(() => {
      (rows()[2] as HTMLElement).click();
    });
    press('k');
    // rows()[2] is b1, the last row in the sidebar; `k` walks one row back up
    // it, to a2 — the click handed the keyboard a position in the list, not
    // just a highlight.
    expect(focused()).toBe('alpha/a2');
  });

  it('offers adding a session, and says plainly that THIS source cannot', () => {
    // Creating one is real now -- a detached tmux session, see
    // `src/main/sources/tmux/` -- but only where a session source can do it.
    // This canvas is rendered on factory, which has no such route, so the
    // honest answer is that factory has no command rather than a promise
    // that one is coming. `Canvas.new-session.test.tsx` covers the source
    // that can.
    render(<Canvas model={MODEL} />);
    act(() => {
      screen.getByLabelText('new session').click();
    });
    expect(screen.getByText(/factory has no new-session command/)).toBeTruthy();
  });

  it('pins settings at the bottom, and it opens the overlay', () => {
    // It used to answer "settings not built yet". The refusal is gone from the
    // tree; the gear and `,` reach one overlay (test/canvas/Canvas.settings).
    render(<Canvas model={MODEL} />);
    act(() => {
      screen.getByLabelText('settings').click();
    });
    expect(document.querySelector('[data-settings-overlay]')).toBeTruthy();
  });
});

describe('renaming, icons and closing', () => {
  it('r opens rename on the focused row, seeded with its current name', () => {
    render(<Canvas model={MODEL} />);
    press('j'); // a2, the next row in the sidebar
    press('r');
    expect(renameInput()?.value).toBe('a2');
  });

  it('rename KEEPS the name — locally, and it wins over the row’s own title', () => {
    // This used to assert the opposite ("cannot rename a session"), which was
    // true of factory's event log and false of what the operator had just
    // typed: the editor took the name and threw it away. The override is
    // vam's own and deliberately local (`RenameChoice` in prefs.ts).
    render(<Canvas model={MODEL} />);
    press('r');
    typeInto(renameInput() as HTMLInputElement, 'new name');
    keyOn(renameInput() as HTMLInputElement, 'Enter');
    expect(renameInput()).toBeNull();
    expect(rowText('a1')).toContain('new name');
  });

  it('Escape abandons the rename without touching the row', () => {
    render(<Canvas model={MODEL} />);
    press('r');
    typeInto(renameInput() as HTMLInputElement, 'halfway typed');
    keyOn(renameInput() as HTMLInputElement, 'Escape');
    expect(renameInput()).toBeNull();
    expect(rowText('a1')).toContain('a1');
  });

  it('s opens the icon picker on the focused row, and s again closes it', () => {
    render(<Canvas model={MODEL} />);
    press('s');
    // Asserted on our own shell, not on the third-party grid inside it: the
    // picker's own buttons are labelled in English by the library, and a test
    // that queried them would be testing emoji-picker-react.
    expect(iconPicker()).toBeTruthy();
    press('s');
    expect(iconPicker()).toBeNull();
  });

  it('names the session it is picking for', () => {
    render(<Canvas model={MODEL} />);
    press('j'); // a2, the next row in the sidebar
    press('s');
    expect(iconPicker()?.textContent).toContain('a2');
  });

  it('shows an icon you chose on a previous visit', () => {
    // The read half of the store, end to end: what localStorage holds reaches
    // the canvas root node without the canvas knowing an icon is a local
    // preference. This used to read the SIDEBAR row (`rowText('a1')` contains
    // the glyph, `rowText('a2')` does not); the sidebar no longer draws a
    // session icon, so the same end-to-end path is asserted on the surface
    // that still displays it -- the assertion moved, it was not dropped.
    localStorage.setItem(
      'vam.prefs.v1',
      JSON.stringify({ icons: { a1: { icon: '🛠', at: new Date().toISOString() } } }),
    );
    render(<Canvas model={MODEL} />);
    expect(nodeIcon('a1')).toBe('🛠');
    expect(rowText('a1')).not.toContain('🛠');
  });

  it('clearing the icon says where it was kept, and forgets it', () => {
    // The write half. Picking an emoji goes through the third-party grid, which
    // loads in its own lazy chunk and is not this test's to drive; "clear icon" is
    // our own button and exercises the same path out.
    localStorage.setItem(
      'vam.prefs.v1',
      JSON.stringify({ icons: { a1: { icon: '🛠', at: new Date().toISOString() } } }),
    );
    render(<Canvas model={MODEL} />);
    press('s');
    act(() => {
      screen.getByText('clear icon').click();
    });
    // It says "on this machine", not "not saved": factory having no icon route
    // was never the point — §3 says this is per-user state that must NOT reach
    // the event log.
    expect(screen.getByText(/on this machine/)).toBeTruthy();
    expect(iconPicker()).toBeNull();
    // Also moved off the sidebar row: it asserted `rowText('a1')` no longer
    // contained the cleared glyph, and now asserts the canvas node does not.
    expect(nodeIcon('a1')).not.toBe('🛠');
    expect(JSON.parse(localStorage.getItem('vam.prefs.v1') ?? '{}').icons).toEqual({});
  });

  /**
   * The picker aims at a session in a SOURCE, and it must still know which one
   * after the model underneath it has moved on.
   *
   * A model refresh between opening the picker and picking is the one input
   * that separates carrying the target from re-deriving it. Re-deriving meant
   * `allEntries.find(e => e.session.id === id)?.project.source ?? 'factory'`
   * — and once the entry is gone that `??` fires, so a pick aimed at an ORCA
   * session silently rewrote the factory bucket instead. `b1` exists under
   * both sources here, so the wrong bucket is a real entry rather than a
   * harmless no-op, which is what makes the two directions distinguishable at
   * all.
   *
   * This is deliberately NOT written as "two sources share a session id, focus
   * the second one". That test cannot be written today: `layout.ts` keys every
   * canvas node on `session.id` alone (`infoNodeId(session.id)`, :237) and
   * `focusedEntry` is `layout.nodes.find(n => n.id === focusedId)` (Canvas.tsx
   * :243), so of two sessions sharing an id the second has no reachable node —
   * it cannot be focused, so it cannot be picked for. That collision is one
   * layer above the storage keys AC-1 re-keyed, and it is filed rather than
   * quietly fixed here.
   */
  const BOTH_SOURCES_HOLD_B1 = () =>
    localStorage.setItem(
      'vam.prefs.v1',
      JSON.stringify({
        icons: {
          factory: { b1: { icon: '🛠', at: new Date().toISOString() } },
          orca: { b1: { icon: '🐋', at: new Date().toISOString() } },
        },
      }),
    );

  /** MODEL with beta emptied — b1 gone, everything else identical. */
  const WITHOUT_B1: CanvasModel = {
    ...MODEL,
    projects: MODEL.projects.map((p) => (p.source === 'orca' ? { ...p, sessions: [] } : p)),
  };

  it("keeps aiming at orca's b1 after the model drops it mid-pick", () => {
    BOTH_SOURCES_HOLD_B1();
    const { rerender } = render(<Canvas model={MODEL} />);
    press('j');
    press('j'); // beta/b1 — the orca one, two rows down the sidebar
    expect(focused()).toBe('beta/b1');
    press('s');
    // The refresh that used to lose the source.
    act(() => rerender(<Canvas model={WITHOUT_B1} />));
    expect(iconPicker()).toBeTruthy();
    act(() => {
      screen.getByText('clear icon').click();
    });
    const stored = JSON.parse(localStorage.getItem('vam.prefs.v1') ?? '{}');
    expect(stored.icons).toEqual({
      factory: { b1: { icon: '🛠', at: expect.any(String) } },
    });
  });

  it('names the session it is picking for even after the entry is gone', () => {
    // The title came from the same lookup and fell back to the raw session id.
    const titled: CanvasModel = {
      ...MODEL,
      projects: MODEL.projects.map((p) =>
        p.source === 'orca'
          ? { ...p, sessions: p.sessions.map((x) => ({ ...x, title: 'beta work' })) }
          : p,
      ),
    };
    const { rerender } = render(<Canvas model={titled} />);
    press('j');
    press('j'); // beta/b1
    press('s');
    act(() => rerender(<Canvas model={WITHOUT_B1} />));
    expect(iconPicker()?.textContent).toContain('beta work');
  });

  it('gr does nothing — the chord grammar drops an unrecognised second key silently', () => {
    // `g` alone opens a chord; an unbound follower must abandon it without
    // touching storage or announcing anything on the status bar.
    localStorage.setItem(
      'vam.prefs.v1',
      JSON.stringify({ icons: { a1: { icon: '🛠', at: new Date().toISOString() } } }),
    );
    render(<Canvas model={MODEL} />);
    const before = statusBar();
    // Both samples taken AFTER mounting, not against the seed. Landing focus on
    // something real now records where it landed, so a launch writes once on
    // its own -- and against a legacy flat `icons` payload like the one seeded
    // above, that write is also what migrates it to the per-source shape.
    // Neither is this chord's doing. What the test is about is that `g`
    // followed by an unbound key changes NOTHING, so it brackets the two
    // presses and compares the whole store: stricter than the seed comparison
    // it replaces, which only ever looked at one key.
    const storedBefore = localStorage.getItem('vam.prefs.v1');
    press('g');
    press('r');
    expect(statusBar()).toBe(before);
    expect(localStorage.getItem('vam.prefs.v1')).toBe(storedBefore);
  });

  it('x names the session it did not close', () => {
    // The read-only refusal has to name the survivor: "closed" and "did not
    // close" must never look alike in a list you are about to act on.
    render(<Canvas model={MODEL} />);
    press('x');
    expect(screen.getByText(/"a1" is still here/)).toBeTruthy();
    expect(rows()).toHaveLength(3);
  });

  it('every row carries a close button of its own', () => {
    render(<Canvas model={MODEL} />);
    act(() => {
      screen.getByLabelText('close b1').click();
    });
    expect(screen.getByText(/"b1" is still here/)).toBeTruthy();
  });
});

describe('handing the keyboard to the right pane', () => {
  it('I moves it there and H hands it back', () => {
    render(<Canvas model={MODEL} />);
    expect(actionPane()).toBe('idle');
    press('I');
    expect(actionPane()).toBe('active');
    expect(mode()).toBe('Insert');
    press('H');
    expect(actionPane()).toBe('idle');
    expect(mode()).toBe('Select');
  });

  it('Escape also hands it back, from wherever you were', () => {
    render(<Canvas model={MODEL} />);
    press('I');
    press('Escape');
    expect(actionPane()).toBe('idle');
  });

  it('j and k walk the actions instead of the sessions while it is there', () => {
    render(<Canvas model={MODEL} />);
    press('G'); // beta/b1 — one command, so the actions are [command, prompt]
    press('I');
    press('j');
    expect(focused()).toBe('beta/b1'); // the session did not move
    press('Enter'); // past the last command is the prompt box
    expect(mode()).toBe('Insert');
  });

  it('Enter in the action pane opens the composer, the only stop left in it', async () => {
    // The command rows were the pane's other stops, and Enter on one copied
    // it. They went with the strip; the prompt is what remains.
    render(<Canvas model={MODEL} />);
    press('G');
    press('I');
    await pressAsync('Enter');
    expect(mode()).toBe('Insert');
  });

  it('h leaves the pane the same way H does', () => {
    render(<Canvas model={MODEL} />);
    press('I');
    press('h');
    expect(actionPane()).toBe('idle');
  });

  it('I with nothing focused says so instead of opening an empty pane', () => {
    render(<Canvas model={EMPTY} />);
    press('I');
    expect(actionPane()).toBe('idle');
    expect(screen.getByText('pick a session first')).toBeTruthy();
  });
});

describe('waiting on you', () => {
  const WAITING: CanvasModel = {
    projects: [
      {
        id: 'p1',
        name: 'alpha',
        source: 'factory',
        sessions: [
          session('calm'),
          session('urgent', {
            status: 'waiting',
            decisions: [decision('gate', { output: null })],
          }),
        ],
      },
    ],
  };

  it('sorts what needs you to the top of the list', () => {
    render(<Canvas model={WAITING} />);
    expect(focused()).toBe('alpha/urgent');
  });

  it('says so with the sidebar row, not with a line of prose in the pane', () => {
    render(<Canvas model={WAITING} />);
    // The operator asked for the sentence under the tab bar to go. RETIRED
    // half: "the header dot is amber and breathing" \u2014 A12.2 removed that
    // dot along with the rest of the header; the same `waiting` status is
    // still on screen, on the sidebar row itself (`STATUS_DOT`,
    // `SessionList.tsx`), which this change does not touch.
    expect(screen.queryByText('session stopped, waiting on you')).toBeNull();
    expect(document.querySelector('[data-action-pane] .vam-breathe.bg-waiting')).toBeNull();
    expect(
      document.querySelector('[data-session-row="urgent"] .vam-breathe.bg-waiting'),
    ).not.toBeNull();
  });

  it('groups it apart in the palette', () => {
    render(<Canvas model={WAITING} />);
    press('k', { ctrlKey: true });
    // Scoped to the palette's own group headings: "needs you" also appears in
    // the sidebar row, and a bare text query would pass on that while the
    // grouping was missing.
    const headings = [...document.querySelectorAll('[cmdk-group-heading]')].map(
      (el) => el.textContent,
    );
    expect(headings).toContain('needs you');
  });

  it('no longer counts it in the status bar', () => {
    render(<Canvas model={WAITING} />);
    // The tally cells are gone at the operator's request; this assertion is
    // kept as an absence rather than deleted, so a re-add fails here.
    // `test/canvas/Canvas.statusbar.test.tsx` owns the whole trimmed bar.
    expect(screen.queryByText(/1 need you/)).toBeNull();
    expect(document.querySelector('[data-status-bar]')?.textContent).not.toMatch(/need you/);
  });
});

describe('writing a prompt to a live factory', () => {
  /** A client that records what it was asked and answers however the test says. */
  function liveSource(
    recordPrompt: (sessionId: string, prompt: string) => Promise<{ eventId: string }>,
  ): { source: CanvasSource; wrote: { count: number } } {
    const wrote = { count: 0 };
    const source: CanvasSource = {
      kind: 'live',
      client: { recordPrompt } as unknown as SmithClient,
      status: 'live',
      error: null,
      onWrote: () => {
        wrote.count += 1;
      },
    };
    return { source, wrote };
  }

  async function submit(source: CanvasSource, text: string) {
    render(<Canvas model={MODEL} source={source} />);
    press('i');
    const input = promptInput() as HTMLTextAreaElement;
    typeInto(input, text);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
  }

  it('sends the focused session’s id, not whichever row was clicked last', async () => {
    const calls: { sessionId: string; prompt: string }[] = [];
    const { source } = liveSource(async (sessionId, prompt) => {
      calls.push({ sessionId, prompt });
      return { eventId: 'e1' };
    });
    await submit(source, 'run task-4 again');
    expect(calls).toEqual([{ sessionId: 'a1', prompt: 'run task-4 again' }]);
  });

  it('says it RECORDED, never that it sent', async () => {
    // factory has no channel into a running agent session. A prompt box
    // claiming to have sent would leave you waiting for an answer nobody is
    // coming to give.
    const { source } = liveSource(async () => ({ eventId: 'e1' }));
    await submit(source, 'hello');
    expect(statusBar()).toContain('recorded');
    expect(statusBar()).toContain('not sent to the agent');
  });

  it('clears the box and asks for a refresh once the write lands', async () => {
    const { source, wrote } = liveSource(async () => ({ eventId: 'e1' }));
    await submit(source, 'hello');
    expect(promptInput()?.value).toBe('');
    expect(wrote.count).toBe(1);
  });

  it('reports a refusal in the factory’s own words', async () => {
    const { source, wrote } = liveSource(async () => {
      throw new SmithApiError('events.unknown-causal-session', 'No log for session "a1".', 409);
    });
    await submit(source, 'hello');
    expect(statusBar()).toContain('events.unknown-causal-session');
    expect(statusBar()).toContain('No log for session');
    // Nothing was written, so nothing is refreshed and the draft is kept — you
    // should not have to retype what the server just rejected.
    expect(wrote.count).toBe(0);
    expect(promptInput()?.value).toBe('hello');
  });

  it('does not write an empty prompt', async () => {
    let called = 0;
    const { source } = liveSource(async () => {
      called += 1;
      return { eventId: 'e1' };
    });
    await submit(source, '   ');
    expect(called).toBe(0);
  });

  it('names the server on the header, so a disconnected canvas cannot look connected', () => {
    render(
      <Canvas
        model={MODEL}
        source={{
          kind: 'live',
          client: {} as unknown as SmithClient,
          status: 'error',
          error: 'cannot reach factory at http://127.0.0.1:4680',
          onWrote: () => {},
        }}
      />,
    );
    expect(document.querySelector('[data-source]')?.textContent).toContain('cannot reach factory');
  });
});

describe('writing a prompt to a "session" source (the desktop shell)', () => {
  /**
   * A `SessionSource` fixture whose `write` member is present or absent
   * exactly as the port's own invariant requires: `recordPrompt: false` means
   * `write` is never even assigned, not assigned-and-throwing. A fake that
   * always carried `write` would let `canWriteTo`'s absence check pass this
   * suite by accident.
   */
  function fakeSessionSource(
    over: { deliverPrompt?: boolean; recordPrompt?: boolean } = {},
    recordPrompt: (sessionId: string, prompt: string) => Promise<void> = async () => {},
  ): { source: CanvasSource; wrote: { count: number } } {
    const recordPromptFlag = over.recordPrompt ?? true;
    const wrote = { count: 0 };
    const sessionSource = {
      id: 'claude-code',
      label: 'Claude Code',
      capabilities: {
        liveUpdates: false,
        recordPrompt: recordPromptFlag,
        deliverPrompt: over.deliverPrompt ?? false,
        promptAttachments: false,
        slashCommands: false,
        renameSession: false,
        closeSession: false,
        createSession: false,
        governance: false,
        pullRequests: false,
        terminal: false,
        agentRoster: false,
      },
      declines: {},
      viewerScope: { kind: 'connection', note: 'one local process' },
      load: async () => [],
      // Assigned member-by-member, exactly like `preload-factory.ts` does:
      // `write` exists only when `recordPrompt` is true, never as a stub.
      ...(recordPromptFlag ? { write: { recordPrompt } } : {}),
    };
    const source: CanvasSource = {
      kind: 'session',
      // `write` is genuinely optional on `SessionSource`, so no `any` is
      // needed -- the cast is only for the literal's `viewerScope.kind`,
      // which TS otherwise widens to `string`.
      source: sessionSource as SessionSource,
      onWrote: () => {
        wrote.count += 1;
      },
    };
    return { source, wrote };
  }

  async function submit(source: CanvasSource, text: string) {
    render(<Canvas model={MODEL} source={source} />);
    press('i');
    const input = promptInput() as HTMLTextAreaElement;
    typeInto(input, text);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
  }

  it('shows the composer busy while the write is still in flight, and again when it lands', async () => {
    // The `sending` prop's WIRING, not the pane's rendering of it. The pane's
    // own tests pass whether or not `Canvas` ever passes the flag -- which is
    // exactly how `delivers` sat unwired behind a green suite until someone
    // read the comment admitting it. This asserts through `<Canvas>`.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { source } = fakeSessionSource({ deliverPrompt: true }, async () => {
      await gate;
    });

    render(<Canvas model={MODEL} source={source} />);
    press('i');
    const input = promptInput() as HTMLTextAreaElement;
    typeInto(input, 'run task-4 again');
    // Deliberately NOT awaited: the write is left in flight.
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    const control = () => document.querySelector('[data-prompt-record]');
    expect(control()?.getAttribute('aria-busy')).toBe('true');
    expect(control()?.getAttribute('aria-label')).toMatch(/sending/i);

    await act(async () => {
      release();
      await gate;
    });
    expect(control()?.getAttribute('aria-busy')).toBe('false');
  });

  it('says SENT, not recorded, once the source delivers into the running session', async () => {
    const calls: { sessionId: string; prompt: string }[] = [];
    const { source } = fakeSessionSource({ deliverPrompt: true }, async (sessionId, prompt) => {
      calls.push({ sessionId, prompt });
    });
    await submit(source, 'run task-4 again');
    expect(calls).toEqual([{ sessionId: 'a1', prompt: 'run task-4 again' }]);
    expect(statusBar()).toContain('sent into the running session');
    expect(statusBar()).not.toContain('recorded');
  });

  it('says RECORDED when the source only records, not delivers', async () => {
    const calls: { sessionId: string; prompt: string }[] = [];
    const { source, wrote } = fakeSessionSource(
      { deliverPrompt: false },
      async (sessionId, prompt) => {
        calls.push({ sessionId, prompt });
      },
    );
    await submit(source, 'hello');
    expect(calls).toEqual([{ sessionId: 'a1', prompt: 'hello' }]);
    expect(statusBar()).toContain('recorded, not sent to the agent');
    // Both directions, so the two outcomes cannot collapse into one wording
    // that happens to contain the word the assertion looked for.
    expect(statusBar()).not.toContain('sent into the running session');
    expect(statusBar()).not.toContain('sent into the running session');
    expect(wrote.count).toBe(1);
  });

  it('refuses without calling anything when recordPrompt is false — the guard is real', async () => {
    let called = 0;
    const { source, wrote } = fakeSessionSource({ recordPrompt: false }, async () => {
      called += 1;
    });
    await submit(source, 'hello');
    expect(called).toBe(0);
    expect(wrote.count).toBe(0);
    expect(statusBar()).toContain('Claude Code');
    expect(statusBar()).toContain('cannot be written to');
    // Nothing was sent, so the operator's words are still on screen.
    expect(promptInput()?.value).toBe('hello');
  });

  it('leaves the draft intact and reports the refusal the preload actually throws', async () => {
    // The preload rethrows the main process's `SourceError` verbatim -- a plain
    // object, never an `Error` (`src/preload/api.ts`, `throw result.error`).
    // A test that rejected with `new Error(...)` exercised a branch the real
    // desktop path never reaches, and left `[object Object]` on screen.
    const { source, wrote } = fakeSessionSource({ deliverPrompt: true }, async () => {
      throw {
        kind: 'refused',
        code: 'session-running',
        message:
          'session a1 is running, so Claude Code will not resume it here. Run `claude attach` to type into it.',
      };
    });
    await submit(source, 'hello');
    // The code leads, so it survives the cell's truncation; the remedy is in
    // the sentence that follows and is reachable on the tooltip.
    expect(statusBar()).toContain('session-running: session a1 is running');
    expect(statusFull()).toContain('claude attach');
    expect(statusBar()).not.toContain('[object Object]');
    expect(statusFull()).not.toContain('[object Object]');
    expect(wrote.count).toBe(0);
    expect(promptInput()?.value).toBe('hello');
  });

  it('still reports a real `Error`’s message, and something that is neither', async () => {
    const { source } = fakeSessionSource({ deliverPrompt: false }, async () => {
      throw new Error('resume failed: no such session');
    });
    await submit(source, 'hello');
    expect(statusBar()).toContain('resume failed: no such session');
    cleanup();

    const { source: odd } = fakeSessionSource({ deliverPrompt: false }, async () => {
      throw 'the preload vanished';
    });
    await submit(odd, 'hello');
    expect(statusBar()).toContain('the preload vanished');
  });

  it('threads `deliverPrompt` into the detail panel’s composer wording', async () => {
    const claim = () =>
      document.querySelector('[data-prompt-record]')?.getAttribute('aria-label')?.toLowerCase() ??
      '';

    const { source: sending } = fakeSessionSource({ deliverPrompt: true });
    render(<Canvas model={MODEL} source={sending} />);
    press('i');
    expect(claim()).toContain('send');
    cleanup();

    const { source: recording } = fakeSessionSource({ deliverPrompt: false });
    render(<Canvas model={MODEL} source={recording} />);
    press('i');
    expect(claim()).toContain('record');
  });
});

/*
 * The review-queue keyboard tests stood here.
 *
 * factory's governance queue was removed from the detail pane at the
 * operator's request. It was left in the action list, so `I` → `j`/`k` → Enter
 * went on reaching rows nothing drew and POSTing waivers and lesson
 * transitions to the factory unseen; `ReviewQueue`, `useReviewQueue` and their
 * tests were kept "in case", which is what made the half-removal survive. The
 * queue is now gone from `buildActions` and from the tree, and
 * test/panels/action-parity.test.tsx asserts the invariant that was missing:
 * the action list and the pane are the same list.
 */

/*
 * Five graph-only describe blocks stood here, all reading
 * `.react-flow__node` directly: `AC-10(d): the canvas re-derives from a
 * fresh layout on every render` (node position after a re-rank), `undrag: a
 * rendered node carries no pointer-interaction class`, `scenery nodes: no
 * tab stop, no drag, no select` (fan/slot node attributes off `layoutCanvas`,
 * deleted with it), `the focused cell renders at full opacity, and the
 * override moves with the cursor` (a node's own `style.opacity`), and `the
 * fan and its slots, rendered end to end through <Canvas>` (the fan SVG and
 * its dashed step-slot placeholders).
 *
 * None had a shell-side property to re-point to: dragging, per-node opacity
 * override, node tab-stop/role/select attributes, and the fan-and-slots
 * visualisation itself were all geometry, deleted with `layoutCanvas`,
 * `SessionFanNode` and `StepSlotNode` in this same commit. 0.2 migration,
 * step 2.
 */

describe('resizing the panes from the keyboard (AC-5d, AC-5e)', () => {
  // A wide viewport, so both DEFAULT_PANES fit under dragCeiling without the
  // narrow-viewport rule (epic.md §4.2 point 4) already clamping the render —
  // that rule is task-1's own AC-2(b) and is not what this suite is testing.
  const realInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
  });
  afterEach(() => {
    if (realInnerWidth) {
      Object.defineProperty(window, 'innerWidth', realInnerWidth);
    }
  });

  it('< narrows the sidebar (default focus) by 24px, > widens it, and both clamp at the bounds', () => {
    render(<Canvas model={MODEL} />);
    expect(width(sidebarAside())).toBe(DEFAULT_PANES.sidebar);

    press('<');
    // Non-vacuity: the press actually changed the width.
    expect(width(sidebarAside())).toBe(DEFAULT_PANES.sidebar - 24);

    press('>');
    press('>');
    expect(width(sidebarAside())).toBe(DEFAULT_PANES.sidebar + 24);

    // Drive it down past MIN — it must stop at MIN, not run past or go negative.
    for (let i = 0; i < 20; i++) {
      press('<');
    }
    expect(width(sidebarAside())).toBe(SIDEBAR_MIN);
    press('<');
    expect(width(sidebarAside())).toBe(SIDEBAR_MIN); // still at the bound, not below it

    // And up past MAX — it must stop at MAX.
    for (let i = 0; i < 40; i++) {
      press('>');
    }
    expect(width(sidebarAside())).toBe(SIDEBAR_MAX);
  });

  /**
   * A12.1: the detail pane has no stored width of its own any more — it
   * fills everything to the sidebar's right (`panes.ts`) — so once `I` has
   * moved the keyboard there, `<`/`>` still move the ONE real seam, the
   * sidebar's, approached from the other side: "narrow the pane I am in"
   * (`<`, meaning the detail pane) is "grow the sidebar", and the sign
   * flips relative to Select. This replaces the old
   * "leaving the sidebar untouched" claim, which described a detail pane
   * that no longer exists.
   */
  it('resizes the sidebar from Insert too, with the sign flipped', () => {
    render(<Canvas model={MODEL} />);
    press('I'); // focuses the action pane — pane === 'action'
    expect(actionPane()).toBe('active');

    press('<');
    expect(width(sidebarAside())).toBe(DEFAULT_PANES.sidebar + 24);
    // The detail pane is exactly what the sidebar leaves — it shrinks in
    // lock-step, never independently.
    expect(width(detailAside())).toBe(1600 - (DEFAULT_PANES.sidebar + 24));

    press('>');
    press('>');
    expect(width(sidebarAside())).toBe(DEFAULT_PANES.sidebar - 24);
    expect(width(detailAside())).toBe(1600 - (DEFAULT_PANES.sidebar - 24));

    // Also prove the sidebar still clamps at its own MAX, reached from
    // Insert's `<` (which grows it).
    for (let i = 0; i < 20; i++) {
      press('<');
    }
    expect(width(sidebarAside())).toBe(SIDEBAR_MAX);
  });

  /**
   * Escape out of the composer must hand the keyboard back to the SIDEBAR.
   *
   * The operator's request was "phím tắt để đi ngược từ prompt input về
   * sidebar". Blurring the textarea was necessary but not sufficient: the
   * composer can be reached through `I` (focus the detail pane) then `i`,
   * which leaves `pane === 'action'`. After the blur the keys reach the
   * window again and route to the DETAIL pane, so `j`/`k` walk that pane's
   * actions instead of the session list. Nothing looks broken — the keys
   * work, they just move the wrong thing, which is harder to notice than
   * being ignored outright.
   *
   * Written through the `I`-then-`i` path on purpose: entering with a bare
   * `i` leaves `pane` on 'list' already, so that route cannot tell the fixed
   * code from the broken code and a test written along it would pass either
   * way.
   *
   * Pane routing is the observable proof. `<` narrows whichever pane owns the
   * keyboard, so "the sidebar narrowed and the detail pane did not" says
   * exactly "the keyboard went back to the sidebar" without reaching into
   * component state.
   */
  it('Escape from a composer opened via I routes the keyboard back to the sidebar', () => {
    render(<Canvas model={MODEL} />);
    press('I');
    expect(actionPane()).toBe('active');
    press('i');
    const box = document.querySelector('[aria-label="prompt to session"]');
    expect(box).not.toBeNull();
    expect(document.activeElement).toBe(box);

    keyOn(box as Element, 'Escape');

    // The proof is the DIRECTION: Select's `<` shrinks the sidebar; Insert's
    // grows it (the test just above this one). Had Escape failed to route
    // the keyboard back, this same `<` would have GROWN the sidebar instead.
    press('<');
    expect(width(sidebarAside())).toBe(DEFAULT_PANES.sidebar - 24);
  });

  it('z0 resets both panes to their defaults in one keystroke sequence', () => {
    render(<Canvas model={MODEL} />);
    press('<');
    press('<');
    press('I');
    press('>'); // Insert's `>` shrinks the sidebar further (sign flipped)
    expect(width(sidebarAside())).not.toBe(DEFAULT_PANES.sidebar);
    // The detail pane is always `viewport - sidebar` now (A12.1) — this
    // still differs from its OLD stored default whenever the sidebar does,
    // which the line above already pins.
    expect(width(detailAside())).not.toBe(1600 - DEFAULT_PANES.sidebar);

    press('z');
    press('0');
    expect(width(sidebarAside())).toBe(DEFAULT_PANES.sidebar);
    expect(width(detailAside())).toBe(1600 - DEFAULT_PANES.sidebar);
  });

  it('writes prefs at most once per press, even one that lands exactly on a bound', () => {
    render(<Canvas model={MODEL} />);
    const setItem = vi.spyOn(localStorage, 'setItem');
    setItem.mockClear();

    press('<');
    expect(setItem).toHaveBeenCalledTimes(1);

    // Drive to MIN, then one more press that cannot move it further.
    for (let i = 0; i < 20; i++) {
      press('<');
    }
    setItem.mockClear();
    press('<'); // already at MIN
    expect(setItem.mock.calls.length).toBeLessThanOrEqual(1);
    setItem.mockRestore();
  });

  it('does not fire while a text input holds focus — the filter box owns < > 0 as literal characters', () => {
    render(<Canvas model={MODEL} />);
    press('/'); // opens the filter box
    const input = filterInput();
    expect(input).not.toBeNull();

    const before = width(sidebarAside());
    keyOn(input as HTMLInputElement, '<');
    keyOn(input as HTMLInputElement, '>');
    expect(width(sidebarAside())).toBe(before);
  });
});

/**
 * Ten sessions under one project, all `done`, so the status ranking cannot
 * reorder them and the sidebar prints exactly source order. Nine of anything
 * is the whole point of `Mod-9`, and MODEL's three cannot reach it.
 */
const MANY: CanvasModel = {
  projects: [
    {
      id: 'p9',
      name: 'gamma',
      source: 'factory',
      sessions: Array.from({ length: 10 }, (_, i) => session(`s${i + 1}`)),
    },
  ],
};

/**
 * `Cmd+<n>` — the sidebar's positions, while the sidebar has the keyboard.
 *
 * The pane fork itself lives in `Canvas.tab-chord.test.tsx`; what these pin is
 * the sidebar half, which is the half that counts rows. Pressed with a
 * `code`, because that is what a real keydown carries and what
 * `normalizeKey` reads.
 */
const sessionAt = (n: number, extra: KeyboardEventInit = {}) =>
  press(String(n), { metaKey: true, code: `Digit${n}`, ...extra });

describe('Cmd-number jumps to a session while the sidebar has the keyboard', () => {
  it('lands on the first row from wherever the cursor was', () => {
    render(<Canvas model={MODEL} />);
    press('j');
    expect(focused()).toBe('alpha/a2');
    sessionAt(1);
    expect(focused()).toBe('alpha/a1');
  });

  it('counts across project headings, which are captions and not rows', () => {
    render(<Canvas model={MODEL} />);
    // a1, a2 sit under alpha and b1 under beta; the third digit is the third
    // SESSION, not the third row of a list that counted its own headings.
    press('3', { ctrlKey: true, code: 'Digit3' });
    expect(focused()).toBe('beta/b1');
  });

  it('the ninth is the last session, past nine and short of it alike', () => {
    const { unmount } = render(<Canvas model={MANY} />);
    sessionAt(9);
    expect(focused()).toBe('gamma/s10'); // the LAST, not the ninth
    unmount();

    render(<Canvas model={MODEL} />);
    sessionAt(9);
    expect(focused()).toBe('beta/b1'); // three sessions, and it still lands
  });

  it('an out-of-range digit says so instead of clamping to the last row', () => {
    render(<Canvas model={MODEL} />);
    sessionAt(7);
    expect(focused()).toBe('alpha/a1'); // unmoved
    expect(statusBar()).toContain('only 3 sessions');
  });

  it('counts what the filter left visible, not what the model holds', () => {
    render(<Canvas model={MODEL} />);
    press('/');
    typeInto(filterInput() as HTMLInputElement, 'alpha');
    keyOn(filterInput() as HTMLInputElement, 'Enter');
    expect(rows().map((el) => el.getAttribute('data-session-row'))).toEqual(['a1', 'a2']);

    sessionAt(2);
    expect(focused()).toBe('alpha/a2');
    // b1 is still in the model and still the third session there. Counting it
    // would land the cursor on a row the operator cannot see.
    sessionAt(3);
    expect(focused()).toBe('alpha/a2');
    expect(statusBar()).toContain('only 2 sessions');
  });

  it('still fires a Mod-chord while a text box has the keyboard, and keeps the draft', () => {
    // REVERSED, deliberately. The window listener used to step aside for every
    // keystroke aimed at an INPUT or a TEXTAREA, which killed Cmd-chords
    // exactly where an operator's hands are. A Cmd/Ctrl chord is not text
    // entry on any layout, so the box has no claim on it. What the box does
    // keep is everything unmodified, including the draft already typed.
    //
    // WHAT THE DIGIT COUNTS HERE CHANGED WITH THE MODE NAMING, and the change
    // is the operator's own mapping: they named Insert after the PROMPT state,
    // so `i` enters Insert exactly as `I` does. The digit therefore switches a
    // TAB, which is what Insert binds it to — the cell no longer says one mode
    // while the digit obeys another. The property under test is unchanged: the
    // chord fired from inside the box, and the draft survived it.
    render(<Canvas model={MODEL} />);
    press('j');
    press('i'); // the composer, aimed at alpha/a2
    const box = promptInput() as HTMLTextAreaElement;
    typeInto(box, 'half a prompt');
    keyOn(box, '1', { metaKey: true, code: 'Digit1' });
    expect(
      document.querySelector('[data-view][aria-pressed="true"]')?.getAttribute('data-view'),
    ).toBe('response');
    expect(focused()).toBe('alpha/a2');
    expect(promptInput()?.value).toBe('half a prompt');
  });

  it('consumes the event, so the host does not also act on it', () => {
    render(<Canvas model={MODEL} />);
    const event = new KeyboardEvent('keydown', {
      key: '2',
      code: 'Digit2',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(focused()).toBe('alpha/a2');
  });
});

describe('the grammar hint in the footer', () => {
  it('no longer spells out the grammar: the sheet behind `?` does', () => {
    render(<Canvas model={MODEL} />);
    // The operator asked for one cell at the right end. The digit jump did
    // not become invisible with it: the `?` sheet is generated from
    // BINDING_TABLES, so `Mod-1..9` is named there, and the bar now points
    // at the sheet instead of paraphrasing it.
    const bar = document.querySelector('[data-status-bar]')?.textContent ?? '';
    expect(bar).not.toMatch(/\^1-9/);
    expect(bar).toMatch(/\?/);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    });
    expect(document.querySelector('[data-key-sheet]')?.textContent).toMatch(/1/);
  });
});
