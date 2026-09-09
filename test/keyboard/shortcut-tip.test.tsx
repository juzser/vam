// @vitest-environment happy-dom

/**
 * The property that decides whether a shortcut hint is worth shipping: the keys
 * a tooltip prints are READ from the binding table, never written beside the
 * button — vam lets the operator rebind, and a hint that then sends them to the
 * wrong key is worse than no hint. So nothing below spells a shipped chord of
 * its own: every assertion asks `bindingChords` what is in force, and one test
 * moves an action's keys and requires the hint to move with them.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import { DEMO_MODEL } from '../../src/renderer/fixtures/demo.js';
import {
  actionId,
  bindingChords,
  type KeyAction,
  NO_BINDINGS,
  setActiveBindings,
} from '../../src/renderer/keyboard/chords.js';
import { MODE_TITLES } from '../../src/renderer/keyboard/keysheet.js';
import {
  primaryChord,
  ShortcutTip,
  shortcutLines,
} from '../../src/renderer/keyboard/ShortcutTip.js';
import { SessionList } from '../../src/renderer/panels/SessionList.js';
import { baseProps, entriesOf, makeSession } from '../panels/session-list-props.js';

beforeAll(() => {
  // The canvas mounts ReactFlow, which measures with APIs happy-dom does not
  // implement, and reads prefs from a store it does not provide either.
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
  setActiveBindings(NO_BINDINGS);
  localStorage.clear();
});

/** The operator's own route to a rebind: stored prefs, which the canvas
 *  activates on mount. */
function seedBinding(keys: readonly string[]) {
  localStorage.setItem('vam.prefs.v1', JSON.stringify({ keyBindings: { [actionId(HELP)]: keys } }));
}

const SETTINGS: KeyAction = { kind: 'settings' };
/** `move` is one of the two mode-dependent families — see `ACTION_LABELS`. */
const MOVE_LEFT: KeyAction = { kind: 'move', direction: 'left' };
const NEW_SESSION: KeyAction = { kind: 'newSession' };
const HELP: KeyAction = { kind: 'help' };

function renderTip(props: Partial<Parameters<typeof ShortcutTip>[0]> = {}) {
  return render(
    <ShortcutTip label="Settings" action={SETTINGS} {...props}>
      <button type="button">S</button>
    </ShortcutTip>,
  );
}

/** Focus is the keyboard's hover, and Radix opens on it without a timer. */
function openByFocus(button = screen.getByRole('button')) {
  fireEvent.focus(button);
  return screen.getByRole('tooltip');
}

