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

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REFRESH_MS, TerminalTab } from '../../src/renderer/panels/TerminalTab.js';
import type { PaneView } from '../../src/shared/terminal.js';

afterEach(cleanup);

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);

const ATLAS = 'claude-code:atlas-11111111';
const BEACON = 'claude-code:beacon-22222222';

const ok = (text: string, name = 'vam-atlas-a1b2c3'): PaneView => ({ kind: 'ok', name, text });

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
    render(<TerminalTab projectId={ATLAS} read={read} resize={undefined} send={undefined} />);
    await settle();

    // No row given here, so the project alone is asked -- the older answer,
    // still available and still correct for a project with one pane.
    expect(read).toHaveBeenCalledWith(ATLAS, undefined);
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
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => ok('hi'))}
        resize={undefined}
        send={undefined}
      />,
    );
    expect(q('[data-terminal-pending]')).not.toBeNull();
    expect(q('[data-terminal-empty]')).toBeNull();
    expect(q('[data-terminal-unavailable]')).toBeNull();
  });

  it('names the session it is showing, so the text is not attributed to vam', async () => {
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => ok('hi'))}
        resize={undefined}
        send={undefined}
      />,
    );
    await settle();
    // THE NAME MOVED, IT DID NOT GO. It was a line of chrome above the pane
    // and the operator asked for that space back; the pane's accessible name
    // still says whose screen this is, which is where a reader that cannot
    // see the box was always getting it.
    expect(q<HTMLElement>('[data-terminal-pane]')?.getAttribute('aria-label')).toContain(
      'vam-atlas-a1b2c3',
    );
    expect(q('[data-terminal-name]')).toBeNull();
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
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async (): Promise<PaneView> => ({ kind: 'not-vam' }))}
        resize={undefined}
        send={undefined}
      />,
    );
    await settle();

    const empty = q<HTMLElement>('[data-terminal-empty]');
    expect(empty?.textContent).toMatch(/did not start/i);
    // No attach button, no "connect": vam cannot take over another process's
    // controlling TTY and must not imply it can.
    expect(document.body.textContent ?? '').not.toMatch(/attach|adopt/i);
    expect(q('[data-terminal-unavailable]')).toBeNull();
  });

  it('says the session has ended when the tmux session is gone', async () => {
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async (): Promise<PaneView> => ({ kind: 'gone' }))}
        resize={undefined}
        send={undefined}
      />,
    );
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
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async (): Promise<PaneView> => ({ kind: 'unavailable', error }))}
        resize={undefined}
        send={undefined}
      />,
    );
    await settle();

    const failed = q<HTMLElement>('[data-terminal-unavailable]');
    expect(failed?.getAttribute('data-terminal-code')).toBe('tmux-missing');
    expect(failed?.textContent).toContain(error.message);
    expect(q('[data-terminal-empty]')).toBeNull();
  });

  it('treats a rejected read as vam not having asked, never as no session', async () => {
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => Promise.reject(new Error('bridge gone')))}
        resize={undefined}
        send={undefined}
      />,
    );
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
      render(<TerminalTab projectId={ATLAS} read={read} resize={undefined} send={undefined} />);
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
      const view = render(
        <TerminalTab projectId={ATLAS} read={read} resize={undefined} send={undefined} />,
      );
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
      render(<TerminalTab projectId={ATLAS} read={read} resize={undefined} send={undefined} />);
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
    render(<TerminalTab projectId={ATLAS} read={undefined} resize={undefined} send={undefined} />);
    await settle();
    expect(q('[data-terminal-unavailable]')).not.toBeNull();
  });
});

/**
 * Everything that is about WHICH session is on screen. The tab is handed a
 * project id, and the id changing is a different session -- a state carried
 * across it is the previous session's screen wearing this one's tab.
 */
