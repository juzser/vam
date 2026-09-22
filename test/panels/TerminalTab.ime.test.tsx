// @vitest-environment happy-dom

/**
 * TYPING A LANGUAGE THAT IS COMPOSED, INTO THE TERMINAL TAB.
 *
 * THE REPORT: "terminal đang không support utf-8 nên viết tiếng Việt bị lỗi?"
 * -- Vietnamese typed into the Terminal tab comes out wrong, and the guess was
 * the encoding. IT IS NOT THE ENCODING, and both ends were read before this
 * file was written: `createTmuxRunner` takes `capture-pane`'s stdout at Node's
 * default `utf8`, and the send path hands `execFile` an argv ARRAY, which Node
 * encodes as UTF-8. Nothing on either wire is latin-1.
 *
 * IT IS IME COMPOSITION, and the pane was built with no notion of it. Telex
 * types `tieengs` to produce `tiếng`: seven keydowns, of which the pane sent
 * all seven -- `strokeFor` takes any one-character `event.key` -- and the
 * eighth, the Enter that COMMITS the syllable, was sent as a Return into a
 * running agent. So the operator got `tieengs` and a submitted line.
 *
 * VAM HAD ALREADY LEARNED THIS ONE FILE OVER. `DetailPanel.tsx`'s composer
 * guards it and records the measurement: the commit key arrives as
 * `{ key: 'Enter', keyCode: 13, isComposing: true }`, and the property lives
 * on the NATIVE event -- React's synthetic keyboard event does not carry it at
 * all, so `event.isComposing` is `undefined` at runtime and a guard written
 * against it is dead while looking exactly like a live one. Every keydown
 * below therefore drives `nativeEvent.isComposing`, which is what the DOM
 * event really has: spell the guard the other way and these go red.
 *
 * AND A GUARD ALONE TYPES NOTHING. The second half is that a non-editable
 * `<section>` cannot host an input method at all, so there was never a
 * composition to guard -- the hidden `<textarea>` is what receives it, and
 * `compositionend` is what delivers the composed string. What this file CANNOT
 * prove is that Chromium really sets `isComposing` on that keystroke and
 * really fires `compositionend` with the syllable: happy-dom implements no
 * input method, so every event here is one this file built. `e2e/
 * terminal-ime-shots.mjs` drives a real composition through CDP
 * `Input.imeSetComposition` in a real Chromium for exactly that reason, and
 * the two files are halves of one guard.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cursorModeAt, focusInsertStop } from '../../src/renderer/keyboard/focus-scope.js';
import { ECHO_MS, TerminalTab } from '../../src/renderer/panels/TerminalTab.js';
import type { PaneKey, PaneSendResult, PaneView } from '../../src/shared/terminal.js';
import { MAX_KEY_TEXT } from '../../src/shared/terminal.js';

afterEach(cleanup);

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const pane = () => q<HTMLElement>('[data-terminal-pane]');
/** The visually hidden box the input method actually composes into. */
const input = () => q<HTMLTextAreaElement>('[data-terminal-input]');

const ATLAS = 'claude-code:atlas-11111111';
const NO_CURSOR = { kind: 'unreadable' } as const;
const ok = (text = 'the screen'): PaneView => ({
  kind: 'ok',
  name: 'vam-atlas-a1b2c3',
  text,
  cursor: NO_CURSOR,
});

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

async function open(sent: PaneSendResult = 'sent') {
  const read = vi.fn(async () => ok());
  const send = vi.fn(async (_project: string, _key: PaneKey, _row?: string) => sent);
  const view = render(
    <TerminalTab projectId={ATLAS} rowId={ATLAS} read={read} resize={undefined} send={send} />,
  );
  await settle();
  return { read, send, view };
}

const keys = (send: { mock: { calls: unknown[][] } }): PaneKey[] =>
  send.mock.calls.map((call) => call[1] as PaneKey);

/**
 * THE OPERATOR'S WAY IN, and the only one there is now. Nothing focuses this
 * pane on arrival any more (`TerminalTab.tsx`); `i` and `I` reach it through
 * `focusInsertStop`, which focuses the pane's first insert stop -- the pane
 * itself -- and the pane forwards the keyboard to this box a microtask later.
 * Every case below that needs the box to HOLD the keyboard says so by calling
 * this.
 */
