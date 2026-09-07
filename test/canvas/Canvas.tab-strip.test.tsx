// @vitest-environment happy-dom

/**
 * The session tab strip, through the component.
 *
 * The strip shipped with no test of its own: nothing under `test/` matched
 * `TabStrip`, `data-session-tab`, `data-tab-close` or `data-tab-strip`, so
 * every claim it makes -- a tab per opened session, a draft that belongs to
 * ONE session, a `x` that closes the tab and not the work behind it -- was
 * being made by the comments and by nothing else.
 *
 * WHAT EACH CASE IS ACTUALLY ABOUT. The tab strip is a cursor over the
 * sessions, not a container of them: decision 6 says the tab closes and the
 * session keeps running, which is a claim about what does NOT happen and can
 * only be asserted against something outside the strip. So the close cases
 * check the source's `write.closeSession` was never reached and the sidebar
 * still lists the session, rather than settling for "the tab is gone" -- that
 * assertion is true of a strip that kills sessions too.
 *
 * The composer case is the headline of the tab shell and the one most easily
 * faked: per-session drafts stored in one `Record` look identical to a single
 * shared draft until a switch happens BETWEEN two typed sessions, in both
 * directions. That is why B is typed into as well, rather than only read.
 *
 * The harness is the one `Canvas.session-resume.test.tsx` and
 * `Canvas.keyboard.test.tsx` use: render the real `Canvas`, drive it with real
 * clicks and real keydowns, and read prefs back out of `localStorage`.
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

/** Three sessions in one project: two to switch between, a third so "closing
 *  the active tab picks a survivor" has more than one survivor to be wrong
 *  about. */
const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'factory',
      sessions: [session('a1'), session('a2'), session('a3')],
    },
  ],
};

const PREFS_KEY = 'vam.prefs.v1';

function seed(payload: Record<string, unknown>) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(payload));
}

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
}

/** The tabs the strip draws, in strip order, by the session title each shows. */
const tabs = () =>
  [...document.querySelectorAll('[data-session-tab] [data-tab-select]')].map(
    (el) => el.textContent ?? '',
  );

/** Which tab is the active one, by title. */
const activeTab = () =>
  document.querySelector('[data-session-tab][data-active="true"] [data-tab-select]')?.textContent ??
  null;

/** Which session the detail pane -- the thing a tab is a pointer TO -- shows. */
const detailSession = () => document.querySelector('[data-prompt-target]')?.textContent ?? '';

const sidebarRow = (id: string) => document.querySelector(`[data-session-row="${id}"]`);

const promptInput = () =>
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');

function clickTab(title: string) {
  const button = [...document.querySelectorAll('[data-session-tab] [data-tab-select]')].find(
    (el) => el.textContent === title,
  );
  if (button === undefined) throw new Error(`no tab titled ${title}`);
  act(() => {
    (button as HTMLElement).click();
  });
}

function closeTab(title: string) {
  const tab = [...document.querySelectorAll('[data-session-tab]')].find(
    (el) => el.querySelector('[data-tab-select]')?.textContent === title,
  );
  if (tab === undefined) throw new Error(`no tab titled ${title}`);
  act(() => {
    tab.querySelector<HTMLElement>('[data-tab-close]')?.click();
  });
}

function openFromSidebar(id: string) {
  act(() => {
    (sidebarRow(id) as HTMLElement).click();
  });
}

function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

