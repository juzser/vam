// @vitest-environment happy-dom

/**
 * The Terminal tab: the first caller of the tmux provider's read path.
 *
 * What is pinned here is mostly what the tab must NOT do. It must cost
 * nothing while it is closed -- the operator asked for a tab that loads only
 * when opened -- and it must never draw a blank pane that could mean either
 * "vam started no session for this" or "vam could not ask tmux". Those two
 * are the whole reason `spawn.ts` classifies failures at all, and this is the
 * first place a person ever sees the difference.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaneView } from '../../src/shared/terminal.js';
import { REFRESH_MS, TerminalTab } from '../../src/renderer/panels/TerminalTab.js';

afterEach(cleanup);

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);

const ok = (text: string): PaneView => ({ kind: 'ok', name: 'vam-atlas-a1b2c3', text });

/** Lets the mounted effect's first read resolve before anything is asserted. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('the Terminal tab shows the focused session pane', () => {
  it('renders the captured screen as text, in a monospace block', async () => {
    const read = vi.fn(async () => ok('$ claude\nthinking about the branch'));
    render(<TerminalTab title="atlas" read={read} />);
    await settle();

    expect(read).toHaveBeenCalledWith('atlas');
    const pane = q<HTMLElement>('[data-terminal-pane]');
    expect(pane?.textContent).toContain('thinking about the branch');
    // The already-composed screen, drawn as plain text -- vam has no terminal
    // emulator, so the class has to be the one that preserves the columns tmux
    // laid out.
    expect(pane?.getAttribute('class')).toContain('font-mono');
    expect(q('[data-terminal-empty]')).toBeNull();
    expect(q('[data-terminal-unavailable]')).toBeNull();
  });

  it('claims nothing before the first read has answered', () => {
    // The empty states are claims about the operator's tmux. Drawing one
    // before an answer arrives would say vam started no session for a session
    // that has one.
    render(<TerminalTab title="atlas" read={vi.fn(async () => ok('hi'))} />);
    expect(q('[data-terminal-pending]')).not.toBeNull();
    expect(q('[data-terminal-empty]')).toBeNull();
    expect(q('[data-terminal-unavailable]')).toBeNull();
  });

  it('names the session it is showing, so the text is not attributed to vam', async () => {
    render(<TerminalTab title="atlas" read={vi.fn(async () => ok('hi'))} />);
    await settle();
    expect(q<HTMLElement>('[data-terminal-name]')?.textContent).toContain('vam-atlas-a1b2c3');
  });
});

/**
 * The two empty states. tmux answering "no server running" is the empty list
 * -- an answer -- and every other failure is vam having lost the ability to
 * look. A single blank pane for both would tell the operator they have no
 * session at the exact moment vam cannot see one.
 */
describe('the Terminal tab tells an absent session from an unreachable tmux', () => {
  it('says vam did not start a session for this one, and offers no adoption', async () => {
    render(<TerminalTab title="atlas" read={vi.fn(async (): Promise<PaneView> => ({ kind: 'not-vam' }))} />);
    await settle();

    const empty = q<HTMLElement>('[data-terminal-empty]');
    expect(empty?.textContent).toMatch(/did not start/i);
    // No attach button, no "connect": vam cannot take over another process's
    // controlling TTY and must not imply it can.
    expect(document.body.textContent ?? '').not.toMatch(/attach|adopt/i);
    expect(q('[data-terminal-unavailable]')).toBeNull();
  });

  it('says the session has ended when the tmux session is gone', async () => {
    render(<TerminalTab title="atlas" read={vi.fn(async (): Promise<PaneView> => ({ kind: 'gone' }))} />);
    await settle();
    expect(q<HTMLElement>('[data-terminal-empty]')?.textContent).toMatch(/ended/i);
  });

  it('reports the reason verbatim when vam could not ask, and never as emptiness', async () => {
    const error = {
      kind: 'unreachable',
      code: 'tmux-missing',
      message: 'the `tmux` command was not found, so vam cannot manage sessions (listing sessions)',
    } as const;
    render(
      <TerminalTab title="atlas" read={vi.fn(async (): Promise<PaneView> => ({ kind: 'unavailable', error }))} />,
    );
    await settle();

    const failed = q<HTMLElement>('[data-terminal-unavailable]');
    expect(failed?.getAttribute('data-terminal-code')).toBe('tmux-missing');
    expect(failed?.textContent).toContain(error.message);
    expect(q('[data-terminal-empty]')).toBeNull();
  });

  it('treats a rejected read as vam not having asked, never as no session', async () => {
    render(<TerminalTab title="atlas" read={vi.fn(async () => Promise.reject(new Error('bridge gone')))} />);
    await settle();
    expect(q('[data-terminal-unavailable]')).not.toBeNull();
    expect(q('[data-terminal-empty]')).toBeNull();
  });
});

describe('the Terminal tab refreshes while it is open and stops when it is not', () => {
  it('re-reads on the refresh interval while mounted', async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(async () => ok('one'));
      render(<TerminalTab title="atlas" read={read} />);
      expect(read).toHaveBeenCalledTimes(1);
      await act(async () => {
        vi.advanceTimersByTime(REFRESH_MS * 2);
      });
      expect(read).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('issues nothing more once it is unmounted', async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(async () => ok('one'));
      const view = render(<TerminalTab title="atlas" read={read} />);
      view.unmount();
      const before = read.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(REFRESH_MS * 5);
      });
      expect(read).toHaveBeenCalledTimes(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops while the window is hidden and resumes when it comes back', async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    try {
      const read = vi.fn(async () => ok('one'));
      render(<TerminalTab title="atlas" read={read} />);
      const before = read.mock.calls.length;

      visibility.mockReturnValue('hidden');
      await act(async () => {
        fireEvent(document, new Event('visibilitychange'));
        vi.advanceTimersByTime(REFRESH_MS * 3);
      });
      expect(read).toHaveBeenCalledTimes(before);

      visibility.mockReturnValue('visible');
      await act(async () => {
        fireEvent(document, new Event('visibilitychange'));
      });
      expect(read.mock.calls.length).toBeGreaterThan(before);
    } finally {
      visibility.mockRestore();
      vi.useRealTimers();
    }
  });

  it('makes no request at all when the bridge is absent, as in the browser build', async () => {
    render(<TerminalTab title="atlas" read={undefined} />);
    await settle();
    expect(q('[data-terminal-unavailable]')).not.toBeNull();
  });
});
