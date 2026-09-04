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
const copyButtons = () => [...document.querySelectorAll<HTMLButtonElement>('[data-command-copy]')];
const copyAllButton = () => document.querySelector<HTMLButtonElement>('[data-commands-copy-all]');
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

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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

describe('copying a command actually copies it', () => {
  it('sends the row’s command over the Electron bridge and says so', async () => {
    const bridge = installBridge();
    render(<Canvas model={MODEL} />);
    await click(copyButtons()[0] as Element);
    expect(bridge.written).toEqual(['smith plan sign plan-v2.json']);
    expect(statusBar()).toContain('copied');
  });

  it('does not claim a copy the bridge refused', async () => {
    installBridge(false);
    render(<Canvas model={MODEL} />);
    await click(copyButtons()[0] as Element);
    expect(statusBar()).not.toContain('copied');
    expect(statusBar()).toContain('sign');
  });

  it('does not claim a copy the bridge threw on', async () => {
    installBridge(new Error('ipc is gone'));
    render(<Canvas model={MODEL} />);
    await click(copyButtons()[0] as Element);
    expect(statusBar()).not.toContain('copied');
  });

  it('falls back to navigator.clipboard in the browser build', async () => {
    const web = installWebClipboard('ok');
    render(<Canvas model={MODEL} />);
    await click(copyButtons()[1] as Element);
    expect(web.written).toEqual(['smith gate run']);
    expect(statusBar()).toContain('copied');
  });

  it('does not claim a copy navigator.clipboard rejected', async () => {
    installWebClipboard('reject');
    render(<Canvas model={MODEL} />);
    await click(copyButtons()[0] as Element);
    expect(statusBar()).not.toContain('copied');
  });

  it('does not claim a copy when there is no clipboard at all', async () => {
    installWebClipboard('absent');
    render(<Canvas model={MODEL} />);
    await click(copyButtons()[0] as Element);
    expect(statusBar()).not.toContain('copied');
  });
});

describe('yy copies every command', () => {
  it('writes them newline-joined and says how many', async () => {
    const bridge = installBridge();
    render(<Canvas model={MODEL} />);
    await pressAsync('y');
    await pressAsync('y');
    expect(bridge.written).toEqual(['smith plan sign plan-v2.json\nsmith gate run']);
    expect(statusBar()).toContain('copied 2 commands');
  });

  it('does not claim it when the write failed', async () => {
    installBridge(false);
    render(<Canvas model={MODEL} />);
    await pressAsync('y');
    await pressAsync('y');
    expect(statusBar()).not.toContain('copied');
  });

  it('copies all of them from the header button too', async () => {
    const bridge = installBridge();
    render(<Canvas model={MODEL} />);
    await click(copyAllButton() as Element);
    expect(bridge.written).toEqual(['smith plan sign plan-v2.json\nsmith gate run']);
  });
});

describe('Enter on a command row in the action pane', () => {
  it('copies that row’s command', async () => {
    const bridge = installBridge();
    render(<Canvas model={MODEL} />);
    press('I');
    await pressAsync('Enter');
    expect(bridge.written).toEqual(['smith plan sign plan-v2.json']);
    expect(statusBar()).toContain('copied');
  });

  it('does not claim a copy that failed', async () => {
    installBridge(false);
    render(<Canvas model={MODEL} />);
    press('I');
    await pressAsync('Enter');
    expect(statusBar()).not.toContain('copied');
  });
});

/**
 * `i` means "type into the thing I am pointing at". The composer is what it
 * opens ONLY on the prompt row -- every other row in the pane is a thing, and
 * `i` acts on that thing instead.
 */
describe('i acts on the row the cursor is on', () => {
  /** The prompt box is `readOnly` until the composer really opens. */
  const composing = () => promptInput()?.readOnly === false;

  it('focuses a command row’s copy control rather than opening the composer', () => {
    installBridge();
    render(<Canvas model={MODEL} />);
    press('I');
    press('i');
    expect(document.activeElement).toBe(copyButtons()[0]);
    expect(composing()).toBe(false);
  });

  it('follows the cursor to the second command row', () => {
    installBridge();
    render(<Canvas model={MODEL} />);
    press('I');
    press('j');
    press('i');
    expect(document.activeElement).toBe(copyButtons()[1]);
    expect(composing()).toBe(false);
  });

  it('opens the composer on the prompt row', () => {
    installBridge();
    render(<Canvas model={MODEL} />);
    press('I');
    press('j');
    press('j'); // past both commands, onto the prompt
    press('i');
    expect(composing()).toBe(true);
  });

  it('opens the composer when the action pane is not the active pane', () => {
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

  it('puts the cursor on the first command, not on a row nothing drew', async () => {
    await mountLive();
    press('I'); // index 0
    press('i');
    expect(document.activeElement).toBe(copyButtons()[0]);
  });

  it('reaches the composer one row past the last command', async () => {
    await mountLive();
    press('I');
    press('j');
    press('j'); // two commands, then the prompt
    press('i');
    expect(promptInput()?.readOnly).toBe(false);
  });

  it('never asks the factory for a queue it cannot draw', async () => {
    await mountLive();
    expect(calls).toEqual([]);
  });
});
