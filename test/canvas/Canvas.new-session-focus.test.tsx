// @vitest-environment happy-dom

/**
 * THE KEYBOARD GOES INTO THE SESSION THAT WAS JUST BORN.
 *
 * Operator instruction: "when a new session finishes being created, focus
 * should go straight into that session's Response view, in insert mode."
 *
 * What shipped opened the session in the pane that asked for it and moved the
 * PANE cursor there, and stopped — the keyboard was left on the shell with
 * nothing focused, so the first thing the operator could do with a session
 * they had just asked for was press `I`.
 *
 * ── WHY EVERY ASSERTION HERE IS ABOUT `document.activeElement` ────────────
 *
 * Insert is not a flag. `keyboard/focus-scope.ts` derives the mode from DOM
 * focus: it is Insert exactly when focus is inside a `data-insert-scope`.
 * `Canvas.tsx` mirrors that into state for the status bar and nothing else,
 * and the audit this rule came out of found the exact failure a mode-only
 * assertion would wave through — `I` used to set the flag and move no focus,
 * so the bar read Insert while `document.activeElement` was still the body
 * and `hjkl` fell through to the canvas grammar under the pane being read.
 * So the mode string is asserted here only ALONGSIDE the element, never
 * instead of it.
 *
 * ── AND WHY THE TIMING IS THE HARD PART ───────────────────────────────────
 *
 * `write.createSession` resolves `void`: `tmux new-session -d` returns before
 * the agent inside has registered anywhere vam can read, so the new session's
 * id is not knowable at the call and the arrival is a later poll. At the
 * commit that arrival effect runs in, the pane it is about is still drawing
 * `StartingSession` IN PLACE OF its `DetailPanel` (`renderLeaf`) — there is no
 * composer in that pane, and a `focusInsertStop` called there answers `false`
 * every time. The composer exists one commit later, once `starting` has
 * cleared and the pane has the new tab in front.
 *
 * That is why the first case below splits first: `zv` MOVES the active tab, so
 * pane-1 is left holding nothing and cannot have a stale composer for the
 * focus to land on by luck. A pane that already held a session would pass a
 * synchronous implementation too — the prompt row is one DOM node the pane
 * reuses across its tabs — and that pass would mean nothing.
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

function sourceWith(): CanvasSource {
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
      createSession: true,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
      resumeSession: false,
    },
    declines: {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: { recordPrompt: async () => {}, createSession: async () => {} },
  };
  return { kind: 'session', source: inner as unknown as SessionSource, onWrote: () => {} };
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

const paneFor = (id: string) => document.querySelector(`[data-split-pane="${id}"]`);
const newTabIn = (paneEl: Element | null | undefined) =>
  paneEl?.querySelector<HTMLButtonElement>('[data-tab-new]') ?? null;
const promptBoxIn = (paneEl: Element | null | undefined) =>
  paneEl?.querySelector('[data-prompt-box]') ?? null;
const activeTabIn = (paneEl: Element | null | undefined) =>
  paneEl?.querySelector('[data-session-tab][data-active="true"] [data-tab-select]')?.textContent ??
  null;
/** The view icons draw in the FOCUSED pane alone, which is where they matter. */
const selectedView = () =>
  document.querySelector('[data-view][aria-pressed="true"]')?.getAttribute('data-view') ?? null;
const mode = () => document.querySelector('[data-mode]')?.textContent ?? '';
/**
 * THE STATUS CELL, not the whole bar: the bar also carries the mode, the
 * source name and the permanent "Keyboard shortcut" hint, so a `/keyboard/i`
 * assertion against the bar would match that hint and never fail.
 */
const statusText = () =>
  document.querySelector('[data-status-bar] [data-status]')?.textContent ?? '';

function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

/** A two-key chord — `zv`, `zw`, `zc` — as the two presses it really is. */
function chord(prefix: string, key: string) {
  press(prefix);
  press(key);
}

async function click(el: HTMLElement | null) {
  await act(async () => {
    el?.click();
  });
}

/** Focus an element the way the operator's own click would, events and all. */
function focusElement(el: Element | null) {
  act(() => {
    (el as HTMLElement | null)?.focus();
    el?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  });
}

