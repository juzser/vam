// @vitest-environment happy-dom

/**
 * THE BARE VIEW DIGIT, MEASURED IN A RENDERED PANE.
 *
 * `test/keyboard/select-digits.test.ts` proves what the grammar resolves. This
 * file asks the only other question worth asking: does the VIEW CHANGE, and
 * does it stay put everywhere it must.
 *
 * The operator asked for a one-key view switch "only in Select mode", so the
 * interesting half of this file is the refusals:
 *
 *   - the composer, which is the INPUT|TEXTAREA the typing guard already
 *     covers;
 *   - an insert scope that is NOT a text box, which the tag-name guard cannot
 *     see and `isSelectOnlyChord` is what stands down for — the question card
 *     stands in for the TERMINAL PANE here, the same substitution
 *     `Canvas.half-page.test.tsx` makes for `Ctrl-D` and for the same reason
 *     (both are a `section`/`div` carrying `data-insert-scope`, and the
 *     terminal itself is driven in `test/panels/TerminalTab.typing.test.tsx`);
 *   - and the key must still be TYPEABLE, which is a stronger claim than "the
 *     view did not change": a swallowed digit and a delivered one look
 *     identical from the view bar, so every refusal below also asserts the
 *     default was left alone.
 *
 * And the three-key chord must still fire from inside the box, because that is
 * the property the short spelling was added BESIDE rather than instead of.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { NO_BINDINGS, setActiveBindings } from '../../src/renderer/keyboard/chords.js';
import { cursorModeAt } from '../../src/renderer/keyboard/focus-scope.js';

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [{ id: `d-${id}`, label: id, input: `in-${id}`, output: `out-${id}`, commands: [] }],
    ...over,
  };
}

const MODEL: CanvasModel = {
  projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1')] }],
};

/** The same project with a question open, so `I` lands the keyboard on an
 *  insert scope that is no text box at all. */
const ASKING: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'factory',
      sessions: [
        session('a1', {
          questions: [
            {
              id: 'toolu_1:0',
              header: 'Colour',
              question: 'Which colour?',
              multiSelect: false,
              options: [{ label: 'Crimson', description: 'a deep red' }],
              answer: null,
            },
          ],
        }),
      ],
    },
  ],
};

beforeEach(() => setActiveBindings(NO_BINDINGS));
afterEach(() => {
  setActiveBindings(NO_BINDINGS);
  cleanup();
});

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const pressed = (view: string) => q(`[data-view="${view}"]`)?.getAttribute('aria-pressed');
const note = () => q<HTMLElement>('[data-view-note]');
const mode = () => document.querySelector('[data-mode]')?.textContent ?? '';

/**
 * A BARE digit keydown, carrying its PHYSICAL key — which is what the grammar
 * spells the binding off, and what makes `character` a free parameter.
 */
