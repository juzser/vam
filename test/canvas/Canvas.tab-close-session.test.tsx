// @vitest-environment happy-dom

/**
 * A22 — the tab's `×` closes the SESSION.
 *
 * The operator: "the close button on the tab doesn't seem to work." It did
 * not: A11.1 had given `closePaneTab` a first statement that refused for any
 * session still in the model, and `orderedPaneTabs` only ever draws a tab for
 * a session that IS in the model — so the refusal was the whole of what the
 * `×` did, on every tab, every time. A control drawn on all of them and
 * effective on none of them is a dead button, whatever the status line says.
 *
 * The fix routes it onto the close path that already exists rather than
 * inventing a second one: the same `closeSession` the `x` key, the sidebar
 * row's own `×` and the tab's context menu "Close session" all go through.
 * These tests assert the SOURCE was called — not that a string in the status
 * bar changed, which is what the dead button was already doing.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

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
      sessions: [
        session('a1', { title: 'nightly sweep' }),
        session('a2', { title: 'second pass' }),
      ],
    },
  ],
};

/** The same fake port `Canvas.session-actions.test.tsx` closes through — one
 *  source shape for both routes, or the two could pass against two fakes. */
function sessionSourceWith(closeSession?: (sessionId: string, force?: boolean) => Promise<void>): {
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
      resumeSession: false,
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

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const tabs = () => [...document.querySelectorAll('[data-session-tab]')];
/** By the title the select button reads, so the assertions do not depend on
 *  the close control's own name — which is one of the things under test. */
const tabFor = (title: string) =>
  tabs().find((tab) => tab.querySelector('[data-tab-select]')?.textContent?.trim() === title) ??
  null;
const closeIn = (title: string) =>
  tabFor(title)?.querySelector<HTMLButtonElement>('[data-tab-close]') ?? null;
const activeTitle = () =>
  tabs()
    .find((tab) => tab.getAttribute('data-active') === 'true')
    ?.querySelector('[data-tab-select]')
    ?.textContent?.trim() ?? null;
const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
const confirmDialog = () => document.querySelector('[data-confirm-force-close]');

async function clickClose(title: string) {
  const button = closeIn(title);
  expect(button, `the × on the "${title}" tab`).not.toBeNull();
  await act(async () => {
    button?.click();
  });
}

describe('a tab’s × closes the session that tab is for', () => {
  it('really calls the source — the thing the refusal never did', async () => {
    const closed: string[] = [];
    const { source, wrote } = sessionSourceWith(async (id) => {
      closed.push(id);
    });
    render(<Canvas model={MODEL} source={source} />);
    await clickClose('nightly sweep');
    expect(closed).toEqual(['a1']);
    expect(wrote.count).toBe(1);
  });

  it('closes the tab that was CLICKED, not the one the keyboard is on', async () => {
    const closed: string[] = [];
    const { source } = sessionSourceWith(async (id) => {
      closed.push(id);
    });
    render(<Canvas model={MODEL} source={source} />);
    // `a1` is the focused session; the second tab is the one pressed.
    expect(activeTitle()).toBe('nightly sweep');
    await clickClose('second pass');
    expect(closed).toEqual(['a2']);
  });

  it('does not also select the tab it is closing', async () => {
    const { source } = sessionSourceWith(async () => {});
    render(<Canvas model={MODEL} source={source} />);
    await clickClose('second pass');
    expect(activeTitle()).toBe('nightly sweep');
  });

  it('says what it does: the name is about the session, not about a tab', () => {
    const { source } = sessionSourceWith(async () => {});
    render(<Canvas model={MODEL} source={source} />);
    expect(closeIn('second pass')?.getAttribute('aria-label')).toBe('close session second pass');
  });
});

/**
 * THE SAME PATH, not a second one that happens to agree today. Each of these
 * is a behaviour `closeSession` alone owns — a duplicate implementation would
 * have to reproduce all three, and a bypass would show up here as silence.
 */
describe('it goes through the one close path the rest of the shell uses', () => {
  it('refuses in the source’s own words when it cannot close at all', async () => {
    const { source } = sessionSourceWith();
    render(<Canvas model={MODEL} source={source} />);
    await clickClose('second pass');
    expect(statusBar()).toContain('second pass');
    expect(statusBar()).toMatch(/cannot|no /i);
  });

  it('renders a refusal verbatim rather than claiming it stopped anything', async () => {
    const { source } = sessionSourceWith(async () => {
      throw { kind: 'refused', code: 'interactive-session', message: 'close that terminal' };
    });
    render(<Canvas model={MODEL} source={source} />);
    await clickClose('second pass');
    expect(statusBar()).toContain('close that terminal');
    expect(statusBar()).not.toMatch(/stopped/i);
  });

  it('never kills by itself: a forcible refusal opens the confirm, unforced', async () => {
    const calls: Array<[string, boolean | undefined]> = [];
    const { source } = sessionSourceWith(async (id, force) => {
      calls.push([id, force]);
      throw { kind: 'refused', code: 'pane-unresolved', message: 'could not tell', forcible: true };
    });
    render(<Canvas model={MODEL} source={source} />);
    await clickClose('second pass');
    expect(calls).toEqual([['a2', false]]);
    expect(confirmDialog()).not.toBeNull();
  });
});