describe('the session vam just started takes the keyboard', () => {
  /**
   * The case that proves the timing rather than assuming it: `zv` MOVES the
   * active tab, so pane-1 holds NOTHING when its `+` is pressed and draws no
   * composer until the arrival lands. There is no stale prompt row here for a
   * synchronous `focusInsertStop` to hit.
   */
  it('puts DOM focus on the new session’s prompt box, not merely the mode string', async () => {
    const source = sourceWith();
    const { rerender } = render(<Canvas model={modelWith('a1')} source={source} />);
    chord('z', 'v');
    await click(newTabIn(paneFor('pane-1')));
    // While the write is in flight the pane draws the wait in place of the
    // panel — there is no prompt box anywhere in it to focus yet.
    expect(promptBoxIn(paneFor('pane-1'))).toBeNull();

    await act(async () => {
      rerender(<Canvas model={modelWith('a1', 'a2')} source={source} />);
    });

    const box = promptBoxIn(paneFor('pane-1'));
    expect(box, 'the arrived session drew no prompt box in the pane that asked').not.toBeNull();
    expect(activeTabIn(paneFor('pane-1'))).toBe('a2');
    expect(document.activeElement).toBe(box);
    // The mode follows the focus; asserted second, and never on its own.
    expect(mode()).toBe('Insert');
  });

  /**
   * THE `+` IS STILL FOCUSED WHEN THE SESSION ARRIVES — and that must not
   * count as the operator having moved on.
   *
   * happy-dom's `.click()` dispatches the event without moving focus, so the
   * case above never reaches this state and no test written against it would.
   * A real browser does: measured in Chromium, a pointer press on a `<button>`
   * leaves `document.activeElement` on that button, `=== document.body` false.
   * So the rule is phrased as "is something ANSWERING keys" rather than "is
   * anything focused at all" — the second reading would have declined on every
   * mouse-driven creation there is, in production only, while this whole file
   * stayed green. Focused explicitly here so the production state is the one
   * being asserted.
   */
  it('still hands it over when the `+` the operator clicked is the focused element', async () => {
    const source = sourceWith();
    const { rerender } = render(<Canvas model={modelWith('a1')} source={source} />);
    chord('z', 'v');
    const plus = newTabIn(paneFor('pane-1'));
    await click(plus);
    focusElement(plus);
    expect(document.activeElement).toBe(plus);

    await act(async () => {
      rerender(<Canvas model={modelWith('a1', 'a2')} source={source} />);
    });

    expect(document.activeElement).toBe(promptBoxIn(paneFor('pane-1')));
    expect(mode()).toBe('Insert');
  });

  /**
   * The view is a PER-SESSION fact (`viewBySession`) seeded from
   * `prefs.detailTab` — so an operator whose last run ended on Agents would
   * have had the new session open on Agents, and "straight into that session's
   * Response view" would have been half true. The seed is left alone: it is
   * what the NEXT RUN opens on, and vam choosing Response for a session the
   * operator has never seen is not the operator choosing it.
   */
  it('opens that session on the Response view, whatever the last run was left on', async () => {
    localStorage.setItem('vam.prefs.v1', JSON.stringify({ detailTab: 'Agents' }));
    const source = sourceWith();
    const { rerender } = render(<Canvas model={modelWith('a1')} source={source} />);
    press('g');
    press('g');
    expect(selectedView()).toBe('agents');

    await click(newTabIn(paneFor('pane-1')));
    await act(async () => {
      rerender(<Canvas model={modelWith('a1', 'a2')} source={source} />);
    });

    expect(activeTabIn(paneFor('pane-1'))).toBe('a2');
    expect(selectedView()).toBe('response');
    // And the preference the operator set is still the preference.
    const stored = JSON.parse(localStorage.getItem('vam.prefs.v1') ?? '{}') as {
      detailTab?: unknown;
    };
    expect(stored.detailTab).toBe('Agents');
  });
});