describe('a tooltip states the label and the shortcut in force', () => {
  it('renders the label and every chord the table holds for the action', () => {
    renderTip();
    const keys = bindingChords(NO_BINDINGS, actionId(SETTINGS));
    expect(keys.length).toBeGreaterThan(0);
    const text = openByFocus().textContent ?? '';
    expect(text).toContain('Settings');
    for (const chord of keys) {
      expect(text, `the shipped chord "${chord}" is missing from the tooltip`).toContain(chord);
    }
  });

  it('follows a rebind: the operator moves the action and the hint moves with it', () => {
    const shipped = bindingChords(NO_BINDINGS, actionId(SETTINGS));
    setActiveBindings({ [actionId(SETTINGS)]: ['Q'] });
    renderTip();
    const text = openByFocus().textContent ?? '';
    expect(text).toContain('Q');
    for (const chord of shipped) {
      expect(text, `the tooltip still advertises the abandoned chord "${chord}"`).not.toContain(
        chord,
      );
    }
  });

  it('shows the label alone when nothing is bound — no empty bracket, no placeholder', () => {
    setActiveBindings({ [actionId(SETTINGS)]: [] });
    renderTip();
    const unbound = openByFocus();
    expect(unbound.textContent?.trim()).toBe('Settings');
    expect(unbound.querySelector('[data-tip-keys]')).toBeNull();
    cleanup();
    render(
      <ShortcutTip label="fit view">
        <button type="button">F</button>
      </ShortcutTip>,
    );
    expect(openByFocus().textContent?.trim()).toBe('fit view');
  });

  it('opens on keyboard focus, not hover alone, describes its button, and closes on blur', () => {
    renderTip();
    expect(screen.queryByRole('tooltip')).toBeNull();
    const button = screen.getByRole('button');
    const tip = openByFocus(button);
    expect(button.getAttribute('aria-describedby')).toBe(tip.id);
    fireEvent.blur(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('dismisses on Escape', () => {
    renderTip();
    openByFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('the label and the shortcut read on one line', () => {
  it('puts the label and its chord in the same row when the meaning is unambiguous', () => {
    renderTip();
    const tip = openByFocus();
    const keys = tip.querySelector('[data-tip-keys]');
    expect(keys).not.toBeNull();
    const label = screen.getByText('Settings');
    expect(label.parentElement).toBe(keys?.parentElement);
  });

  it('keeps a header line above the per-mode rows when the meaning depends on cursor mode', () => {
    // Two distinct mode meanings cannot share one row with the label without
    // repeating it — the label stays a header, and each mode keeps its own
    // single line of caption + keys, unchanged from before this layout pass.
    renderTip({ label: 'move left', action: MOVE_LEFT });
    const tip = openByFocus();
    const label = screen.getByText('move left');
    const keys = tip.querySelectorAll('[data-tip-keys]');
    expect(keys.length).toBe(2);
    for (const chip of keys) {
      expect(chip.parentElement).not.toBe(label.parentElement);
    }
  });
});

describe('a mode-dependent binding is never flattened to one meaning', () => {
  it('states the meaning of the mode that applies, when the caller knows it', () => {
    renderTip({ label: 'move left', action: MOVE_LEFT, mode: 'insert' });
    const text = openByFocus().textContent ?? '';
    expect(text).toContain(MODE_TITLES.insert);
    expect(text).not.toContain(MODE_TITLES.select);
  });

  it('states both, distinctly, when the button is reachable in either mode', () => {
    renderTip({ label: 'move left', action: MOVE_LEFT });
    const text = openByFocus().textContent ?? '';
    expect(text).toContain(MODE_TITLES.select);
    expect(text).toContain(MODE_TITLES.insert);
    const lines = shortcutLines(MOVE_LEFT, undefined, NO_BINDINGS);
    expect(new Set(lines.map((line) => line.caption)).size).toBe(2);
  });
});

describe('shortcutLines: the pure reading of the table', () => {
  it('is empty for an unbound action and for a button that drives none', () => {
    expect(shortcutLines(SETTINGS, undefined, { [actionId(SETTINGS)]: [] })).toEqual([]);
    expect(shortcutLines(undefined, undefined, NO_BINDINGS)).toEqual([]);
  });

  it('joins every chord an action holds, in table order', () => {
    const lines = shortcutLines(SETTINGS, undefined, { [actionId(SETTINGS)]: ['Q', 'gq'] });
    expect(lines).toEqual([{ caption: null, keys: 'Q or gq' }]);
  });
});

describe('the sidebar is wired to it', () => {
  it('gives the "new group" and "new repo" header buttons a tooltip each, and says which is which', () => {
    render(<SessionList {...baseProps(entriesOf([makeSession()]))} onCreateGroup={() => {}} />);
    const groupText =
      openByFocus(screen.getByLabelText('new project (a group of repos)')).textContent ?? '';
    cleanup();
    render(<SessionList {...baseProps(entriesOf([makeSession()]))} onCreateGroup={() => {}} />);
    const repoText = openByFocus(screen.getByLabelText('new project')).textContent ?? '';
    // Two side-by-side "+" squares that both say "project" is the confusion
    // the operator reported; the tooltips must not repeat it.
    expect(groupText.toLowerCase()).toContain('group');
    expect(repoText.toLowerCase()).not.toContain('group');
  });

  it('gives the filter toggle a tooltip too (already wired, pinned here alongside its siblings)', () => {
    render(<SessionList {...baseProps(entriesOf([makeSession()]))} />);
    const text = openByFocus(screen.getByLabelText('filter sessions')).textContent ?? '';
    expect(text.toLowerCase()).toContain('filter');
  });

  it('gives the settings button a tooltip carrying the chord in force', () => {
    setActiveBindings({ [actionId(SETTINGS)]: ['Q'] });
    render(<SessionList {...baseProps(entriesOf([makeSession()]))} />);
    const text = openByFocus(screen.getByLabelText('settings')).textContent ?? '';
    expect(text).toContain('Settings');
    expect(text).toContain('Q');
  });
});

describe('wrapping a button changes no DOM the panels around it depend on', () => {
  it('adds no element: the trigger stays its parent’s own child, classes intact', () => {
    render(
      <div data-row="row" className="group/row">
        <ShortcutTip label="Close this session" action={{ kind: 'close' }}>
          <button type="button" className="opacity-0 group-hover/row:opacity-100">
            ×
          </button>
        </ShortcutTip>
      </div>,
    );
    const button = screen.getByRole('button');
    // A wrapper span here would break every `group-hover/row:` reveal and any
    // rule matching a row's direct children — the shape, not a count.
    expect(button.parentElement?.getAttribute('data-row')).toBe('row');
    expect(button.className).toBe('opacity-0 group-hover/row:opacity-100');
    expect(button.tagName).toBe('BUTTON');
  });
});

/**
 * The two surfaces have different room, and the difference is the bug this
 * pins: `newSession` holds two chords out of the box, and the footer chip that
 * used to read `o` would read `o or Mod-n` if it printed what a tooltip does.
 */
describe('an inline chip names one chord; a tooltip names them all', () => {
  it('gives the sidebar footer one chord and its tooltip both', () => {
    const both = bindingChords(NO_BINDINGS, actionId(NEW_SESSION));
    expect(both.length, 'newSession must hold two chords for this to test anything').toBe(2);
    render(<SessionList {...baseProps(entriesOf([makeSession()]))} />);
    const button = screen.getByLabelText('new session');
    expect(button.textContent).toBe(`New session${both[0]}`);
    expect(openByFocus(button).textContent).toContain(both.join(' or '));
  });

  it('primaryChord takes the first chord, and nothing when the action is unbound', () => {
    expect(primaryChord(NEW_SESSION, NO_BINDINGS)).toBe(
      bindingChords(NO_BINDINGS, actionId(NEW_SESSION))[0],
    );
    expect(primaryChord(NEW_SESSION, { [actionId(NEW_SESSION)]: [] })).toBeNull();
  });
});

/**
 * The status bar's `?` was the third literal of the class this feature exists
 * to remove — and the most prominent hint in the chrome.
 */
describe('the status bar prints the key that opens the sheet, not a default', () => {
  it('follows a rebind of help, and prints nothing when help is unbound', () => {
    // Through STORED prefs, not `setActiveBindings`: mounting the canvas
    // activates the operator's prefs, which would overwrite a direct call —
    // so a test that took the short path would be testing a state the app
    // cannot be in.
    seedBinding(['F1']);
    render(<Canvas model={DEMO_MODEL} />);
    expect(document.querySelector('[data-keysheet-hint]')?.textContent).toBe('F1');
    cleanup();
    seedBinding([]);
    render(<Canvas model={DEMO_MODEL} />);
    expect(document.querySelector('[data-keysheet-hint]')).toBeNull();
    // The caption stays: it is what makes the sheet discoverable at all.
    expect(document.body.textContent).toContain('Keyboard shortcut');
  });
});

/**
 * Audit item 2 (S2). The chip's separation from the label is purely visual — a
 * gap and a border — and the tip content is the target of `aria-describedby`,
 * so a screen reader flattens the two into one string. Measured live, the
 * Settings tip announced as `"Settings,"`: a label with a comma stuck to it,
 * where the comma is the whole shortcut. `"Search sessions/"`, `"Filter
 * sessionsF"` and `"Close this sessionx or Mod-w"` were the same defect.
 *
 * The border cannot be read, so the word has to be said.
 */
describe('the chord is announced as a shortcut, not as punctuation', () => {
  it('names it in text for a screen reader and hides the visual chip', () => {
    renderTip();
    const tip = openByFocus();
    const keys = bindingChords(NO_BINDINGS, actionId(SETTINGS)).join(' or ');
    expect(keys).not.toBe('');
    // The visual chip is decoration once the text alternative exists; left
    // readable it would say the chord twice.
    const chip = tip.querySelector('[data-tip-keys]');
    expect(chip?.getAttribute('aria-hidden')).toBe('true');
    // What a screen reader actually flattens to.
    expect(tip.textContent ?? '').toContain(`shortcut: ${keys}`);
    // The defect itself: the label must no longer be welded to a bare chord.
    expect(tip.textContent ?? '').not.toBe(`Settings${keys}`);
  });

  it('says it for a mode-qualified action too, where each row carries its own chip', () => {
    render(
      <ShortcutTip label="Move left" action={MOVE_LEFT}>
        <button type="button">M</button>
      </ShortcutTip>,
    );
    const tip = openByFocus();
    const keys = bindingChords(NO_BINDINGS, actionId(MOVE_LEFT)).join(' or ');
    for (const chip of tip.querySelectorAll('[data-tip-keys]')) {
      expect(chip.getAttribute('aria-hidden')).toBe('true');
    }
    expect(tip.textContent ?? '').toContain(`shortcut: ${keys}`);
  });
});

/**
 * The four view icons — the operator's own request ("add tooltips for the 4
 * functions in the tab, with the shortcut key"), and the reason
 * `Alt+<digit>` had to become a real binding first.
 *
 * These icons carried their chord as a LITERAL in two places at once, an
 * `aria-label` and a byte-identical `title`: `Response view — Alt+1`. A
 * tooltip built on that literal would be the third copy of a string nothing
 * keeps true — and `pickView` is rebindable now, so "nothing keeps it true"
 * stopped being hypothetical. Everything below asks the binding table what is
 * in force; not one assertion spells a shipped chord of its own.
 */
describe('the view icons derive their shortcut, and do not repeat it in their name', () => {
  const icon = (view: string) =>
    document.querySelector<HTMLButtonElement>(`[data-view="${view}"]`) as HTMLButtonElement;

  it('names the view and prints the chord the table holds for its digit', () => {
    render(<Canvas model={DEMO_MODEL} />);
    const action: KeyAction = { kind: 'pickView', digit: 2 };
    const keys = bindingChords(NO_BINDINGS, actionId(action));
    expect(keys, 'the fixture must have the digit bound, or this asserts nothing').not.toEqual([]);
    const text = openByFocus(icon('prs')).textContent ?? '';
    expect(text).toContain('PRs view');
    expect(text).toContain(keys.join(' or '));
  });

  it('follows the operator to a rebound key rather than to the shipped one', () => {
    // Through STORED prefs, the operator's own route: the canvas activates
    // them on mount, so a direct `setActiveBindings` would be overwritten.
    localStorage.setItem('vam.prefs.v1', JSON.stringify({ keyBindings: { 'pickView:2': ['F2'] } }));
    render(<Canvas model={DEMO_MODEL} />);
    const text = openByFocus(icon('prs')).textContent ?? '';
    expect(text).toContain('F2');
    // And the shipped chord is not ALSO printed — the tip reads what is in
    // force, it does not accumulate.
    expect(text).not.toContain('Alt-2');
  });

  it('prints no shortcut at all for a view the operator unbound', () => {
    localStorage.setItem('vam.prefs.v1', JSON.stringify({ keyBindings: { 'pickView:2': [] } }));
    render(<Canvas model={DEMO_MODEL} />);
    const tip = openByFocus(icon('prs'));
    expect(tip.textContent?.trim()).toBe('PRs view');
    // Not an empty bracket, not the word "unbound": no chip element at all.
    expect(tip.querySelector('[data-tip-keys]')).toBeNull();
  });

  it('carries no `title`, so the tooltip is the only hover surface', () => {
    render(<Canvas model={DEMO_MODEL} />);
    for (const button of document.querySelectorAll('[data-view]')) {
      expect(button.getAttribute('title'), `${button.getAttribute('data-view')}`).toBeNull();
    }
  });
});
