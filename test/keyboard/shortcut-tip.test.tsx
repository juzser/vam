// @vitest-environment happy-dom

/**
 * The property that decides whether a shortcut hint is worth shipping: the
 * keys a tooltip prints are READ from the binding table, never written beside
 * the button. vam lets the operator rebind, so a hard-coded hint becomes a lie
 * the first time they do — and a lie on a hint surface sends them to press a
 * key that does something else.
 *
 * So the assertions below never spell a chord of their own. They ask
 * `bindingChords` what is in force and require the tooltip to agree, and the
 * rebinding test moves an action's keys and requires the hint to move with it.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  actionId,
  bindingChords,
  type KeyAction,
  NO_BINDINGS,
  setActiveBindings,
} from '../../src/renderer/keyboard/chords.js';
import { MODE_TITLES } from '../../src/renderer/keyboard/keysheet.js';
import { ShortcutTip, shortcutLines } from '../../src/renderer/keyboard/ShortcutTip.js';

afterEach(() => {
  cleanup();
  setActiveBindings(NO_BINDINGS);
});

const SETTINGS: KeyAction = { kind: 'settings' };
/** `move` is one of the two mode-dependent families — see `ACTION_LABELS`. */
const MOVE_LEFT: KeyAction = { kind: 'move', direction: 'left' };

function renderTip(props: Partial<Parameters<typeof ShortcutTip>[0]> = {}) {
  return render(
    <ShortcutTip label="Settings" action={SETTINGS} {...props}>
      <button type="button">S</button>
    </ShortcutTip>,
  );
}

/** Focus is the keyboard's hover, and Radix opens on it without a timer. */
function openByFocus() {
  fireEvent.focus(screen.getByRole('button'));
  return screen.getByRole('tooltip');
}

describe('a tooltip states the label and the shortcut in force', () => {
  it('renders the button label', () => {
    renderTip();
    expect(openByFocus().textContent).toContain('Settings');
  });

  it('renders the chords the binding table holds for the action, not a written-down key', () => {
    renderTip();
    const keys = bindingChords(NO_BINDINGS, actionId(SETTINGS));
    expect(keys.length).toBeGreaterThan(0);
    const text = openByFocus().textContent ?? '';
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

  it('shows the label alone for an unbound action — no empty bracket, no placeholder', () => {
    setActiveBindings({ [actionId(SETTINGS)]: [] });
    renderTip();
    const tip = openByFocus();
    expect(tip.textContent?.trim()).toBe('Settings');
    expect(tip.querySelector('[data-tip-keys]')).toBeNull();
  });

  it('shows the label alone when the button drives no bound action at all', () => {
    render(
      <ShortcutTip label="fit view">
        <button type="button">F</button>
      </ShortcutTip>,
    );
    expect(openByFocus().textContent?.trim()).toBe('fit view');
  });

  it('ties the tooltip to its button with aria-describedby', () => {
    renderTip();
    const tip = openByFocus();
    expect(screen.getByRole('button').getAttribute('aria-describedby')).toBe(tip.id);
  });

  it('opens on keyboard focus, not on hover alone, and closes on blur', () => {
    renderTip();
    expect(screen.queryByRole('tooltip')).toBeNull();
    const button = screen.getByRole('button');
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip')).not.toBeNull();
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
  });
});

describe('shortcutLines: the pure reading of the table', () => {
  it('is empty for an action with no chords, so a caller renders label-only', () => {
    expect(shortcutLines(SETTINGS, undefined, { [actionId(SETTINGS)]: [] })).toEqual([]);
    expect(shortcutLines(undefined, undefined, NO_BINDINGS)).toEqual([]);
  });

  it('joins every chord an action holds, in table order', () => {
    const id = actionId(SETTINGS);
    const lines = shortcutLines(SETTINGS, undefined, { [id]: ['Q', 'gq'] });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.keys).toBe('Q or gq');
    expect(lines[0]?.caption).toBeNull();
  });

  it('yields one line per cursor mode for a mode-dependent action', () => {
    const lines = shortcutLines(MOVE_LEFT, undefined, NO_BINDINGS);
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((line) => line.caption)).size).toBe(2);
  });
});
