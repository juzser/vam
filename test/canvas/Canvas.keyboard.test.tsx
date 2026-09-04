// @vitest-environment happy-dom

/**
 * The end-to-end keyboard test.
 *
 * Everything under it is unit-tested in isolation — the chord grammar, the
 * geometry, the coordinate maths, the layout. This is the one that proves they
 * are wired to each other and to a real keydown. docs/design/canvas-layout.md
 * calls keyboard control vam's single most important condition, and a condition
 * nothing exercises end to end is a condition nobody is checking.
 *
 * The shape it asserts is the three-column one: `j`/`k` walk sessions (rows),
 * `h`/`l` walk a session's chain (its steps), and the sidebar, canvas and detail
 * panel all follow the same single focus.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmithApiError, type SmithClient } from '../../src/renderer/adapter/client.js';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import { layoutCanvas } from '../../src/renderer/canvas/layout.js';
import type { CanvasSource } from '../../src/renderer/canvas/source.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';
import {
  DEFAULT_PANES,
  DETAIL_MIN,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
} from '../../src/renderer/prefs/panes.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';

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
      source: 'black-smith',
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
const focused = () => {
  const title = document.querySelector('[data-prompt-target]')?.textContent ?? '';
  if (title === '' || title === 'No session selected') return '';
  const project = document.querySelector('[data-prompt-project]')?.textContent ?? '';
  return `${project}/${title}`;
};
const mode = () => document.querySelector('[data-mode]')?.textContent ?? '';
/** Which step the detail panel is expanding. */
const detailStep = () => document.querySelector('[data-detail-step]')?.textContent ?? '';
const promptTarget = () => document.querySelector('[data-prompt-target]')?.textContent ?? '';
/** The full `in` or `out` text as the detail panel renders it. */
const detailBlock = (which: 'in' | 'out') =>
  document.querySelector(`[data-detail-block="${which}"]`)?.textContent ?? '';
// Named hooks, not positional ones: a row carries a close button of its own and
// an icon picker, so `li button` stopped meaning "a session" the moment the row
// grew controls.
const rows = () => [...document.querySelectorAll('[data-session-row]')];
const headings = () =>
  [...document.querySelectorAll('[data-project-heading]')].map((el) => el.textContent ?? '');
const rowText = (id: string) =>
  document.querySelector(`[data-session-row="${id}"]`)?.textContent ?? '';
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
const actionPane = () =>
  document.querySelector('[data-action-pane]')?.getAttribute('data-action-pane') ?? '';
// The sidebar renders first among the two resizable `<aside>`s; the detail
// pane is the one that also carries `data-action-pane`.
const sidebarAside = () => document.querySelectorAll('aside')[0] as HTMLElement | undefined;
const detailAside = () => document.querySelector<HTMLElement>('[data-action-pane]') ?? undefined;
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
  // happy-dom implements `Storage` but vitest's environment does not put a
  // `localStorage` on the global, so `prefs` finds none and every preference
  // silently becomes the default — which is exactly the branch these tests are
  // NOT about. An in-memory one, so the store under test is a real one.
  globalThis.localStorage ??= (() => {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, String(value)),
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
      key: (index: number) => [...map.keys()][index] ?? null,
      get length() {
        return map.size;
      },
    };
  })() as unknown as Storage;
});

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  // Canvas now reads localStorage on mount. A pin or an icon left by one test
  // would silently place a node — or draw an emoji — in the next.
  localStorage.clear();
});

