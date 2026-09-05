// @vitest-environment happy-dom

/**
 * The Projects header's `+` -- "new project", which here can only mean:
 * choose a directory, and start a session in it.
 *
 * A project in vam is derived from the cwd of a live session; there is no
 * stored thing to create. So this path has exactly two halves, and both are
 * asserted through their seams rather than performed: the directory picker is
 * `window.api.dialog.chooseDirectory` (Electron's `showOpenDialog`, absent in
 * the browser build) and the creation is the port's `write.createSessionIn`,
 * behind which main's tmux provider sits. NOTHING here spawns anything.
 *
 * Every refusal test asserts the NEGATIVE directly -- that `createSessionIn`
 * was never called -- and not merely that a sentence appeared. A test that
 * only reads the status bar passes just as happily against an implementation
 * that starts a session and then apologises.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { whyNotARepository } from '../../src/main/sources/repo.js';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasSource } from '../../src/renderer/canvas/source.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';

const session = (id: string): Session => ({
  id,
  title: id,
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
  projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1')] }],
};

/** A directory that is nobody's home: this repo is public. */
const CHOSEN = '/srv/work/orchard';

const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';

async function clickNewProject() {
  await act(async () => {
    screen.getByLabelText('new project').click();
  });
}

type Spawned = [string, string][];

function sourceWith(canCreate: boolean): {
  source: CanvasSource;
  spawned: Spawned;
  wrote: { count: number };
} {
  const spawned: Spawned = [];
  const wrote = { count: 0 };
  const writes = canCreate
    ? {
        createSession: async () => {},
        createSessionIn: async (cwd: string, title: string) => {
          spawned.push([cwd, title]);
        },
      }
    : {};
  const inner = {
    id: 'claude-code',
    label: 'Claude Code',
    capabilities: {
      liveUpdates: false,
      recordPrompt: true,
      deliverPrompt: false,
      promptAttachments: false,
      slashCommands: false,
      renameSession: false,
      closeSession: false,
      createSession: canCreate,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
    },
    declines: canCreate ? {} : { createSession: 'this source has no way to start one' },
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: { recordPrompt: async () => {}, ...writes },
  };
  return {
    source: {
      kind: 'session',
      source: inner as unknown as SessionSource,
      onWrote: () => {
        wrote.count += 1;
      },
    },
    spawned,
    wrote,
  };
}

/** Installs a picker, or -- with `undefined` -- the browser build's absence of one. */
function withDialog(chooseDirectory?: () => Promise<string | null>) {
  const calls = { count: 0 };
  const api =
    chooseDirectory === undefined
      ? undefined
      : {
          dialog: {
            chooseDirectory: async () => {
              calls.count += 1;
              return chooseDirectory();
            },
          },
        };
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
  return calls;
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
  Object.defineProperty(window, 'api', { value: undefined, configurable: true, writable: true });
});

describe('new project', () => {
  it('starts a session in the chosen directory, by (cwd, name) in that order', async () => {
    const { source, spawned, wrote } = sourceWith(true);
    withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    // By VALUE and in ORDER. Clicked against a source that cannot create, this
    // control returns before either argument is read, so a swapped pair would
    // sail through every refusal test in this file (#127's finding).
    expect(spawned).toEqual([[CHOSEN, 'orchard']]);
    expect(statusBar()).toContain('orchard');
    expect(wrote.count).toBe(1);
  });

  it('cancelling the picker starts nothing', async () => {
    const { source, spawned, wrote } = sourceWith(true);
    withDialog(async () => null);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    expect(spawned).toEqual([]);
    expect(wrote.count).toBe(0);
    expect(statusBar()).toMatch(/no directory/i);
  });

  it('with no Electron bridge it says so, opens nothing and starts nothing', async () => {
    const { source, spawned } = sourceWith(true);
    withDialog();
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    expect(spawned).toEqual([]);
    expect(statusBar()).toMatch(/desktop app|browser/i);
    expect(statusBar()).not.toMatch(/started/i);
  });

  it('a source that cannot create refuses in its own words and never opens the picker', async () => {
    const { source, spawned } = sourceWith(false);
    const picker = withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    expect(spawned).toEqual([]);
    expect(picker.count).toBe(0);
    expect(statusBar()).toContain('this source has no way to start one');
  });

  it('reports a failed start rather than claiming a session it did not start', async () => {
    const { source, wrote } = sourceWith(true);
    const inner = (source as { source: SessionSource }).source as unknown as {
      write: { createSessionIn: unknown };
    };
    inner.write.createSessionIn = async () => {
      throw { kind: 'refused', code: 'no-such-directory', message: 'that directory is gone' };
    };
    withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    expect(statusBar()).toContain('no-such-directory');
    expect(wrote.count).toBe(0);
  });

  /**
   * The narrowing the operator asked for, seen from where they see it. The
   * refusal is main's (`src/main/sources/repo.ts`) and it is asserted here BY
   * ITS OWN WORDS rather than by a stand-in shape: the failure mode this
   * closes is picking a directory that is not a repository and being told
   * nothing, so what has to hold is that main's sentence -- the path included
   * -- reaches the status bar.
   */
  it('a chosen directory that is not a repository is refused, in main’s own words', async () => {
    const { source, wrote } = sourceWith(true);
    const refusal = whyNotARepository(CHOSEN);
    const inner = (source as { source: SessionSource }).source as unknown as {
      write: { createSessionIn: unknown };
    };
    inner.write.createSessionIn = async () => {
      throw refusal;
    };
    withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    expect(refusal?.code).toBe('not-a-repository');
    expect(statusBar()).toContain('not-a-repository');
    // The path, because "invalid directory" would leave the operator retracing
    // which one they clicked.
    expect(statusBar()).toContain(CHOSEN);
    expect(wrote.count).toBe(0);
  });
});

