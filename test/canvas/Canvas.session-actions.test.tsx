// @vitest-environment happy-dom

/**
 * The two controls that used to type-check, look real, and then refuse: `x`
 * (close) and `r` (rename).
 *
 * Nothing here spawns anything. The close path is asserted through the port's
 * `write.closeSession`, which is the seam main's `stop.ts` sits behind, and
 * the rename path through prefs -- the CLI has no rename verb, so vam's own
 * store is the whole implementation.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasSource } from '../../src/renderer/canvas/source.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';

function session(id: string, over: Partial<Session> = {}): Session {
  return {
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
    ...over,
  };
}

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'claude-code',
      sessions: [session('a1', { title: 'nightly sweep' }), session('a2')],
    },
  ],
};

const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
const renameInput = () =>
  document.querySelector<HTMLInputElement>('input[aria-label="rename session"]');
const sidebarText = () => document.querySelectorAll('aside')[0]?.textContent ?? '';

function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

async function pressAsync(key: string, modifiers: KeyboardEventInit = {}) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

function typeInto(input: HTMLInputElement, text: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set as (
      this: HTMLElement,
      v: string,
    ) => void;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** A `SessionSource` whose `write` carries `closeSession` only when it can. */
function sessionSourceWith(closeSession?: (sessionId: string) => Promise<void>): {
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
      closeSession: closeSession !== undefined,
      createSession: false,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
    },
    declines: closeSession === undefined ? { closeSession: 'no verb for it' } : {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: {
      recordPrompt: async () => {},
      ...(closeSession === undefined ? {} : { closeSession }),
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

// The same three globals every rendering Canvas test installs: ReactFlow
// needs the first two, prefs the third.
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

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('closing a session with `x`', () => {
  it('really calls the source and says the conversation is kept', async () => {
    const closed: string[] = [];
    const { source, wrote } = sessionSourceWith(async (id) => {
      closed.push(id);
    });
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('x');
    expect(closed).toEqual(['a1']);
    expect(statusBar()).toContain('nightly sweep');
    expect(statusBar()).toMatch(/attach/i);
    expect(wrote.count).toBe(1);
  });

  it('reports the refusal in the source’s own words rather than claiming success', async () => {
    const { source } = sessionSourceWith(async () => {
      throw { kind: 'refused', code: 'interactive-session', message: 'close that terminal' };
    });
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('x');
    expect(statusBar()).toContain('interactive-session');
    expect(statusBar()).toContain('close that terminal');
    expect(statusBar()).not.toMatch(/stopped/i);
  });

  it('`Mod-w` reaches the very same path', async () => {
    const closed: string[] = [];
    const { source } = sessionSourceWith(async (id) => {
      closed.push(id);
    });
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('w', { metaKey: true });
    expect(closed).toEqual(['a1']);
  });

  it('refuses honestly, and calls nothing, when the source cannot close at all', async () => {
    const { source } = sessionSourceWith();
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('x');
    expect(statusBar()).toContain('nightly sweep');
    expect(statusBar()).toMatch(/cannot|no /i);
  });
});

describe('renaming a session with `r`', () => {
  const renameTo = async (name: string) => {
    press('r');
    const input = renameInput();
    expect(input).not.toBeNull();
    typeInto(input as HTMLInputElement, name);
    await act(async () => {
      (input as HTMLInputElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });
  };

  it('keeps the name, and it wins over the source’s own title', async () => {
    const { source } = sessionSourceWith(async () => {});
    render(<Canvas model={MODEL} source={source} />);
    await renameTo('the good one');
    expect(sidebarText()).toContain('the good one');
    expect(sidebarText()).not.toContain('nightly sweep');
    expect(statusBar()).not.toMatch(/cannot rename/i);
  });

  it('survives a reload, because it is stored rather than held in state', async () => {
    const { source } = sessionSourceWith(async () => {});
    const first = render(<Canvas model={MODEL} source={source} />);
    await renameTo('the good one');
    first.unmount();
    render(<Canvas model={MODEL} source={source} />);
    expect(sidebarText()).toContain('the good one');
  });

  it('restores the source name when the rename is cleared to nothing', async () => {
    const { source } = sessionSourceWith(async () => {});
    render(<Canvas model={MODEL} source={source} />);
    await renameTo('the good one');
    await renameTo('');
    expect(sidebarText()).toContain('nightly sweep');
    expect(sidebarText()).not.toContain('the good one');
  });
});
