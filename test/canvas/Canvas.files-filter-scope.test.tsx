// @vitest-environment happy-dom

/**
 * THE FILE FILTER IS A PLACE THE KEYBOARD CAN BE STUCK — the operator's own
 * report, translated: "when the file filter is focused, I can't press Cmd-0
 * to get back to select mode — so should the file filter be insert mode?"
 *
 * They are right, and this file is the pin for both halves of the answer.
 *
 * WHAT WAS MEASURED IN CHROMIUM BEFORE ANY OF THIS WAS WRITTEN, with the
 * keyboard really in the box (`e2e/files-tab-keyboard-shots.mjs` runs the
 * same sequence now):
 *
 *   - `Meta+0` was CLAIMED (`defaultPrevented: true`) and moved nothing. The
 *     grammar resolved it to `focusList`, `releaseInsert` found no insert
 *     scope around an unmarked `<input>` and returned `false`, and the status
 *     bar printed "the keyboard is already on the session list" — a sentence
 *     that was false twice over: the keyboard was in the filter, and it had
 *     not moved. The mode chip read Select the whole time.
 *   - `Meta+Shift+h`, `focusList`'s other chord, did exactly the same.
 *   - `Escape` DID leave, to `document.body`. So the box had one working way
 *     out and the DOCUMENTED one was dead.
 *
 * THE OLD ARGUMENT, AND WHY IT WAS ONLY HALF AN ARGUMENT. `FilesTab.tsx`
 * recorded the filter as deliberately UNMARKED: a native `input` is already
 * exempt from the chord grammar by tag name, so nothing needed to be marked
 * to make typing safe. That is true and is still true. It answers "does this
 * box STEAL chords" and never asks "how does the operator get OUT", and
 * getting out is the half `data-insert-scope` actually owns — `releaseInsert`
 * blurs what is inside a scope and nothing else, so an unmarked box is one
 * `focusList` cannot reach into. The mark is the escape hatch, not a claim on
 * the grammar.
 *
 * AND THE DISTINCTION IS WHAT MOST OF THIS FILE ASSERTS. A text box that
 * started swallowing chords would be a worse trap than the one being fixed,
 * so every chord that worked from inside the box before is checked to still
 * work: `Mod-p` (both the reach and the second-press restart), `Mod-1`, and
 * an ordinary character still typing an ordinary character.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { INSERT_SCOPE, INSERT_STOP } from '../../src/renderer/keyboard/focus-scope.js';

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
    decisions: [{ id: `${id}-d`, label: 'plan', input: 'in', output: 'out', commands: [] }],
    ...over,
  };
}

const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'factory', sessions: [session('a1'), session('a2')] },
  ],
};

const SIGNATURE = { size: 3, mtimeMs: 1, sha256: 'abc' };

class FakeResizeObserver {
  constructor(readonly callback: () => void) {}
  observe() {}
  disconnect() {}
}

/**
 * The file bridge, read off `window.api.files` inside `DetailPanel` — the same
 * seam `DetailPanel.files-tab.test.tsx` sets, and what makes `Canvas.tsx`'s
 * own `filesTab` flag (`window.api?.files !== undefined`) true so the view
 * pill draws a Files icon at all.
 */
function withFileBridge() {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      files: {
        list: async () => ({
          root: '/work/alpha',
          files: ['/work/alpha/.env', '/work/alpha/src/index.ts'],
          truncated: false,
        }),
        read: async () => ({ content: 'A=1', isBinary: false, signature: SIGNATURE }),
        write: async () => ({ signature: SIGNATURE }),
      },
    },
  });
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: FakeResizeObserver,
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'api');
});

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const qa = <T extends Element>(selector: string) => [...document.querySelectorAll<T>(selector)];

const mode = () => q('[data-mode]')?.textContent ?? '';
const statusText = () => q('[data-status-bar] [data-status]')?.textContent ?? '';
const filterBox = () => q<HTMLInputElement>('[data-files-filter]');

/**
 * A keydown on whatever really holds focus, `cancelable` so
 * `preventDefault()` is not the specified no-op it is on an event built
 * without it — `Canvas.tsx`'s `if (event.defaultPrevented) return` goes inert
 * otherwise and every case below runs with BOTH listeners handling the key.
 * Returns whether anything claimed it.
 */