/**
 * ── WHEN IT MUST NOT FIRE ────────────────────────────────────────────────
 *
 * `tmux new-session -d` plus the agent's own registration is seconds of wall
 * clock, and the operator is not required to stand still through it. Taking
 * the keyboard out from under whatever they moved on to is worse than the
 * problem being fixed, so the arrival withholds the keyboard — and ONLY the
 * keyboard: the session still lands in the pane that asked, which is a fact
 * about where things are kept rather than about who is typing.
 */
describe('it does not take a keyboard the operator has moved', () => {
  it('leaves it alone when they are typing in another pane', async () => {
    const source = sourceWith();
    const { rerender } = render(<Canvas model={modelWith('a1')} source={source} />);
    chord('z', 'v');
    // pane-2 took the tab, so pane-2 is the one with a composer in it.
    await click(newTabIn(paneFor('pane-1')));
    const typing = promptBoxIn(paneFor('pane-2'));
    expect(typing, 'the split left no composer to type in').not.toBeNull();
    focusElement(typing);
    expect(document.activeElement).toBe(typing);

    await act(async () => {
      rerender(<Canvas model={modelWith('a1', 'a2')} source={source} />);
    });

    expect(document.activeElement).toBe(typing);
    // The session still went where it was asked to go.
    expect(activeTabIn(paneFor('pane-1'))).toBe('a2');
  });

  it('leaves it alone when they have stepped to another pane', async () => {
    const source = sourceWith();
    const { rerender } = render(<Canvas model={modelWith('a1')} source={source} />);
    chord('z', 'v');
    await click(newTabIn(paneFor('pane-1')));
    // `zw` moves the pane cursor and nothing else — the operator went to read
    // the other pane while the session was being born.
    chord('z', 'w');

    await act(async () => {
      rerender(<Canvas model={modelWith('a1', 'a2')} source={source} />);
    });

    expect(activeTabIn(paneFor('pane-1'))).toBe('a2');
    expect(document.activeElement).not.toBe(promptBoxIn(paneFor('pane-1')));
    expect(mode()).toBe('Select');
  });

  it('leaves it alone while the command palette owns it', async () => {
    const source = sourceWith();
    const { rerender } = render(<Canvas model={modelWith('a1')} source={source} />);
    await click(newTabIn(paneFor('pane-1')));
    press('k', { metaKey: true });
    const filter = document.querySelector('input[placeholder="go to session…"]');
    expect(filter, 'the palette did not open').not.toBeNull();

    await act(async () => {
      rerender(<Canvas model={modelWith('a1', 'a2')} source={source} />);
    });

    expect(document.activeElement).not.toBe(promptBoxIn(paneFor('pane-1')));
    expect(document.querySelector('input[placeholder="go to session…"]')).not.toBeNull();
  });

  /**
   * THE PALETTE IS CAUGHT TWICE OVER — it holds a text box, so the "already
   * answering keys" clause would decline even with no overlay rule at all.
   * This case is the one that ISOLATES the overlay rule, and it needs an
   * overlay with no text box in it to do that.
   *
   * IT USED TO BE THE KEY SHEET, on `Canvas.tsx`'s own keydown comment ("the
   * sheet and the settings overlay contain none"). The sheet grew a search box
   * when the operator asked for one, and the settings overlay mounts every
   * panel at once — hex fields included — so the error log is what is left:
   * a full-screen overlay, in `overlayOpen` like the rest, with nothing in it
   * to type into. The assertion below says so out loud rather than assuming
   * it, so the day THAT surface grows a box this case declares itself instead
   * of quietly testing the other clause.
   */
  it('leaves it alone while an overlay with no text box owns it', async () => {
    const source = sourceWith();
    const { rerender } = render(<Canvas model={modelWith('a1')} source={source} />);
    await click(newTabIn(paneFor('pane-1')));
    press('E', { shiftKey: true });
    const log = document.querySelector('[data-error-log]');
    expect(log, 'the error log did not open').not.toBeNull();
    expect(
      log?.querySelector('input, textarea'),
      'the error log grew a text box, so this case no longer isolates the overlay rule',
    ).toBeNull();

    await act(async () => {
      rerender(<Canvas model={modelWith('a1', 'a2')} source={source} />);
    });

    expect(document.activeElement).not.toBe(promptBoxIn(paneFor('pane-1')));
    expect(mode()).toBe('Select');
  });

  /**
   * MEASURED, AND THE MEASUREMENT IS THE POINT: deleting the arrival's
   * closed-pane guard reddens NOTHING, here or anywhere in the suite. The
   * property survives it twice over — `paneElement` answers `null` for a pane
   * that is not drawn and `focusInsertStop` is total over `null`, so there is
   * nothing to land on; and the dangling `focusedPaneId` the guard also
   * prevents is repaired in the same flush by "land focus on something real",
   * which routes the pick through `paneHolding` and back onto a pane that
   * exists. This case is kept for the behaviour rather than as a guard, and
   * the honest statement is that no test can distinguish that mutation.
   */
  it('does nothing at all when the pane that asked has been closed', async () => {
    const source = sourceWith();
    const { rerender } = render(<Canvas model={modelWith('a1')} source={source} />);
    chord('z', 'v');
    await click(newTabIn(paneFor('pane-1')));
    // `+` focused pane-1, so `zc` closes the very pane the session was for.
    chord('z', 'c');
    expect(paneFor('pane-1')).toBeNull();

    await act(async () => {
      rerender(<Canvas model={modelWith('a1', 'a2')} source={source} />);
    });

    expect(mode()).toBe('Select');
    expect(document.activeElement?.hasAttribute('data-prompt-box')).not.toBe(true);
    // And a pane still holds the keyboard, rather than the shell being left
    // pointed at a leaf that is gone.
    expect(document.querySelector('[data-split-pane][data-split-focused="true"]')).not.toBeNull();
  });
});