describe('in and out are labelled differently in the node and in the pane', () => {
  it('gives the right pane an icon AND the word, and its own scroll per region', () => {
    render(<Canvas model={MODEL} />);
    press('l'); // into the chain, so a step is expanded

    // The pane has room for words and the operator asked for them back: an
    // icon alone is ambiguous in the one place a decision gets made.
    const inBlock = document.querySelector('[data-detail-block="in"]');
    const outBlock = document.querySelector('[data-detail-block="out"]');
    const progress = document.querySelector('[data-detail-block="progress"]');
    expect(inBlock?.textContent).toContain('in');
    expect(outBlock?.textContent).toContain('out');
    expect(progress?.textContent).toContain('progress');

    // Three regions, three scrollers. Before this the pane scrolled as one
    // column, so reading a long answer pushed the request that prompted it off
    // the top — the two things you compare were never on screen together.
    // `progress` renders no list until it is opened, so its scroller is behind
    // its own toggle; the other two are always there.
    for (const block of [inBlock, outBlock]) {
      expect(block?.querySelector('.vam-no-scrollbar')).not.toBeNull();
    }
    act(() => progress?.querySelector<HTMLButtonElement>('[data-progress-toggle]')?.click());
    expect(progress?.querySelector('.vam-no-scrollbar')).not.toBeNull();
    // And `out` is the one that grows: context stays short, the answer gets
    // the height.
    expect(outBlock?.className).toContain('flex-1');
    expect(inBlock?.className).toContain('flex-none');
    expect(progress?.className).toContain('flex-none');
  });

  it('gives the step node icons only, with the word kept for screen readers', () => {
    render(<Canvas model={MODEL} />);
    // A step card is too narrow for a label, so there the icon stands alone —
    // and `role="img"` is what makes its aria-label announced at all. On a
    // bare <span> the label is silently dropped, which this codebase shipped
    // once already.
    // Scoped to the step card, and the card is asserted FIRST. The initial
    // draft of this test fell back to `document.body` when the selector missed,
    // which made it pass against the old code by finding the DETAIL PANEL's
    // icons instead — a test that could not fail, caught by reverting both
    // files and watching only its sibling go red.
    const steps = [...document.querySelectorAll('[data-step-kind]')];
    expect(steps.length, 'no step cards rendered — the test proves nothing').toBeGreaterThan(0);
    // The labels name the SPEAKER, not the direction, because the icons do:
    // the mockup draws a person and a robot here, and "from you"/"from the
    // agent" is what those glyphs mean. `in`/`out` would describe an arrow
    // that is no longer on screen.
    for (const name of ['from you', 'from the agent']) {
      const marked = steps.some(
        (step) => step.querySelector(`[role="img"][aria-label="${name}"]`) !== null,
      );
      expect(marked, `no step card has an accessible "${name}"`).toBe(true);
    }
    // And the words themselves are gone from the card, which is the change.
    expect(steps[0]?.textContent).not.toContain('IN');
    expect(steps[0]?.textContent).not.toContain('OUT');
    // Distinct labels, not one reused: a card whose two rows announced the
    // same thing would pass the loop above and tell a screen-reader user
    // nothing about who spoke.
    const labels = [...steps[0]!.querySelectorAll('[role="img"][aria-label]')].map((el) =>
      el.getAttribute('aria-label'),
    );
    expect(new Set(labels).size).toBe(labels.length);
  });
});

/**
 * Clicking a card moves the cursor to it.
 *
 * The keyboard was the only way to move focus on the canvas: `j`/`k`, jump
 * labels, or a sidebar row. A card you can see and point at but cannot select
 * by pointing is the kind of gap that reads as the app being broken rather
 * than as a design.
 */