function pressFocused(key: string, modifiers: KeyboardEventInit = {}): boolean {
  const target = document.activeElement ?? window;
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

/** `Mod-0`, spelled the way a real macOS keydown spells it — the CODE carries
 *  the position, which is why `chords.ts` reads it for the digit row. */
const pressModZero = () => pressFocused('0', { metaKey: true, code: 'Digit0' });

/** Render the canvas, open the Files view, and put the keyboard in the filter
 *  the way the operator does: `Mod-p`, the chord the placeholder names. */
async function openFilter(): Promise<HTMLInputElement> {
  withFileBridge();
  render(<Canvas model={MODEL} />);
  await act(async () => {
    q<HTMLButtonElement>('[data-view="files"]')?.click();
    await Promise.resolve();
  });
  const box = filterBox();
  expect(box).not.toBeNull();
  act(() => {
    (box as HTMLInputElement).focus();
    fireEvent.focusIn(box as HTMLInputElement);
  });
  expect(document.activeElement).toBe(box);
  return box as HTMLInputElement;
}

describe('the file filter is an insert scope', () => {
  it('so the status bar calls it Insert while the caret is in it', async () => {
    const box = await openFilter();
    // The CLAIM, not the attribute: the chip is the mode, and the mode is
    // `cursorModeAt(document.activeElement)`.
    expect(mode()).toBe('Insert');
    act(() => {
      box.blur();
      fireEvent.focusOut(box, { relatedTarget: null });
    });
    expect(mode()).toBe('Select');
  });

  it('and it is a scope only — never a stop, or `I` would land here', async () => {
    await openFilter();
    // `focusInsertStop` takes the FIRST `data-insert-stop` in the pane in
    // document order, and the tree is mounted before the composer. A stop mark
    // here would take `I` off the prompt box on every other tab.
    //
    // COUNTED FIRST, because a loop over a selector that matched nothing is a
    // green assertion about no elements at all — this tab draws exactly two
    // text boxes in its tree, the filter and the "new file" name.
    const boxes = qa('[data-files] input');
    expect(boxes).toHaveLength(2);
    for (const box of boxes) {
      expect(box.hasAttribute(INSERT_SCOPE)).toBe(true);
      expect(box.hasAttribute(INSERT_STOP)).toBe(false);
    }
  });
});

describe('Mod-0 gets the keyboard back out of the file filter', () => {
  it('releases it, rather than claiming the key and moving nothing', async () => {
    const box = await openFilter();
    expect(pressModZero()).toBe(true);
    expect(document.activeElement).not.toBe(box);
    expect(mode()).toBe('Select');
  });

  it('and never says the keyboard was already on the list while it was in the box', async () => {
    await openFilter();
    pressModZero();
    // The measured lie: `releaseInsert` returned false on an unmarked input,
    // `cursorMode` read Select, and the refusal for "you are already there"
    // fired at an operator who was not.
    expect(statusText()).not.toBe('the keyboard is already on the session list');
  });

  it('does the same for Mod-Shift-h, focusList’s other chord', async () => {
    const box = await openFilter();
    expect(pressFocused('h', { metaKey: true, shiftKey: true })).toBe(true);
    expect(document.activeElement).not.toBe(box);
    expect(mode()).toBe('Select');
  });

  it('and Escape still leaves too — two routes out, both working', async () => {
    const box = await openFilter();
    act(() => {
      fireEvent.keyDown(box, { key: 'Escape', bubbles: true, cancelable: true });
    });
    expect(document.activeElement).not.toBe(box);
    expect(mode()).toBe('Select');
  });
});

/**
 * THE OTHER HALF — the mark is an escape hatch and not a licence to eat keys.
 * Each of these worked from inside the box before the mark and must still.
 */
describe('the filter does not start swallowing the grammar', () => {
  it('types an ordinary character instead of acting on it', async () => {
    const box = await openFilter();
    // Unmodified keys never reach the window grammar from a text box
    // (`Canvas.tsx`'s own typing guard), and that is unchanged by the mark:
    // the key is unclaimed and the box keeps it.
    expect(pressFocused('j')).toBe(false);
    act(() => {
      fireEvent.change(box, { target: { value: 'env' } });
    });
    expect(filterBox()?.value).toBe('env');
    expect(document.activeElement).toBe(box);
  });

  it('keeps Mod-p, and a second press still selects what is there', async () => {
    const box = await openFilter();
    act(() => {
      fireEvent.change(box, { target: { value: 'env' } });
    });
    expect(pressFocused('p', { metaKey: true })).toBe(true);
    expect(document.activeElement).toBe(filterBox());
    expect(filterBox()?.selectionStart).toBe(0);
    expect(filterBox()?.selectionEnd).toBe(3);
  });

  it('keeps Mod-1, so another tab is still one chord away', async () => {
    await openFilter();
    expect(pressFocused('1', { metaKey: true, code: 'Digit1' })).toBe(true);
  });
});

/**
 * THE SAME TRAP, THE SAME TAB — the "new file" box is the filter's sibling,
 * shares its `onBoxKeyDown`, and was measured in Chromium doing exactly the
 * same thing: `Meta+0` claimed, focus unmoved, the same false sentence on the
 * bar. `FilesTab.tsx`'s header argued the two together and was wrong about
 * both for the same reason, so they are fixed together.
 */
describe('the new-file box is the same box by construction', () => {
  it('reads Insert, and Mod-0 gets out of it too', async () => {
    withFileBridge();
    render(<Canvas model={MODEL} />);
    await act(async () => {
      q<HTMLButtonElement>('[data-view="files"]')?.click();
      await Promise.resolve();
    });
    const box = q<HTMLInputElement>('[data-files-new] input');
    expect(box).not.toBeNull();
    act(() => {
      (box as HTMLInputElement).focus();
      fireEvent.focusIn(box as HTMLInputElement);
    });
    expect(mode()).toBe('Insert');
    expect(pressModZero()).toBe(true);
    expect(document.activeElement).not.toBe(box);
    expect(mode()).toBe('Select');
  });
});
