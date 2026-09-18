// @vitest-environment happy-dom

/**
 * AUDIT F3 — RESETTING ONE BINDING COULD HAND ITS KEY TO ANOTHER ACTION.
 *
 * The whole sequence is the ordinary editor, no hand-edited file:
 *
 *   1. move `rename` off `r` onto a free key
 *   2. bind `icon` to the now-free `r`
 *   3. reset `rename`
 *
 * Step 3 deleted the override with no check at all, so `rename` returned to
 * its default `r` — which `icon` now held. `buildTables` gives the override
 * precedence, so `r` invoked `icon` while the editor and the sheet went on
 * printing `r` for `rename`. Two things made it worse than an ordinary
 * conflict: the CAPTURE path checks and the RESET path did not, so the editor
 * taught the operator it protects them and then stopped; and nothing on
 * screen said the advertised key was dead.
 *
 * WHAT IS ASSERTED HERE IS BEHAVIOUR, not the map read back. A test that
 * typed a binding in and found it in `prefs.keyBindings` cannot fail — the
 * defect produces exactly that. So every case below asks what the OPERATOR
 * gets: whether the write happened at all, and what the surface says about it.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBindingSheet } from '../../src/renderer/keyboard/keysheet.js';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';

afterEach(cleanup);

/** After steps 1 and 2: `rename` on `b`, `icon` on the freed `r`. */
const AFTER_TWO_STEPS: Prefs = {
  ...EMPTY_PREFS,
  keyBindings: { rename: ['b'], icon: ['r'] },
};

/** What step 3 used to produce, and what an upgrade can still produce: `icon`
 *  holds `r`, `rename` is back on its shipped `r` and dead. */
const CONTESTED: Prefs = { ...EMPTY_PREFS, keyBindings: { icon: ['r'] } };

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  render(<SettingsOverlay prefs={prefs} theme="dark" onChange={onChange} onClose={vi.fn()} />);
  return { onChange };
}

const labelOf = (id: string, prefs: Prefs) =>
  buildBindingSheet(prefs.keyBindings)
    .flatMap((group) => group.rows)
    .find((row) => row.id === id)?.label ?? '';

const reset = (id: string) =>
  document.querySelector<HTMLElement>(`[data-binding-reset="${id}"]`) as HTMLElement;
const slot = (id: string, index: number) =>
  document.querySelector<HTMLElement>(`[data-binding-slot="${id}:${index}"]`) as HTMLElement;
/** The prefs one `onChange` call carried, asserted to exist rather than
 *  optionally chained away — a missing call is the failure, so say so. */
function changed(onChange: { mock: { calls: unknown[][] } }): Prefs {
  const call = onChange.mock.calls[0];
  expect(call, 'onChange was not called').toBeDefined();
  return (call ?? [])[0] as Prefs;
}

const message = () => document.querySelector('[data-binding-message]')?.textContent ?? '';
const clashNote = () => document.querySelector('[data-binding-clash]')?.textContent ?? '';

describe('the reset that could steal a key', () => {
  it('refuses it, and names the action that owns the key now', () => {
    const { onChange } = open(AFTER_TWO_STEPS);
    fireEvent.click(reset('rename'));
    // Refused: nothing was written, so `r` still reaches `icon` and `rename`
    // still answers the key the operator moved it to.
    expect(onChange).not.toHaveBeenCalled();
    expect(message()).toContain('"r"');
    expect(message()).toContain(labelOf('icon', AFTER_TWO_STEPS));
  });

  it('leaves the operator a way through rather than a wall', () => {
    // A refusal that does not say what to do next is a dead end. Both exits
    // are named: move the other action, or restore every shipped key.
    open(AFTER_TWO_STEPS);
    fireEvent.click(reset('rename'));
    expect(message()).toContain('reset shortcuts');
  });

  it('still shows the binding it refused to change', () => {
    open(AFTER_TWO_STEPS);
    fireEvent.click(reset('rename'));
    expect(slot('rename', 0).textContent).toContain('b');
  });

  it('performs a reset that takes nobody’s key', () => {
    // The refusal is not a blanket one: the ordinary reset is the whole point
    // of the control and must survive its new check.
    const prefs: Prefs = { ...EMPTY_PREFS, keyBindings: { rename: ['b'], icon: ['q'] } };
    const { onChange } = open(prefs);
    fireEvent.click(reset('rename'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(changed(onChange).keyBindings).toEqual({ icon: ['q'] });
    expect(message()).toBe('');
  });

  it('lets "reset shortcuts" out of a map that is already contested', () => {
    // The escape hatch, and the reason it can be one: the shipped grammar
    // contests nothing, so restoring all of it can never mint a clash.
    const { onChange } = open(CONTESTED);
    fireEvent.click(screen.getByRole('tab', { name: 'Keyboard' }));
    fireEvent.click(screen.getByRole('button', { name: 'reset shortcuts' }));
    expect(changed(onChange).keyBindings).toEqual({});
  });
});

describe('a dead binding is shown, not hidden', () => {
  it('says on the row that its key reaches something else', () => {
    open(CONTESTED);
    const dead = slot('rename', 0);
    expect(dead.textContent).toContain('r');
    // The accessible name carries it too: a strikethrough is invisible to a
    // screen reader, and this row's whole problem is that it looks fine.
    expect(dead.getAttribute('aria-label')).toContain(labelOf('icon', CONTESTED));
  });

  it('names the contested key once for the whole section', () => {
    open(CONTESTED);
    expect(clashNote()).toContain('"r"');
    expect(clashNote()).toContain(labelOf('icon', CONTESTED));
    expect(clashNote()).toContain(labelOf('rename', CONTESTED));
  });

  it('says nothing of the sort when no key is contested', () => {
    open({ ...EMPTY_PREFS, keyBindings: { rename: ['b'] } });
    expect(clashNote()).toBe('');
    expect(slot('rename', 0).getAttribute('aria-label')).not.toContain('dead');
    expect(slot('icon', 0).getAttribute('aria-label')).not.toContain('dead');
  });
});