describe('the Terminal tab draws the session it was last asked about', () => {
  it('stops drawing the previous session the moment the project changes', async () => {
    // Up to the 10s tmux timeout, not the 1s refresh: the stale pane is drawn
    // until a read for the NEW project comes back, and it is attributed to
    // the wrong session -- by its own accessible name -- the whole time.
    const read = vi.fn(async (id: string) =>
      id === ATLAS ? ok('atlas screen', 'vam-atlas-a1b2c3') : ok('beacon screen', 'vam-beacon-d4'),
    );
    const view = render(
      <TerminalTab projectId={ATLAS} read={read} resize={undefined} send={undefined} />,
    );
    await settle();
    expect(q<HTMLElement>('[data-terminal-pane]')?.textContent).toContain('atlas screen');

    let resolve: ((v: PaneView) => void) | undefined;
    read.mockImplementationOnce(
      () =>
        new Promise<PaneView>((r) => {
          resolve = r;
        }),
    );
    view.rerender(
      <TerminalTab projectId={BEACON} read={read} resize={undefined} send={undefined} />,
    );
    // The claim about atlas is gone BEFORE the answer about beacon arrives.
    expect(q('[data-terminal-pane]')).toBeNull();
    expect(q('[data-terminal-pending]')).not.toBeNull();

    await act(async () => {
      resolve?.(ok('beacon screen', 'vam-beacon-d4'));
      await Promise.resolve();
    });
    expect(q<HTMLElement>('[data-terminal-pane]')?.getAttribute('aria-label')).toContain(
      'vam-beacon-d4',
    );
  });

  it('says nothing is selected rather than reading a session forever', async () => {
    // With no session focused there is no project to ask about, so the effect
    // returns early -- and the pending state, which means "vam is looking",
    // stayed on screen for the rest of the session. vam was claiming to be
    // reading something it had never asked for.
    const read = vi.fn(async () => ok('screen'));
    render(<TerminalTab projectId={null} read={read} resize={undefined} send={undefined} />);
    await settle();
    expect(read).not.toHaveBeenCalled();
    expect(q('[data-terminal-pending]')).toBeNull();
    expect(q<HTMLElement>('[data-terminal-empty]')?.textContent).toMatch(/no session/i);
  });

  it('shows no screen at all when two sessions answer to one project', async () => {
    // Either screen would be a coin toss the operator cannot see. Both names
    // are said instead, so the ambiguity is something they can act on.
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(
          async (): Promise<PaneView> => ({
            kind: 'ambiguous',
            names: ['vam-atlas-a1b2c3', 'vam-atlas-d4e5f6'],
          }),
        )}
        resize={undefined}
        send={undefined}
      />,
    );
    await settle();
    expect(q('[data-terminal-pane]')).toBeNull();
    const empty = q<HTMLElement>('[data-terminal-empty]');
    expect(empty?.textContent).toContain('vam-atlas-a1b2c3');
    expect(empty?.textContent).toContain('vam-atlas-d4e5f6');
  });
});

/**
 * vam is a keyboard-first app, so a scroll region no key can reach is not a
 * WCAG footnote here -- it is a pane of output the operator cannot read past
 * the first screenful. The scrollbar is hidden by `vam-no-scrollbar`, which
 * removes the mouse affordance too.
 */
describe('the pane can be reached and scrolled from the keyboard', () => {
  it('is a focus stop with an accessible name, and takes focus', async () => {
    render(
      <TerminalTab
        projectId={ATLAS}
        read={vi.fn(async () => ok('$ claude'))}
        resize={undefined}
        send={undefined}
      />,
    );
    await settle();
    const pane = q<HTMLElement>('[data-terminal-pane]');
    if (pane === null) throw new Error('no pane');
    expect(pane.getAttribute('tabindex')).toBe('0');
    // A focus stop that says nothing is a trap with a focus ring. A NAMED
    // <section> is a region by its own semantics, not by a role attribute, and
    // it is not a button: nothing is bound to Enter, and nothing captions it
    // as bound.
    expect(pane.tagName).toBe('SECTION');
    expect(pane.getAttribute('aria-label')).toBeTruthy();
    pane.focus();
    expect(document.activeElement).toBe(pane);
  });
});

describe('the row it asks about', () => {
  it('names the session as well as the project, so a project with two panes resolves', async () => {
    // The project alone answers `ambiguous` when vam started two sessions in
    // it. The row is what main pairs against the pane the session published.
    const read = vi.fn(async () => ok('beta screen'));
    render(
      <TerminalTab
        projectId={ATLAS}
        rowId="sess-beta#8"
        read={read}
        resize={undefined}
        send={undefined}
      />,
    );
    await waitFor(() => expect(read).toHaveBeenCalledWith(ATLAS, 'sess-beta#8'));
  });
});
