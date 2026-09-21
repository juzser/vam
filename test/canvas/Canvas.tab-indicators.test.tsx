// @vitest-environment happy-dom

/**
 * WHAT A SESSION TAB DRAWS BESIDE ITS TITLE, and -- the operator's actual
 * sentence -- what a resting one does not.
 *
 * "If a tab is idle (not running, not waiting for you, ...) there is no need
 * to show the dot on the tab. A tab should only show certain indicators."
 * Every tab used to carry a 6px dot in its status colour; the dot is gone,
 * and in its place is AT MOST ONE status mark, the same glyph the sidebar row
 * draws (`panels/status-mark.tsx`), then the PROVIDER glyph, then the title,
 * then the three indicators that are about the operator's own state rather
 * than the agent's. The list is a constant, not a setting
 * (`prefs/tab-indicators.ts`), and idle is not on it.
 *
 * THE SESSION ICON USED TO SIT WHERE THE PROVIDER NOW DOES, and the operator
 * removed it: "put the provider glyph after the indicator, on the tab name.
 * Remove the session icon from the tab." Its describe block below is what
 * that removal is pinned by -- an absence, asserted, rather than tests
 * deleted along with the behaviour they covered.
 *
 * WHAT THIS FILE CAN SAY: which elements the strip puts in the DOM for which
 * state and which preference, and what a screen reader is handed. What it
 * cannot: that the marks paint, that the row does not grow, that an idle tab
 * is narrower than a marked one. Those are pixels, and
 * `e2e/tab-strip-shots.mjs` measures them in Chromium.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session, SessionStatus } from '../../src/renderer/domain/model.js';
import {
  isTabIndicatorOn,
  TAB_INDICATOR_IDS,
  TAB_INDICATORS,
  type TabIndicatorId,
} from '../../src/renderer/prefs/tab-indicators.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

function session(id: string, status: SessionStatus, over: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status,
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
    ...over,
  };
}

/** One project, one tab per status, so a single strip holds all five. */
const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'claude-code',
      sessions: [
        session('idle-1', 'idle'),
        session('running-1', 'running'),
        session('waiting-1', 'waiting'),
        session('failed-1', 'failed'),
        session('done-1', 'done'),
      ],
    },
  ],
};

/**
 * THE LIST IS A CONSTANT NOW, so there is nothing to seed and no test here
 * may pretend otherwise. The operator asked for the switches to go
 * (`prefs/tab-indicators.ts`), so what was "this id is off by default and on
 * when switched" became "this id is not on the list and draws nothing" --
 * which is the claim the shipped app actually makes. A stored `tabIndicators`
 * key is ignored: `parsePrefs` no longer reads one.
 */
function seed() {
  localStorage.removeItem('vam.prefs.v1');
}

const tabs = () => [...document.querySelectorAll('[data-session-tab]')];
/** A tab by its session's title -- read off the close control's name rather
 *  than the select button's text, which carries the icon too when there is
 *  one. */
const tabOf = (id: string) =>
  tabs().find(
    (tab) =>
      tab.querySelector('[data-tab-close]')?.getAttribute('aria-label') === `close session ${id}`,
  ) ?? null;
/** The title as read, which is the button's text with any icon in front. */
const titleOf = (id: string) => tabOf(id)?.querySelector('[data-tab-select]')?.textContent?.trim();
/** Every indicator a tab draws, by id, in DOM order. */
const marksOf = (id: string) =>
  [...(tabOf(id)?.querySelectorAll('[data-tab-mark]') ?? [])].map((el) =>
    el.getAttribute('data-tab-mark'),
  );
const markOf = (id: string, mark: TabIndicatorId) =>
  tabOf(id)?.querySelector(`[data-tab-mark="${mark}"]`) ?? null;
/** The lucide glyph names drawn inside an element, e.g. `lucide-bell`. */
const glyphsIn = (el: Element | null) =>
  [...(el?.querySelectorAll('svg') ?? [])].flatMap((svg) =>
    (svg.getAttribute('class') ?? '').split(/\s+/).filter((c) => /^lucide-./.test(c)),
  );