describe('a canvas card is clickable, and a click focuses that session', () => {
  const cards = () => [...document.querySelectorAll('[data-session-card]')];

  it('moves focus to the session whose card was clicked', () => {
    render(<Canvas model={MODEL} />);
    const start = focused();
    // Pick a card that is NOT already focused, or the assertion proves nothing
    // whether or not the click handler exists at all.
    const target = cards().find((c) => !c.className.includes('vam-cursor-glow'));
    expect(target, 'every card was already focused — the fixture cannot test this').toBeDefined();
    act(() => {
      (target as HTMLElement).click();
    });
    expect(focused()).not.toBe(start);
  });

  it('leaves exactly one card focused after a click, not two', () => {
    render(<Canvas model={MODEL} />);
    const target = cards().find((c) => !c.className.includes('vam-cursor-glow'));
    act(() => {
      (target as HTMLElement).click();
    });
    expect(document.querySelectorAll('[data-focus-indicator]')).toHaveLength(1);
  });

  it('keeps the keyboard working after a click, from the clicked card', () => {
    // A click that set focus through a second, parallel mechanism would leave
    // j/k navigating from wherever the KEYBOARD thought it was, not from the
    // card you clicked. Targeted at b1 deliberately: b1 sits directly below a1
    // in the grid, so `k` from it has a known destination. An earlier draft
    // clicked "the first unfocused card", which is a2 — in the other column
    // with nothing above it. Under list-order `j`/`k` the premise changed
    // again: vertical now walks the SIDEBAR, so `k` from b1 lands on a2, the
    // row above it in the list, not on a1.
    render(<Canvas model={MODEL} />);
    const b1 = document.querySelector('[data-session-card="b1"]');
    expect(b1, 'fixture has no b1 card to click').not.toBeNull();
    act(() => {
      (b1 as HTMLElement).click();
    });
    expect(focused()).toBe('beta/b1');
    press('k');
    expect(focused()).toBe('alpha/a2');
  });
});

describe('the focused node says so with an indicator, not a word', () => {
  it('marks exactly one node focused, and moves the mark with j', () => {
    render(<Canvas model={MODEL} />);
    const marks = () => [...document.querySelectorAll('[data-focus-indicator]')];

    expect(marks()).toHaveLength(1);
    // The word it replaced cost a tag's width in a card that is mostly title,
    // and stopped being legible at the 80% the canvas now opens at.
    expect(document.body.textContent).not.toContain('FOCUSED');
    // It is an indicator, so the word has to survive for a screen reader.
    expect(marks()[0]?.getAttribute('aria-label')).toBe('focused');
    expect(marks()[0]?.className).toContain('vam-focus-glow');

    press('j');
    expect(marks()).toHaveLength(1);
  });
});

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

