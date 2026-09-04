// @vitest-environment happy-dom

/**
 * Typing into the Terminal tab.
 *
 * The tab was read-only, and its focus stop existed for ONE reason: the pane
 * is a scroll region with a hidden scrollbar, so without a focus stop nothing
 * below the fold was reachable by any key. Keys are consumed now, and these
 * tests pin the three things that makes true and dangerous.
 *
 * WHAT MUST STILL WORK: the arrows and the Page keys still scroll, because
 * that is what the focus stop was for and losing it silently would be the
 * regression nobody notices.
 *
 * WHO OWNS A KEY: an unmodified key belongs to the pane and stops there, so
 * `j` does not also move vam's cursor. A Cmd/Ctrl chord belongs to vam and is
 * never typed -- the canvas already exempts chords from its typing guard, and
 * a chord is not text on any layout.
 *
 * THE WAY OUT: Escape leaves. A focus stop that eats every key and cannot be
 * left from the keyboard is the trap the old comment promised this was not.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalTab } from '../../src/renderer/panels/TerminalTab.js';
import type { PaneKey, PaneView } from '../../src/shared/terminal.js';

afterEach(cleanup);

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const pane = () => q<HTMLElement>('[data-terminal-pane]');

const ATLAS = 'claude-code:atlas-11111111';
const ok = (text = 'the screen'): PaneView => ({ kind: 'ok', name: 'vam-atlas-a1b2c3', text });

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** A tab showing a real pane, with a send path that records what it is asked. */
async function open(view: PaneView = ok(), sent = true) {
  const send = vi.fn(async (_project: string, _key: PaneKey, _row?: string) => sent);
  render(
    <TerminalTab
      projectId={ATLAS}
      rowId={ATLAS}
      read={vi.fn(async () => view)}
      resize={undefined}
      send={send}
    />,
  );
  await settle();
  return send;
}

const keys = (send: { mock: { calls: unknown[][] } }): PaneKey[] =>
  send.mock.calls.map((call) => call[1] as PaneKey);

describe('the Terminal tab takes focus when it is opened', () => {
  it('focuses the pane as soon as there is a pane to focus', async () => {
    await open();
    expect(document.activeElement).toBe(pane());
  });

  it('does not take focus while the window is hidden', async () => {
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      await open();
      // Nothing is being read either, so there is no pane to focus and no
      // reason to pull focus out of whatever the operator last touched.
      expect(document.activeElement).not.toBe(pane());
    } finally {
      spy.mockRestore();
    }
  });

  it('takes no focus when there is no pane, only a sentence', async () => {
    await open({ kind: 'not-vam' });
    expect(pane()).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});

describe('a keystroke in the pane reaches tmux, exactly once', () => {
  it('types a printable character literally, with no Return behind it', async () => {
    const send = await open();
    fireEvent.keyDown(pane() as HTMLElement, { key: 'h' });
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(ATLAS, { kind: 'text', text: 'h' }, ATLAS);
  });

  it('sends Enter as the key that must be interpreted, not as a newline', async () => {
    const send = await open();
    fireEvent.keyDown(pane() as HTMLElement, { key: 'Enter' });
    await settle();
    expect(keys(send)).toEqual([{ kind: 'enter' }]);
  });

  it('sends Backspace as a key, because a terminal you cannot correct is not usable', async () => {
    const send = await open();
    fireEvent.keyDown(pane() as HTMLElement, { key: 'Backspace' });
    await settle();
    // Never `{ kind: 'text', text: 'Backspace' }`: that types the word.
    expect(keys(send)).toEqual([{ kind: 'backspace' }]);
  });

  it('does not also fire vam’s own keyboard, so `j` is a letter here', async () => {
    const heard: string[] = [];
    const onKey = (event: KeyboardEvent) => heard.push(event.key);
    window.addEventListener('keydown', onKey);
    try {
      const send = await open();
      fireEvent.keyDown(pane() as HTMLElement, { key: 'j' });
      await settle();
      expect(keys(send)).toEqual([{ kind: 'text', text: 'j' }]);
      expect(heard).toEqual([]);
    } finally {
      window.removeEventListener('keydown', onKey);
    }
  });
});

describe('the pane declines the keys that are not its own', () => {
  it('leaves a Cmd chord to vam and types nothing', async () => {
    const heard: string[] = [];
    const onKey = (event: KeyboardEvent) => heard.push(event.key);
    window.addEventListener('keydown', onKey);
    try {
      const send = await open();
      fireEvent.keyDown(pane() as HTMLElement, { key: '1', metaKey: true });
      fireEvent.keyDown(pane() as HTMLElement, { key: 'k', ctrlKey: true });
      await settle();
      expect(send).not.toHaveBeenCalled();
      // Reaching vam is the point: `Cmd+1` picks a tab from anywhere,
      // including from inside a box that is capturing letters.
      expect(heard).toEqual(['1', 'k']);
    } finally {
      window.removeEventListener('keydown', onKey);
    }
  });

  it('leaves the scrolling keys to the browser, which is why the focus stop exists', async () => {
    const send = await open();
    for (const key of ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End']) {
      fireEvent.keyDown(pane() as HTMLElement, { key });
    }
    await settle();
    // The pane has a hidden scrollbar: if these were typed away, the content
    // below the fold would be reachable by nothing at all.
    expect(send).not.toHaveBeenCalled();
  });

  it('leaves Tab alone, so the focus order still gets out', async () => {
    const send = await open();
    fireEvent.keyDown(pane() as HTMLElement, { key: 'Tab' });
    await settle();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('there is a way out that does not need a mouse', () => {
  it('Escape leaves the pane instead of being typed into it', async () => {
    const send = await open();
    expect(document.activeElement).toBe(pane());
    fireEvent.keyDown(pane() as HTMLElement, { key: 'Escape' });
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(pane());
  });
});

describe('the pane says whether what is typed is going anywhere', () => {
  it('says where the keys go while it can send them', async () => {
    await open();
    expect(q('[data-terminal-typing]')?.textContent).toContain('vam-atlas-a1b2c3');
  });

  it('says so when vam refused, rather than swallowing the keystroke', async () => {
    const send = await open(ok(), false);
    fireEvent.keyDown(pane() as HTMLElement, { key: 'h' });
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    const said = q('[data-terminal-refused]')?.textContent ?? '';
    expect(said).not.toBe('');
    expect(said.toLowerCase()).toContain('did not');
  });

  it('says the keys go nowhere when there is no send path at all', async () => {
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => ok())}
        resize={undefined}
        send={undefined}
      />,
    );
    await settle();
    fireEvent.keyDown(pane() as HTMLElement, { key: 'h' });
    await settle();
    expect(q('[data-terminal-typing]')?.textContent?.toLowerCase()).toContain('cannot');
  });
});