async function enter() {
  (pane() as HTMLElement).focus();
  await settle();
}

/**
 * One composition event, carrying its `data`.
 *
 * BUILT BY HAND BECAUSE happy-dom's `CompositionEvent` DROPS IT. Measured:
 * `new CompositionEvent('compositionend', { data: 'tiếng' })` there yields an
 * event whose `data` is `undefined`, and `fireEvent.compositionEnd(el, {
 * data })` goes through that same constructor -- so every assertion about a
 * composed string would have been made against an empty one. The property is
 * defined on a plain `Event` instead, which is what React reads to build its
 * own `SyntheticCompositionEvent`.
 *
 * This is also the clearest statement of what this file cannot prove: nothing
 * here is Chromium composing. `e2e/terminal-ime-shots.mjs` is.
 */
function composition(box: HTMLElement, type: string, data: string): void {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'data', { value: data });
  fireEvent(box, event);
}

/** Compose `text` into the hidden box and commit it, as Chromium would. */
async function compose(text: string): Promise<void> {
  const box = input() as HTMLTextAreaElement;
  composition(box, 'compositionstart', '');
  composition(box, 'compositionupdate', text);
  // The IME writes its in-flight candidate into the box. React's own
  // `input` event carries it, and the box must not treat that as text to
  // send -- only the commit is.
  fireEvent.input(box, { target: { value: text } });
  composition(box, 'compositionend', text);
  await settle();
}