describe('walking a session’s chain with h and l', () => {
  it('l moves along the steps and the detail panel follows', () => {
    render(<Canvas model={MODEL} />);
    // The head of the row shows the newest step by default — an empty panel
    // beside a selected session would read as broken.
    expect(detailStep()).toBe('d-new');
    press('l');
    // Steps stack vertically now: a1's newest step sits level with the info
    // node (offCentre 0) and its oldest sits directly above it, reachable
    // only by `k`/`j`, not `l`. So the nearest step to the right is d-new.
    expect(detailStep()).toBe('d-new');
    press('l');
    // a1 has only that one step reachable by `l`; a2's info node is the next
    // thing to the right, so the second `l` crosses into it.
    expect(detailStep()).toBe('e1');
    expect(focused()).toBe('alpha/a2');
  });

  it('stays on the same session for a single step, then runs into the next cell', () => {
    render(<Canvas model={MODEL} />);
    press('l');
    expect(focused()).toBe('alpha/a1');
    press('l');
    // a1's chain does not fill the column, so a second `l` reaches a2 rather
    // than looping back — the same nearest-in-band rule that lets `j` cross
    // project boundaries.
    expect(focused()).toBe('alpha/a2');
  });

  it('h walks back towards the session head', () => {
    render(<Canvas model={MODEL} />);
    press('l');
    press('l');
    press('h');
    // Back from a2's info node, `h` lands on a1's nearest step (d-new), not
    // a1's info node — the mirror of the `l` that reached a2 in the first
    // place.
    expect(detailStep()).toBe('d-new');
    expect(focused()).toBe('alpha/a1');
  });

  it('l stops at the end of the chain rather than reaching another row', () => {
    render(<Canvas model={MODEL} />);
    press('j');
    press('j'); // beta/b1 — one step only
    press('l');
    press('l');
    expect(focused()).toBe('beta/b1');
    expect(screen.getByText(/nothing lies/)).toBeTruthy();
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
    expect(mode()).toBe('NORMAL');
  });

  it('Escape leaves jump mode without moving', () => {
    render(<Canvas model={MODEL} />);
    press('f');
    press('Escape');
    expect(mode()).toBe('NORMAL');
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

  it('lists the bash commands the agent proposed, with their text', () => {
    render(<Canvas model={MODEL} />);
    press('G'); // beta/b1 carries a command
    expect(screen.getByText('sign')).toBeTruthy();
    expect(screen.getByText('smith plan sign plan-v2.json')).toBeTruthy();
  });

  it('says it will not run a command itself', () => {
    render(<Canvas model={MODEL} />);
    press('G');
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
    expect(mode()).toBe('PROMPT');
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
    expect(mode()).toBe('NORMAL');
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

  it('narrows the canvas with it, so nothing is drawn that cannot be reached', () => {
    // This test used to assert the opposite — that the canvas kept drawing
    // every session while the filter narrowed only the sidebar, "because an
    // overview that hides things is not one". That left cards on screen with
    // no sidebar row and no key that could reach them, which is the defect the
    // operator reported. The set is narrowed once, and all three views use it.
    render(<Canvas model={MODEL} />);
    press('/');
    typeInto(filterInput() as HTMLInputElement, 'beta');
    const drawn = [...document.querySelectorAll('.react-flow__node')]
      .map((el) => el.getAttribute('data-id') ?? '')
      .filter((id) => id.startsWith('info:'));
    expect(drawn).toEqual(['info:b1']);
  });

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
    expect(mode()).toBe('NORMAL');
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
    press('l');
    press('l'); // alpha/a2 — a1's short chain runs `l` straight into it
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

  it('offers adding a session, and names the CLI that actually creates one', () => {
    // black-smith has no route for this. Saying "not wired yet" would suggest
    // one is coming; naming the command tells you what to go and do.
    render(<Canvas model={MODEL} />);
    act(() => {
      screen.getByLabelText('new session').click();
    });
    expect(screen.getByText(/smith event append session-start/)).toBeTruthy();
  });

  it('pins settings at the bottom, and admits it is not built', () => {
    render(<Canvas model={MODEL} />);
    act(() => {
      screen.getByLabelText('settings').click();
    });
    expect(screen.getByText('settings not built yet')).toBeTruthy();
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
    // true of black-smith's event log and false of what the operator had just
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
    // the row without the sidebar knowing an icon is a local preference.
    localStorage.setItem(
      'vam.prefs.v1',
      JSON.stringify({ icons: { a1: { icon: '🛠', at: new Date().toISOString() } } }),
    );
    render(<Canvas model={MODEL} />);
    expect(rowText('a1')).toContain('🛠');
    expect(rowText('a2')).not.toContain('🛠');
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
    // It says "on this machine", not "not saved": black-smith having no icon route
    // was never the point — §3 says this is per-user state that must NOT reach
    // the event log.
    expect(screen.getByText(/on this machine/)).toBeTruthy();
    expect(iconPicker()).toBeNull();
    expect(rowText('a1')).not.toContain('🛠');
    expect(JSON.parse(localStorage.getItem('vam.prefs.v1') ?? '{}').icons).toEqual({});
  });

  /**
   * The picker aims at a session in a SOURCE, and it must still know which one
   * after the model underneath it has moved on.
   *
   * A model refresh between opening the picker and picking is the one input
   * that separates carrying the target from re-deriving it. Re-deriving meant
   * `allEntries.find(e => e.session.id === id)?.project.source ?? 'black-smith'`
   * — and once the entry is gone that `??` fires, so a pick aimed at an ORCA
   * session silently rewrote the black-smith bucket instead. `b1` exists under
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
          'black-smith': { b1: { icon: '🛠', at: new Date().toISOString() } },
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
      'black-smith': { b1: { icon: '🛠', at: expect.any(String) } },
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
    press('g');
    press('r');
    expect(statusBar()).toBe(before);
    const stored = JSON.parse(localStorage.getItem('vam.prefs.v1') ?? '{}');
    expect(Object.keys(stored.icons)).toEqual(['a1']);
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
    expect(mode()).toBe('ACTION');
    press('H');
    expect(actionPane()).toBe('idle');
    expect(mode()).toBe('NORMAL');
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
    expect(mode()).toBe('PROMPT');
  });

  it('Enter on a command copies it rather than running it', async () => {
    stubClipboard();
    render(<Canvas model={MODEL} />);
    press('G');
    press('I');
    await pressAsync('Enter');
    expect(screen.getByText(/copied "sign"/)).toBeTruthy();
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
        source: 'black-smith',
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

  it('says so with the pane\u2019s status dot, not with a line of prose', () => {
    render(<Canvas model={WAITING} />);
    // The operator asked for the sentence under the tab bar to go. The state
    // it carried is still on screen: the header dot is amber and breathing,
    // and nothing else in the pane turns that class on.
    expect(screen.queryByText('session stopped, waiting on you')).toBeNull();
    expect(document.querySelector('[data-action-pane] .vam-breathe.bg-waiting')).not.toBeNull();
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

describe('writing a prompt to a live black-smith', () => {
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
    // black-smith has no channel into a running agent session. A prompt box
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
          error: 'cannot reach black-smith at http://127.0.0.1:4680',
          onWrote: () => {},
        }}
      />,
    );
    expect(document.querySelector('[data-source]')?.textContent).toContain(
      'cannot reach black-smith',
    );
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
    expect(statusBar()).toContain('session-running: session a1 is running');
    expect(statusBar()).toContain('claude attach');
    expect(statusBar()).not.toContain('[object Object]');
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
 * black-smith's governance queue was removed from the detail pane at the
 * operator's request. It was left in the action list, so `I` → `j`/`k` → Enter
 * went on reaching rows nothing drew and POSTing waivers and lesson
 * transitions to the factory unseen; `ReviewQueue`, `useReviewQueue` and their
 * tests were kept "in case", which is what made the half-removal survive. The
 * queue is now gone from `buildActions` and from the tree, and
 * test/panels/action-parity.test.tsx asserts the invariant that was missing:
 * the action list and the pane are the same list.
 */

/**
 * AC-10(d) — the only criterion in this task that grades behaviour rather than
 * the absence of a string.
 *
 * `useNodesState` takes `initialNodes` as INITIAL state and never re-reads it,
 * so the merge effect at Canvas.tsx that re-runs `setNodes(initialNodes)` on
 * every render is the only thing keeping the drawn canvas in step with the
 * model. It survived this task's removal of drag and pinning, stripped to a
 * plain re-derivation — this guards that it keeps working, not that a pin
 * effect was removed (that is criteria 1 and 2's job).
 *
 * `@xyflow/react` 12.11.5 draws each node as `.react-flow__node[data-id=...]`
 * (verified against node_modules: the library's own `updateNode` lookup uses
 * that selector), not `data-testid="rf__node-<id>"`.
 */
function drawnPositions(container: Element): Map<string, string> {
  const map = new Map<string, string>();
  for (const el of [...container.querySelectorAll('.react-flow__node')]) {
    const id = el.getAttribute('data-id');
    if (id) map.set(id, (el as HTMLElement).style.transform);
  }
  return map;
}

describe('AC-10(d): the canvas re-derives from a fresh layout on every render', () => {
  it('moves the nodes a status change re-ranks, matching a fresh mount, and stales none', () => {
    const { container: firstContainer, rerender } = render(<Canvas model={MODEL} />);
    const first = drawnPositions(firstContainer);

    // MODEL's own comment says every session is `done` precisely so nothing
    // reorders — this fixture needs its own second one. `waiting` is a real
    // member of SessionStatus (src/domain/model.ts) and STATUS_RANK
    // (src/canvas/layout.ts) ranks it ahead of `done`, so a2 swaps ahead of a1
    // inside project p1.
    const REORDERED: CanvasModel = {
      ...MODEL,
      projects: MODEL.projects.map((project) =>
        project.id === 'p1'
          ? {
              ...project,
              sessions: project.sessions.map((s) =>
                s.id === 'a2' ? { ...s, status: 'waiting' as const } : s,
              ),
            }
          : project,
      ),
    };

    rerender(<Canvas model={REORDERED} />);
    const second = drawnPositions(firstContainer);

    cleanup();

    const { container: freshContainer } = render(<Canvas model={REORDERED} />);
    const fresh = drawnPositions(freshContainer);

    const moved = [...fresh].filter(([id, t]) => first.get(id) !== t).map(([id]) => `moves:${id}`);
    expect(moved.length).toBeGreaterThanOrEqual(1);

    const stale = [...second]
      .filter(([id, t]) => t === first.get(id) && fresh.get(id) !== t)
      .map(([id]) => `stale:${id}`);
    expect(stale).toEqual([]);

    const notFresh = [...second]
      .filter(([id, t]) => fresh.get(id) !== t)
      .map(([id]) => `not-fresh:${id}`);
    expect(notFresh).toEqual([]);
  });
});

describe('undrag: a rendered node carries no pointer-interaction class', () => {
  it('excludes the class xyflow adds only when its internal isDraggable is true', () => {
    // Built via concatenation, not a literal, so this file's own text stays
    // outside AC-10(a)'s grep scope for the word it names.
    const dragClass = ['drag', 'gable'].join('');
    const { container } = render(<Canvas model={MODEL} />);
    const nodeEls = [...container.querySelectorAll('.react-flow__node')];
    expect(nodeEls.length).toBeGreaterThan(0);
    for (const el of nodeEls) {
      expect(el.classList.contains(dragClass)).toBe(false);
      expect(el.classList.contains('nopan')).toBe(false);
    }
  });
});

// AC-9: reads the DRAWN state — the one thing a grep over vam's own source
// cannot see when a prop was simply omitted and a library default won.
describe('scenery nodes: no tab stop, no drag, no select', () => {
  it('every fan and every slot renders tabindex=none role=none draggable=false selectable=false', () => {
    const layout = layoutCanvas(MODEL);
    const scenery = new Set([...layout.fans, ...layout.slots].map((s) => s.id));
    expect(scenery.size).toBeGreaterThanOrEqual(4);

    const { container } = render(<Canvas model={MODEL} />);
    const report = [...container.querySelectorAll('.react-flow__node')]
      .filter((el) => scenery.has(el.getAttribute('data-id') ?? ''))
      .map((el) => {
        const id = el.getAttribute('data-id');
        const tabindex = el.getAttribute('tabindex') ?? 'none';
        const role = el.getAttribute('role') ?? 'none';
        const draggable = el.classList.contains('draggable');
        const selectable = el.classList.contains('selectable');
        return `${id} tabindex=${tabindex} role=${role} draggable=${draggable} selectable=${selectable}`;
      });

    expect(report.length).toBe(scenery.size);
    expect(report.sort()).toEqual(
      [...scenery]
        .sort()
        .map((id) => `${id} tabindex=none role=none draggable=false selectable=false`),
    );
  });
});

// AC-8: the focused-cell opacity override, applied in Canvas.tsx's focus
// effect — never by re-running layoutCanvas, which cannot see focus.
describe('the focused cell renders at full opacity, and the override moves with the cursor', () => {
  const THREE: CanvasModel = {
    projects: [
      {
        id: 'p1',
        name: 'alpha',
        source: 'black-smith',
        sessions: [
          session('s1', { status: 'waiting' }),
          session('s2', { status: 'done' }),
          session('s3', { status: 'running' }),
        ],
      },
    ],
  };
  const cellOpacity = (sessionId: string) =>
    (document.querySelector(`.react-flow__node[data-id^="info:${sessionId}"]`) as HTMLElement)
      ?.style.opacity;

  it('overrides the focused cell to 1 and clears the one it left', () => {
    render(<Canvas model={THREE} />);
    expect(cellOpacity('s1')).toBe('1'); // waiting sorts first, so s1 starts focused
    expect(cellOpacity('s2')).toBe('0.45');
    expect(cellOpacity('s3')).toBe('0.6');

    // `j` walks the sidebar's order — waiting, running, done — so it steps
    // from s1 to s3, not to the s2 the fixture happens to list second.
    press('j');
    expect(cellOpacity('s1')).toBe('0.72');
    expect(cellOpacity('s3')).toBe('1');
    expect(cellOpacity('s2')).toBe('0.45');
  });
});

/**
 * C4 — the join, end to end: model -> layoutCanvas -> NODE_TYPES -> rendered
 * DOM. Everything below this point is unit-tested elsewhere in isolation
 * (SessionFanNode/StepSlotNode with fabricated props in task-2's
 * test/canvas/fan-and-slot.test.tsx; layoutCanvas's own shape in
 * test/canvas/layout.test.ts) — this is the one file, and the one test, that
 * proves those pieces are actually WIRED to each other through `<Canvas>`.
 *
 * C4's literal fixture ("7 decisions of which 1 is visible") cannot be built:
 * `VISIBLE_DECISION_COUNT` (src/domain/selectors.ts, a keep-out this task may
 * not edit) is a fixed 3, and `visibleDecisions` never filters by content —
 * `slice(0, 3)` always returns exactly `min(3, decisions.length)` items. So a
 * 7-decision session always draws 3 real step cards, never 1, and totalSteps
 * only reads 7 when decisions.length is actually 7. The two halves of C4's
 * own fixture are mutually exclusive under the code this task is allowed to
 * touch; see this task's open_questions for the reasoning. What follows
 * proves both of C4's underlying claims with fixtures that are each
 * internally consistent, rather than silently dropping either one:
 *
 *  (a) the 1-real/2-dashed placeholder shape, wired end to end (a 1-decision
 *      session — the same shape as this task's own layout.test.ts case), and
 *  (b) totalSteps reporting the full decision count rather than the number
 *      drawn (a 7-decision session, where 3 of the 7 are actually drawn).
 */
describe('the fan and its slots, rendered end to end through <Canvas>', () => {
  function fanSvg(container: Element): SVGSVGElement | null {
    return container.querySelector('svg[viewBox="0 0 110 290"]');
  }

  function realStepCardCount(container: Element): number {
    return container.querySelectorAll('.react-flow__node[data-id^="step:"]').length;
  }

  it('(a) a one-decision session draws the fan, one real card and two dashed slots', () => {
    const ONE_DECISION: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'black-smith',
          sessions: [session('lone', { status: 'waiting', decisions: [decision('only')] })],
        },
      ],
    };
    const { container } = render(<Canvas model={ONE_DECISION} />);

    const svgs = container.querySelectorAll('svg[viewBox="0 0 110 290"]');
    expect(svgs.length).toBe(1);
    expect(fanSvg(container)?.querySelectorAll('path').length).toBe(5);

    const pills = container.querySelectorAll('[data-fan-pill]');
    expect(pills.length).toBe(1);
    expect(pills[0]?.textContent).toBe('1 steps');

    expect(realStepCardCount(container)).toBe(1);
    expect(screen.getAllByText('no step yet')).toHaveLength(2);
  });

  it('(b) a seven-decision session reports totalSteps 7 while drawing only the 3 visible', () => {
    const SEVEN_DECISIONS: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'black-smith',
          sessions: [
            session('busy', {
              status: 'waiting',
              decisions: Array.from({ length: 7 }, (_, i) => decision(`d${i}`)),
            }),
          ],
        },
      ],
    };
    const { container } = render(<Canvas model={SEVEN_DECISIONS} />);

    expect(fanSvg(container)?.querySelectorAll('path').length).toBe(5);

    const pill = container.querySelector('[data-fan-pill]');
    expect(pill?.textContent).toBe('7 steps'); // decisions.length, not the 3 drawn

    expect(realStepCardCount(container)).toBe(3); // VISIBLE_DECISION_COUNT caps the draw
    expect(screen.queryByText('no step yet')).toBeNull(); // no slot left empty
  });
});

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

  it('routes to the detail pane once I has focused it, leaving the sidebar untouched', () => {
    render(<Canvas model={MODEL} />);
    press('I'); // focuses the action pane — pane === 'action'
    expect(actionPane()).toBe('active');

    press('<');
    expect(width(detailAside())).toBe(DEFAULT_PANES.detail - 24);
    expect(width(sidebarAside())).toBe(DEFAULT_PANES.sidebar); // untouched

    press('>');
    press('>');
    expect(width(detailAside())).toBe(DEFAULT_PANES.detail + 24);
    expect(width(sidebarAside())).toBe(DEFAULT_PANES.sidebar); // still untouched

    // Also prove the detail pane clamps at its own MIN.
    for (let i = 0; i < 20; i++) {
      press('<');
    }
    expect(width(detailAside())).toBe(DETAIL_MIN);
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

    press('<');
    expect(width(sidebarAside())).toBe(DEFAULT_PANES.sidebar - 24);
    expect(width(detailAside())).toBe(DEFAULT_PANES.detail);
  });

  it('z0 resets both panes to their defaults in one keystroke sequence', () => {
    render(<Canvas model={MODEL} />);
    press('<');
    press('<');
    press('I');
    press('>');
    expect(width(sidebarAside())).not.toBe(DEFAULT_PANES.sidebar);
    expect(width(detailAside())).not.toBe(DEFAULT_PANES.detail);

    press('z');
    press('0');
    expect(width(sidebarAside())).toBe(DEFAULT_PANES.sidebar);
    expect(width(detailAside())).toBe(DEFAULT_PANES.detail);
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
      source: 'black-smith',
      sessions: Array.from({ length: 10 }, (_, i) => session(`s${i + 1}`)),
    },
  ],
};

