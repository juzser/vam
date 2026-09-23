// @vitest-environment happy-dom

/**
 * TEXT THAT ARRIVES ALREADY COMPOSED, WITH NO COMPOSITION SESSION AT ALL.
 *
 * THE REPORT, translated: "When typing Vietnamese in tmux (the Terminal tab),
 * some special letters like ố, ồ … get lost, and then as I keep typing,
 * characters keep getting deleted one after another."
 *
 * THE OPERATOR RUNS OPENKEY (github.com/tuyenvm/OpenKey), not (only) a
 * standard macOS input source. OpenKey is not an input method in the sense
 * `TerminalTab.ime.test.tsx` already covers -- it holds no marked-text
 * session with Chromium at all. It is a `CGEventTap` that watches raw Telex
 * keystrokes and, the moment a later key changes an earlier letter (`toois`
 * -> `tối`, doubling `o` into `ô`, a tone key moving a mark), posts two kinds
 * of SYNTHETIC key event at the OS queue: one Backspace keyDown/keyUp pair
 * per character to erase (`SendBackspace`, `Sources/OpenKey/macOS/ModernKey
 * /OpenKey.mm`, one CGEvent pair per call, looped), and then ONE keyDown/keyUp
 * pair carrying the WHOLE corrected string via `CGEventKeyboardSetUnicodeString`
 * (`SendNewCharString`, same file) -- not one character at a time. Neither
 * event opens a marked-text/composition session, so `isComposing` is `false`
 * on whatever the replacement arrives as.
 *
 * WHICH IS NOT A `keydown`, MEASURED AGAINST A REAL CHROMIUM. The first cut of
 * this fix widened `strokeFor`'s `key.length === 1` rule on the argument
 * (`Option+e`'s dead-key result, which really does carry its composed
 * character on a `keydown`) that a synthetic multi-character key event would
 * do the same. It does not: driving Chromium over CDP with
 * `Input.dispatchKeyEvent({ type: 'keyDown', key: 'ối', ... })` -- one code
 * unit longer than a single character -- produced a `keydown` whose `key` was
 * the EMPTY STRING, not `'ối'`; `Input.insertText({ text: 'ối' })` and a raw
 * CDP `type: 'char'` event, with NO prior `Input.imeSetComposition` call,
 * produced no `keydown` at all -- only `beforeinput` and `input`,
 * `isComposing: false`, `inputType: 'insertText'`, carrying the whole string
 * as `data`. A single accented CHARACTER still arrives on a `keydown` fine
 * (`key: 'ố'` alone survives CDP dispatch unchanged, matching the existing
 * one-code-unit rule); it is specifically a REPLACEMENT LONGER THAN ONE
 * CHARACTER -- which `SendNewCharString` sends whole, and which most of what
 * OpenKey corrects is -- that Chromium can only express as an insertion, never
 * as a key.
 *
 * SO THE HIDDEN BOX'S `onInput` IS WHERE THIS WAS ACTUALLY LOST, not
 * `onKeyDown`. Its handler dropped anything that arrived while
 * `composingNow.current` was `false` -- "a paste, a drop, the emoji picker...
 * none of them is a keystroke" -- which was true of everything reaching it
 * BEFORE OpenKey, and stopped being true the moment a correction longer than
 * one character became a real, reachable case: OpenKey's `insertText` looks,
 * to that guard, exactly like a paste. THE ACCENTED LETTERS ARE LOST, exactly
 * as reported -- and the Backspaces that preceded each dropped replacement
 * had already reached the pane and deleted real characters, so the pane falls
 * behind OpenKey's own idea of what it has typed by however many code points
 * each dropped string carried. The NEXT correction computes its backspace
 * count against OpenKey's own buffer, not against the pane, so it deletes
 * into whatever the pane actually has at that position -- "characters keep
 * getting deleted one after another" is that drift compounding across every
 * syllable typed after the first dropped one.
 *
 * THE FIX HAS TWO HALVES, BOTH IN `TerminalTab.tsx`. `onInput` now reads
 * `event.nativeEvent.inputType`: `'insertText'` is what a real Cmd+V paste
 * NEVER carries (`insertFromPaste`, MEASURED against a real OS clipboard
 * paste in `e2e/terminal-echo-scroll-shots.mjs`'s own probe) and a real drop
 * never carries (`insertFromDrop`) -- it is the value the spec reserves for
 * text a person or an input method actually typed, which is exactly what
 * this channel exists to accept. Declining every OTHER `inputType` (paste,
 * drop, and `undefined` for an engine or a test that supplies none) is what
 * keeps `MAX_KEY_TEXT`'s promise -- this channel cannot become an unbounded
 * paste into a running agent -- intact, described below in its own file. The
 * FIRST half, `composedKeydownStrokes` widening `strokeFor`'s keydown path,
 * stays in as a documented fallback rather than being deleted: it is proven
 * correct for the single-event-multi-character keydown this codebase's own
 * `Option+e` precedent shows CAN happen, it costs nothing a real correction
 * would trip over (a named key is still declined, below), and CDP is not
 * proof that no engine anywhere ever takes that path -- only that Chromium,
 * measured, does not for OpenKey's shape.
 *
 * WHAT THIS FILE CANNOT PROVE. Accessibility automation was not available to
 * drive the real OpenKey process in the environment this file was written in
 * (`osascript`'s `System Events` answered "Not authorized to send Apple
 * events to System Events (-1743)"), so nothing here is OpenKey itself --
 * the CDP shapes above are reasoned from its own source and measured against
 * Chromium directly, not against a live `CGEventTap`. `docs/ui` and the
 * operator are owed that caveat plainly.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalTab } from '../../src/renderer/panels/TerminalTab.js';
import type { PaneKey, PaneSendResult, PaneView } from '../../src/shared/terminal.js';
import { isPaneKey, MAX_KEY_TEXT } from '../../src/shared/terminal.js';

afterEach(cleanup);

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const pane = () => q<HTMLElement>('[data-terminal-pane]');
/** The visually hidden box `onInput` is attached to -- see `TerminalTab.ime.test.tsx`. */
const input = () => q<HTMLTextAreaElement>('[data-terminal-input]');

