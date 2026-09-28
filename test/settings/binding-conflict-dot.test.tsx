// @vitest-environment happy-dom

/**
 * THE CONFLICT DOT — a small red marker on EVERY row a chord is contested
 * on, winner included.
 *
 * `binding-conflicts.test.tsx` already covers the standing notice (one
 * sentence for the whole section) and the struck-through, dead SLOT
 * (`row.dead`, which only ever marks the LOSING side). Neither answers the
 * operator's own request: "add an error indicator if a shortcut key is
 * duplicated or conflicts, with a tooltip on that indicator saying where the
 * conflict is" — a mark on the ROW, readable at a glance without reading a
 * strikethrough or scrolling to the sticky banner, and present on the
 * WINNING row too, which `row.dead` structurally cannot mark (its own doc
 * comment: "a row with no binding behind it is the defect this module exists
 * to make impossible" — the winner's binding is very much behind it).
 *
 * Built on `chords.ts`'s `rowConflicts` (pure, unit-tested on its own in
 * `test/keyboard/row-conflicts.test.ts`) and `panels/Note.tsx` (the existing
 * keyboard-focusable, Radix tooltip this codebase already uses for exactly
 * this shape of hint — `shortcut-tip.test.tsx`'s own header: "Focus is the
 * keyboard's hover, and Radix opens on it without a timer").
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBindingSheet } from '../../src/renderer/keyboard/keysheet.js';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';

afterEach(cleanup);

/** `close` holds `r`; `rename`'s shipped `r` is dead behind it — the same
 *  fixture `binding-conflicts.test.tsx` builds its whole suite on. */
const CONTESTED: Prefs = { ...EMPTY_PREFS, keyBindings: { close: ['r'] } };

function open(prefs: Prefs = EMPTY_PREFS) {
  render(
    <SettingsOverlay
      prefs={prefs}
      theme="dark"
      onChange={vi.fn()}
      onClose={vi.fn()}
      initialSection="keyboard"
    />,
  );
}

const labelOf = (id: string, prefs: Prefs) =>
  buildBindingSheet(prefs.keyBindings)
    .flatMap((group) => group.rows)
    .find((row) => row.id === id)?.label ?? '';

const dot = (id: string) => document.querySelector<HTMLElement>(`[data-binding-conflict="${id}"]`);

describe('a contested row carries a conflict dot', () => {
  it('draws no dot at all when nothing is contested', () => {
    open({ ...EMPTY_PREFS, keyBindings: { rename: ['b'] } });
    expect(dot('rename')).toBeNull();
    expect(dot('close')).toBeNull();
  });

  it('draws the dot on the LOSING row, beside the row `row.dead` already struck through', () => {
    open(CONTESTED);
    expect(dot('rename')).not.toBeNull();
  });

  it('ALSO draws it on the WINNING row — the row `row.dead` never marks at all', () => {
    open(CONTESTED);
    expect(dot('close')).not.toBeNull();
  });

  it('draws no dot on a row that holds no contested chord', () => {
    open(CONTESTED);
    expect(dot('newSession')).toBeNull();
  });

  it('is red — the operator’s own word, and this codebase’s own danger token', () => {
    open(CONTESTED);
    // `bg-danger` reads the same fixed hue every destructive control in this
    // app already does (`ConfirmForceClose.tsx`, `ConfirmRemoveProject.tsx`,
    // the PR conflict pill) — reused rather than a fresh literal colour.
    expect(dot('rename')?.className).toContain('bg-danger');
  });
});

describe('the dot is a real, accessible trigger', () => {
  it('is keyboard-focusable on its own — a tooltip nobody can Tab to is not accessible', () => {
    open(CONTESTED);
    const trigger = dot('rename') as HTMLElement;
    // Radix's `asChild` merges onto this exact element (`Note.tsx`'s own
    // doc: "adds NO element"), so the trigger IS the focusable control, not
    // a wrapper around one — a real `<button>` is in the tab order with no
    // `tabIndex` needed, so the assertion is that this is a real control
    // assistive tech can land on, not merely decoration.
    expect(trigger.tagName).toBe('BUTTON');
  });

  it('carries the conflict text as its own aria-label, before any tooltip opens', () => {
    // The operator's own bar: "an aria-label or aria-describedby carrying
    // the same text". Set unconditionally, not only once Radix decides to
    // open a portal, so a screen reader announces it on arrival rather than
    // on a timing Radix owns.
    open(CONTESTED);
    const label = dot('rename')?.getAttribute('aria-label') ?? '';
    expect(label.toLowerCase()).toContain('also bound to');
    expect(label).toContain(labelOf('close', CONTESTED));
  });

  it('opens a tooltip on focus, naming the SAME conflict', () => {
    open(CONTESTED);
    const trigger = dot('rename') as HTMLElement;
    fireEvent.focus(trigger);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent?.toLowerCase()).toContain('also bound to');
    expect(tip.textContent).toContain(labelOf('close', CONTESTED));
  });

  it('names the OTHER side from the winning row’s own dot — not itself', () => {
    open(CONTESTED);
    const label = dot('close')?.getAttribute('aria-label') ?? '';
    expect(label).toContain(labelOf('rename', CONTESTED));
    expect(label).not.toContain(labelOf('close', CONTESTED));
  });

  it('names the chord in the operator’s own symbols, never the stored token', () => {
    const modContested: Prefs = { ...EMPTY_PREFS, keyBindings: { newProject: ['Mod-k'] } };
    open(modContested);
    const label = dot('palette')?.getAttribute('aria-label') ?? '';
    expect(label).not.toContain('Mod-k');
  });
});
