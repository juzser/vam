// @vitest-environment happy-dom

/**
 * THE WAIT BETWEEN A PRESS AND THE AGENT REGISTERING.
 *
 * Operator: "After clicking Start session on the start screen, there needs
 * to be a loading state while the session is being created." `typeIntoOwnPane`
 * (main) resolves the moment the KEYS are typed, seconds before an agent
 * registers anywhere vam can see it (`startSessionIn`'s own header in
 * `Canvas.tsx`), and until now nothing on screen said so: the operator saw
 * the same picker, could press it again, and got `pane-occupied` back for
 * their trouble.
 *
 * ASSERTED THROUGH THE REAL SOURCE PORT, exactly as
 * `Canvas.terminal-only-resume.test.tsx` and `Canvas.new-session.test.tsx`
 * already do for their own writes: a `recordPrompt` the test resolves BY
 * HAND is what lets the in-flight state be read, and a model swapped by
 * `rerender` — the same `EMPTY -> AGENT` pair `Canvas.pane-row-resolves.
 * test.tsx` uses — is what proves the wait ends on the ROW, not on the write.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Canvas, START_PANE_WAIT_TIMEOUT_MS } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

const PANE = 'vam-alpha-aa11bb';

const UNSTARTED: Session = {
  id: `pane:${PANE}`,
  title: PANE,
  epic: null,
  branch: null,
  status: 'unstarted',
  runningAgents: 0,
  activity: null,
  age: null,
  decisions: [],
  source: 'claude-code',
  vamControlled: true,
  pane: PANE,
};

const TERMINAL: Session = {
  ...UNSTARTED,
  status: 'terminal',
  title: 'fix the flaky test',
  resumeCommand: 'claude --resume aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
};

/** The same pane, a poll later, with an agent registered in it. */
const LIVE: Session = {
  id: 'sess-a#4242',
  title: UNSTARTED.title,
  epic: null,
  branch: null,
  status: 'running',
  runningAgents: 0,
  activity: null,
  age: null,
  decisions: [{ id: 'd1', label: 'you', input: 'go on', output: null, commands: [] }],
  source: 'claude-code',
  vamControlled: true,
  pane: PANE,
};

function otherSession(id: string): Session {
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
  };
}

function modelWith(...sessions: readonly Session[]): CanvasModel {
  return { projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions }] };
}

function sourceWith(onRecord: (sessionId: string, prompt: string) => Promise<void>): {
  source: CanvasSource;
  recorded: [string, string][];
  wrote: { count: number };
} {
  const recorded: [string, string][] = [];
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
      closeSession: false,
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
    write: {
      recordPrompt: async (sessionId: string, prompt: string) => {
        recorded.push([sessionId, prompt]);
        await onRecord(sessionId, prompt);
      },
    },
  };
  return {
    source: {
      kind: 'session',
      source: inner as unknown as SessionSource,
      onWrote: () => {
        wrote.count += 1;
      },
    },
    recorded,
    wrote,
  };
}

