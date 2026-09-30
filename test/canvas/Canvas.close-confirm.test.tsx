// @vitest-environment happy-dom

/**
 * DECISION 1 — one prompt, one gate, every close route.
 *
 * `docs/design/vam-owns-the-session.md` §5, "Confirm only when the agent is
 * mid-turn", and the operator's own words: "ask for confirmation before
 * closing a session ONLY while the agent is running, on every device."
 *
 * `Canvas.session-actions.test.tsx` and `Canvas.tab-close-session.test.tsx`
 * already pin the `x` chord and the tab's `×` against a `done` session, and
 * neither ever saw a dialog — that is this decision's OTHER half, proven
 * incidentally by tests written before it existed. This file proves the half
 * those could not: that the SAME four routes (the `x` chord, the sidebar
 * row's own `×`, a tab's `×`, and a tab's context menu "Close session") open
 * `ConfirmCloseSession` first when the session is `running`, that `waiting`
 * does NOT count as running (the doc's own definition: the ball is already
 * with the operator), and that the desktop dialog is keyboard-friendly —
 * Enter confirms, Escape cancels, focus starts on Cancel.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
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

/** One project, two sessions: the focused one is what each case closes, and
 *  the second exists only so a tab strip has something to draw beside it —
 *  the same shape `Canvas.tab-close-session.test.tsx` renders against. */
function modelWith(status: Session['status'], runningAgents = 0): CanvasModel {
  return {
    projects: [
      {
        id: 'p1',
        name: 'alpha',
        source: 'claude-code',
        sessions: [
          session('a1', { title: 'nightly sweep', status, runningAgents }),
          session('a2', { title: 'second pass' }),
        ],
      },
    ],
  };
}