const ATLAS = 'claude-code:atlas-11111111';
const ok = (): PaneView => ({
  kind: 'ok',
  name: 'vam-atlas-a1b2c3',
  text: 'the screen',
  cursor: { kind: 'unreadable' },
});

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

async function open() {
  const send = vi.fn(async (_p: string, _k: PaneKey, _r?: string) => 'sent' as PaneSendResult);
  render(
    <TerminalTab
      projectId={ATLAS}
      rowId={ATLAS}
      read={vi.fn(async () => ok())}
      resize={undefined}
      send={send as never}
    />,
  );
  await settle();
  return send;
}

const keys = (send: { mock: { calls: unknown[][] } }): PaneKey[] =>
  send.mock.calls.map((call) => call[1] as PaneKey);

/**
 * Press `init` on the pane and report both what the bridge was asked to send
 * and what vam's own window listener heard -- the same double-measurement
 * `TerminalTab.control-chords.test.tsx` uses, and for the same reason: a
 * named key this change must keep declining has to still reach vam, or a
 * "fix" that widens the rule too far would silently break the tab switch or
 * scrolling instead of losing a letter.
 */
async function press(init: Partial<KeyboardEventInit> & { key: string }) {
  const heard: string[] = [];
  const onKey = (event: KeyboardEvent) => heard.push(event.key);
  window.addEventListener('keydown', onKey);
  try {
    const send = await open();
    const notPrevented = fireEvent.keyDown(pane() as HTMLElement, init);
    await settle();
    return { sent: keys(send), heard, notPrevented };
  } finally {
    window.removeEventListener('keydown', onKey);
  }
}

describe('the keydown path: a documented fallback, not the mechanism Chromium actually uses', () => {
  it('sends a two-character correction as one `text` keystroke', async () => {
    // `toi` corrected to `tối` by a tone key: OpenKey's own replacement event
    // carries the tone-marked vowel AND the letter after it in one string.
    const { sent, notPrevented } = await press({ key: 'ối' });
    expect(sent).toEqual([{ kind: 'text', text: 'ối' }]);
    // Consumed exactly as a single printable character already is -- the
    // browser must not ALSO run its own default insertion of the same event
    // into the hidden box, which is the second path this letter used to be
    // dropped on (`onInput`'s "arrived without a composition" rule).
    expect(notPrevented).toBe(false);
  });

  it('sends a shape main will actually accept', async () => {
    const { sent } = await press({ key: 'ố' });
    expect(sent).toHaveLength(1);
    expect(isPaneKey(sent[0])).toBe(true);
  });

  it('normalises a decomposed replacement to NFC before it is sent', async () => {
    // 'ố' spelled the long way -- 'o' + COMBINING CIRCUMFLEX (U+0302) +
    // COMBINING ACUTE (U+0301) -- three code units for one glyph. OpenKey
    // builds its replacement from its own hardcoded mark table rather than
    // calling a canonical-mapping normaliser, so this shape is not ruled out.
    const decomposed = 'tiếng';
    expect(decomposed).not.toBe('tiếng');
    const { sent } = await press({ key: decomposed });
    expect(sent).toEqual([{ kind: 'text', text: 'tiếng' }]);
  });

  it('splits a replacement longer than the channel takes, in order', async () => {
    const long = 'ố'.repeat(MAX_KEY_TEXT + 4);
    const { sent } = await press({ key: long });
    expect(sent.length).toBeGreaterThan(1);
    const joined = sent.map((key) => (key.kind === 'text' ? key.text : '')).join('');
    expect(joined).toBe(long);
    for (const key of sent) expect(isPaneKey(key)).toBe(true);
  });

  it('still types a single accented letter exactly as before the widening', async () => {
    // The unchanged case: a real keyboard layout composes one character per
    // keystroke, which `strokeFor`'s original rule already carried.
    const { sent } = await press({ key: 'ệ' });
    expect(sent).toEqual([{ kind: 'text', text: 'ệ' }]);
  });
});