/** Make a tab the pane's own, by the pointer route -- which also puts the
 *  caret in its composer. The canvas focuses the busiest session on mount,
 *  not the first, so every test that types says which tab it is typing in. */
function focusTab(id: string) {
  fireEvent.click(tabOf(id)?.querySelector('[data-tab-select]') as HTMLElement);
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

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('a resting tab', () => {
  it('draws no mark at all: the title, and nothing else', () => {
    // The operator's sentence, as a DOM fact. Not "an idle mark that is
    // hidden", not "a lane left empty": no element with `data-tab-mark` and
    // no leftover dot.
    render(<Canvas model={MODEL} />);
    expect(marksOf('idle-1')).toEqual([]);
    expect(tabOf('idle-1')?.querySelector('.rounded-full')).toBeNull();
  });

  it('still reports its status on the tab itself, for the tests and guards that read it', () => {
    // The 6px dot used to carry `data-tab-status`. The attribute moves to the
    // tab so that "which status is this tab" stays answerable when there is
    // no mark to hang it on -- and every tab answers, idle included.
    render(<Canvas model={MODEL} />);
    expect(
      Object.fromEntries(
        tabs().map((tab) => [
          tab.querySelector('[data-tab-select]')?.textContent?.trim(),
          tab.getAttribute('data-tab-status'),
        ]),
      ),
    ).toEqual({
      'idle-1': 'idle',
      'running-1': 'running',
      'waiting-1': 'waiting',
      'failed-1': 'failed',
      'done-1': 'done',
    });
  });

  it('cannot be made to draw one: idle is not an indicator id', () => {
    seed();
    render(<Canvas model={MODEL} />);
    expect(marksOf('idle-1')).toEqual([]);
  });
});

describe('the status marks, one per tab at most', () => {
  it('draws the sidebar’s own glyph for running, waiting and failed by default', () => {
    render(<Canvas model={MODEL} />);
    expect(marksOf('running-1')).toEqual(['running']);
    expect(marksOf('waiting-1')).toEqual(['waiting']);
    expect(marksOf('failed-1')).toEqual(['failed']);
    // The SAME glyphs `status-mark.tsx` gives the sidebar row -- a spinner,
    // a bell, a triangle -- so the tab and the row say one thing. The
    // spinner carries both its bodies, the turning arc and the whole ring
    // `prefers-reduced-motion` swaps in; that story is reused, not forked.
    expect(glyphsIn(markOf('running-1', 'running'))).toContain('lucide-loader-circle');
    expect(
      markOf('running-1', 'running')?.querySelector('[data-mark-motion="rest"]'),
    ).not.toBeNull();
    expect(glyphsIn(markOf('waiting-1', 'waiting'))).toEqual(['lucide-bell']);
    expect(glyphsIn(markOf('failed-1', 'failed'))).toEqual(['lucide-triangle-alert']);
  });

  it('leaves a finished session unmarked -- `done` is not on the list', () => {
    // A tick on every session left open after a working day is the grey dot
    // again in a different shape, so `done` is not one of the five.
    render(<Canvas model={MODEL} />);
    expect(marksOf('done-1')).toEqual([]);
  });

  it('draws running, waiting and failed, and no other status', () => {
    // The three that are on the list, and the two statuses that are not:
    // together they are the whole of `SessionStatus`, so this says what the
    // strip draws AND what it never draws.
    render(<Canvas model={MODEL} />);
    expect(marksOf('running-1')).toEqual(['running']);
    expect(marksOf('waiting-1')).toEqual(['waiting']);
    expect(marksOf('failed-1')).toEqual(['failed']);
    expect(marksOf('done-1')).toEqual([]);
    expect(marksOf('idle-1')).toEqual([]);
  });

  it('is decorative to a screen reader, as the dot was', () => {
    // Labelling one per tab would read every session's status before any of
    // the titles; the sidebar row already announces it once. The argument is
    // the one on the dot this replaces.
    render(<Canvas model={MODEL} />);
    for (const id of ['running-1', 'waiting-1', 'failed-1']) {
      const mark = tabOf(id)?.querySelector('[data-tab-mark]');
      expect(mark?.getAttribute('aria-hidden'), id).toBe('true');
      expect(mark?.textContent, id).toBe('');
    }
  });
});

describe('the session’s own icon, which the operator took off the tab', () => {
  /**
   * "Remove the session icon from the tab." What it drew was the
   * session-else-project chain, and on a strip of one project's tabs that is
   * the project's own mark repeated across every tab -- the same argument
   * that took it off the sidebar row (`SessionList.icon.test.tsx`), arriving
   * at the other surface. The provider glyph below takes the slot, and says
   * something the strip does not otherwise say.
   */
  const WITH_ICON: CanvasModel = {
    projects: [
      {
        id: 'p1',
        name: 'alpha',
        source: 'claude-code',
        sessions: [session('idle-1', 'idle', { icon: '🌙' })],
      },
    ],
  };

  it('draws nothing for a session that has one of its own', () => {
    render(<Canvas model={WITH_ICON} />);
    expect(markOf('idle-1', 'icon')).toBeNull();
    expect(tabOf('idle-1')?.querySelector('[data-session-icon]')).toBeNull();
  });

  it('draws nothing for the project fallback either -- the whole chain is off', () => {
    // The chain is what was removed, not one link of it: a tab with no icon
    // of its own used to inherit its project's, so asserting only the session
    // case would leave the louder half of the old behaviour untested.
    const FROM_PROJECT: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'claude-code',
          icon: '🏭',
          sessions: [session('idle-1', 'idle')],
        },
      ],
    };
    render(<Canvas model={FROM_PROJECT} />);
    expect(tabOf('idle-1')?.querySelector('[data-session-icon]')).toBeNull();
  });

  it('leaves the title reading as the title, with nothing in front of it', () => {
    render(<Canvas model={WITH_ICON} />);
    expect(titleOf('idle-1')).toBe('idle-1');
  });

  it('is off the LIST without leaving the vocabulary, so re-enabling it is one entry', () => {
    // `tab-indicators.ts` keeps the id in the union on purpose, and this is
    // the test that "an indicator that is off draws nothing" is about now
    // that `icon` is the off one -- which is what makes the JSX in
    // `Canvas.tsx` live code behind a list rather than something to delete.
    seed();
    expect(TAB_INDICATOR_IDS).toContain('icon');
    expect(TAB_INDICATORS).not.toContain('icon');
    expect(isTabIndicatorOn('icon')).toBe(false);
  });
});