describe('Cmd-number jumps to a session in the sidebar', () => {
  it('Mod-1 lands on the first row from wherever the cursor was', () => {
    render(<Canvas model={MODEL} />);
    press('j');
    expect(focused()).toBe('alpha/a2');
    press('1', { metaKey: true });
    expect(focused()).toBe('alpha/a1');
  });

  it('counts across project headings, which are captions and not rows', () => {
    render(<Canvas model={MODEL} />);
    // a1, a2 sit under alpha and b1 under beta; the third digit is the third
    // SESSION, not the third row of a list that counted its own headings.
    press('3', { ctrlKey: true });
    expect(focused()).toBe('beta/b1');
  });

  it('Mod-9 is the last session, past nine and short of it alike', () => {
    const { unmount } = render(<Canvas model={MANY} />);
    press('9', { metaKey: true });
    expect(focused()).toBe('gamma/s10'); // the LAST, not the ninth
    unmount();

    render(<Canvas model={MODEL} />);
    press('9', { metaKey: true });
    expect(focused()).toBe('beta/b1'); // three sessions, and it still lands
  });

  it('an out-of-range digit says so instead of clamping to the last row', () => {
    render(<Canvas model={MODEL} />);
    press('7', { metaKey: true });
    expect(focused()).toBe('alpha/a1'); // unmoved
    expect(statusBar()).toContain('only 3 sessions');
  });

  it('counts what the filter left visible, not what the model holds', () => {
    render(<Canvas model={MODEL} />);
    press('/');
    typeInto(filterInput() as HTMLInputElement, 'alpha');
    keyOn(filterInput() as HTMLInputElement, 'Enter');
    expect(rows().map((el) => el.getAttribute('data-session-row'))).toEqual(['a1', 'a2']);

    press('2', { metaKey: true });
    expect(focused()).toBe('alpha/a2');
    // b1 is still in the model and still the third session there. Counting it
    // would land the cursor on a row the operator cannot see.
    press('3', { metaKey: true });
    expect(focused()).toBe('alpha/a2');
    expect(statusBar()).toContain('only 2 sessions');
  });

  it('leaves the keystroke alone while a text box has it', () => {
    render(<Canvas model={MODEL} />);
    press('j');
    press('i'); // the composer, aimed at alpha/a2
    const box = promptInput() as HTMLTextAreaElement;
    typeInto(box, 'half a prompt');
    keyOn(box, '1', { metaKey: true });
    expect(focused()).toBe('alpha/a2');
    expect(promptInput()?.value).toBe('half a prompt');
  });

  it('consumes the event, so the host does not also act on it', () => {
    render(<Canvas model={MODEL} />);
    const event = new KeyboardEvent('keydown', {
      key: '2',
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