function digit(
  character: string,
  code: number,
  extra: KeyboardEventInit = {},
  target: EventTarget = window,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: character,
    code: `Digit${code}`,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** The same, from whatever holds the keyboard right now. */
const fromCaret = (character: string, code: number, extra: KeyboardEventInit = {}) =>
  digit(character, code, extra, document.activeElement ?? window);

const press = (key: string) => {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
};

describe('in Select, one key switches the view', () => {
  it('opens PRs on a bare 2', () => {
    render(<Canvas model={MODEL} />);
    expect(mode()).toBe('Select');
    const event = digit('2', 2);
    expect(pressed('prs')).toBe('true');
    expect(note()).toBeNull();
    // Cancelled like every other chord this grammar answers, so nothing is
    // left over for the browser to do with the keystroke.
    expect(event.defaultPrevented).toBe(true);
  });

  it('opens Agents on a bare 4, and comes back to Response on a bare 1', () => {
    render(<Canvas model={MODEL} />);
    digit('4', 4);
    expect(pressed('agents')).toBe('true');
    digit('1', 1);
    expect(pressed('response')).toBe('true');
  });

  /**
   * THE LAYOUT IS NOT THE BINDING. AZERTY puts `&` on the unshifted `Digit1`
   * and `é` on `Digit2`; the view that opens is the one the KEY'S PLACE names.
   * Driven here as well as in the grammar test because this is the layer an
   * operator on that keyboard actually meets.
   */
  it('opens PRs from an AZERTY `é`, because the binding is a position', () => {
    render(<Canvas model={MODEL} />);
    digit('é', 2);
    expect(pressed('prs')).toBe('true');
  });

  /**
   * SHIFT+DIGIT WAS THE OPERATOR'S OTHER SUGGESTION AND IS NOT BOUND. It must
   * reach nothing AND be left typeable — `!` is a character, and the `!`
   * typeahead in the composer is a real feature one pane over.
   */
  it('leaves Shift+digit alone, and does not cancel it', () => {
    render(<Canvas model={MODEL} />);
    const event = digit('!', 1, { shiftKey: true });
    expect(pressed('response')).toBe('true');
    expect(event.defaultPrevented).toBe(false);
  });

  it('refuses a digit past the last view aloud, the same way the chord does', () => {
    render(<Canvas model={MODEL} />);
    digit('6', 6);
    expect(pressed('response')).toBe('true');
    expect(note()?.getAttribute('role')).toBe('status');
    expect(note()?.textContent ?? '').toContain('no view 6');
  });

  it('refuses a withdrawn view BY NAME, never sliding onto its neighbour', () => {
    render(<Canvas model={MODEL} />);
    expect(q('[data-view="terminal"]')).toBeNull();
    digit('3', 3);
    expect(pressed('response')).toBe('true');
    expect(pressed('agents')).toBe('false');
    expect(note()?.textContent ?? '').toContain('Terminal');
  });

  it('does nothing on a bare 0, which still belongs to z0', () => {
    render(<Canvas model={MODEL} />);
    const event = digit('0', 0);
    expect(pressed('response')).toBe('true');
    expect(note()).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('in Insert, the digit is text and nothing else', () => {
  it('leaves the composer its digit — the view does not move and the key is not eaten', () => {
    render(<Canvas model={MODEL} />);
    press('i');
    expect(mode()).toBe('Insert');
    const event = fromCaret('2', 2);
    expect(pressed('prs'), 'a typed digit switched a view').toBe('false');
    expect(pressed('response')).toBe('true');
    expect(event.defaultPrevented, 'the composer never received its digit').toBe(false);
    expect(note()).toBeNull();
  });

  /**
   * THE CASE NO TAG NAME COULD HAVE CAUGHT. An insert scope that is not an
   * INPUT or a TEXTAREA — the question card here, the TERMINAL PANE in
   * production — passes `Canvas.tsx`'s typing guard untouched, so without
   * `isSelectOnlyChord` a bare digit aimed at somebody's running agent would
   * have switched the view under it instead.
   */
  it('stands down on an insert scope that is no text box, which stands in for the terminal', () => {
    render(<Canvas model={ASKING} />);
    press('I');
    expect(mode()).toBe('Insert');
    expect(document.activeElement?.hasAttribute('data-question-option')).toBe(true);
    const event = fromCaret('2', 2);
    expect(pressed('prs')).toBe('false');
    expect(event.defaultPrevented).toBe(false);
  });

  /**
   * AND THE THREE-KEY CHORD STILL FIRES THERE, which is the half that must not
   * move: it is the reason `Ctrl-Alt-<digit>` was kept rather than replaced.
   * A stand-down written as `isSelectOnly(action)` — a predicate over the ACT
   * — would have taken this with it, and this is the case that says so.
   */
  it('still takes Ctrl+Option+<digit> from inside the prompt box', () => {
    render(<Canvas model={MODEL} />);
    press('i');
    expect(mode()).toBe('Insert');
    const event = fromCaret('2', 2, { ctrlKey: true, altKey: true });
    expect(pressed('prs'), 'the view chord did not fire from the composer').toBe('true');
    expect(event.defaultPrevented).toBe(true);
  });

  it('works again the moment the keyboard comes back to Select', () => {
    render(<Canvas model={MODEL} />);
    press('i');
    fromCaret('4', 4);
    expect(pressed('agents')).toBe('false');
    press('Escape');
    expect(mode()).toBe('Select');
    digit('4', 4);
    expect(pressed('agents')).toBe('true');
  });
});

/**
 * THE BOXES THAT HOLD A CARET AND CARRY NO INSERT SCOPE — the OTHER
 * population, and the one guarded by the OTHER guard.
 *
 * `Canvas.tsx`'s `answeringKeys` names them: "the command palette's filter,
 * the search line, a rename field… they are overlays and inline edits rather
 * than places the pane cursor lives, so they carry no scope; they still hold a
 * caret in the middle of a word". `FilesTab.tsx` puts its tree FILTER and its
 * "new file" box in the same population by name, deliberately unmarked,
 * "because a native `<input>` is already exempt from vam's chord grammar by
 * tag name (`Canvas.tsx`'s own `typing` guard)".
 *
 * So the status bar reads SELECT while one of these has the keyboard, and
 * `isSelectOnlyChord` — which asks the cursor MODE — cannot help. What holds
 * here is the `typing` clause alone, and these cases exist to redden if it is
 * removed or narrowed. Each asserts BOTH halves: the view stayed put, AND the
 * keystroke was left uncancelled so the character actually gets typed.
 */
describe('a caret outside any insert scope keeps its digit too', () => {
  /** Open a box, put the keyboard in it, and prove it is in NO insert scope —
   *  which is the premise the whole describe rests on, so it is asserted per
   *  case rather than stated once in prose. */
  const caretIn = (selector: string, what: string): HTMLInputElement => {
    const box = q<HTMLInputElement>(selector);
    expect(box, `${what} did not open`).not.toBeNull();
    const found = box as HTMLInputElement;
    act(() => found.focus());
    expect(document.activeElement, `${what} did not take the keyboard`).toBe(found);
    // Read through the grammar's own predicate rather than off the status bar:
    // the bar has a third caption for filtering, and what decides the
    // stand-down is `cursorModeAt`.
    expect(cursorModeAt(found), `${what} must not claim an insert scope`).toBe('select');
    return found;
  };

  it('leaves the SEARCH LINE its digits, with the cursor mode still Select', () => {
    render(<Canvas model={MODEL} />);
    press('/');
    caretIn('input[aria-label="filter sessions"]', 'the search line');
    const event = fromCaret('2', 2);
    expect(pressed('prs'), 'a digit typed into the search line switched a view').toBe('false');
    expect(event.defaultPrevented, 'the search line never received its digit').toBe(false);
  });

  it('leaves a RENAME FIELD its digits, with the cursor mode still Select', () => {
    render(<Canvas model={MODEL} />);
    press('r');
    caretIn('input[aria-label="rename session"]', 'the rename field');
    const event = fromCaret('7', 7);
    expect(event.defaultPrevented, 'the rename field never received its digit').toBe(false);
    // `7` names no view, so the proof it did not reach the grammar is the
    // absence of the refusal the grammar would have spoken.
    expect(note(), 'the view picker answered a digit typed into a rename field').toBeNull();
  });

  /**
   * AND THE SHAPE ITSELF, which is what stands in for the Files tab's filter
   * and its "new file" box without this file reaching into a component another
   * change is editing. Both are plain `<input>`s outside every scope, by that
   * file's own decision; this is that shape, focused, in a real canvas.
   */
  it('leaves ANY unscoped input or textarea its digits', () => {
    render(<Canvas model={MODEL} />);
    for (const tag of ['input', 'textarea'] as const) {
      const box = document.createElement(tag);
      document.body.append(box);
      box.focus();
      expect(document.activeElement, `the ${tag} did not take the keyboard`).toBe(box);
      // Not in any insert scope — the premise, asserted rather than assumed.
      expect(box.closest('[data-insert-scope]')).toBeNull();
      const event = digit('3', 3, {}, box);
      expect(pressed('response'), `a digit typed into a bare ${tag} switched a view`).toBe('true');
      expect(event.defaultPrevented, `a bare ${tag} never received its digit`).toBe(false);
      box.remove();
    }
  });
});

describe('the operator still owns the key', () => {
  it('follows a rebind of the bare slot, and the old digit goes quiet', () => {
    render(<Canvas model={MODEL} />);
    // AFTER the render — `prefs.ts` hands the grammar the stored overrides on
    // every read, and mounting is a read.
    setActiveBindings({ 'pickView:2': ['Ctrl-Alt-2', 'q'] });
    digit('2', 2);
    expect(pressed('prs'), 'the unbound digit still fired').toBe('false');
    press('q');
    expect(pressed('prs')).toBe('true');
  });
});
