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
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

const session = (id: string, title: string): Session => ({
  id,
  title,
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
      resumeSession: false,
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

/**
 * Start a session in a named project -- two presses now, and that is the
 * change rather than an accident of this helper.
 *
 * The control was a `+` on the project heading labelled "new session in
 * alpha", which is what these tests used to click. It is the first item of
 * that project's own menu now (one icon less per heading, at the operator's
 * request), so the route is: open the menu, press the item.
 */
const addInProject = async (projectId: string) => {
  await act(async () => {
    (document.querySelector(`[data-project-menu="${projectId}"]`) as HTMLElement).click();
  });
  await act(async () => {
    (
      document.querySelector(
        `[data-project-menu-panel="${projectId}"] [data-project-menu-item="new-session"]`,
      ) as HTMLElement
    ).click();
  });
};

/** The sidebar's "starting a session in …" row. */
const startingRow = () => document.querySelector('[data-session-starting]');

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
});

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

/**
 * WHAT CARRIES THE WAIT NOW THAT THE CONTROL CLOSES BEHIND ITSELF.
 *
 * These four used to read the `+`'s own attributes -- `data-pending`,
 * `aria-busy`, `disabled` -- because the button stayed on screen through the
 * spawn. The add is a menu item now, and a menu item that did not dismiss its
 * menu would be the only one in vam that does not.
 *
 * Nothing is unheld by that. The wait was never carried by the button alone:
 * `createSession` sets `starting`, which draws an `aria-live` row inside the
 * project reading "starting a session in alpha…", and sets the status bar in
 * the same breath. That row is the assertion here, and it is the better one --
 * it names the project, it is announced, and it is what the operator actually
 * looks at. The double-press guard never lived on the control either: a
 * disabled button dispatches no click, so the guard that matters is
 * `createSession`'s own `pendingAction` check, which the second test reaches
 * through a DIFFERENT control exactly as it did before.
 */
describe('creating a session', () => {
  it('shows the work running, and says where, while the spawn runs', async () => {
    const gate = deferred<void>();
    const { source } = sourceWith(() => gate.promise);
    render(<Canvas model={MODEL} source={source} />);
    await addInProject('p1');

    const row = startingRow();
    expect(row, 'no starting row while the spawn runs').not.toBeNull();
    expect(row?.textContent).toContain('starting a session in alpha');
    // Announced, not merely drawn: the row is the only thing on screen that
    // changed, so a reader who cannot see it has to be told.
    expect(row?.getAttribute('aria-live')).toBe('polite');
    expect(statusBar()).toContain('starting a new session in alpha');

    await act(async () => {
      gate.settle();
    });
    expect(statusFull()).toContain('it may take a moment to appear');
  });

  it('a second press while one is pending SPAWNS NOTHING', async () => {
    const gate = deferred<void>();
    const { source, calls } = sourceWith(() => gate.promise);
    render(<Canvas model={MODEL} source={source} />);
    await addInProject('p1');
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
  ])('stops saying it is working on %s, and says why', async (code, message) => {
    const gate = deferred<void>();
    const { source } = sourceWith(() => gate.promise);
    render(<Canvas model={MODEL} source={source} />);
    await addInProject('p1');
    expect(startingRow()).not.toBeNull();
    await act(async () => {
      gate.fail({ kind: 'refused', code, message });
      await Promise.resolve();
    });
    // NOTHING IS LEFT SPINNING: an indicator that outlives its own failure
    // says vam is still trying when vam has stopped.
    expect(startingRow()).toBeNull();
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
  it('says it is working in words, not only in movement', async () => {
    const gate = deferred<void>();
    const { source } = sourceWith(() => gate.promise);
    render(<Canvas model={MODEL} source={source} />);
    await addInProject('p1');
    // The row breathes a dot, and with motion off the dot is all that stops.
    // What is left is a sentence naming the project and the status bar saying
    // the same thing -- two text channels for a state that used to be an
    // attribute on a button that has since closed behind itself.
    expect(startingRow()?.textContent).toContain('starting a session in alpha');
    expect(statusBar()).toContain('starting a new session in alpha');
    await act(async () => {
      gate.settle();
    });
  });

  /** The close control is still a button that stays on screen, so its own
   *  attributes are still the channel there -- unchanged, and asserted so the
   *  rewrite above cannot be read as "vam stopped doing this anywhere". */
  it('keeps the same promise on the row close, which did not move', async () => {
    const gate = deferred<void>();
    const { source } = sourceWith(() => gate.promise);
    render(<Canvas model={MODEL} source={source} />);
    await click('close nightly sweep');
    const button = control('close nightly sweep');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('title')).toContain('Stopping');
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
    await addInProject('p1');
    expect(calls.create).toEqual([]);
    expect(statusBar()).toMatch(/still running/i);
    expect(statusFull()).toContain('alpha');
    await act(async () => {
      gate.settle();
    });
  });
});
