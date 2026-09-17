// @vitest-environment happy-dom

/**
 * THE SWITCHES FOR WHAT A SESSION TAB DRAWS, at the surface the operator
 * touches.
 *
 * One row per indicator, in the order `TAB_INDICATOR_IDS` lists them, each a
 * `Switch` with a caption saying what the mark means; and a reset that puts
 * the five defaults back. What is pinned here is the wiring -- that a click
 * writes exactly one field, that the rows are the vocabulary and not a second
 * list of it, that idle has no row -- and the words, because the caption is
 * the only place an operator learns what a pencil on a tab means. What the
 * rows PAINT is `e2e/settings-chrome-shots.mjs`'s business.
 *
 * IN APPEARANCE, NOT SESSIONS, by the rule the two sections already state
 * about themselves: `focus view` is under Appearance because "this is not
 * behaviour, it is how densely the transcript is drawn ... Nothing it changes
 * reaches a session", and `send key` is under Sessions because it "decides
 * WHEN A PROMPT LEAVES FOR ONE". A mark on a tab reaches nothing; it is paint.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import {
  DEFAULT_TAB_INDICATORS,
  TAB_INDICATOR_IDS,
  type TabIndicatorId,
} from '../../src/renderer/prefs/tab-indicators.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';

afterEach(cleanup);

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  render(<SettingsOverlay prefs={prefs} theme="dark" onChange={onChange} onClose={() => {}} />);
  return { onChange };
}

const switchFor = (id: TabIndicatorId) =>
  document.querySelector<HTMLButtonElement>(`[data-switch="tab-${id}"]`);
const block = () => document.querySelector('[data-tab-indicators]');
const reset = () => document.querySelector<HTMLButtonElement>('[data-tab-indicators-reset] button');

function changed(onChange: { mock: { calls: unknown[][] } }, index = 0): Prefs {
  const call = onChange.mock.calls[index];
  expect(call, `onChange was not called ${index + 1} time(s)`).toBeDefined();
  return (call ?? [])[0] as Prefs;
}

describe('the session tabs block', () => {
  it('lives in Appearance, where the paint settings are', () => {
    open();
    expect(block()?.closest('[data-settings-panel]')?.getAttribute('data-settings-panel')).toBe(
      'appearance',
    );
  });

  it('draws one switch per indicator, in the vocabulary’s own order, and none for idle', () => {
    open();
    const drawn = [...document.querySelectorAll('[data-tab-indicators] [data-switch]')].map((el) =>
      (el.getAttribute('data-switch') ?? '').replace(/^tab-/, ''),
    );
    expect(drawn).toEqual([...TAB_INDICATOR_IDS]);
    expect(document.querySelector('[data-switch="tab-idle"]')).toBeNull();
  });

  it('shows each switch thrown the way the store says', () => {
    open();
    for (const id of TAB_INDICATOR_IDS) {
      expect(switchFor(id)?.getAttribute('role'), id).toBe('switch');
      expect(switchFor(id)?.getAttribute('aria-checked'), id).toBe(
        DEFAULT_TAB_INDICATORS.includes(id) ? 'true' : 'false',
      );
    }
    cleanup();
    open({ ...EMPTY_PREFS, tabIndicators: ['done', 'agents'] });
    expect(switchFor('done')?.getAttribute('aria-checked')).toBe('true');
    expect(switchFor('agents')?.getAttribute('aria-checked')).toBe('true');
    expect(switchFor('running')?.getAttribute('aria-checked')).toBe('false');
  });

  it('names each switch for what it controls, never for its state', () => {
    // The same name whichever way the switch is thrown -- a name that flipped
    // with the value would make it a different control on every press.
    const names = (prefs: Prefs) => {
      open(prefs);
      const read = TAB_INDICATOR_IDS.map((id) => switchFor(id)?.getAttribute('aria-label') ?? '');
      cleanup();
      return read;
    };
    const allOn = names({ ...EMPTY_PREFS, tabIndicators: [...TAB_INDICATOR_IDS] });
    const allOff = names({ ...EMPTY_PREFS, tabIndicators: [] });
    expect(allOn).toEqual(allOff);
    expect(new Set(allOn).size).toBe(TAB_INDICATOR_IDS.length);
    for (const name of allOn) expect(name).not.toBe('');
  });

  it('says on each row what the mark means, in words a first-time reader needs', () => {
    // The caption is the whole documentation of a glyph. Three of them are
    // not guessable from a name: `draft` is about text you have NOT sent,
    // `pending` is about a prompt the transcript has NOT recorded yet, and
    // `agents` is a count.
    open();
    const text = block()?.textContent?.toLowerCase() ?? '';
    expect(text).toContain('unsent');
    expect(text).toContain('not yet');
    expect(text).toContain('sub-agents');
    // And the hint over the list says the one thing that is not a switch:
    // an idle tab shows only its title.
    const panel = document.querySelector('[data-settings-panel="appearance"]');
    expect(panel?.textContent?.toLowerCase()).toContain('idle shows only its title');
  });

  it('writes one indicator on a click, disturbing no neighbour', () => {
    const { onChange } = open({ ...EMPTY_PREFS, theme: 'light', outFontSize: 15 });
    fireEvent.click(switchFor('done') as HTMLElement);
    const next = changed(onChange, 0);
    expect(next.tabIndicators).toEqual([
      ...DEFAULT_TAB_INDICATORS.slice(0, 3),
      'done',
      'icon',
      'draft',
    ]);
    expect(next.theme).toBe('light');
    expect(next.outFontSize).toBe(15);
  });

  it('writes it back off', () => {
    const { onChange } = open();
    fireEvent.click(switchFor('running') as HTMLElement);
    expect(changed(onChange, 0).tabIndicators).toEqual(['waiting', 'failed', 'icon', 'draft']);
  });

  it('offers a reset only once something differs from the defaults, and it restores them', () => {
    // The colours and the shortcuts already do this: a reset that can never
    // do anything is a button that lies about having a job.
    open();
    expect(reset()).toBeNull();
    cleanup();

    const { onChange } = open({ ...EMPTY_PREFS, tabIndicators: [] });
    expect(reset()).not.toBeNull();
    fireEvent.click(reset() as HTMLElement);
    expect(changed(onChange, 0).tabIndicators).toEqual(DEFAULT_TAB_INDICATORS);
  });
});
