// @vitest-environment happy-dom

/**
 * PASTE, IN INSERT MODE, INTO THE CAPTURE-PANE TERMINAL TAB.
 *
 * The operator's ask: paste in Insert mode was refused outright --
 * `onInput`'s guard drops anything that did not arrive as a keystroke or an
 * OpenKey correction, which used to include a real `insertFromPaste`. Allow
 * it, but never let it become a proxy for typing arbitrary keystrokes: a
 * paste is now its own `PaneKey` kind (`kind: 'paste'`), delivered by tmux's
 * own paste buffer (`sources/tmux/argv.ts`'s `sendPasteArgv`) rather than
 * split into sixteen-character `text` keys the way an IME commit is
 * (`terminal-compose.ts`) -- so this file's job is to prove the hidden
 * textarea's `paste` event reaches `send` as exactly that, sanitised by
 * `terminal-paste.ts`'s `preparePastedText` on the way, and that a paste
 * dispatched anywhere else in the pane (Select mode) does nothing.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preparePastedText } from '../../src/renderer/panels/terminal-paste.js';
import { TerminalTab } from '../../src/renderer/panels/TerminalTab.js';
import type { PaneKey, PaneSendResult, PaneView } from '../../src/shared/terminal.js';

afterEach(cleanup);

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const pane = () => q<HTMLElement>('[data-terminal-pane]');
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

async function enter() {
  (pane() as HTMLElement).focus();
  await settle();
}

/** A real `ClipboardEvent`'s own shape, narrowed to what a paste handler
 *  reads -- happy-dom's `ClipboardEvent` carries no working `clipboardData`,
 *  so it is defined by hand exactly as `TerminalStreamTab.test.tsx`'s own
 *  paste test already does for the streaming renderer. */
function pasteEvent(text: string): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
  return event;
}

const keys = (send: { mock: { calls: unknown[][] } }): PaneKey[] =>
  send.mock.calls.map((call) => call[1] as PaneKey);

describe('a real paste in Insert mode', () => {
  it('sends the whole paste as one paste PaneKey, sanitised', async () => {
    const { send } = await open();
    await enter();
    const raw = 'first line\r\nsecond line';
    const event = pasteEvent(raw);
    const preventDefault = vi.spyOn(event, 'preventDefault');
    act(() => {
      (input() as HTMLTextAreaElement).dispatchEvent(event);
    });
    await settle();
    expect(preventDefault).toHaveBeenCalled();
    expect(keys(send)).toEqual([{ kind: 'paste', text: preparePastedText(raw) }]);
  });

  it('does nothing for an empty clipboard', async () => {
    const { send } = await open();
    await enter();
    act(() => {
      (input() as HTMLTextAreaElement).dispatchEvent(pasteEvent(''));
    });
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it('leaves the hidden box empty afterwards -- it is a staging area, not a value', async () => {
    await open();
    await enter();
    act(() => {
      (input() as HTMLTextAreaElement).dispatchEvent(pasteEvent('pasted text'));
    });
    await settle();
    expect((input() as HTMLTextAreaElement).value).toBe('');
  });

  it('draws the same refusal sentence as any other keystroke when tmux declines it', async () => {
    const { send } = await open('unaimed');
    await enter();
    act(() => {
      (input() as HTMLTextAreaElement).dispatchEvent(pasteEvent('hello'));
    });
    await settle();
    expect(send).toHaveBeenCalled();
    expect(q('[data-terminal-refused]')?.getAttribute('data-terminal-refusal')).toBe('unaimed');
  });
});

describe('a paste outside Insert mode (Select mode keeps its current behaviour)', () => {
  it('does nothing when the hidden box never had focus', async () => {
    const { send } = await open();
    // Deliberately no `enter()`: the pane is showing, but nothing has taken
    // the keyboard, which is Select mode's own posture
    // (`TerminalTab.tsx`'s own note: "NOTHING FOCUSES THIS PANE ON ARRIVAL").
    act(() => {
      (pane() as HTMLElement).dispatchEvent(pasteEvent('nope'));
    });
    await settle();
    expect(send).not.toHaveBeenCalled();
  });
});
