// @vitest-environment happy-dom

/**
 * `?` over a map where two actions claim one key.
 *
 * Audit F3's visible half. The sheet's contract is that it names no key
 * nothing is bound to; a key TWO actions claim is the neighbouring lie —
 * bound, but not to the action the row names. The sheet printed `r` twice,
 * under two different captions, with nothing saying which one the keystroke
 * reaches.
 *
 * Asserted as what the operator can READ, not as a class name: the correction
 * is words in the row, so this is evidence rather than a scan for a rule
 * somebody typed. The state is reachable without hand-editing anything — an
 * upgrade that moves a shipped key onto a stored override mints it — so it is
 * seeded here the way it arrives: through the binding map.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bindKey,
  clearBindings,
  NO_BINDINGS,
  setActiveBindings,
} from '../../src/renderer/keyboard/chords.js';
import { buildBindingSheet } from '../../src/renderer/keyboard/keysheet.js';
import { KeySheet } from '../../src/renderer/panels/KeySheet.js';

/** F3's three editor steps, as the map they leave behind. */
const CONTESTED = clearBindings(
  bindKey(bindKey(NO_BINDINGS, 'rename', 0, 'b'), 'icon', 0, 'r'),
  'rename',
);

const labelOf = (id: string) =>
  buildBindingSheet(CONTESTED)
    .flatMap((group) => group.rows)
    .find((row) => row.id === id)?.label ?? '';

afterEach(() => {
  cleanup();
  setActiveBindings(NO_BINDINGS);
});

/** Every rendered row, as `keys` plus everything the row says. */
const rows = () =>
  [...document.querySelectorAll('[data-key-sheet] li')].map((li) => ({
    keys: li.querySelector('[data-key-sheet-keys]')?.textContent ?? '',
    text: li.textContent ?? '',
    dead: li.querySelector('[data-key-sheet-dead]')?.textContent ?? null,
  }));

describe('the sheet over a contested key', () => {
  it('says which action `r` really reaches, on the row that no longer has it', () => {
    setActiveBindings(CONTESTED);
    render(<KeySheet onClose={vi.fn()} />);
    const onR = rows().filter((row) => row.keys === 'r');
    expect(onR.length).toBe(2);

    const shadowed = onR.filter((row) => row.dead !== null);
    expect(shadowed.length, 'exactly one of the two rows is dead').toBe(1);
    // The dead row is the one whose caption is rename's, and it names icon.
    expect(shadowed[0]?.text).toContain(labelOf('rename'));
    expect(shadowed[0]?.dead).toContain(labelOf('icon'));

    const live = onR.find((row) => row.dead === null);
    expect(live?.text).toContain(labelOf('icon'));
  });

  it('marks nothing when no key is contested', () => {
    setActiveBindings(NO_BINDINGS);
    render(<KeySheet onClose={vi.fn()} />);
    expect(rows().length).toBeGreaterThan(30);
    expect(rows().filter((row) => row.dead !== null)).toEqual([]);
  });

  it('gives every row its own React key, contested or not', () => {
    // Two rows on `r` and two rows per mode-dependent key both collide under a
    // key of `row.keys` alone. React answers that on `console.error`, and a
    // list whose keys collide reconciles by position — so this is a real
    // rendering fault, not a lint.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    setActiveBindings(CONTESTED);
    render(<KeySheet onClose={vi.fn()} />);
    const messages = errors.mock.calls.map((call) => String(call[0] ?? ''));
    errors.mockRestore();
    expect(messages.filter((message) => message.includes('same key'))).toEqual([]);
  });
});