describe('a named key is still not text, however many characters spell its name', () => {
  it.each([
    ['Shift', { key: 'Shift', shiftKey: true }],
    ['Tab', { key: 'Tab' }],
    ['CapsLock', { key: 'CapsLock' }],
    ['F5', { key: 'F5' }],
    ['Delete', { key: 'Delete' }],
    ['ContextMenu', { key: 'ContextMenu' }],
    ['Unidentified', { key: 'Unidentified' }],
    ['Dead', { key: 'Dead' }],
    ['Process', { key: 'Process' }],
  ])('declines %s, and leaves it for vam to hear', async (_label, init) => {
    const { sent, heard, notPrevented } = await press(init);
    // NOTHING WAS TYPED. Every named key in the DOM's own vocabulary is plain
    // ASCII, which is exactly what a correction from OpenKey never is -- it
    // has no reason to correct anything that carries no diacritic.
    expect(sent).toEqual([]);
    // AND IT WAS NOT SWALLOWED EITHER. `Tab` is the pane's own way out;
    // `Shift` alone is a hand moving, not a chord vam or the pane owns.
    // `ArrowLeft`/`ArrowRight` used to be declined here too -- they are the
    // pane's `nav` keys now (vam/terminal-arrows), pinned as sent rather than
    // declined in `TerminalTab.nav-keys.test.tsx`.
    expect(heard).toEqual([init.key]);
    expect(notPrevented).toBe(true);
  });
});

/**
 * ONE `input` EVENT, carrying `inputType` and the value already in the box --
 * MEASURED against a real Chromium (this file's own header) rather than
 * asserted about one: OpenKey's replacement, a real Cmd+V paste and a real
 * drop all reach the hidden box exactly this way, distinguished only by
 * `inputType`. `composingNow.current` is `false` throughout this describe
 * block -- nothing here ever fires `compositionstart` -- because that is
 * exactly the state OpenKey's synthetic event arrives in.
 */
function arrive(box: HTMLTextAreaElement, value: string, inputType?: string): void {
  box.value = value;
  const event = new Event('input', { bubbles: true });
  if (inputType !== undefined) Object.defineProperty(event, 'inputType', { value: inputType });
  fireEvent(box, event);
}

describe('the real mechanism: OpenKey’s replacement arrives at `input`, not at a keydown', () => {
  it('sends the whole replacement as one `text` keystroke when `inputType` is `insertText`', async () => {
    const send = await open();
    const box = input() as HTMLTextAreaElement;
    arrive(box, 'ối', 'insertText');
    await settle();
    expect(keys(send)).toEqual([{ kind: 'text', text: 'ối' }]);
  });

  it('empties the box once the replacement has been sent, same as a composition commit', async () => {
    const send = await open();
    const box = input() as HTMLTextAreaElement;
    arrive(box, 'ối', 'insertText');
    await settle();
    expect(keys(send)).toHaveLength(1);
    expect(box.value).toBe('');
  });

  it('normalises a decomposed replacement to NFC, through the same `composedStrokes` the commit path uses', async () => {
    const send = await open();
    const box = input() as HTMLTextAreaElement;
    const decomposed = 'tiếng'; // 'tiếng', spelled decomposed
    arrive(box, decomposed, 'insertText');
    await settle();
    expect(keys(send)).toEqual([{ kind: 'text', text: 'tiếng' }]);
  });

  it('splits a replacement longer than the channel takes, in order', async () => {
    const send = await open();
    const box = input() as HTMLTextAreaElement;
    const long = 'ố'.repeat(MAX_KEY_TEXT + 4);
    arrive(box, long, 'insertText');
    await settle();
    const sent = keys(send);
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.map((key) => (key.kind === 'text' ? key.text : '')).join('')).toBe(long);
  });

  it.each([
    ['a real Cmd+V paste', 'insertFromPaste'],
    ['a real drop', 'insertFromDrop'],
  ])('still drops text that arrived as %s, never as a keystroke', async (_label, inputType) => {
    const send = await open();
    const box = input() as HTMLTextAreaElement;
    arrive(box, 'a whole pasted paragraph', inputType);
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(box.value).toBe('');
  });

  it('drops text with no `inputType` at all -- the conservative default for an engine or a test that supplies none', async () => {
    // `TerminalTab.ime.test.tsx`'s own paste case fires exactly this shape
    // (`fireEvent.input(box, { target: { value } })`, no `inputType`), and it
    // must stay declined: the absence of the one value this channel now
    // trusts is not evidence that the box holds a keystroke.
    const send = await open();
    const box = input() as HTMLTextAreaElement;
    arrive(box, 'a whole pasted paragraph', undefined);
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(box.value).toBe('');
  });

  it('still leaves a live composition to `onCompositionEnd`, not to this path', async () => {
    // The guard this whole describe block adds must not fire WHILE a
    // composition is in flight -- `onInput`'s existing `composingNow.current`
    // check comes first and is unchanged; this pins that it still does.
    const send = await open();
    const box = input() as HTMLTextAreaElement;
    fireEvent(box, new Event('compositionstart', { bubbles: true }));
    arrive(box, 'tieeng', 'insertText');
    await settle();
    expect(send).not.toHaveBeenCalled();
  });
});
