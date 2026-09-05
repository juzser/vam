// @vitest-environment happy-dom

/**
 * THE CELL THAT SAYS WHETHER VAM IS CONNECTED (F-6).
 *
 * Its own comment in `Canvas.tsx` states the rule: "the one thing a dashboard
 * must never do is look the same whether or not it is connected". The
 * `'session'` arm -- the only arm the desktop build ever reaches -- broke it
 * twice. It hard-coded a green dot and the source's name, so a source whose
 * every poll was failing read exactly like a healthy one; and before the
 * source was assembled at all there was no `'session'` source yet, so the
 * canvas fell back to `READ_ONLY_SOURCE` and the opening window claimed "no
 * write route — this canvas is read-only" about a source that was still
 * loading and would turn out to be writable.
 *
 * Asserted on the cell's own text and its colour class, because the colour is
 * the whole claim: the failure badge in the status bar was already correct,
 * and it was the green dot beside it that contradicted it.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasSource } from '../../src/renderer/canvas/source.js';
import type { CanvasModel } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';

const MODEL: CanvasModel = { projects: [] };

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
    createSession: false,
    governance: false,
    pullRequests: false,
    terminal: false,
    agentRoster: false,
  },
  declines: {},
  viewerScope: { kind: 'connection', note: 'one local process' },
  load: async () => [],
  write: { recordPrompt: async () => {} },
} as unknown as SessionSource;

const cell = () => document.querySelector('[data-source]') as HTMLElement;
const dot = () => cell().firstElementChild as HTMLElement;

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

describe('the source cell', () => {
  it('reads green with the source name while the source is answering', () => {
    const source: CanvasSource = { kind: 'session', source: inner, onWrote: () => {} };
    render(<Canvas model={MODEL} source={source} />);
    expect(cell().textContent).toContain('Claude Code');
    expect(dot().className).toContain('text-done');
  });

  it('does not draw green while the source is in error, and says what failed', () => {
    const source: CanvasSource = {
      kind: 'session',
      source: inner,
      error: 'could not load projects — the `claude` command was not found',
      onWrote: () => {},
    };
    render(<Canvas model={MODEL} source={source} />);
    expect(dot().className).not.toContain('text-done');
    expect(dot().className).toContain('text-failed');
    expect(cell().textContent).toContain('was not found');
  });

  it('start-up is distinguishable from connected-and-empty, and claims nothing about writing', () => {
    render(<Canvas model={MODEL} source={{ kind: 'connecting' }} />);
    expect(cell().textContent).toMatch(/connecting/i);
    // The old start-up sentence, which was a false statement about a source
    // that had not answered yet.
    expect(cell().textContent).not.toMatch(/read-only/i);
    expect(dot().className).not.toContain('text-done');
    // Not `ink-faint`: 3.27:1 dark, 3.01:1 light (issue 188).
    expect(dot().className).not.toContain('ink-faint');
  });

  /**
   * ONE SOURCE, ONE CLAIM ABOUT IT.
   *
   * The cell reads the failure off `source.error`; `newSessionRoute` did not,
   * so with a source that had answered and refused permanently the cell said
   * so in red while the `+` tooltip and the status bar on click both said
   * "still connecting" -- an in-progress connection that had already ended.
   * `source.ts` says this field exists to stop exactly that.
   */
  it('the + refuses in the same words the cell is showing, not "still connecting"', async () => {
    const failed = 'the endpoint refused: unauthenticated';
    render(<Canvas model={MODEL} source={{ kind: 'connecting', error: failed }} />);
    expect(cell().textContent).toContain(failed);

    const plus = screen.getByLabelText('new project') as HTMLButtonElement;
    expect(plus.title).toContain(failed);
    expect(plus.title).not.toMatch(/still connecting/i);

    await act(async () => {
      plus.click();
    });
    const bar = document.querySelector('[data-status-bar]')?.textContent ?? '';
    expect(bar).toContain('unauthenticated');
    expect(bar).not.toMatch(/still connecting/i);
  });

  it('still says "connecting" while it genuinely is', async () => {
    render(<Canvas model={MODEL} source={{ kind: 'connecting' }} />);
    const plus = screen.getByLabelText('new project') as HTMLButtonElement;
    await act(async () => {
      plus.click();
    });
    const bar = document.querySelector('[data-status-bar]')?.textContent ?? '';
    expect(bar).toMatch(/still connecting/i);
  });

  it('a source that could not be assembled at all says so rather than connecting forever', () => {
    render(<Canvas model={MODEL} source={{ kind: 'connecting', error: 'no route to a source' }} />);
    expect(cell().textContent).toContain('no route to a source');
    expect(cell().textContent).not.toMatch(/connecting/i);
    expect(dot().className).toContain('text-failed');
  });
});
