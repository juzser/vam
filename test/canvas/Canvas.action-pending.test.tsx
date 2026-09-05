// @vitest-environment happy-dom

/**
 * Feedback while a session is being created or closed.
 *
 * THE COMPLAINT THIS ANSWERS: both actions spawn a subprocess with a ten
 * second timeout, and until now nothing on screen changed between the click
 * and the result, so a slow action and an ignored click looked identical.
 *
 * THE THIRD ASSERTION IS THE ONE THAT MATTERS. A spinner that keeps spinning
 * after a refusal turns a clear failure into an apparent hang, which is worse
 * than no spinner at all -- so the clearing is asserted on the failure paths
 * (more than one code, because a single one would not notice a classifier
 * that only handles its own) and on the timeout, not only on success.
 *
 * Nothing here spawns anything: the port's `write` members are the seam.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasSource } from '../../src/renderer/canvas/source.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';

const session = (id: string, title: string): Session => ({
  id,
  title,
  icon: null,
  epic: null,
  branch: null,
  status: 'done',
  runningAgents: 0,
  activity: null,
  age: null,
  decisions: [],
});

const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1', 'nightly sweep')] },
  ],
};

const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
const statusFull = () =>
  document.querySelector('[data-status-bar] [data-status]')?.getAttribute('data-note') ?? '';

/** A promise the test resolves by hand, so "while it runs" is a real moment. */
function deferred<T>() {
  let settle!: (value: T) => void;
  let fail!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

type Calls = { create: string[]; close: string[] };

function sourceWith(answer: () => Promise<void>): { source: CanvasSource; calls: Calls } {
  const calls: Calls = { create: [], close: [] };
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
      createSession: true,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
    },
    declines: {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: {
      recordPrompt: async () => {},
      createSession: (projectId: string) => {
        calls.create.push(projectId);
        return answer();
      },
      closeSession: (sessionId: string) => {
        calls.close.push(sessionId);
        return answer();
      },
    },
  };
  return {
    source: {
      kind: 'session',
      source: inner as unknown as SessionSource,
      onWrote: () => {},
    },
    calls,
  };
}

const click = async (label: string) => {
  await act(async () => {
    screen.getByLabelText(label).click();
  });
};

const press = async (key: string) => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
};

const control = (label: string) => screen.getByLabelText(label) as HTMLButtonElement;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
  globalThis.localStorage ??= (() => {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, String(value)),
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
      key: (index: number) => [...map.keys()][index] ?? null,
      get length() {
        return map.size;
      },
    };
  })() as unknown as Storage;
});

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('creating a session', () => {
  it('shows the control working, and disables it, while the spawn runs', async () => {
    const gate = deferred<void>();
    const { source } = sourceWith(() => gate.promise);
    render(<Canvas model={MODEL} source={source} />);
    await click('new session in alpha');

    const button = control('new session in alpha');
    expect(button.getAttribute('data-pending')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.disabled).toBe(true);
    expect(statusBar()).toContain('starting a new session in alpha');

    await act(async () => {
      gate.settle();
    });
    expect(control('new session in alpha').getAttribute('data-pending')).toBeNull();
    expect(statusFull()).toContain('it may take a moment to appear');
  });

  it('a second press while one is pending SPAWNS NOTHING', async () => {
    const gate = deferred<void>();
    const { source, calls } = sourceWith(() => gate.promise);
    render(<Canvas model={MODEL} source={source} />);
    await click('new session in alpha');
    await press('o');
    await click('new session');
    expect(calls.create).toEqual(['p1']);
    await act(async () => {
      gate.settle();
    });
  });

  it.each([
    ['tmux-missing', 'the `tmux` command was not found'],
    ['unknown-project', 'vam cannot tell which directory project p1 is'],
    ['timed-out', 'tmux did not answer within 10s'],
  ])('clears the pending state on %s and says why', async (code, message) => {
    const gate = deferred<void>();
    const { source } = sourceWith(() => gate.promise);
    render(<Canvas model={MODEL} source={source} />);
    await click('new session in alpha');
    await act(async () => {
      gate.fail({ kind: 'refused', code, message });
      await Promise.resolve();
    });
    const button = control('new session in alpha');
    expect(button.getAttribute('data-pending')).toBeNull();
    expect(button.disabled).toBe(false);
    expect(statusFull()).toContain(message);
  });
});

