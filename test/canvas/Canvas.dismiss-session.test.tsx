// @vitest-environment happy-dom

/**
 * DISMISS: the fallback for a row Close cannot ever make go away.
 *
 * `docs/design/vam-owns-the-session.md` §5, "Dismiss is the safe fallback",
 * and the operator's own report: "some sessions cannot be closed and report
 * a failure — they stay there forever." Two families of that:
 *
 *  - a row vam did not start, or cannot verify ownership of (an ambiguous
 *    pane, tmux unreachable, an entire source with no close verb at all) --
 *    `closeSession` refuses it, honestly, every single time.
 *  - a row the source ITSELF already reports finished (`stop.ts`'s
 *    `already-finished`) -- there is no job left to stop, so the refusal is
 *    not even a real failure, and recording it as one would be a false alarm.
 *
 * Both leave the row exactly where the CLI's own listing keeps it (a
 * background job for up to `BACKGROUND_WINDOW_MS`, an unowned session
 * forever), so the only thing that makes either disappear from vam's own
 * list is a dismissal -- never a kill, and always reversible.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { clearEvents, loggedEvents } from '../../src/renderer/errors/log.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

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
    decisions: [],
    ...over,
  };
}

function sessionSourceWith(
  closeSession: (sessionId: string, force?: boolean) => Promise<void>,
): CanvasSource {
  const inner = {
    id: 'claude-code',
    label: 'Claude Code',
    capabilities: {
      liveUpdates: false,
      recordPrompt: true,
      deliverPrompt: true,
      promptAttachments: false,
      slashCommands: false,
      renameSession: false,
      closeSession: true,
      createSession: false,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
      resumeSession: false,
    },
    declines: {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: { recordPrompt: async () => {}, closeSession },
  };
  return { kind: 'session', source: inner as unknown as SessionSource, onWrote: () => {} };
}

const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
/** The status cell truncates at 72 chars (`truncateStatus`) and carries the
 *  whole message on its tooltip -- `Canvas.session-actions.test.tsx` reads a
 *  long message's tail the same way. */
const statusFull = () =>
  document.querySelector('[data-status-bar] [data-status]')?.getAttribute('data-note') ?? '';
const sidebarText = () => document.querySelectorAll('aside')[0]?.textContent ?? '';
const restoreButton = () => document.querySelector<HTMLButtonElement>('[data-restore-dismissed]');

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

async function pressAsync(key: string) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
});

beforeEach(() => {
  localStorage.clear();
  clearEvents();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the operator’s own report: a background row the source already calls finished', () => {
  it('the row leaves the sidebar, and the error log records no failure for it', async () => {
    const MODEL: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'claude-code',
          sessions: [session('vam', { title: 'vam', status: 'failed' })],
        },
      ],
    };
    const source = sessionSourceWith(async () => {
      // The EXACT shape `stop.ts:367-372` throws for a background row the
      // CLI already reports `done`/`failed`.
      throw {
        kind: 'refused',
        code: 'already-finished',
        message:
          '"vam" already failed; there is no running job left to stop. Nothing was lost -- the conversation is kept either way.',
      };
    });
    render(<Canvas model={MODEL} source={source} />);
    expect(sidebarText()).toContain('vam');

    await pressAsync('x');

    // GONE FROM THE SIDEBAR -- the row Close could never make disappear
    // before this, per the operator's report.
    expect(sidebarText()).not.toContain('vam');
    // AND NOT A FAILURE: nothing left running was ever true, so this must
    // never cost the operator a false alarm in the error log or the badge.
    expect(loggedEvents().some((event) => event.kind === 'failure')).toBe(false);
    expect(statusBar()).not.toMatch(/\bfailure\b/i);
    // Past where the visible cell cuts a message this long -- see
    // `statusFull`'s own comment.
    expect(statusFull()).toMatch(/removed it from your list/i);
  });
});

