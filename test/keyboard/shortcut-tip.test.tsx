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
