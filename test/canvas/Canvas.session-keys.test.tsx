// @vitest-environment happy-dom

/**
 * The fourth arrangement of the digit row, and the two keys either side of it.
 *
 * The operator asked for it in one sentence: "Cmd+0 goes back to the sidebar,
 * Cmd+number switches tab", plus "Cmd+T creates a new session/tab in the
 * currently focused pane". So the digit is no longer context-dependent — it is
 * a SESSION TAB in every cursor mode — and the four views keep the other
 * modifier (`Alt+<digit>`), which is where they already were.
 *
 * Everything here presses a key and reads what CHANGED ON SCREEN: which tab
 * wears `data-active`, what the mode cell says, what the status bar said, what
 * the source was asked to create. A test that read the binding table back
 * would only be agreeing with the line of source it was written beside.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { buildKeySheet } from '../../src/renderer/keyboard/keysheet.js';
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

/** Three tabs in one pane, which is what a digit past the last one needs. */
const THREE = modelWith('a1', 'a2', 'a3');

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

const panes = () => [...document.querySelectorAll('[data-split-pane]')];
const paneFor = (id: string) => document.querySelector(`[data-split-pane="${id}"]`);
const focusedPane = () => document.querySelector('[data-split-pane][data-split-focused="true"]');
const tabsIn = (pane: Element | null | undefined) =>
  [...(pane?.querySelectorAll('[data-tab-select]') ?? [])].map((el) => el.textContent);
const activeTabIn = (pane: Element | null | undefined) =>
  pane?.querySelector('[data-session-tab][data-active="true"] [data-tab-select]')?.textContent ??
  null;
const activeTab = () => activeTabIn(focusedPane());
const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
const mode = () => document.querySelector('[data-mode]')?.textContent ?? '';
const selectedView = () =>
  document.querySelector('[data-view][aria-pressed="true"]')?.getAttribute('data-view') ?? null;
const newTabIn = (pane: Element | null | undefined) =>
  pane?.querySelector<HTMLButtonElement>('[data-tab-new]') ?? null;

function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

async function pressAsync(key: string, modifiers: KeyboardEventInit = {}) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

/** `Cmd+<n>`, with the `code` a real keydown carries — the physical key is
 *  what `normalizeKey` reads for the digit row. */
const digit = (n: number) => press(String(n), { metaKey: true, code: `Digit${n}` });

