// @vitest-environment happy-dom

/**
 * The operator's request: "there should be a `+` button to create a new tab
 * in each pane, next to the tabs."
 *
 * A pane is VSCode's editor group, so its `+` is VSCode's "new editor in
 * THIS group": the session is born in the pane whose button was pressed and
 * lands there as a new tab, whichever pane happened to hold the keyboard.
 * The click goes through the SAME `newSession` route `o`/`Mod-n` take —
 * there is one way to create a session, not two — which is also why a source
 * that cannot create makes this button refuse in the source's own words
 * rather than sit there doing nothing.
 *
 * `write.createSession` resolves `void` (`preload-api.ts`): the id of what it
 * started is not knowable at the call, and `tmux new-session -d` returns
 * before the agent has registered anywhere vam can read. So "lands in that
 * pane" is asserted the only way it can be true — the session that APPEARS
 * in a later model is opened into the pane that asked for it.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

function session(id: string): Session {
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
  };
}

const modelWith = (...ids: string[]): CanvasModel => ({
  projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions: ids.map(session) }],
});

function sourceWith(createSession?: (projectId: string, title: string) => Promise<void>): {
  source: CanvasSource;
  created: [string, string][];
} {
  const created: [string, string][] = [];
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
      ...(createSession === undefined
        ? {}
        : {
            createSession: async (projectId: string, title: string) => {
              created.push([projectId, title]);
              await createSession(projectId, title);
            },
          }),
    },
  };
  return {
    source: { kind: 'session', source: inner as unknown as SessionSource, onWrote: () => {} },
    created,
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
});

afterEach(cleanup);

const splitPanes = () => [...document.querySelectorAll('[data-split-pane]')];
const paneFor = (id: string) => document.querySelector(`[data-split-pane="${id}"]`);
const newTabIn = (paneEl: Element | null | undefined) =>
  paneEl?.querySelector<HTMLButtonElement>('[data-tab-new]') ?? null;
const tabsIn = (paneEl: Element | null | undefined) =>
  [...(paneEl?.querySelectorAll('[data-tab-select]') ?? [])].map((el) => el.textContent);
const activeTabIn = (paneEl: Element | null | undefined) =>
  paneEl?.querySelector('[data-session-tab][data-active="true"] [data-tab-select]')?.textContent ??
  null;
const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

async function click(el: HTMLElement | null) {
  await act(async () => {
    el?.click();
  });
}

describe('the per-pane `+`', () => {
  it('draws one in every pane’s strip, as a labelled real button', () => {
    const { source } = sourceWith(async () => {});
    render(<Canvas model={modelWith('a1')} source={source} />);
    press('z');
    press('v');
    expect(splitPanes()).toHaveLength(2);
    for (const pane of splitPanes()) {
      const button = newTabIn(pane);
      expect(button).not.toBeNull();
      expect(button?.tagName).toBe('BUTTON');
      // Icon-only does not mean unlabelled (`ViewIcons`' own rule): a real
      // name, reachable by Tab, not a `title` alone.
      expect(button?.getAttribute('aria-label')).toMatch(/new session/i);
      expect(button?.closest('[data-tab-strip-row]')).not.toBeNull();
    }
  });

  it('starts the session in the pane’s own project, by (id, name)', async () => {
    const { source, created } = sourceWith(async () => {});
    render(<Canvas model={modelWith('a1')} source={source} />);
    await click(newTabIn(splitPanes()[0]));
    expect(created).toEqual([['p1', 'alpha']]);
  });

  /**
   * The whole point of a PER-PANE control. `zv` leaves the new right-hand
   * pane focused, so the `+` pressed here belongs to the pane that does NOT
   * hold the keyboard: the session must still land in it.
   */
  it('opens the session that appears in the pane whose `+` was pressed', async () => {
    const { source } = sourceWith(async () => {});
    const { rerender } = render(<Canvas model={modelWith('a1')} source={source} />);
    press('z');
    press('v');
    expect(paneFor('pane-2')?.getAttribute('data-split-focused')).toBe('true');
    await click(newTabIn(paneFor('pane-1')));
    // The source has started it; the model only catches up on a later poll.
    await act(async () => {
      rerender(<Canvas model={modelWith('a1', 'a2')} source={source} />);
    });
    expect(tabsIn(paneFor('pane-1'))).toEqual(['a1', 'a2']);
    expect(activeTabIn(paneFor('pane-1'))).toBe('a2');
    expect(tabsIn(paneFor('pane-2'))).toEqual(['a1']);
  });

  it('refuses aloud, and calls nothing, when the source cannot create', async () => {
    const { source, created } = sourceWith();
    render(<Canvas model={modelWith('a1')} source={source} />);
    await click(newTabIn(splitPanes()[0]));
    expect(created).toEqual([]);
    expect(statusBar()).toContain('this source has no way to start one');
    expect(statusBar()).not.toMatch(/^started/i);
  });
});