/**
 * WHICH AGENT RAN THIS TAB, in the slot the session icon has just left.
 *
 * The operator's ask, translated: "put the provider glyph after the
 * indicator, on the tab name." So a tab reads status mark, provider, title:
 * what the session is doing, who ran it, what it is called.
 */
describe('the provider glyph', () => {
  const providerOf = (id: string) => tabOf(id)?.querySelector('[data-tab-source]') ?? null;

  it('draws on every tab, whatever the session is doing', () => {
    render(<Canvas model={MODEL} />);
    for (const id of ['idle-1', 'running-1', 'waiting-1', 'failed-1', 'done-1']) {
      expect(providerOf(id)?.getAttribute('data-tab-source'), id).toBe('claude-code');
      expect(providerOf(id)?.getAttribute('data-source-mark'), id).toBe('brand');
      expect(providerOf(id)?.querySelector('svg'), `${id} drew an empty lane`).not.toBeNull();
    }
  });

  it('rides after the status mark and before the title, and is not inside it', () => {
    render(<Canvas model={MODEL} />);
    const tab = tabOf('running-1');
    const order = [
      ...(tab?.querySelectorAll('[data-tab-mark], [data-tab-source], [data-tab-select]') ?? []),
    ].map((el) =>
      el.hasAttribute('data-tab-source') ? 'source' : (el.getAttribute('data-tab-mark') ?? 'title'),
    );
    expect(order).toEqual(['running', 'source', 'title']);
    // A SIBLING of the select button, never a child of it -- the reason the
    // draft pencil is one: the button truncates, and a long title would take
    // the glyph into the ellipsis with it.
    expect(tab?.querySelector('[data-tab-select] [data-tab-source]')).toBeNull();
  });

  it('draws nothing at all when nothing names a source -- no lane is reserved', () => {
    // Unlike the sidebar, where the empty lane keeps a COLUMN of titles
    // aligned. Tabs sit side by side, so there is no column to protect, and a
    // lane held open for a mark that is not coming is the invisible dot the
    // operator asked to be rid of.
    const NO_SOURCE: CanvasModel = {
      projects: [{ id: 'p1', name: 'alpha', sessions: [session('idle-1', 'idle')] }],
    };
    render(<Canvas model={NO_SOURCE} />);
    expect(tabOf('idle-1')?.querySelector('[data-tab-source]')).toBeNull();
    expect(tabOf('idle-1')?.firstElementChild?.hasAttribute('data-tab-select')).toBe(true);
  });

  it('prefers the session’s own source to its project’s', () => {
    // `Session.source` and `Project.source` are stamped by different readers,
    // and the tab reads them in the order the sidebar row and the status bar
    // already read them in.
    const MIXED: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'codex',
          sessions: [session('idle-1', 'idle', { source: 'claude-code' })],
        },
      ],
    };
    render(<Canvas model={MIXED} />);
    expect(providerOf('idle-1')?.getAttribute('data-source-mark')).toBe('brand');
  });

  it('draws the neutral mark -- not another provider’s -- for a source it has never heard of', () => {
    const UNKNOWN: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'some-agent-from-2027',
          sessions: [session('idle-1', 'idle')],
        },
      ],
    };
    render(<Canvas model={UNKNOWN} />);
    expect(providerOf('idle-1')?.getAttribute('data-source-mark')).toBe('neutral');
    expect(providerOf('idle-1')?.querySelector('svg')).not.toBeNull();
  });

  it('is decorative, as the status mark beside it is', () => {
    // A provider is a constant of the tab, and every tab of one project has
    // the same one: announced, it would read the source aloud before each of
    // eight titles. The status bar's `SourceGlyph` names the FOCUSED
    // session's source once, in a labelled `role="img"`.
    render(<Canvas model={MODEL} />);
    const mark = providerOf('running-1');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    expect(mark?.textContent).toBe('');
  });
});