// The native setter has to come from the element's OWN prototype: React tracks
// the last value it wrote, and going through the wrong prototype's descriptor
// throws rather than firing a change the component can see.
function typeInto(input: HTMLTextAreaElement, text: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set as (
      this: HTMLElement,
      v: string,
    ) => void;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/**
 * A source whose `write.closeSession` records every call.
 *
 * This is the seam a real session end goes through -- the same one
 * `Canvas.session-actions.test.tsx` asserts `x` reaching -- so it is also the
 * only honest way to assert that closing a TAB does not reach it.
 */
function watchedSource(): { source: CanvasSource; closed: string[] } {
  const closed: string[] = [];
  const inner = {
    id: 'factory',
    label: 'Factory',
    capabilities: {
      liveUpdates: false,
      recordPrompt: true,
      deliverPrompt: true,
      promptAttachments: false,
      slashCommands: false,
      renameSession: false,
      closeSession: true,
      createSession: false,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
    },
    declines: {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: {
      recordPrompt: async () => {},
      closeSession: async (sessionId: string) => {
        closed.push(sessionId);
      },
    },
  };
  return {
    source: {
      kind: 'session',
      source: inner as unknown as SessionSource,
      onWrote: () => {},
    },
    closed,
  };
}

// The same three globals every rendering Canvas test installs: ReactFlow needs
// the first two, prefs the third (installed by test/support/storage.ts).
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

describe('opening sessions into tabs', () => {
  it('opens a tab for the session focus lands on, and the tab shows that session', () => {
    render(<Canvas model={MODEL} />);
    // The first launch lands focus on the first session, and that landing is
    // an opening like any other -- a detail pane showing `a1` beside a strip
    // claiming nothing is open would be the strip contradicting the pane.
    expect(tabs()).toEqual(['a1']);
    expect(activeTab()).toBe('a1');
    expect(detailSession()).toBe('a1');
  });

  it('opens a second tab when a second session is picked from the sidebar', () => {
    render(<Canvas model={MODEL} />);
    openFromSidebar('a2');
    expect(tabs()).toEqual(['a1', 'a2']);
    expect(activeTab()).toBe('a2');
    expect(detailSession()).toBe('a2');
  });

  it('does not open a second tab for a session that already has one', () => {
    render(<Canvas model={MODEL} />);
    openFromSidebar('a2');
    openFromSidebar('a1');
    openFromSidebar('a2');
    expect(tabs()).toEqual(['a1', 'a2']);
  });

  it('switches the detail content when a tab is clicked', () => {
    render(<Canvas model={MODEL} />);
    openFromSidebar('a2');
    expect(detailSession()).toBe('a2');
    clickTab('a1');
    expect(activeTab()).toBe('a1');
    expect(detailSession()).toBe('a1');
    clickTab('a2');
    expect(activeTab()).toBe('a2');
    expect(detailSession()).toBe('a2');
  });
});

describe('the composer, per session', () => {
  it('keeps each tab’s draft to itself across a switch, in both directions', () => {
    render(<Canvas model={MODEL} />);
    openFromSidebar('a2');
    clickTab('a1');

    press('i');
    typeInto(promptInput() as HTMLTextAreaElement, 'draft for the first one');
    expect(promptInput()?.value).toBe('draft for the first one');

    clickTab('a2');
    // B never saw A's text. Asserted on the box when there is one, and on its
    // absence when composing has not begun in B either -- both are "B has no
    // draft", and which of the two it is belongs to the composer's own tests.
    expect(promptInput()?.value ?? '').toBe('');

    press('i');
    typeInto(promptInput() as HTMLTextAreaElement, 'a different one entirely');
    expect(promptInput()?.value).toBe('a different one entirely');

    clickTab('a1');
    expect(promptInput()?.value).toBe('draft for the first one');
    clickTab('a2');
    expect(promptInput()?.value).toBe('a different one entirely');
  });
});

describe('closing a tab', () => {
  it('removes the tab and leaves the session running', () => {
    const { source, closed } = watchedSource();
    render(<Canvas model={MODEL} source={source} />);
    openFromSidebar('a2');
    expect(tabs()).toEqual(['a1', 'a2']);

    closeTab('a1');

    expect(tabs()).toEqual(['a2']);
    // Decision 6: the TAB closed. Nothing was asked to end the session, and
    // the session is still there to be opened again.
    expect(closed).toEqual([]);
    expect(sidebarRow('a1')).not.toBeNull();
    openFromSidebar('a1');
    expect(tabs()).toEqual(['a2', 'a1']);
    expect(detailSession()).toBe('a1');
  });

  it('moves focus to a surviving tab when the ACTIVE one is closed', () => {
    const { source, closed } = watchedSource();
    render(<Canvas model={MODEL} source={source} />);
    openFromSidebar('a2');
    openFromSidebar('a3');
    expect(tabs()).toEqual(['a1', 'a2', 'a3']);
    expect(activeTab()).toBe('a3');

    closeTab('a3');

    expect(tabs()).toEqual(['a1', 'a2']);
    // The neighbour BEFORE it, so repeated closes walk left rather than
    // bouncing to the end.
    expect(activeTab()).toBe('a2');
    expect(detailSession()).toBe('a2');
    expect(closed).toEqual([]);
    expect(sidebarRow('a3')).not.toBeNull();
  });

  it('closing an inactive tab leaves focus where it was', () => {
    render(<Canvas model={MODEL} />);
    openFromSidebar('a2');
    openFromSidebar('a3');
    closeTab('a1');
    expect(tabs()).toEqual(['a2', 'a3']);
    expect(activeTab()).toBe('a3');
    expect(detailSession()).toBe('a3');
  });
});

describe('the open tabs, across a relaunch', () => {
  it('persists a pointer per open tab, in strip order', () => {
    render(<Canvas model={MODEL} />);
    openFromSidebar('a2');
    expect(stored().openTabs).toEqual([
      { source: 'factory', session: 'a1' },
      { source: 'factory', session: 'a2' },
    ]);
  });

  it('restores both tabs on a fresh mount seeded with that blob', () => {
    render(<Canvas model={MODEL} />);
    openFromSidebar('a2');
    const blob = stored().openTabs;
    cleanup();

    render(<Canvas model={MODEL} />);
    expect(tabs()).toEqual(['a1', 'a2']);
    // And the restore did not rewrite what it restored from.
    expect(stored().openTabs).toEqual(blob);
  });

  it('drops a remembered tab whose session has ended, keeping its neighbours', () => {
    seed({
      openTabs: [
        { source: 'factory', session: 'a1' },
        { source: 'factory', session: 'gone' },
        { source: 'factory', session: 'a3' },
      ],
      lastFocus: { source: 'factory', session: 'a1' },
    });
    render(<Canvas model={MODEL} />);
    expect(tabs()).toEqual(['a1', 'a3']);
  });
});
