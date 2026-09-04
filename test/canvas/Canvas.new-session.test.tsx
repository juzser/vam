// @vitest-environment happy-dom

/**
 * `o` -- New session -- as a real creation rather than a sentence about the CLI.
 *
 * Nothing here spawns anything: the path is asserted through the port's
 * `write.createSession`, which is the seam main's tmux provider sits behind.
 * The refusal case asserts the NEGATIVE directly -- a source that cannot
 * create must call nothing at all, not call and then apologise.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasSource } from '../../src/renderer/canvas/source.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { buildKeySheet } from '../../src/renderer/keyboard/keysheet.js';
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

async function clickAsync(label: string) {
  await act(async () => {
    screen.getByLabelText(label).click();
  });
}

async function pressAsync(key: string, modifiers: KeyboardEventInit = {}) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
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

  /**
   * The two mouse paths, against a source that CAN create -- which is the
   * whole point of asserting them. Clicked against a source that cannot, both
   * buttons return at the `createSession` guard before either argument is
   * read, so a swapped `(name, id)` would sail through: main answers
   * `unknown-project` for every add and no test moves.
   *
   * So the assertion is by VALUE and in ORDER: the project id first, the
   * display name second.
   */
  it('the per-project add button passes (id, name), in that order', async () => {
    const created: [string, string][] = [];
    const { source, wrote } = sourceWith(async (projectId, title) => {
      created.push([projectId, title]);
    });
    render(<Canvas model={MODEL} source={source} />);
    await clickAsync('new session in alpha');
    expect(created).toEqual([['p1', 'alpha']]);
    expect(wrote.count).toBe(1);
  });

  it('the footer add button passes (id, name), in that order', async () => {
    const created: [string, string][] = [];
    const { source } = sourceWith(async (projectId, title) => {
      created.push([projectId, title]);
    });
    render(<Canvas model={MODEL} source={source} />);
    await clickAsync('new session');
    expect(created).toEqual([['p1', 'alpha']]);
  });

  it('does not claim the new session is visible yet', async () => {
    // `tmux new-session -d` returns as soon as the session exists, before the
    // agent inside it has registered anywhere vam can read, so the reload that
    // follows will not show the new row. Saying it started is true; implying
    // it is on screen is not, and the operator would read a missing row as a
    // failure.
    const { source } = sourceWith(async () => {});
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('o');
    expect(statusBar()).toContain('alpha');
    expect(statusBar()).toMatch(/moment to appear|not showing yet/i);
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

/**
 * `Mod-n` — the same action under the chord every application already spells
 * "new". ALONGSIDE `o`, not instead of it: `o` is the vim gesture the rest of
 * this grammar is built on, and the two are one binding with two keys, the way
 * `close` already holds `x` and `Mod-w`.
 *
 * Asserted through `buildKeySheet` rather than against a written-out list,
 * because the sheet is generated: a binding that reached the table without a
 * label cannot reach the sheet, and a list written here would pass either way.
 */
describe('creating a session with `Mod-n`', () => {
  it('starts a session, exactly as `o` does', async () => {
    const created: [string, string][] = [];
    const { source, wrote } = sourceWith(async (projectId, title) => {
      created.push([projectId, title]);
    });
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('n', { metaKey: true });
    expect(created).toEqual([['p1', 'alpha']]);
    expect(wrote.count).toBe(1);
  });

  it('leaves plain `n` to the search, which is a different action', async () => {
    const created: string[] = [];
    const { source } = sourceWith(async (projectId) => void created.push(projectId));
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('n');
    expect(created).toEqual([]);
  });

  /**
   * `#154` let modifier chords past the `INPUT|TEXTAREA` early return, so this
   * is a decision rather than an inheritance: mid-prompt, `Mod-n` DOES start a
   * session. A Cmd chord produces no character on any layout, so it cannot be
   * something the operator meant to type; and the moment you want another
   * session is usually while you are already writing to one. The draft is not
   * touched — starting a session neither sends nor clears it.
   */
  it('starts one from inside the prompt box, without disturbing the draft', async () => {
    const created: string[] = [];
    const { source } = sourceWith(async (projectId) => void created.push(projectId));
    render(<Canvas model={MODEL} source={source} />);
    const box = document.querySelector('textarea');
    expect(box).not.toBeNull();
    await act(async () => {
      fireEvent.change(box as HTMLTextAreaElement, { target: { value: 'half a thought' } });
    });
    await act(async () => {
      (box as HTMLTextAreaElement).focus();
      fireEvent.keyDown(box as HTMLTextAreaElement, { key: 'n', metaKey: true, bubbles: true });
    });
    expect(created).toEqual(['p1']);
    expect((box as HTMLTextAreaElement).value).toBe('half a thought');
  });

  it('does nothing while an overlay owns the keyboard', async () => {
    const created: string[] = [];
    const { source } = sourceWith(async (projectId) => void created.push(projectId));
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('?');
    expect(document.querySelector('[data-key-sheet]')).not.toBeNull();
    await pressAsync('n', { metaKey: true });
    expect(created).toEqual([]);
  });

  it('appears in the generated key sheet, next to `o`', () => {
    const rows = buildKeySheet().flatMap((group) => group.rows);
    const start = rows.filter((row) => row.label === 'start a new session');
    expect(start.map((row) => row.keys).sort()).toEqual(['Mod-n', 'o']);
  });
});