/**
 * `landed === false` IS A REAL STATE, AND IT IS SILENT HERE.
 *
 * `I` refuses aloud — "nothing in this pane takes the keyboard" — because the
 * operator ASKED for it and is owed an answer. This move is vam's own
 * initiative, so the same sentence here would push the one line the operator
 * DID ask for, "started a new session in alpha", off the single row that
 * carries it, to report a non-event.
 *
 * ASSERTED IN THE THREE CASES THAT ARE REACHABLE, which is every case where
 * the keyboard is withheld. A source that draws no composer at all cannot be
 * reached through this path: `canWriteTo` (`sources/port.ts`) gates
 * `createSession` on `recordPrompt`, the same capability `composerHidden`
 * reads, so a source that cannot be typed into refuses the `+` outright and
 * never arrives here.
 */
describe('withholding the keyboard is silent', () => {
  /**
   * The one interference that is not a chord, so the status line still holds
   * what the `+` put there: both halves of the rule are assertable at once.
   */
  it('keeps the sentence the operator did ask for, and adds none of its own', async () => {
    const source = sourceWith();
    const { rerender } = render(<Canvas model={modelWith('a1')} source={source} />);
    chord('z', 'v');
    await click(newTabIn(paneFor('pane-1')));
    focusElement(promptBoxIn(paneFor('pane-2')));

    await act(async () => {
      rerender(<Canvas model={modelWith('a1', 'a2')} source={source} />);
    });

    expect(statusText()).toMatch(/started a new session in alpha/i);
    expect(statusText()).not.toMatch(/keyboard/i);
  });

  /**
   * The rest are CHORDS, and every resolved chord clears the status cell
   * (`setStatus(null)` at the top of the chord switch) — which is the right
   * behaviour and means the sentence cannot survive them. What is assertable
   * here is that nothing was written back onto the line the operator cleared.
   */
  it.each([
    ['stepped to another pane', () => chord('z', 'w')],
    ['the palette open', () => press('k', { metaKey: true })],
    ['the pane closed', () => chord('z', 'c')],
  ])('writes nothing back when the operator has %s', async (_case, interfere) => {
    const source = sourceWith();
    const { rerender } = render(<Canvas model={modelWith('a1')} source={source} />);
    chord('z', 'v');
    await click(newTabIn(paneFor('pane-1')));
    interfere();

    await act(async () => {
      rerender(<Canvas model={modelWith('a1', 'a2')} source={source} />);
    });

    expect(statusText()).not.toMatch(/keyboard/i);
  });
});
