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
 * A queue row keeps today's behaviour: `i` asks for its reason box, and in
 * particular does NOT open the composer -- a waiver's justification must not
 * become a message to the session.
 */
describe('i on a queue row does not open the composer', () => {
  const finding = {
    findingId: 'f1',
    taskId: 't1',
    fingerprint: 'fp-1',
    severity: 'S3-minor',
    findingStatus: 'raised',
    summary: 'a defect',
    foundBy: 'gate',
    waiverId: null,
  };
  const lesson = {
    lessonId: 'l1',
    sessionId: 's1',
    lessonType: 'process',
    lessonScope: 'repo',
    lessonStatus: 'candidate',
    statement: 'a lesson',
  };

  /** A live source whose review queue holds one waiver and one lesson. */
  function liveSource(): CanvasSource {
    const client = {
      taskIds: async () => ['t1'],
      taskDetail: async () => ({ findings: [finding] }),
      lessons: async () => ({ pending: [lesson], approved: [], closed: [] }),
      overview: async () => ({ alerts: { pendingWaivers: 1 } }),
    } as unknown as SmithClient;
    return { kind: 'live', client, status: 'live', error: null, onWrote: () => {} };
  }

  async function mountLive() {
    installBridge();
    render(<Canvas model={MODEL} source={liveSource()} />);
    // The queue loads asynchronously; the actions do not exist until it has.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('leaves the composer shut on a waiver row', async () => {
    await mountLive();
    press('I'); // index 0 -- "fix fp-1"
    press('i');
    expect(promptInput()?.readOnly).toBe(true);
    // Proof the queue really loaded, and that these four rows really sit
    // above the commands: with an empty queue, four `j` would already be past
    // them and `i` would focus nothing.
    for (let i = 0; i < 4; i += 1) press('j');
    press('i');
    expect(document.activeElement).toBe(copyButtons()[0]);
  });

  it('leaves the composer shut on a lesson row', async () => {
    await mountLive();
    press('I');
    press('j');
    press('j'); // past both waiver verdicts, onto "reject l1"
    press('i');
    expect(promptInput()?.readOnly).toBe(true);
  });

  it('still opens the composer on the prompt row below them', async () => {
    await mountLive();
    press('I');
    for (let i = 0; i < 6; i += 1) press('j'); // 2 waiver + 2 lesson + 2 command
    press('i');
    expect(promptInput()?.readOnly).toBe(false);
  });
});