/**
 * The composer's own textarea, and a change typed into it the way React
 * sees one -- through the prototype setter, so the tracked value moves and
 * the `input` event is not swallowed as a no-op.
 */
const promptInput = () =>
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');

function typeInto(text: string) {
  const input = promptInput();
  if (input === null) throw new Error('no composer to type into');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set as (
      this: HTMLElement,
      v: string,
    ) => void;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the draft pencil', () => {
  it('appears when the composer holds text, and goes when it is cleared', () => {
    render(<Canvas model={MODEL} />);
    focusTab('idle-1');
    expect(marksOf('idle-1')).toEqual([]);
    typeInto('half a thought');
    expect(marksOf('idle-1')).toEqual(['draft']);
    expect(glyphsIn(markOf('idle-1', 'draft'))).toEqual(['lucide-pencil']);
    typeInto('');
    expect(marksOf('idle-1')).toEqual([]);
  });

  it('is not raised by whitespace alone, which the send would refuse too', () => {
    // `sendPromptFor` returns on `trim() === ''`. A pencil for text that
    // cannot be sent would be a mark for nothing, so the two share the rule.
    render(<Canvas model={MODEL} />);
    focusTab('idle-1');
    typeInto('  \n ');
    expect(marksOf('idle-1')).toEqual([]);
  });

  it('follows the session, not the pane: the other tabs stay unmarked', () => {
    render(<Canvas model={MODEL} />);
    focusTab('idle-1');
    typeInto('for idle-1 only');
    expect(marksOf('idle-1')).toEqual(['draft']);
    expect(marksOf('running-1')).toEqual(['running']);
    expect(marksOf('done-1')).toEqual([]);
  });

  it('rides AFTER the title, where the status mark rides before it', () => {
    // Reading order on a strip is left to right: what the session is doing
    // comes first, what the operator was doing here comes last.
    render(<Canvas model={MODEL} />);
    focusTab('running-1');
    typeInto('typed while it works');
    const tab = tabOf('running-1');
    const order = [...(tab?.querySelectorAll('[data-tab-mark], [data-tab-select]') ?? [])].map(
      (el) => el.getAttribute('data-tab-mark') ?? 'title',
    );
    expect(order).toEqual(['running', 'title', 'draft']);
  });

  it('has an accessible name, because it is not a status the row already reads', () => {
    render(<Canvas model={MODEL} />);
    focusTab('idle-1');
    typeInto('unsent');
    const pencil = markOf('idle-1', 'draft');
    expect(pencil?.getAttribute('aria-hidden')).not.toBe('true');
    expect(pencil?.getAttribute('aria-label')).toBe('unsent draft');
    expect(pencil?.getAttribute('role')).toBe('img');
  });

  it('is gone once the draft is sent', async () => {
    // The composer is cleared the instant the send begins (the optimistic
    // paint), which is the instant the pencil has nothing to say.
    const source = recordingSource();
    render(<Canvas model={MODEL} source={source} />);
    focusTab('idle-1');
    typeInto('ship it');
    expect(marksOf('idle-1')).toEqual(['draft']);
    await act(async () => {
      promptInput()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(promptInput()?.value).toBe('');
    expect(marksOf('idle-1')).toEqual([]);
  });

  it('is on the list, so a draft always raises it', () => {
    seed();
    render(<Canvas model={MODEL} />);
    focusTab('idle-1');
    typeInto('a draft the operator has not sent');
    expect(marksOf('idle-1')).toEqual(['draft']);
  });
});

/** A source that records a prompt and answers at once, so the pending paint
 *  is up while the model has not caught up. */
function recordingSource(): CanvasSource {
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
      resumeSession: false,
    },
    declines: {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: { recordPrompt: async () => {} },
  };
  return { kind: 'session', source: inner as SessionSource, onWrote: () => {} };
}

