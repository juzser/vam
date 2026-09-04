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
});
