// @vitest-environment happy-dom

/**
 * `o` -- New session -- as a real creation rather than a sentence about the CLI.
 *
 * Nothing here spawns anything: the path is asserted through the port's
 * `write.createSession`, which is the seam main's tmux provider sits behind.
 * The refusal case asserts the NEGATIVE directly -- a source that cannot
 * create must call nothing at all, not call and then apologise.
 */

import { act, cleanup, render } from '@testing-library/react';
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

const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';

async function pressAsync(key: string) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function sourceWith(createSession?: (projectId: string, title: string) => Promise<void>): {
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
      closeSession: false,
      createSession: createSession !== undefined,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
    },
    declines:
      createSession === undefined ? { createSession: 'this source has no way to start one' } : {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: {
      recordPrompt: async () => {},
      ...(createSession === undefined ? {} : { createSession }),
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

describe('creating a session with `o`', () => {
  it('really calls the source, in the focused session’s own project', async () => {
    const created: [string, string][] = [];
    const { source, wrote } = sourceWith(async (projectId, title) => {
      created.push([projectId, title]);
    });
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('o');
    expect(created).toEqual([['p1', 'alpha']]);
    expect(statusBar()).toContain('alpha');
    expect(wrote.count).toBe(1);
  });

  it('refuses in the source’s own words, and CALLS NOTHING, when it cannot', async () => {
    const { source, wrote } = sourceWith();
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('o');
    expect(statusBar()).toContain('this source has no way to start one');
    expect(statusBar()).not.toMatch(/started|created a/i);
    expect(wrote.count).toBe(0);
  });

  it('reports the failure rather than claiming a session it did not start', async () => {
    const { source } = sourceWith(async () => {
      throw { kind: 'refused', code: 'session-exists', message: 'a session by that name exists' };
    });
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('o');
    expect(statusBar()).toContain('session-exists');
    expect(statusBar()).not.toMatch(/^started/i);
  });
});