/**
 * FEEDBACK, and the guard that comes with it (F-1).
 *
 * `newProject` was the one create path that set neither `pendingAction` nor a
 * status, so between the directory dialog closing and `createSessionIn`
 * resolving -- two tmux spawns at a 10 s timeout each -- nothing on screen
 * changed and the `+` stayed live. The second-order half is the one that costs
 * something: with no pending state there was no guard either, so a second
 * click opened a second dialog and started a SECOND session in the directory.
 *
 * Both halves are asserted against the seams, never performed: `picker.count`
 * is how many dialogs were opened and `spawned` is how many sessions were
 * started. A test that read only the status bar would pass against an
 * implementation that starts two sessions and describes one.
 */
describe('new project — feedback and the in-flight guard', () => {
  /** A promise the test resolves by hand, so "while it runs" is a real moment. */
  function deferred<T>() {
    let settle!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
      settle = resolve;
    });
    return { promise, settle };
  }

  const control = () => screen.getByLabelText('new project') as HTMLButtonElement;

  it('goes busy and says so before the picker has answered', async () => {
    const { source, spawned } = sourceWith(true);
    const gate = deferred<string | null>();
    withDialog(() => gate.promise);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();

    // BEFORE the await resolves: the control is already wearing the action.
    expect(control().getAttribute('data-pending')).toBe('true');
    expect(control().getAttribute('aria-busy')).toBe('true');
    expect(control().disabled).toBe(true);
    expect(statusBar()).toMatch(/choosing a directory/i);
    expect(spawned).toEqual([]);

    await act(async () => {
      gate.settle(CHOSEN);
    });
    expect(control().getAttribute('data-pending')).toBeNull();
    expect(statusBar()).toContain('orchard');
  });

  it('a second click while the picker is open opens no second dialog and starts no second session', async () => {
    const { source, spawned } = sourceWith(true);
    const gate = deferred<string | null>();
    const picker = withDialog(() => gate.promise);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    // The button is disabled, so drive the handler directly -- a guard that
    // exists only as `disabled` is one keyboard path away from being absent.
    await act(async () => {
      control().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(picker.count).toBe(1);

    await act(async () => {
      gate.settle(CHOSEN);
    });
    expect(spawned).toEqual([[CHOSEN, 'orchard']]);
  });

  it('says "starting…" before the spawn, and clears the busy state when it lands', async () => {
    const { source } = sourceWith(true);
    const gate = deferred<void>();
    const inner = (source as { source: SessionSource }).source as unknown as {
      write: { createSessionIn: () => Promise<void> };
    };
    inner.write.createSessionIn = () => gate.promise;
    withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();

    expect(statusBar()).toContain('starting a new session in orchard');
    expect(control().disabled).toBe(true);

    await act(async () => {
      gate.settle();
    });
    expect(control().getAttribute('data-pending')).toBeNull();
    expect(control().disabled).toBe(false);
  });

  it.each([
    ['cancelling', async () => null],
    ['a failed spawn', async () => CHOSEN],
  ])('clears the busy state after %s', async (_label, choose) => {
    const { source } = sourceWith(true);
    const inner = (source as { source: SessionSource }).source as unknown as {
      write: { createSessionIn: () => Promise<void> };
    };
    inner.write.createSessionIn = async () => {
      throw { kind: 'refused', code: 'tmux-missing', message: 'the `tmux` command was not found' };
    };
    withDialog(choose);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    expect(control().getAttribute('data-pending')).toBeNull();
    expect(control().disabled).toBe(false);
  });
});
