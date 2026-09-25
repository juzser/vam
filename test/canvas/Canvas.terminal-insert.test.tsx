// @vitest-environment happy-dom

/**
 * `i` GETS INTO THE TERMINAL, AND ARRIVING AT IT NO LONGER DOES.
 *
 * ── THE OPERATOR'S REPORT, translated ─────────────────────────────────────
 * "When I go into terminal mode, can it not automatically enter insert mode
 * straight away — can I still have to press `i` to focus the terminal input?"
 *
 * Two halves, and the second is what makes this more than a preference.
 * `TerminalTab`'s latched `FOCUS ON ARRIVAL, ONCE` effect was the ONLY
 * keyboard route into the pane: `Mod-0` let go and `i` did not get back,
 * because `i` resolves to `prompt`, `prompt` called `beginComposing()`, and
 * `beginComposing` sets a flag that only a COMPOSER reads — which the Terminal
 * view does not draw (`DetailPanel.tsx`: not on `Terminal`, not on `Files`).
 * So the key set a flag, focused nothing, said nothing. Deleting the grab on
 * its own would have left the terminal reachable by mouse and by nothing else.
 *
 * ── WHAT THIS FILE CAN AND CANNOT SAY ─────────────────────────────────────
 * It drives the CANVAS with a real `TerminalTab` inside it, which is the one
 * place the two halves meet: `case 'prompt'` reads the pane's markup to decide
 * where `i` goes, and only a rendered terminal pane has that markup. happy-dom
 * moves and reports focus for an explicit `.focus()` call — the mechanism
 * `focusInsertStop` uses — which is what makes the claim askable here at all.
 *
 * It cannot say where a REAL key press lands, because a synthetic keydown is
 * delivered to whatever the test last focused rather than to whoever holds the
 * keyboard, and it cannot see the pane's own microtask forward to the hidden
 * compose box under a real browser's focus rules. `e2e/terminal-insert-shots.mjs`
 * is where both of those are measured; neither file is the proof on its own.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { setActiveStreamingTerminal } from '../../src/renderer/prefs/streaming-terminal.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

function session(id: string): Session {
  return {
    id,
    title: id,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [{ id: `${id}-d`, label: 'plan', input: 'in', output: 'out', commands: [] }],
  };
}

const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1'), session('a2')] },
  ],
};

/** A source that offers a terminal, which is what puts the view on the bar. */
function withTerminal(): CanvasSource {
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
      terminal: true,
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

const pane = () => document.querySelector<HTMLElement>('[data-terminal-pane]');
const mode = () => document.querySelector('[data-mode]')?.textContent ?? '';
const statusText = () =>
  document.querySelector('[data-status-bar] [data-status]')?.textContent ?? '';

/** A keydown on whatever really holds focus — how a real press arrives. */
function press(key: string, modifiers: KeyboardEventInit = {}) {
  const target = document.activeElement ?? window;
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
    );
  });
}

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** The bare digit for `Terminal` — its FIXED slot in `TABS`, which is 3. */
async function openTerminal() {
  render(<Canvas model={MODEL} source={withTerminal()} />);
  press('3');
  await settle();
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

beforeEach(() => {
  // The bridge the Terminal view reads through. `DetailPanel` passes
  // `globalThis.window.api.terminal.read` straight down, so this is the whole
  // of what a terminal needs to be drawn in a unit environment.
  (globalThis.window as unknown as { api: unknown }).api = {
    terminal: {
      read: vi.fn(async () => ({
        kind: 'ok',
        name: 'vam-alpha-a1b2c3',
        text: 'the screen',
        cursor: { kind: 'unreadable' },
      })),
      send: vi.fn(async () => 'sent'),
    },
  };
  // THIS FILE'S SUBJECT IS THE CLASSIC `[data-terminal-pane]` RENDERER'S OWN
  // keyboard/insert-mode behaviour, and the bridge above carries no
  // `terminalStream` member at all. Streaming defaults ON now
  // (`prefs/streaming-terminal.ts`), so the explicit opt-out is what keeps
  // `TerminalAutoTab` drawing the renderer this file actually tests --
  // SEEDED INTO `localStorage`, not set on the live store directly:
  // `Canvas.tsx`'s own `useState(() => readPrefs(storage))` initializer runs
  // `activatePrefs` (and so `setActiveStreamingTerminal`) DURING `render()`,
  // AFTER this `beforeEach` -- a direct `setActiveStreamingTerminal(false)`
  // here would just be overwritten the moment `Canvas` reads its own real
  // (real, empty) `localStorage` and gets the new default back.
  // `streamingTerminalMigrated: true` so `readStreamingTerminal` reads this
  // value literally rather than the one-time migration ratchet overriding it
  // (`prefs.ts`'s own `streamingTerminalMigrated` header).
  globalThis.window.localStorage.setItem(
    'vam.prefs.v1',
    JSON.stringify({ streamingTerminal: false, streamingTerminalMigrated: true }),
  );
  setActiveStreamingTerminal(false);
});

afterEach(() => {
  cleanup();
  (globalThis.window as unknown as { api?: unknown }).api = undefined;
  globalThis.window.localStorage.removeItem('vam.prefs.v1');
  setActiveStreamingTerminal(true);
});

describe('arriving at the Terminal view leaves the keyboard on the shell', () => {
  it('draws the screen and takes nothing', async () => {
    await openTerminal();
    expect(pane()).not.toBeNull();
    // THE PROPERTY, not a proxy for it. The mode cell is read on the line
    // below because a cell that disagreed with focus is this suite's own
    // oldest bug — but it is `activeElement` that says whether a keystroke
    // typed now goes into somebody's running agent.
    expect(pane()?.contains(document.activeElement)).toBe(false);
    expect(mode()).toBe('Select');
  });

  it('and still takes nothing when the pane is redrawn for the next session', async () => {
    // THE REGRESSION THE DELETED LATCH EXISTED TO PREVENT, asked of code that
    // has no latch left. `TerminalTab` clears its `view` DURING RENDER when
    // the row changes, so the pane goes away and comes back on every switch:
    // a rule phrased "there is a screen, take the keyboard" grabs it each
    // time, and the `j` that moves to the next session is typed into an agent
    // instead. Nothing grabs now, so there is nothing to re-latch.
    //
    // THE VIEW IS A FACT ABOUT THE SESSION (`viewBySession`), so the second
    // session has to be put on ITS Terminal view before there are two
    // terminals to switch between — without that this walks onto a Response
    // pane and proves nothing about a redrawn screen.
    await openTerminal();
    press('j');
    press('3');
    await settle();
    expect(pane()).not.toBeNull();
    press('k');
    await settle();
    expect(pane()).not.toBeNull();
    expect(pane()?.contains(document.activeElement)).toBe(false);
    expect(mode()).toBe('Select');
  });

  it('and takes nothing back when a transient refusal replaces the screen', async () => {
    // The other half of the same finding: `view` also goes away and comes back
    // when a read cannot answer. A ten-second tmux timeout under a pane the
    // operator is not typing in must not end with the keyboard back in it.
    const api = (globalThis.window as unknown as { api: { terminal: { read: () => unknown } } })
      .api;
    await openTerminal();
    expect(pane()).not.toBeNull();
    api.terminal.read = async () => ({
      kind: 'unavailable',
      error: { kind: 'unreachable', code: 'timeout', message: 'slow' },
    });
    press('j');
    press('3');
    await settle();
    expect(pane()).toBeNull();
    api.terminal.read = async () => ({
      kind: 'ok',
      name: 'vam-alpha-a1b2c3',
      text: 'the screen',
      cursor: { kind: 'unreadable' },
    });
    press('k');
    await settle();
    expect(pane()?.contains(document.activeElement)).toBe(false);
    expect(mode()).toBe('Select');
  });
});

describe('`i` is the way in, and `I` is the same door', () => {
  it('puts the keyboard inside the terminal pane', async () => {
    await openTerminal();
    expect(pane()?.contains(document.activeElement)).toBe(false);
    press('i');
    expect(pane()?.contains(document.activeElement)).toBe(true);
    expect(mode()).toBe('Insert');
    // NOT A REFUSAL. `i` used to be silent here; a sentence now would mean it
    // had declined, which is a different bug wearing the same words.
    expect(statusText()).toBe('');
  });

  it('and `I` lands in the same place', async () => {
    await openTerminal();
    // A real Shift press: since the CapsLock fix `normalizeKey` reads the
    // letter's case off `shiftKey` alone, so an unshifted `I` IS `i`.
    press('I', { shiftKey: true });
    expect(pane()?.contains(document.activeElement)).toBe(true);
    expect(mode()).toBe('Insert');
  });

  it('but refuses out loud when the Terminal view has no screen to type into', async () => {
    // A VIEW IS NOT A SURFACE. `not-vam` draws a sentence and no pane, so
    // there is no composer, no question and no screen — nothing for `i` to
    // land on. It was silent here too, which on this key is the state that
    // reads as a frozen application; `focusAction` has always answered.
    (
      globalThis.window as unknown as { api: { terminal: { read: () => unknown } } }
    ).api.terminal.read = async () => ({ kind: 'not-vam' });
    await openTerminal();
    expect(pane()).toBeNull();
    press('i');
    expect(mode()).toBe('Select');
    expect(document.activeElement).toBe(document.body);
    expect(statusText()).not.toBe('');
  });

  it('and Mod-0 is still the way out of what `i` entered', async () => {
    await openTerminal();
    press('i');
    expect(mode()).toBe('Insert');
    // Spelled the way a real macOS keydown spells it — the CODE carries the
    // position, which is what `chords.ts` reads for the digit row.
    press('0', { metaKey: true, code: 'Digit0' });
    expect(mode()).toBe('Select');
    expect(pane()?.contains(document.activeElement)).toBe(false);
  });
});