/** A write the test resolves by hand, so the wait can be read mid-flight. */
function gatedSource() {
  let release: (() => void) | null = null;
  const built = sourceWith(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  return { ...built, release: () => release?.() };
}

const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
const startButton = () =>
  document.querySelector('[data-start-session-button]') as HTMLButtonElement | null;
const resumeButton = () =>
  document.querySelector('[data-resume-in-pane]') as HTMLButtonElement | null;
const providerPicker = () => document.querySelector('[data-start-providers]');
const timeoutHint = () => document.querySelector('[data-start-timeout-hint]');

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

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

describe('Start session — the wait for the agent to register', () => {
  it('shows a loading state the instant Start is pressed', async () => {
    const { source } = gatedSource();
    render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    await act(async () => {
      startButton()?.click();
    });
    expect(startButton()?.disabled).toBe(true);
    expect(startButton()?.textContent).toContain('Starting Claude Code');
    expect(providerPicker()?.hasAttribute('disabled')).toBe(true);
  });

  it('stays up after the write resolves, while the row is still unstarted', async () => {
    const { source, release } = gatedSource();
    render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    await act(async () => {
      startButton()?.click();
    });
    await act(async () => {
      release();
    });
    expect(startButton()?.disabled).toBe(true);
    expect(document.querySelector('[data-start-session]')).not.toBeNull();
  });

  it('clears once the row stops being unstarted — the agent registered', async () => {
    const { source, release } = gatedSource();
    const view = render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    await act(async () => {
      startButton()?.click();
    });
    await act(async () => {
      release();
    });
    await act(async () => {
      view.rerender(<Canvas model={modelWith(LIVE)} source={source} />);
    });
    expect(document.querySelector('[data-start-session]')).toBeNull();
    // AND THE RECORD ITSELF IS GONE, not merely unreadable because this row
    // no longer draws a start screen: a fresh `unstarted` row on the SAME
    // pane (`startingPaneByKey`'s own key) must open on the ordinary picker,
    // not on a wait nothing cleared.
    await act(async () => {
      view.rerender(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    });
    expect(startButton()?.disabled).toBe(false);
    expect(providerPicker()?.hasAttribute('disabled')).toBe(false);
  });

  it('clears at once on a refusal, and the reason is the source’s own', async () => {
    const { source } = sourceWith(async () => {
      throw {
        kind: 'refused',
        code: 'pane-occupied',
        message: 'someone typed claude by hand in the meantime',
      };
    });
    render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    await act(async () => {
      startButton()?.click();
    });
    expect(startButton()?.disabled).toBe(false);
    expect(providerPicker()?.hasAttribute('disabled')).toBe(false);
    expect(statusBar()).toContain('someone typed claude by hand in the meantime');
  });

  it('persists across a tab switch in the same pane, keyed by the row rather than local state', async () => {
    const { source } = gatedSource();
    render(<Canvas model={modelWith(UNSTARTED, otherSession('s2'))} source={source} />);
    await act(async () => {
      startButton()?.click();
    });
    expect(startButton()?.disabled).toBe(true);

    const tabs = () => [...document.querySelectorAll('[data-tab-select]')] as HTMLElement[];
    const otherTab = tabs().find((el) => el.textContent === 's2');
    await act(async () => {
      otherTab?.click();
    });
    expect(document.querySelector('[data-start-session]')).toBeNull();

    const firstTab = tabs().find((el) => el.textContent === PANE);
    await act(async () => {
      firstTab?.click();
    });
    expect(startButton()?.disabled).toBe(true);
    expect(startButton()?.textContent).toContain('Starting Claude Code');
  });

  it('a second press does nothing once the write has already resolved, while the row still has not arrived', async () => {
    const { source, recorded } = sourceWith(async () => {});
    render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    await act(async () => {
      startButton()?.click();
    });
    expect(recorded).toHaveLength(1);
    expect(startButton()?.disabled).toBe(true);
    await act(async () => {
      startButton()?.click();
    });
    expect(recorded).toHaveLength(1);
  });

  it('drops the spinner and offers the Terminal view once the wait passes the timeout', async () => {
    vi.useFakeTimers();
    const { source } = gatedSource();
    render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    await act(async () => {
      startButton()?.click();
    });
    expect(timeoutHint()).toBeNull();
    expect(startButton()?.querySelector('.vam-spin')).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(START_PANE_WAIT_TIMEOUT_MS);
    });
    expect(timeoutHint()?.textContent).toContain('Still starting');
    expect(startButton()?.querySelector('.vam-spin')).toBeNull();
    // NEVER LEFT SPINNING: the button still says what it is doing, but the
    // one part that promised an end it could not see is gone.
    expect(startButton()?.disabled).toBe(true);
  });
});

describe('Resume — the same wait, on the terminal-only screen', () => {
  it('shows "Resuming…" the instant it is pressed, and freezes Start too', async () => {
    const { source } = gatedSource();
    render(<Canvas model={modelWith(TERMINAL)} source={source} />);
    await act(async () => {
      resumeButton()?.click();
    });
    expect(resumeButton()?.disabled).toBe(true);
    expect(resumeButton()?.textContent).toContain('Resuming');
    expect(startButton()?.disabled).toBe(true);
    expect(providerPicker()?.hasAttribute('disabled')).toBe(true);
  });

  it('clears at once on a refusal', async () => {
    const { source } = sourceWith(async () => {
      throw new Error('tmux said no');
    });
    render(<Canvas model={modelWith(TERMINAL)} source={source} />);
    await act(async () => {
      resumeButton()?.click();
    });
    expect(resumeButton()?.disabled).toBe(false);
    expect(statusBar()).toContain('tmux said no');
  });

  it('clears once the row stops being terminal — the agent registered', async () => {
    const { source, release } = gatedSource();
    const view = render(<Canvas model={modelWith(TERMINAL)} source={source} />);
    await act(async () => {
      resumeButton()?.click();
    });
    await act(async () => {
      release();
    });
    await act(async () => {
      view.rerender(<Canvas model={modelWith(LIVE)} source={source} />);
    });
    expect(document.querySelector('[data-terminal-only-start]')).toBeNull();
    // AND THE RECORD ITSELF IS GONE -- see the Start session version of this
    // assertion above for why this is not merely "the screen changed".
    await act(async () => {
      view.rerender(<Canvas model={modelWith(TERMINAL)} source={source} />);
    });
    expect(resumeButton()?.disabled).toBe(false);
  });

  it('a second press does nothing once the write has already resolved, while the row still has not arrived', async () => {
    const { source, recorded } = sourceWith(async () => {});
    render(<Canvas model={modelWith(TERMINAL)} source={source} />);
    await act(async () => {
      resumeButton()?.click();
    });
    expect(recorded).toHaveLength(1);
    await act(async () => {
      resumeButton()?.click();
    });
    expect(recorded).toHaveLength(1);
  });
});