describe('the pending dot', () => {
  it('is not on the list: a sent prompt raises nothing on the tab', async () => {
    render(<Canvas model={MODEL} source={recordingSource()} />);
    focusTab('idle-1');
    typeInto('ship it');
    await act(async () => {
      promptInput()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(marksOf('idle-1')).toEqual([]);
  });

  it('stays off the tab even while a prompt is typed and not yet recorded', async () => {
    seed();
    render(<Canvas model={MODEL} source={recordingSource()} />);
    focusTab('idle-1');
    typeInto('ship it');
    await act(async () => {
      promptInput()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    // The composer is empty again, so no pencil -- what is pending is the
    // prompt, not a draft of one -- and `pending` is not on the list, so the
    // tab carries nothing at all. The pane is where a sent prompt shows.
    expect(marksOf('idle-1')).toEqual([]);
    expect(marksOf('running-1')).toEqual(['running']);
  });
});

describe('the agents count', () => {
  const BUSY: CanvasModel = {
    projects: [
      {
        id: 'p1',
        name: 'alpha',
        source: 'claude-code',
        sessions: [
          session('running-1', 'running', { runningAgents: 3 }),
          session('idle-1', 'idle', { runningAgents: 0 }),
        ],
      },
    ],
  };

  it('is not on the list', () => {
    render(<Canvas model={BUSY} />);
    expect(marksOf('running-1')).toEqual(['running']);
  });

  it('draws nothing even for a session with agents running', () => {
    seed();
    render(<Canvas model={BUSY} />);
    // Three agents running under this session, and the tab says only that the
    // session is running: the count is the sidebar row's job, and `agents` is
    // not on the list.
    expect(marksOf('running-1')).toEqual(['running']);
    expect(markOf('running-1', 'agents')).toBeNull();
    expect(marksOf('idle-1')).toEqual([]);
  });
});
