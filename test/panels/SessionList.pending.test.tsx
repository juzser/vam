// @vitest-environment happy-dom

/**
 * A row whose session is being closed.
 *
 * Closing can take the whole stop timeout -- fifteen seconds -- so the row has
 * to say so for that entire time, and say it the moment the click lands rather
 * than when the work finishes. `pendingAction` is the single notion of "this
 * one is busy" and it is set BEFORE the await in the canvas's close path, so
 * the treatment here is a pure function of that prop and these tests can state
 * it directly.
 *
 * The sibling assertion is the one that matters most: a busy treatment that
 * leaks to the rows around it is the obvious way to get this wrong, and it
 * would be invisible in a one-row fixture.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { SessionList } from '../../src/renderer/panels/SessionList.js';
import { baseProps, makeProject, makeSession } from './session-list-props.js';

afterEach(cleanup);

const project = makeProject({ id: 'p1', name: 'alpha' }, []);
const ENTRIES: SessionEntry[] = [
  { project, session: makeSession({ id: 's1', title: 'closing one' }) },
  { project, session: makeSession({ id: 's2', title: 'untouched two' }) },
];

function mount(pendingAction: string | null, onPick = vi.fn()) {
  render(<SessionList {...baseProps(ENTRIES)} pendingAction={pendingAction} onPick={onPick} />);
  return { onPick };
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-session-row="${id}"]`);
const wrapper = (id: string) => document.querySelector<HTMLElement>(`[data-row-pending="${id}"]`);
const indicator = (id: string) =>
  document.querySelector<HTMLElement>(`[data-row-pending="${id}"] [data-row-busy]`);

describe('the sidebar row while its session is closing', () => {
  it('dims the row and says it is busy, in words as well as in paint', () => {
    mount('s1');
    const busy = wrapper('s1');
    expect(busy).not.toBeNull();
    // Dimmed by a rule keyed on this attribute, not by an inline colour, and
    // announced rather than merely greyed.
    expect(busy?.getAttribute('aria-busy')).toBe('true');
    expect(row('s1')?.getAttribute('title')).toContain('closing one');
  });

  it('overlays an indicator that is perceivable without colour', () => {
    mount('s1');
    const mark = indicator('s1');
    expect(mark).not.toBeNull();
    // A word, not only a spinning shape: with motion off the animation stops,
    // and what is left has to still say what is happening.
    expect(mark?.textContent).toContain('Stopping');
  });

  it('refuses the row’s own actions while it is in flight', () => {
    const { onPick } = mount('s1');
    const button = row('s1') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    // Not a tab stop either: a control that cannot act must not collect focus
    // on the way to one that can.
    expect(button.tabIndex).toBe(-1);
    fireEvent.click(button);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('leaves every other row exactly as it was', () => {
    const { onPick } = mount('s1');
    expect(wrapper('s2')).toBeNull();
    expect(indicator('s2')).toBeNull();
    const other = row('s2') as HTMLButtonElement;
    expect(other.disabled).toBe(false);
    fireEvent.click(other);
    expect(onPick).toHaveBeenCalledWith('s2');
  });

  it('returns to normal when the pending action clears', () => {
    const { onPick } = mount(null);
    expect(wrapper('s1')).toBeNull();
    expect(indicator('s1')).toBeNull();
    const button = row('s1') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onPick).toHaveBeenCalledWith('s1');
  });
});

/**
 * The dim and the indicator's reduced-motion answer are stylesheet facts, and
 * the DOM cannot be asked about them here -- so the sheet is, the same way the
 * filter badge's colour is checked in `SessionList.test.tsx`. Without this the
 * row's attribute would be a hook nothing paints.
 */
describe('the treatment the stylesheet carries', () => {
  const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');

  it('dims a pending row, and from opacity rather than a status token', () => {
    const start = CSS.indexOf('[data-row-pending] {');
    expect(start, 'no rule for [data-row-pending]').toBeGreaterThanOrEqual(0);
    const block = CSS.slice(start, CSS.indexOf('\n}', start));
    expect(block).toMatch(/opacity:\s*0?\.\d+/);
    // The four status tokens mean session state; a closing row wearing one
    // would read as a status it does not have.
    for (const token of ['running', 'waiting', 'done', 'failed']) {
      expect(block, token).not.toContain(`--color-${token}`);
    }
  });

  it('stops the indicator’s motion without removing the indicator', () => {
    const start = CSS.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(start).toBeGreaterThanOrEqual(0);
    // The mark parks upright; the word beside it never moved, so what is left
    // is a static indicator rather than none.
    expect(CSS.slice(start)).toContain('.vam-spin');
  });
});