describe('Cmd+<digit> is the tab strip in front of the operator', () => {
  it('switches tab while the SIDEBAR has the keyboard', () => {
    render(<Canvas model={THREE} />);
    expect(tabsIn(focusedPane())).toEqual(['a1', 'a2', 'a3']);
    expect(mode()).toBe('Select');
    digit(2);
    expect(activeTab()).toBe('a2');
    // The digit no longer means two things, so nothing about the mode changed
    // and no view moved with it.
    expect(mode()).toBe('Select');
    expect(selectedView()).toBe('response');
  });

  /**
   * THE DIGIT INDEXES THE LIST ON SCREEN, read back off the DOM rather than
   * compared against a literal typed into this file.
   *
   * Every position is walked, not one: a middle position is symmetric under a
   * reversed strip, so an assertion that only presses `2` over three tabs
   * cannot tell a strip the keyboard agrees with from one it merely happens to
   * match. Measured by mutation — reversing `drawnPaneTabs` under `renderLeaf`
   * left the two-of-three assertion green.
   */
  it('lands on the tab DRAWN at that position, every position', () => {
    render(<Canvas model={THREE} />);
    const drawn = tabsIn(focusedPane());
    expect(drawn).toHaveLength(3);
    for (const [index, title] of drawn.entries()) {
      digit(index + 1);
      expect(activeTab(), `Cmd+${index + 1} over ${drawn.join(', ')}`).toBe(title);
    }
  });

  it('switches the same tab with the keyboard in the RESPONSE pane', () => {
    render(<Canvas model={THREE} />);
    press('I');
    expect(mode()).toBe('Insert');
    digit(3);
    expect(activeTab()).toBe('a3');
    // `Alt+<digit>` still owns the four views; Cmd does not touch them.
    expect(selectedView()).toBe('response');
  });

  it('the ninth is the LAST tab of the pane, whatever the count', () => {
    render(<Canvas model={THREE} />);
    digit(9);
    expect(activeTab()).toBe('a3');
  });

  it('refuses a digit past the last tab aloud, and moves nothing', () => {
    render(<Canvas model={THREE} />);
    digit(2);
    expect(activeTab()).toBe('a2');
    digit(4);
    expect(activeTab()).toBe('a2');
    expect(statusBar()).toContain('only 3 tabs');
  });

  /**
   * THE RULE WHEN THE SHELL IS SPLIT, AND IT IS THE FIFTH ARRANGEMENT OF THIS
   * ROW — a deliberate reversal of what this case used to assert.
   *
   * It read "the digits count THE FOCUSED PANE'S OWN STRIP", and `Cmd+2` in a
   * one-tab pane refused rather than reaching across. The operator asked for
   * the other rule: a split is one screen, and the tab they can SEE at
   * position 2 should be what `Cmd+2` names. `chords.ts` records all five
   * arrangements and this one's price — past nine tabs the digits no longer
   * cover everything, where per-pane numbering kept every strip individually
   * reachable.
   *
   * `zv` moves the front tab into the new pane and leaves the keyboard there,
   * so the focused pane holds one of the three tabs on screen.
   */
  it('counts every strip on screen, not just the focused pane’s', () => {
    render(<Canvas model={THREE} />);
    press('z');
    press('v');
    expect(panes()).toHaveLength(2);
    expect(tabsIn(focusedPane())).toHaveLength(1);
    // WAS: "only 1 tab in this pane". Position 2 is pane-1's second tab, read
    // off what that pane DRAWS rather than compared to a literal.
    digit(2);
    expect(activeTabIn(paneFor('pane-1'))).toBe(tabsIn(paneFor('pane-1'))[1]);
    // Read off the status CELL, not the whole bar: the bar carries the source
    // readout too, and matching against all of it is how a negative assertion
    // comes to be about a sentence nobody wrote.
    expect(
      document.querySelector('[data-status-bar] [data-status]')?.textContent ?? '',
    ).not.toContain('only');
    // And the keyboard went with it — a digit that brought a tab forward in a
    // pane the operator is not in would be the worst of both rules.
    expect(focusedPane()?.getAttribute('data-split-pane')).toBe('pane-1');
  });

  it('refuses past the LAST tab on screen, counting every pane in the sentence', () => {
    render(<Canvas model={THREE} />);
    press('z');
    press('v');
    const before = activeTab();
    digit(4);
    expect(activeTab()).toBe(before);
    // Three tabs across two panes. The count has to be of the list the digit
    // addresses, or the refusal is about a different list from the one that
    // refused.
    expect(statusBar()).toContain('only 3 tabs');
  });

  it('says so rather than nothing when nothing is open anywhere', () => {
    // The empty-pane case this replaced is no longer a refusal: with the tabs
    // counted across panes, a digit pressed in an emptied pane addresses the
    // tabs still open in the other one — which is the point of the change.
    // What is left to refuse is a shell with no tabs at all.
    render(<Canvas model={{ projects: [] }} />);
    expect(tabsIn(focusedPane())).toHaveLength(0);
    digit(1);
    expect(statusBar()).toContain('no tabs');
  });

  it('fires from inside the prompt box, where the operator’s hands are', () => {
    const { container } = render(<Canvas model={THREE} />);
    press('i');
    const box = container.querySelector('[aria-label="prompt to session"]') as HTMLTextAreaElement;
    box.focus();
    act(() => {
      fireEvent.keyDown(box, { key: '3', metaKey: true, code: 'Digit3', bubbles: true });
    });
    expect(activeTab()).toBe('a3');
  });
});

describe('Cmd+0 goes back to the sidebar', () => {
  it('puts the keyboard back in the session list from the response pane', () => {
    render(<Canvas model={THREE} />);
    press('I');
    expect(mode()).toBe('Insert');
    press('0', { metaKey: true, code: 'Digit0' });
    expect(mode()).toBe('Select');
  });

  it('leaves `z0` — the pane-width reset — alone', () => {
    render(<Canvas model={THREE} />);
    press('z');
    press('0');
    // `z0` also lands in Select, so the readable proof it was the chord and
    // not `Mod-0` is that the chord machine consumed the `z`: a bare `0` after
    // it is not a second reset, and nothing threw.
    expect(mode()).toBe('Select');
  });
});