describe('any other refusal dismisses too, not only the graceful one', () => {
  it('a row vam did not start also leaves the sidebar', async () => {
    const MODEL: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'claude-code',
          sessions: [session('a1', { title: 'someone else’s terminal' })],
        },
      ],
    };
    const source = sessionSourceWith(async () => {
      throw {
        kind: 'refused',
        code: 'not-vam-started',
        message: 'vam did not start "someone else’s terminal", so it owns no terminal to close',
      };
    });
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('x');
    expect(sidebarText()).not.toContain('someone else’s terminal');
    // This one WAS a real refusal, so it still shows up as one -- dismissing
    // does not erase the diagnosis, only the row.
    expect(loggedEvents().some((event) => event.kind === 'failure')).toBe(true);
  });

  it('returns on new activity: a resumed session is not the one that was hidden', async () => {
    const MODEL: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'claude-code',
          sessions: [session('a1', { title: 'resumable', activity: null })],
        },
      ],
    };
    const source = sessionSourceWith(async () => {
      throw { kind: 'refused', code: 'not-vam-started', message: 'not vam’s' };
    });
    const { rerender } = render(<Canvas model={MODEL} source={source} />);
    await pressAsync('x');
    expect(sidebarText()).not.toContain('resumable');

    // The SAME row, now showing something it was not showing at dismissal
    // time -- the row was resumed outside vam.
    const RESUMED: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'claude-code',
          sessions: [session('a1', { title: 'resumable', activity: 'Bash: run tests' })],
        },
      ],
    };
    rerender(<Canvas model={RESUMED} source={source} />);
    expect(sidebarText()).toContain('resumable');
  });

  it('ROW-KEYED: dismissing one process of a session id leaves its sibling alone', async () => {
    // The exact shape `agents.ts` documents: one session id, two live
    // processes, two rows -- `<sessionId>#<pid>`, never the bare id.
    const MODEL: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'claude-code',
          sessions: [
            session('abc#111', { title: 'abc (pid 111)' }),
            session('abc#222', { title: 'abc (pid 222)' }),
          ],
        },
      ],
    };
    const source = sessionSourceWith(async (id) => {
      if (id === 'abc#111') {
        throw { kind: 'refused', code: 'not-vam-started', message: 'not vam’s' };
      }
    });
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('x');
    expect(sidebarText()).not.toContain('abc (pid 111)');
    // The sibling row is untouched: a different row id, a different
    // dismissal entry.
    expect(sidebarText()).toContain('abc (pid 222)');
  });
});

describe('the message a source’s own decline carries through to the status bar', () => {
  /**
   * `main/sources/codex/source.ts`'s own `NOT_OURS`, copied rather than
   * imported: that module is main-process only and this file exercises the
   * renderer's own `write.closeSession` boundary, the same one every other
   * test in this file mocks by throwing. What this test is FOR is the
   * property `combine.ts`'s `routeWrite` now guarantees -- a Codex row's
   * Close reaches the STATUS BAR wearing Codex's own sentence, never the
   * generic "claims this but carries no member for it" `routeWrite` used to
   * invent when `createCodexSource` ships no `closeSession` function at all
   * (`test/sources/combine-sources.test.ts` proves that boundary directly;
   * this proves the sentence it produces is the one the operator reads).
   */
  it('a Codex row’s Close shows Codex’s own decline, not a generic internal one', async () => {
    const MODEL: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'codex',
          sessions: [session('codex-1', { title: 'a codex thread' })],
        },
      ],
    };
    const source = sessionSourceWith(async () => {
      // The exact envelope `routeWrite`'s `performed === undefined` branch
      // now returns for a Codex row: `not-implemented`, carrying the
      // source's OWN `declines.closeSession` rather than a made-up sentence.
      throw {
        kind: 'refused',
        code: 'not-implemented',
        message:
          'this is the operator’s own Codex thread, started outside vam; vam can queue a message for it and nothing else',
      };
    });
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('x');

    expect(sidebarText()).not.toContain('a codex thread');
    expect(statusFull()).toContain('this is the operator’s own Codex thread, started outside vam');
    // NOT THE SENTENCE `routeWrite` USED TO INVENT: this is what the bug
    // actually looked like on screen before the fix.
    expect(statusFull()).not.toMatch(/carries no member for it/i);
  });
});

describe('the dismissed count and its one-click undo', () => {
  it('shows a count once something is dismissed, and restores everything on click', async () => {
    const MODEL: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'claude-code',
          sessions: [session('a1', { title: 'gone-for-now' })],
        },
      ],
    };
    const source = sessionSourceWith(async () => {
      throw { kind: 'refused', code: 'not-vam-started', message: 'not vam’s' };
    });
    render(<Canvas model={MODEL} source={source} />);
    expect(restoreButton()).toBeNull();

    await pressAsync('x');
    expect(sidebarText()).not.toContain('gone-for-now');
    expect(restoreButton()).not.toBeNull();
    expect(restoreButton()?.textContent).toMatch(/1/);

    await act(async () => {
      restoreButton()?.click();
    });
    expect(sidebarText()).toContain('gone-for-now');
    expect(restoreButton()).toBeNull();
  });
});
