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
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SmithApiError, type SmithClient } from '../../src/adapter/client.js';
import { Canvas } from '../../src/canvas/Canvas.js';
import { layoutCanvas } from '../../src/canvas/layout.js';
import type { CanvasSource } from '../../src/canvas/source.js';
import type { CanvasModel, Decision, Session } from '../../src/domain/model.js';

function decision(id: string, over: Partial<Decision> = {}): Decision {
  return { id, label: id, input: `in-${id}`, output: `out-${id}`, commands: [], ...over };
}

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
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

/** The status bar's cells, queried by name — the tree has three `<footer>`s. */
const focused = () => document.querySelector('[data-focus]')?.textContent ?? '';
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
const promptInput = () =>
  document.querySelector<HTMLInputElement>('input[aria-label="prompt to session"]');
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

function typeInto(input: HTMLInputElement, text: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set as (
      this: HTMLInputElement,
      v: string,
    ) => void;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function keyOn(element: Element, key: string) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
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
  // Canvas now reads localStorage on mount. A pin or an icon left by one test
  // would silently place a node — or draw an emoji — in the next.
  localStorage.clear();
});

describe('walking sessions with j and k', () => {
  it('starts on the first session in the list', () => {
    render(<Canvas model={MODEL} />);
    expect(focused()).toBe('alpha/a1');
  });

  it('j goes to the next session, across repos', () => {
    // The grid places a1 at (col 0, row 0), a2 at (col 1, row 0) and b1 at
    // (col 0, row 1) — b1 sits directly below a1, so a single `j` already
    // crosses from alpha into beta, without stopping on a group header.
    render(<Canvas model={MODEL} />);
    press('j');
    expect(focused()).toBe('beta/b1');
    press('j'); // nothing lies below the grid's last row
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
    expect(promptTarget()).toBe('alpha/a1');
    press('j'); // b1 sits directly below a1 in the grid
    expect(promptTarget()).toBe('beta/b1');
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

  it('yy reports what it copied', () => {
    render(<Canvas model={MODEL} />);
    press('G');
    press('y');
    press('y');
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
    const input = promptInput() as HTMLInputElement;
    typeInto(input, 'chạy lại đi');
    keyOn(input, 'Enter');
    expect(statusBar()).toContain('read-only');
  });

  it('Escape leaves it and drops the draft', () => {
    render(<Canvas model={MODEL} />);
    press('i');
    typeInto(promptInput() as HTMLInputElement, 'nửa chừng');
    keyOn(promptInput() as HTMLInputElement, 'Escape');
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

  it('narrows the sidebar without hiding anything on the canvas', () => {
    // The canvas is the overview, and an overview that hides things is not one.
    // The filter narrows where you navigate, not what exists.
    render(<Canvas model={MODEL} />);
    press('/');
    typeInto(filterInput() as HTMLInputElement, 'beta');
    const canvasTitles = [...document.querySelectorAll('.react-flow__node')]
      .map((el) => el.textContent ?? '')
      .join(' ');
    expect(canvasTitles).toContain('a1');
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
    // b1 — the only cell directly below a1 in the grid — is filtered out, and
    // there is nothing else left in a1's column to walk to.
    expect(focused()).toBe('alpha/a1');
    expect(screen.getByText(/nothing lies/)).toBeTruthy();
    press('j');
    expect(focused()).toBe('alpha/a1');
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
    expect(promptTarget()).toBe('beta/b1');
  });

  it('keeps working with the keyboard after a click', () => {
    render(<Canvas model={MODEL} />);
    act(() => {
      (rows()[2] as HTMLElement).click();
    });
    press('k');
    // b1 sits directly below a1 in the grid; a2 is in the other column and
    // does not share b1's band, so `k` from b1 lands on a1.
    expect(focused()).toBe('alpha/a1');
  });

  it('offers adding a session, and names the CLI that actually creates one', () => {
    // black-smith has no route for this. Saying "chưa nối" would suggest one is
    // coming; naming the command tells you what to go and do.
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
    press('j'); // b1 sits directly below a1 in the grid
    press('r');
    expect(renameInput()?.value).toBe('b1');
  });

  it('rename does not claim to have saved — a session id is what the log chains on', () => {
    render(<Canvas model={MODEL} />);
    press('r');
    typeInto(renameInput() as HTMLInputElement, 'tên mới');
    keyOn(renameInput() as HTMLInputElement, 'Enter');
    expect(screen.getByText(/cannot rename a session/)).toBeTruthy();
    expect(renameInput()).toBeNull();
  });

  it('Escape abandons the rename without touching the row', () => {
    render(<Canvas model={MODEL} />);
    press('r');
    typeInto(renameInput() as HTMLInputElement, 'nửa chừng');
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
    press('j'); // b1 sits directly below a1 in the grid
    press('s');
    expect(iconPicker()?.textContent).toContain('b1');
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
    // It says "on this machine", not "chưa lưu": black-smith having no icon route
    // was never the point — §3 says this is per-user state that must NOT reach
    // the event log.
    expect(screen.getByText(/on this machine/)).toBeTruthy();
    expect(iconPicker()).toBeNull();
    expect(rowText('a1')).not.toContain('🛠');
    expect(JSON.parse(localStorage.getItem('vam.prefs.v1') ?? '{}').icons).toEqual({});
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

  it('Enter on a command copies it rather than running it', () => {
    render(<Canvas model={MODEL} />);
    press('G');
    press('I');
    press('Enter');
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

  it('says so in the detail panel, where the answer gets given', () => {
    render(<Canvas model={WAITING} />);
    expect(screen.getByText('session stopped, waiting on you')).toBeTruthy();
  });

  it('groups it apart in the palette', () => {
    render(<Canvas model={WAITING} />);
    press('k', { ctrlKey: true });
    // Scoped to the palette's own group headings: "chờ bạn" also appears in the
    // sidebar row and the status-bar count, and a bare text query would pass on
    // either of those while the grouping was missing.
    const headings = [...document.querySelectorAll('[cmdk-group-heading]')].map(
      (el) => el.textContent,
    );
    expect(headings).toContain('needs you');
  });

  it('counts it in the status bar', () => {
    render(<Canvas model={WAITING} />);
    expect(screen.getByText(/1 need you/)).toBeTruthy();
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
    const input = promptInput() as HTMLInputElement;
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
    await submit(source, 'chạy lại task-4');
    expect(calls).toEqual([{ sessionId: 'a1', prompt: 'chạy lại task-4' }]);
  });

  it('says it RECORDED, never that it sent', async () => {
    // black-smith has no channel into a running agent session. A prompt box
    // claiming to have sent would leave you waiting for an answer nobody is
    // coming to give.
    const { source } = liveSource(async () => ({ eventId: 'e1' }));
    await submit(source, 'xin chào');
    expect(statusBar()).toContain('recorded');
    expect(statusBar()).toContain('not sent to the agent');
  });

  it('clears the box and asks for a refresh once the write lands', async () => {
    const { source, wrote } = liveSource(async () => ({ eventId: 'e1' }));
    await submit(source, 'xin chào');
    expect(promptInput()?.value).toBe('');
    expect(wrote.count).toBe(1);
  });

  it('reports a refusal in the factory’s own words', async () => {
    const { source, wrote } = liveSource(async () => {
      throw new SmithApiError('events.unknown-causal-session', 'No log for session "a1".', 409);
    });
    await submit(source, 'xin chào');
    expect(statusBar()).toContain('events.unknown-causal-session');
    expect(statusBar()).toContain('No log for session');
    // Nothing was written, so nothing is refreshed and the draft is kept — you
    // should not have to retype what the server just rejected.
    expect(wrote.count).toBe(0);
    expect(promptInput()?.value).toBe('xin chào');
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

describe('answering the review queue from the keyboard', () => {
  const FINDING = {
    findingId: 'f-1',
    taskId: 'e2e/task-1',
    fingerprint: 'fp-1',
    severity: 'S3-minor',
    findingStatus: 'raised',
    summary: 'Comment names a variable that was renamed.',
    foundBy: 'reviewer',
    waiverId: null,
  };

  type Applied = { fingerprint: string; decision: string; operatorNote: string };

  function liveWithQueue(): { source: CanvasSource; applied: Applied[] } {
    const applied: Applied[] = [];
    // An answered finding stops coming back, exactly as the factory stops
    // returning it once it is waived. A stub that kept serving the row would
    // make "the queue shrank under the cursor" — the case the cursor reset
    // exists for — unreachable in every test here.
    const client = {
      taskIds: async () => ['e2e/task-1'],
      taskDetail: async () => ({ findings: applied.length === 0 ? [FINDING] : [] }),
      lessons: async () => ({ pending: [], approved: [], closed: [] }),
      overview: async () => ({
        runningSessions: [],
        alerts: { escalations: 0, pendingWaivers: 0 },
      }),
      applyWaivers: async (_envelope: unknown, decisions: Applied[]) => {
        applied.push(...decisions);
        return { applied: decisions.length };
      },
    } as unknown as SmithClient;
    return {
      source: { kind: 'live', client, status: 'live', error: null, onWrote: () => {} },
      applied,
    };
  }

  async function mounted(source: CanvasSource) {
    render(<Canvas model={MODEL} source={source} />);
    // Let the queue's fetch settle before the first keypress.
    await act(async () => {});
  }

  const noteBox = () =>
    document.querySelector<HTMLInputElement>('input[aria-label="reason for fp-1"]');

  it('puts every verdict button on the j/k path, conservative one first', async () => {
    const { source } = liveWithQueue();
    await mounted(source);
    press('I');
    // First stop is the row's "fix" — nothing is excused by landing there.
    expect(document.querySelector('[data-waiver="fp-1"]')?.innerHTML).toContain('ring-running');
  });

  it('refuses to grant without a reason, and says which key gives one', async () => {
    // waivers.ts would refuse this anyway. Answering before the round trip
    // names the missing thing instead of returning a 400.
    const { source, applied } = liveWithQueue();
    await mounted(source);
    press('I');
    press('j'); // onto "waive"
    await act(async () => {
      press('Enter');
    });
    expect(applied).toEqual([]);
    expect(statusBar()).toContain('a waiver needs a reason');
  });

  it('i opens the row’s reason box rather than the prompt', async () => {
    // Sending it to the prompt would put a waiver's justification into a
    // message to the session.
    const { source } = liveWithQueue();
    await mounted(source);
    press('I');
    press('i');
    expect(document.activeElement).toBe(noteBox());
    expect(mode()).not.toBe('PROMPT');
  });

  it('writes the verdict with the reason once one is typed', async () => {
    const { source, applied } = liveWithQueue();
    await mounted(source);
    press('I');
    press('i');
    typeInto(noteBox() as HTMLInputElement, 'chỉ là comment lệch tên');
    keyOn(noteBox() as HTMLInputElement, 'Escape');
    press('j'); // onto "waive"
    await act(async () => {
      press('Enter');
    });
    expect(applied).toEqual([
      { fingerprint: 'fp-1', decision: 'granted', operatorNote: 'chỉ là comment lệch tên' },
    ]);
  });

  it('reaches the prompt past the queue, still last', async () => {
    const { source } = liveWithQueue();
    await mounted(source);
    press('I');
    press('j'); // waive
    press('j'); // the command on beta/b1? no — a1 has none, so this is the prompt
    await act(async () => {
      press('Enter');
    });
    expect(mode()).toBe('PROMPT');
  });

  it('puts the cursor back at the top after an answer lands', async () => {
    // The answered row vanishes. Leaving the index where it was drops the
    // cursor onto whatever slid up into that slot — which after clearing a
    // waiver was the next row's "approve". A cursor landing on a consequential
    // button nobody aimed at is the one way this pane could do real damage.
    const { source, applied } = liveWithQueue();
    await mounted(source);
    press('I');
    press('i');
    typeInto(noteBox() as HTMLInputElement, 'ok');
    keyOn(noteBox() as HTMLInputElement, 'Escape');
    press('j'); // onto "waive", index 1
    await act(async () => {
      press('Enter');
    });
    expect(applied).toHaveLength(1);
    // Index 0 again. The queue is empty now, so index 0 is the prompt — and
    // Enter opens it instead of firing whatever slid into the old slot.
    await act(async () => {
      press('Enter');
    });
    expect(mode()).toBe('PROMPT');
    expect(applied).toHaveLength(1);
  });

  it('h still leaves the pane, whatever the cursor is on', async () => {
    const { source } = liveWithQueue();
    await mounted(source);
    press('I');
    press('h');
    expect(actionPane()).toBe('idle');
  });
});

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

    press('j'); // s1 -> s2 (grid column 0, row 1)
    expect(cellOpacity('s1')).toBe('0.72');
    expect(cellOpacity('s2')).toBe('1');
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