describe('a keystroke that belongs to an input method is not typed into the agent', () => {
  it('sends nothing for the Enter that commits a candidate', async () => {
    const { send } = await open();
    // MEASURED IN CHROMIUM, recorded by `DetailPanel.tsx`: this is what the
    // commit key looks like. Unguarded, the pane sent a Return into a live
    // agent at the end of every accented syllable.
    fireEvent.keyDown(pane() as HTMLElement, { key: 'Enter', isComposing: true });
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing for the half-typed letters a Telex syllable is made of', async () => {
    const { send } = await open();
    // `tieengs` -> `tiếng`. Every one of these is a printable one-character
    // `event.key`, which is the whole of `strokeFor`'s test for "the pane
    // wants this", so all seven used to be typed into the agent.
    for (const key of [...'tieengs']) {
      fireEvent.keyDown(pane() as HTMLElement, { key, isComposing: true });
    }
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it('leaves the keystroke to the input method rather than swallowing it', async () => {
    const { send } = await open();
    // NOT PREVENTED: the composition is mid-flight and this keystroke is what
    // advances or commits it. Claiming the event would leave the operator
    // unable to finish the syllable -- the pane would take the keys and
    // produce nothing at all, which is worse than the bug being fixed.
    expect(fireEvent.keyDown(pane() as HTMLElement, { key: 'Enter', isComposing: true })).toBe(
      true,
    );
    expect(fireEvent.keyDown(pane() as HTMLElement, { key: 'a', isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(pane() as HTMLElement, { key: 'Escape', isComposing: true })).toBe(
      true,
    );
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it('goes back to typing the moment the composition is over', async () => {
    // The guard is about a keystroke, not about a session with an IME
    // installed. The very next key with nothing composing is the key it
    // always was.
    const { send } = await open();
    fireEvent.keyDown(pane() as HTMLElement, { key: 'Enter', isComposing: true });
    await settle();
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(pane() as HTMLElement, { key: 'Enter' });
    await settle();
    expect(keys(send)).toEqual([{ kind: 'enter', shift: false }]);
  });
});

describe('the composed syllable is what reaches the agent', () => {
  it('types the committed string, once, as text', async () => {
    const { send } = await open();
    await compose('tiếng');
    expect(keys(send)).toEqual([{ kind: 'text', text: 'tiếng' }]);
  });

  it('empties the hidden box, so the next syllable starts from nothing', async () => {
    await open();
    await compose('tiếng');
    // The box is a staging area for the input method and holds no value of
    // its own. Left full, the next commit would be drawn against stale text
    // and `input` would keep firing over it.
    expect(input()?.value).toBe('');
  });

  it('sends nothing for a composition the operator cancelled', async () => {
    const { send } = await open();
    const box = input() as HTMLTextAreaElement;
    composition(box, 'compositionstart', '');
    composition(box, 'compositionupdate', 'tieng');
    // Escape ends a composition with an empty commit. An empty `text` key
    // fails `isPaneKey` in main, whose answer for a malformed ask is
    // `unaimed` -- a sentence about pairing, drawn for a syllable the
    // operator deliberately threw away.
    composition(box, 'compositionend', '');
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it('splits a commit longer than the channel takes, in order', async () => {
    const { send } = await open();
    const long = 'あ'.repeat(MAX_KEY_TEXT + 4);
    await compose(long);
    const sent = keys(send).map((key) => (key as { readonly text: string }).text);
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.join('')).toBe(long);
  });

  it('reads the pane back as soon as the syllable lands, like any other key', async () => {
    // `ECHO_MS` exists because a typed character otherwise waited up to a
    // full second for the next interval tick. A composed one has the same
    // right to appear: without this, Vietnamese types invisibly.
    const { read } = await open();
    const before = read.mock.calls.length;
    await compose('tiếng');
    expect(read.mock.calls.length).toBeGreaterThan(before);
    expect(ECHO_MS).toBeGreaterThan(0);
  });

  it('queues behind the keys already typed rather than overtaking them', async () => {
    // The chain exists because Return overtaking a half-typed line SUBMITS
    // it. A composition is several spawns of its own and must join the same
    // queue, not race it.
    const pending: { key: PaneKey; settle: (result: PaneSendResult) => void }[] = [];
    const send = vi.fn(
      (_project: string, key: PaneKey) =>
        new Promise<PaneSendResult>((resolve) => {
          pending.push({ key, settle: resolve });
        }),
    );
    render(
      <TerminalTab
        projectId={ATLAS}
        rowId={ATLAS}
        read={vi.fn(async () => ok())}
        resize={undefined}
        send={send}
      />,
    );
    await settle();
    fireEvent.keyDown(pane() as HTMLElement, { key: 'x' });
    await settle();
    await compose('tiếng');
    // The `x` has not answered yet, so the syllable has not been sent.
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending[0]?.settle('sent');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pending.map((call) => call.key)).toEqual([
      { kind: 'text', text: 'x' },
      { kind: 'text', text: 'tiếng' },
    ]);
  });

  it('types nothing at all where there is no send path', async () => {
    // The browser build. A surface that cannot deliver must not consume, and
    // must not leave the operator's syllable sitting in a hidden box either.
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => ok())}
        resize={undefined}
        send={undefined}
      />,
    );
    await settle();
    await compose('tiếng');
    expect(input()?.value).toBe('');
  });

  it('drops text that arrived without a composition instead of typing it', async () => {
    // A paste, a drop, the emoji picker: all of them write into the hidden
    // box. None of them is a keystroke, and this channel is bounded at
    // sixteen characters precisely so that it cannot become a paste into a
    // running agent -- so the box is emptied and nothing is sent, which is
    // exactly what happened before it existed.
    const { send } = await open();
    const box = input() as HTMLTextAreaElement;
    fireEvent.input(box, { target: { value: 'a whole pasted paragraph' } });
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(box.value).toBe('');
  });
});

describe('the pane says what is being composed, because the box that holds it is invisible', () => {
  it('draws the in-flight candidate while it is being typed', async () => {
    await open();
    const box = input() as HTMLTextAreaElement;
    composition(box, 'compositionstart', '');
    composition(box, 'compositionupdate', 'tieeng');
    await settle();
    // Without this the operator types into a hole: the box is hidden, the
    // agent has not been sent anything yet, and the screen is a snapshot of
    // a pane where nothing has happened.
    expect(q('[data-terminal-composing]')?.textContent).toContain('tieeng');
  });

  it('takes it away again once the syllable has been sent', async () => {
    await open();
    await compose('tiếng');
    // It is a claim about what is IN FLIGHT. Left on screen it would be a
    // second, stale copy of text that is now in the agent's own pane.
    expect(q('[data-terminal-composing]')).toBeNull();
  });
});

describe('the hidden box does not take the pane’s place', () => {
  it('leaves the pane as the one insert stop, and is not one itself', async () => {
    // `focusInsertStop` takes the FIRST `data-insert-stop` in the pane in
    // document order and focuses it blindly. A hidden box carrying the mark
    // would become that first match -- and `I` would then land the keyboard
    // on a box that is not the pane, in a surface whose whole contract is
    // that the pane is the thing the keyboard is in.
    await open();
    const stops = document.querySelectorAll('[data-insert-stop]');
    expect(stops).toHaveLength(1);
    expect(stops[0]?.hasAttribute('data-terminal-pane')).toBe(true);
    expect(input()?.hasAttribute('data-insert-stop')).toBe(false);
  });

  it('still lets `I` land on the pane, and reports that it landed', async () => {
    const { view } = await open();
    (input() as HTMLTextAreaElement).blur();
    // The exact call `Canvas.tsx` makes for `I`, and the exact thing it
    // believes the answer means: `false` makes it refuse out loud with
    // "nothing in this pane takes the keyboard". `focusInsertStop` focuses
    // the stop and then asks `document.activeElement === stop` in the same
    // breath -- so forwarding to the box synchronously would make this false
    // every time, and `I` would refuse on a pane that works.
    expect(focusInsertStop(view.container)).toBe(true);
    // And a tick later the box has it, which is the half that makes `I` a
    // usable landing rather than a claim: the operator's next syllable needs
    // something an input method can compose into.
    await settle();
    expect(document.activeElement).toBe(input());
  });

  it('hands the keyboard over on a click that selected nothing', async () => {
    const { view } = await open();
    (input() as HTMLTextAreaElement).blur();
    const box = pane() as HTMLElement;
    // A click is pointerdown, a focus that lands on the pane, and pointerup.
    // The focus is NOT forwarded while the pointer is down -- see the drag
    // case below for what that protects.
    fireEvent.pointerDown(box);
    box.focus();
    await settle();
    expect(document.activeElement).toBe(box);
    fireEvent.lostPointerCapture(box);
    expect(document.activeElement).toBe(input());
    expect(focusInsertStop(view.container)).toBe(true);
  });

  /**
   * THE STUCK FLAG, AND WHY IT REINSTATES THE WHOLE BUG.
   *
   * The suppression that protects a drag is a boolean, and a boolean set on
   * `pointerdown` has to be cleared on every way a press can END. The first
   * cut of this pane cleared it in an `onPointerUp` ON THE PANE, so it was
   * cleared only when the pointer came up OVER the pane. Press inside and
   * release outside -- the ORDINARY way a person drags out to select the last
   * line of a terminal -- and the pane is not on the event's path at all: the
   * flag stays set for the life of the component, the focus forward returns
   * early every time, the box never takes the keyboard again, and Vietnamese
   * goes straight back to leaking `tieengs` into a running agent.
   *
   * IT SELF-HEALS ON THE SECOND KEYSTROKE, which is exactly what made it
   * invisible by hand: `onKeyDown` re-arms the box, so only the FIRST
   * character of the next syllable is typed raw and everything after it looks
   * right.
   *
   * THE FIX IS POINTER CAPTURE, and these two cases are the two halves of it
   * that this environment can hold. happy-dom has `setPointerCapture` as a
   * stub -- it neither retargets a release nor fires `lostpointercapture` --
   * so what is proved here is that the pane ASKS for the capture, and that
   * losing it ends the gesture. That the browser then really delivers the
   * release to a captured element wherever the pointer physically goes up is
   * `e2e/terminal-ime-shots.mjs`'s to prove, and it drags off the pane to do
   * it.
   */
  it('takes pointer capture, which is what makes a release reach it wherever it lands', async () => {
    await open();
    const box = pane() as HTMLElement;
    const captured: number[] = [];
    box.setPointerCapture = (pointerId: number) => {
      captured.push(pointerId);
    };
    fireEvent.pointerDown(box, { pointerId: 7 });
    expect(captured).toEqual([7]);
  });

  it('hands the keyboard back when the gesture ends, however it ended', async () => {
    await open();
    (input() as HTMLTextAreaElement).blur();
    const box = pane() as HTMLElement;
    fireEvent.pointerDown(box);
    box.focus();
    await settle();
    // Suppressed while the pointer is down: this is the focus that would
    // otherwise collapse the selection being made.
    expect(document.activeElement).toBe(box);
    // `lostpointercapture` is the ONE end of a gesture -- a release over the
    // pane, a release anywhere else, a cancelled pointer and the element being
    // removed all arrive here, instead of a release handler that hears only
    // one of the four.
    fireEvent.lostPointerCapture(box);
    expect(document.activeElement).toBe(input());
    // And the suppression is really gone, not merely bypassed once: the next
    // focus that lands on the pane is forwarded too.
    (input() as HTMLTextAreaElement).blur();
    box.focus();
    await settle();
    expect(document.activeElement).toBe(input());
  });

  it('leaves the keyboard alone when the gesture selected text, so the copy survives', async () => {
    // MEASURED IN CHROMIUM: focusing a text control collapses the document
    // selection. Forwarding at `pointerdown` made a drag across the screen
    // select nothing at all -- and mouse selection is the only way there is to
    // copy text out of this tab.
    const { view } = await open();
    (input() as HTMLTextAreaElement).blur();
    const box = pane() as HTMLElement;
    const selection = { isCollapsed: false } as unknown as Selection;
    const spy = vi.spyOn(globalThis, 'getSelection').mockReturnValue(selection);
    try {
      fireEvent.pointerDown(box);
      box.focus();
      await settle();
      fireEvent.lostPointerCapture(box);
      expect(document.activeElement).toBe(box);
    } finally {
      spy.mockRestore();
    }
    // AND THE HOLE IS CLOSED BY THE NEXT KEYSTROKE. A copy gesture owns the
    // keyboard only until the operator types; without this the pane would sit
    // in a state where keys are delivered but nothing can be composed, which
    // is the original bug in a corner.
    fireEvent.keyDown(box, { key: 'h' });
    await settle();
    expect(document.activeElement).toBe(input());
    expect(focusInsertStop(view.container)).toBe(true);
  });

  it('hands the keyboard to the hidden box, which is where a composition can happen', async () => {
    await open();
    await enter();
    // THE WHOLE POINT OF THE BOX. A `<section>` is not editable, so an input
    // method has nothing to compose into and the operator's syllable never
    // exists. What holds the keyboard has to be a real editable element.
    expect(document.activeElement).toBe(input());
    // And the mode is still Insert, because the mark that decides it is on
    // the pane this box sits inside -- not on the box.
    expect(cursorModeAt(document.activeElement)).toBe('insert');
    expect(pane()?.contains(input())).toBe(true);
  });

  it('keeps Tab as the way out, and does not swallow it', async () => {
    // The pane's accessible name promises "press Tab to leave", and Tab is
    // the only key that does now that Escape is the pane's. A box that took
    // Tab for itself would close the one exit.
    const { send } = await open();
    expect(fireEvent.keyDown(input() as HTMLElement, { key: 'Tab' })).toBe(true);
    await settle();
    expect(send).not.toHaveBeenCalled();
    // And it is reachable BY Tab as well: the box is the pane's tab stop, so
    // the focus order still arrives somewhere that can take a composition.
    expect(input()?.tabIndex).toBe(0);
    // The pane itself is out of the tab order on purpose: as a tab stop it
    // sits before the box in document order, so Shift+Tab out of the box
    // would land on it and be handed straight back -- a focus trap.
    expect(pane()?.tabIndex).toBe(-1);
  });

  it('still says the pane has focus while the hidden box holds it', async () => {
    // The corner hint is the only thing on screen that says where the keys
    // are going. Focus moved one element deeper; the claim must not.
    await open();
    await enter();
    expect(q('[data-terminal-exit-hint]')).not.toBeNull();
    (input() as HTMLTextAreaElement).blur();
    await settle();
    expect(q('[data-terminal-exit-hint]')).toBeNull();
  });
});