describe('closing a session', () => {
  it('shows the row control working and clears it on success', async () => {
    const gate = deferred<void>();
    const { source } = sourceWith(() => gate.promise);
    render(<Canvas model={MODEL} source={source} />);
    await click('close nightly sweep');

    expect(control('close nightly sweep').getAttribute('data-pending')).toBe('true');
    expect(statusBar()).toContain('stopping');

    await act(async () => {
      gate.settle();
    });
    expect(control('close nightly sweep').getAttribute('data-pending')).toBeNull();
    expect(statusFull()).toContain('the conversation is kept');
  });

  it('a second press while one is pending SPAWNS NOTHING', async () => {
    const gate = deferred<void>();
    const { source, calls } = sourceWith(() => gate.promise);
    render(<Canvas model={MODEL} source={source} />);
    await click('close nightly sweep');
    await press('x');
    await click('close nightly sweep');
    expect(calls.close).toEqual(['a1']);
    await act(async () => {
      gate.settle();
    });
  });

  it.each([
    ['interactive-session', 'close that terminal yourself'],
    ['no-such-session', 'that tmux session no longer exists'],
  ])('clears the pending state on %s and says why', async (code, message) => {
    const gate = deferred<void>();
    const { source } = sourceWith(() => gate.promise);
    render(<Canvas model={MODEL} source={source} />);
    await click('close nightly sweep');
    await act(async () => {
      gate.fail({ kind: 'refused', code, message });
      await Promise.resolve();
    });
    expect(control('close nightly sweep').getAttribute('data-pending')).toBeNull();
    expect(statusFull()).toContain(message);
  });
});

/**
 * With motion off the breathe animation is switched off in `styles.css`, so
 * the pending state has to be carried by something that is not movement. It
 * is: `aria-busy` and `data-pending` are attributes, and the caption changes.
 * This asserts the attributes rather than the animation, which is the point --
 * a test that read the animation would pass on a build nobody could read.
 */
describe('pending without motion', () => {
  it('says it is working in attributes and words, not only in movement', async () => {
    const gate = deferred<void>();
    const { source } = sourceWith(() => gate.promise);
    render(<Canvas model={MODEL} source={source} />);
    await click('new session in alpha');
    const button = control('new session in alpha');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('title')).toContain('Starting');
    expect(statusBar()).toContain('starting a new session in alpha');
    await act(async () => {
      gate.settle();
    });
  });
});

/**
 * A REFUSED SECOND ACTION NAMES ITS CAUSE (F-4).
 *
 * Both guards returned in silence while `removeProject`, one screen down in
 * the same file, already said `something else is still running — …`. Only the
 * PENDING control is disabled; every other row's `×` and every other
 * project's `+` stay live, so the operator's click landed on a button that
 * looked pressable and did nothing at all.
 *
 * Each test drives the refusal through a control that is NOT the pending one,
 * because the pending one is disabled and its click never reaches the guard.
 */
describe('a second action while one is in flight', () => {
  const TWO: CanvasModel = {
    projects: [
      {
        id: 'p1',
        name: 'alpha',
        source: 'claude-code',
        sessions: [session('a1', 'nightly sweep'), session('a2', 'the other one')],
      },
    ],
  };

  it('says why a second close was refused, and closes nothing', async () => {
    const gate = deferred<void>();
    const { source, calls } = sourceWith(() => gate.promise);
    render(<Canvas model={TWO} source={source} />);
    await click('close nightly sweep');
    await click('close the other one');
    expect(calls.close).toEqual(['a1']);
    expect(statusBar()).toMatch(/still running/i);
    // By name: "something is running" leaves the operator guessing which of
    // the two clicks was the one that did not happen.
    expect(statusFull()).toContain('the other one');
    await act(async () => {
      gate.settle();
    });
  });

  it('says why a second create was refused, and creates nothing', async () => {
    const gate = deferred<void>();
    const { source, calls } = sourceWith(() => gate.promise);
    render(<Canvas model={TWO} source={source} />);
    await click('close nightly sweep');
    await click('new session in alpha');
    expect(calls.create).toEqual([]);
    expect(statusBar()).toMatch(/still running/i);
    expect(statusFull()).toContain('alpha');
    await act(async () => {
      gate.settle();
    });
  });
});