describe('Cmd+T starts a session in the focused pane', () => {
  it('asks the source for one, by the pane’s own project', async () => {
    const { source, created } = sourceWith(async () => {});
    render(<Canvas model={modelWith('a1')} source={source} />);
    await pressAsync('t', { metaKey: true });
    expect(created).toEqual([['p1', 'alpha']]);
  });

  it('opens the session that appears in the pane that asked', async () => {
    const { source } = sourceWith(async () => {});
    const { rerender } = render(<Canvas model={modelWith('a1')} source={source} />);
    press('z');
    press('v'); // a1 moves to pane-2, which takes the keyboard
    expect(paneFor('pane-2')?.getAttribute('data-split-focused')).toBe('true');
    await pressAsync('t', { metaKey: true });
    await act(async () => {
      rerender(<Canvas model={modelWith('a1', 'a2')} source={source} />);
    });
    expect(tabsIn(paneFor('pane-2'))).toEqual(['a1', 'a2']);
    expect(activeTabIn(paneFor('pane-2'))).toBe('a2');
    expect(tabsIn(paneFor('pane-1'))).toEqual([]);
  });

  it('refuses aloud, and calls nothing, when the source cannot create', async () => {
    const { source, created } = sourceWith();
    render(<Canvas model={modelWith('a1')} source={source} />);
    await pressAsync('t', { metaKey: true });
    expect(created).toEqual([]);
    expect(statusBar()).toContain('this source has no way to start one');
    expect(statusBar()).not.toMatch(/^started/i);
  });

  /**
   * WHY IT IS NOT `Mod-n` UNDER A SECOND NAME. `Mod-n`/`o` start a session in
   * the FOCUSED SESSION's project and refuse when nothing is focused; `Mod-t`
   * is the per-pane `+`, which resolves a project from the pane and falls back
   * to the project on screen. A pane a split emptied is exactly where the two
   * diverge, and it is a state the operator reaches with one keystroke.
   */
  it('still creates in a pane a split emptied, where `Mod-n` refuses', async () => {
    const { source, created } = sourceWith(async () => {});
    render(<Canvas model={modelWith('a1')} source={source} />);
    press('z');
    press('v');
    press('z');
    press('w'); // the keyboard, back in the pane the split emptied
    expect(tabsIn(focusedPane())).toHaveLength(0);

    await pressAsync('n', { metaKey: true });
    expect(created).toEqual([]);
    expect(statusBar()).toContain('pick a session first');

    await pressAsync('t', { metaKey: true });
    expect(created).toEqual([['p1', 'alpha']]);
  });

  it('is the key the pane’s own `+` names, so the tooltip cannot lie', () => {
    const { source } = sourceWith(async () => {});
    render(<Canvas model={modelWith('a1')} source={source} />);
    const button = newTabIn(panes()[0]);
    act(() => {
      button?.focus();
      button?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    });
    const tip = document.querySelector('[role="tooltip"]')?.textContent ?? '';
    expect(tip).toContain('Mod-t');
    expect(tip).not.toContain('Mod-n');
  });
});

describe('the generated key sheet tells the truth about the new row', () => {
  const rows = () => buildKeySheet().flatMap((group) => group.rows);
  const keys = () => rows().map((row) => row.keys);

  it('lists every digit the table binds, zero included now', () => {
    expect(keys()).toContain('Mod-0');
    for (let n = 1; n <= 9; n += 1) {
      expect(keys(), `Mod-${n}`).toContain(`Mod-${n}`);
    }
  });

  it('names NO Mod-Shift digit — macOS owns three of them', () => {
    for (let n = 1; n <= 9; n += 1) {
      expect(keys(), `Mod-Shift-${n}`).not.toContain(`Mod-Shift-${n}`);
    }
  });

  it('captions a digit as a TAB, once, with no per-mode fork left', () => {
    const digitRows = rows().filter((row) => row.keys === 'Mod-2');
    expect(digitRows).toHaveLength(1);
    expect(digitRows[0]?.mode).toBeNull();
    expect(digitRows[0]?.label).toContain('tab 2');
    expect(digitRows[0]?.label).not.toContain('session 2');
  });

  it('says the ninth is the last tab rather than a ninth one', () => {
    expect(rows().find((row) => row.keys === 'Mod-9')?.label).toContain('LAST');
  });

  it('lists Mod-t, and does not describe it as the same thing as Mod-n', () => {
    const newTab = rows().find((row) => row.keys === 'Mod-t');
    const newSession = rows().find((row) => row.keys === 'Mod-n');
    expect(newTab).toBeDefined();
    expect(newSession).toBeDefined();
    expect(newTab?.label).not.toBe(newSession?.label);
    expect(newTab?.label).toContain('pane');
  });
});
