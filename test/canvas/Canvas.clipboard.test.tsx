// @vitest-environment happy-dom

/**
 * Copying, end to end, and the `i` key's promise that it types into the thing
 * the cursor is on.
 *
 * The copy half exists because there was NO test here at all: deleting all
 * three `navigator.clipboard.writeText` calls left the suite green while the
 * packaged app told the operator "copied" for a write the permission policy
 * had refused. So every assertion below is about the OUTCOME -- what text
 * actually reached a clipboard, and what the status bar says when nothing
 * did -- never about which API was called.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SmithClient } from '../../src/renderer/adapter/client.js';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasSource } from '../../src/renderer/canvas/source.js';
import type { CanvasModel } from '../../src/renderer/domain/model.js';

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'black-smith',
      sessions: [
        {
          id: 's1',
          title: 's1',
          icon: null,
          epic: null,
          branch: null,
          status: 'done',
          runningAgents: 0,
          activity: null,
          age: null,
          decisions: [
            {
              id: 'd1',
              label: 'gate',
              input: 'in',
              output: 'out',
              commands: [
                { id: 'c1', label: 'sign', command: 'smith plan sign plan-v2.json' },
                { id: 'c2', label: 'gate', command: 'smith gate run' },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
const promptInput = () =>
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

async function pressAsync(key: string) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

/** What reached a clipboard, whichever route it took. */
type Recorder = { readonly written: string[] };

/** The Electron bridge, present only in the packaged app. */
function installBridge(outcome: boolean | Error = true): Recorder {
  const written: string[] = [];
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (text: string) => {
          written.push(text);
          if (outcome instanceof Error) throw outcome;
          return outcome;
        },
      },
      usage: { get: async () => ({ kind: 'unknown', reason: 'unavailable' }) },
    },
  });
  return { written };
}

/** The browser build's route: no bridge, only `navigator.clipboard`. */
function installWebClipboard(outcome: 'ok' | 'reject' | 'absent'): Recorder {
  const written: string[] = [];
  Object.defineProperty(window, 'api', { configurable: true, value: undefined });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value:
      outcome === 'absent'
        ? undefined
        : {
            writeText: async (text: string) => {
              written.push(text);
              if (outcome === 'reject') throw new Error('NotAllowedError');
            },
          },
  });
  return { written };
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

afterEach(() => {
  cleanup();
  localStorage.clear();
  Object.defineProperty(window, 'api', { configurable: true, value: undefined });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
});

/**
 * `yy` is the whole copy surface now.
 *
 * The per-row `copy` buttons went with the command strip the operator asked to
 * remove; the commands themselves are offered by the `!` typeahead inside the
 * composer, which writes one into the prompt rather than onto the clipboard.
 * The chord survives it: copying every proposed command is a keyboard action,
 * not a thing that needed a button on screen.
 */
describe('yy copies every command', () => {
  it('writes them newline-joined over the Electron bridge and says how many', async () => {
    const bridge = installBridge();
    render(<Canvas model={MODEL} />);
    await pressAsync('y');
    await pressAsync('y');
    expect(bridge.written).toEqual(['smith plan sign plan-v2.json\nsmith gate run']);
    expect(statusBar()).toContain('copied 2 commands');
  });

  it('does not claim it when the bridge refused', async () => {
    installBridge(false);
    render(<Canvas model={MODEL} />);
    await pressAsync('y');
    await pressAsync('y');
    expect(statusBar()).not.toContain('copied');
  });

  it('does not claim it when the bridge threw', async () => {
    installBridge(new Error('ipc is gone'));
    render(<Canvas model={MODEL} />);
    await pressAsync('y');
    await pressAsync('y');
    expect(statusBar()).not.toContain('copied');
  });

  it('falls back to navigator.clipboard in the browser build', async () => {
    const web = installWebClipboard('ok');
    render(<Canvas model={MODEL} />);
    await pressAsync('y');
    await pressAsync('y');
    expect(web.written).toEqual(['smith plan sign plan-v2.json\nsmith gate run']);
    expect(statusBar()).toContain('copied');
  });

  it('does not claim a copy navigator.clipboard rejected', async () => {
    installWebClipboard('reject');
    render(<Canvas model={MODEL} />);
    await pressAsync('y');
    await pressAsync('y');
    expect(statusBar()).not.toContain('copied');
  });

  it('does not claim a copy when there is no clipboard at all', async () => {
    installWebClipboard('absent');
    render(<Canvas model={MODEL} />);
    await pressAsync('y');
    await pressAsync('y');
    expect(statusBar()).not.toContain('copied');
  });

  it('draws no copy control of its own, in the pane or above it', () => {
    installBridge();
    render(<Canvas model={MODEL} />);
    expect(document.querySelector('[data-command-copy]')).toBeNull();
    expect(document.querySelector('[data-commands-copy-all]')).toBeNull();
  });
});

/**
 * `i` means "type into the thing I am pointing at". The composer is the only
 * thing left to point at in this pane -- the command rows it used to land on
 * went with the strip -- so `i` opens it from wherever the cursor is.
 */
describe('i opens the composer', () => {
  /** The prompt box is `readOnly` until the composer really opens. */
  const composing = () => promptInput()?.readOnly === false;

  it('opens it from the first stop in the action pane', () => {
    installBridge();
    render(<Canvas model={MODEL} />);
    press('I');
    press('i');
    expect(composing()).toBe(true);
  });

  it('opens it when the action pane is not the active pane', () => {
    installBridge();
    render(<Canvas model={MODEL} />);
    press('i');
    expect(composing()).toBe(true);
  });
});

/**
 * A live source adds no stops of its own to the action pane.
 *
 * It used to. black-smith's governance queue was removed from the detail pane
 * at the operator's request but left in `buildActions`, so a live source put
 * four rows -- two verdicts per finding, two per lesson candidate -- ahead of
 * the commands with nothing drawn for any of them. `I` then landed on an
 * invisible "fix fp-1", `j` walked stops that were not on screen, and `Enter`
 * POSTed a waiver or a lesson transition to the factory. The tests that stood
 * here asserted that behaviour was correct, counting the four rows out by
 * hand.
 *
 * What replaces them is the inverse: a client that WOULD serve a finding and a
 * lesson changes neither the cursor nor the request log.
 */
describe('a live source adds no stops of its own to the action pane', () => {
  const calls: string[] = [];

  /** A live client that would answer every review-queue read, if one came. */
  function liveSource(): CanvasSource {
    const client = {
      taskIds: async () => {
        calls.push('taskIds');
        return ['t1'];
      },
      taskDetail: async () => {
        calls.push('taskDetail');
        return { findings: [] };
      },
      lessons: async () => {
        calls.push('lessons');
        return { pending: [], approved: [], closed: [] };
      },
      overview: async () => {
        calls.push('overview');
        return { alerts: { pendingWaivers: 1 } };
      },
    } as unknown as SmithClient;
    return { kind: 'live', client, status: 'live', error: null, onWrote: () => {} };
  }

  async function mountLive() {
    calls.length = 0;
    installBridge();
    render(<Canvas model={MODEL} source={liveSource()} />);
    // Three microtask turns: what the removed queue fetch needed to settle.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('puts the cursor on the prompt, not on a row nothing drew', async () => {
    await mountLive();
    press('I'); // index 0, and the only index there is
    press('i');
    expect(promptInput()?.readOnly).toBe(false);
  });

  it('never asks the factory for a queue it cannot draw', async () => {
    await mountLive();
    expect(calls).toEqual([]);
  });
});