/** The same fake port the other close-path suites use. */
function sessionSourceWith(closeSession: (sessionId: string, force?: boolean) => Promise<void>): {
  source: CanvasSource;
  wrote: { count: number };
} {
  const wrote = { count: 0 };
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
  return {
    source: {
      kind: 'session',
      source: inner as unknown as SessionSource,
      onWrote: () => {
        wrote.count += 1;
      },
    },
    wrote,
  };
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
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

async function pressAsync(key: string) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

const confirmDialog = () => document.querySelector('[data-confirm-close-session]');
const confirmGo = () =>
  document.querySelector<HTMLButtonElement>('[data-confirm-close-session-go]');
const confirmCancel = () =>
  document.querySelector<HTMLButtonElement>('[data-confirm-close-session-cancel]');

const tabs = () => [...document.querySelectorAll('[data-session-tab]')];
const tabFor = (title: string) =>
  tabs().find((tab) => tab.querySelector('[data-tab-select]')?.textContent?.trim() === title) ??
  null;
const closeIn = (title: string) =>
  tabFor(title)?.querySelector<HTMLButtonElement>('[data-tab-close]') ?? null;

describe('the `x` chord: asks only while running', () => {
  it('opens the confirm on a running session, and sends nothing until answered', async () => {
    const calls: string[] = [];
    const { source, wrote } = sessionSourceWith(async (id) => {
      calls.push(id);
    });
    render(<Canvas model={modelWith('running')} source={source} />);
    await pressAsync('x');
    expect(confirmDialog(), 'a running session asks first').not.toBeNull();
    expect(calls, 'nothing sent before the question is answered').toEqual([]);
    expect(wrote.count).toBe(0);

    await act(async () => {
      confirmGo()?.click();
    });
    expect(calls).toEqual(['a1']);
    expect(confirmDialog()).toBeNull();
    expect(wrote.count).toBe(1);
  });

  it('Cancel leaves the session running and closes nothing', async () => {
    const calls: string[] = [];
    const { source } = sessionSourceWith(async (id) => {
      calls.push(id);
    });
    render(<Canvas model={modelWith('running')} source={source} />);
    await pressAsync('x');
    expect(confirmDialog()).not.toBeNull();
    await act(async () => {
      confirmCancel()?.click();
    });
    expect(confirmDialog()).toBeNull();
    expect(calls).toEqual([]);
  });

  /**
   * `waiting` DOES NOT COUNT AS RUNNING — `domain/model.ts`'s own definition:
   * the session already finished its turn and the ball is with the operator,
   * so closing it loses nothing in flight. This is the case the operator's
   * brief asked to be decided and justified explicitly.
   */
  it('sends at once on a `waiting` session — the ball is already with the operator', async () => {
    const calls: string[] = [];
    const { source } = sessionSourceWith(async (id) => {
      calls.push(id);
    });
    render(<Canvas model={modelWith('waiting')} source={source} />);
    await pressAsync('x');
    expect(confirmDialog(), 'waiting must not ask').toBeNull();
    expect(calls).toEqual(['a1']);
  });

  it('sends at once on an idle session too', async () => {
    const calls: string[] = [];
    const { source } = sessionSourceWith(async (id) => {
      calls.push(id);
    });
    render(<Canvas model={modelWith('idle')} source={source} />);
    await pressAsync('x');
    expect(confirmDialog()).toBeNull();
    expect(calls).toEqual(['a1']);
  });
});

describe('the sidebar row’s own `×`: the same gate', () => {
  const sidebarClose = (title: string) =>
    document.querySelector<HTMLButtonElement>(`[aria-label="close ${title}"]`);

  it('opens the confirm on a running session', async () => {
    const calls: string[] = [];
    const { source } = sessionSourceWith(async (id) => {
      calls.push(id);
    });
    render(<Canvas model={modelWith('running')} source={source} />);
    await act(async () => {
      sidebarClose('nightly sweep')?.click();
    });
    expect(confirmDialog()).not.toBeNull();
    expect(calls).toEqual([]);
    await act(async () => {
      confirmGo()?.click();
    });
    expect(calls).toEqual(['a1']);
  });

  it('sends at once when the row is not running', async () => {
    const calls: string[] = [];
    const { source } = sessionSourceWith(async (id) => {
      calls.push(id);
    });
    render(<Canvas model={modelWith('done')} source={source} />);
    await act(async () => {
      sidebarClose('nightly sweep')?.click();
    });
    expect(confirmDialog()).toBeNull();
    expect(calls).toEqual(['a1']);
  });
});

describe('a tab’s `×`: the same gate', () => {
  it('opens the confirm on a running session', async () => {
    const calls: string[] = [];
    const { source } = sessionSourceWith(async (id) => {
      calls.push(id);
    });
    render(<Canvas model={modelWith('running')} source={source} />);
    await act(async () => {
      closeIn('nightly sweep')?.click();
    });
    expect(confirmDialog()).not.toBeNull();
    expect(calls).toEqual([]);
    await act(async () => {
      confirmGo()?.click();
    });
    expect(calls).toEqual(['a1']);
  });

  it('sends at once when the tab’s session is not running', async () => {
    const calls: string[] = [];
    const { source } = sessionSourceWith(async (id) => {
      calls.push(id);
    });
    render(<Canvas model={modelWith('terminal')} source={source} />);
    await act(async () => {
      closeIn('nightly sweep')?.click();
    });
    expect(confirmDialog()).toBeNull();
    expect(calls).toEqual(['a1']);
  });
});

describe('a tab’s context menu "Close session": the same gate', () => {
  const openMenu = (title: string) => {
    const tab = tabFor(title);
    const button = tab?.querySelector('[data-tab-select]');
    act(() => {
      fireEvent.contextMenu(button as Element, { clientX: 10, clientY: 10 });
    });
  };
  const clickClose = () => {
    act(() => {
      fireEvent.click(document.querySelector('[data-context-menu-item="close"]') as Element);
    });
  };

  it('opens the confirm on a running session', async () => {
    const calls: string[] = [];
    const { source } = sessionSourceWith(async (id) => {
      calls.push(id);
    });
    render(<Canvas model={modelWith('running')} source={source} />);
    openMenu('nightly sweep');
    clickClose();
    expect(confirmDialog()).not.toBeNull();
    expect(calls).toEqual([]);
    await act(async () => {
      confirmGo()?.click();
    });
    expect(calls).toEqual(['a1']);
  });

  it('sends at once when the menu’s session is not running', () => {
    const calls: string[] = [];
    const { source } = sessionSourceWith(async (id) => {
      calls.push(id);
    });
    render(<Canvas model={modelWith('failed')} source={source} />);
    openMenu('nightly sweep');
    clickClose();
    expect(confirmDialog()).toBeNull();
    expect(calls).toEqual(['a1']);
  });
});

describe('the desktop confirm dialog is keyboard-friendly', () => {
  it('starts focus on Cancel, so a reflex Enter does not need to be feared', async () => {
    const { source } = sessionSourceWith(async () => {});
    render(<Canvas model={modelWith('running')} source={source} />);
    await pressAsync('x');
    expect(confirmDialog()).not.toBeNull();
    expect(document.activeElement).toBe(confirmCancel());
  });

  it('Enter confirms', async () => {
    const calls: string[] = [];
    const { source } = sessionSourceWith(async (id) => {
      calls.push(id);
    });
    render(<Canvas model={modelWith('running')} source={source} />);
    await pressAsync('x');
    expect(confirmDialog()).not.toBeNull();
    await act(async () => {
      confirmDialog()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(calls).toEqual(['a1']);
    expect(confirmDialog()).toBeNull();
  });

  it('Escape cancels', async () => {
    const calls: string[] = [];
    const { source } = sessionSourceWith(async (id) => {
      calls.push(id);
    });
    render(<Canvas model={modelWith('running')} source={source} />);
    await pressAsync('x');
    expect(confirmDialog()).not.toBeNull();
    await act(async () => {
      confirmDialog()?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(confirmDialog()).toBeNull();
    expect(calls).toEqual([]);
  });
});

/**
 * BACKGROUND AGENTS COUNT AS "STILL RUNNING". `Session.runningAgents` is the
 * live count of the session's background agents, and closing the session ends
 * them, so a `waiting` row with agents alive asks first -- with copy that says
 * what will be lost -- while a row with none keeps the old rule.
 */
describe('background agents gate the same confirm', () => {
  const heading = () =>
    confirmDialog()?.querySelector('span.font-semibold')?.textContent?.trim() ?? '';

  it('asks on a waiting row with 2 agents, names them, and sends nothing until answered', async () => {
    const calls: string[] = [];
    const { source } = sessionSourceWith(async (id) => {
      calls.push(id);
    });
    render(<Canvas model={modelWith('waiting', 2)} source={source} />);
    await pressAsync('x');
    expect(confirmDialog(), 'agents alive ask first').not.toBeNull();
    expect(heading()).toBe('Close session with background agents running?');
    expect(confirmDialog()?.textContent).toContain(
      '2 background agents still running. Closing the session ends them.',
    );
    expect(calls).toEqual([]);

    await act(async () => {
      confirmCancel()?.click();
    });
    expect(confirmDialog()).toBeNull();
    expect(calls, 'Cancel sends nothing').toEqual([]);

    await pressAsync('x');
    await act(async () => {
      confirmGo()?.click();
    });
    expect(calls).toEqual(['a1']);
  });

  it('keeps the existing copy on a running row with no agents', async () => {
    const { source } = sessionSourceWith(async () => {});
    render(<Canvas model={modelWith('running', 0)} source={source} />);
    await pressAsync('x');
    expect(confirmDialog()).not.toBeNull();
    expect(heading()).toBe('Close “nightly sweep”?');
    expect(confirmDialog()?.textContent).toContain('This ends the agent running in it.');
    expect(confirmDialog()?.textContent).not.toContain('background agent');
  });

  it('closes at once on a waiting or idle row with no agents', async () => {
    for (const status of ['waiting', 'idle'] as const) {
      const calls: string[] = [];
      const { source } = sessionSourceWith(async (id) => {
        calls.push(id);
      });
      render(<Canvas model={modelWith(status, 0)} source={source} />);
      await pressAsync('x');
      expect(confirmDialog(), status).toBeNull();
      expect(calls, status).toEqual(['a1']);
      cleanup();
    }
  });

  it('says `1 background agent` in the singular', async () => {
    const { source } = sessionSourceWith(async () => {});
    render(<Canvas model={modelWith('waiting', 1)} source={source} />);
    await pressAsync('x');
    expect(confirmDialog()?.textContent).toContain('1 background agent still running.');
    expect(confirmDialog()?.textContent).not.toContain('1 background agents');
  });
});
