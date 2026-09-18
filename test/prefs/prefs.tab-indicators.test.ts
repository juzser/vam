/**
 * WHAT A SESSION TAB SHOWS BESIDE ITS TITLE: a set of indicator ids, stored,
 * read back defensively, and put into a canonical order.
 *
 * The operator's ask: "if a tab is idle (not running, not waiting for you,
 * ...) there is no need to show the dot on the tab. A tab should only show
 * certain indicators." They chose five to ship on; the other three exist as
 * toggles and ship off. Idle is not on the list at all, and the first test
 * here is that it cannot be put there by any route.
 *
 * The reader is total, like every reader in `prefs/`: a payload an older vam
 * wrote, a hand edit in devtools, a value from a vam that knew a ninth
 * indicator -- none of them may reach the strip as anything but a list of ids
 * this vam draws.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_PREFS,
  readPrefs,
  resetTabIndicators,
  type StorageLike,
  setTabIndicator,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';
import {
  DEFAULT_TAB_INDICATORS,
  isTabIndicatorOn,
  readTabIndicators,
  TAB_INDICATOR_IDS,
} from '../../src/renderer/prefs/tab-indicators.js';

const KEY = 'vam.prefs.v1';

function fake(initial: string | null = null): StorageLike & { value: string | null } {
  return {
    value: initial,
    getItem(key) {
      return key === KEY ? this.value : null;
    },
    setItem(key, value) {
      if (key === KEY) this.value = value;
    },
  };
}

const stored = (payload: object) => readPrefs(fake(JSON.stringify(payload)));

describe('the vocabulary', () => {
  it('is the eight the operator was offered, in the order the dialog lists them', () => {
    // The order is the dialog's order and the strip's precedence: the four
    // STATUS marks first (at most one of which is drawn), then the icon, then
    // the three that ride AFTER the title. A test that retyped the list would
    // be the second list this file exists to forbid, so it is asserted whole.
    expect(TAB_INDICATOR_IDS).toEqual([
      'running',
      'waiting',
      'failed',
      'done',
      'icon',
      'draft',
      'pending',
      'agents',
    ]);
  });

  it('never offers idle -- a quiet tab shows its title and nothing else', () => {
    // The operator's sentence, as a type-level fact: `idle` is a status the
    // model has and is NOT an indicator, so no toggle, no default and no
    // stored payload can make a resting tab draw a mark.
    expect(TAB_INDICATOR_IDS).not.toContain('idle');
    expect(readTabIndicators(['idle', 'running'])).toEqual(['running']);
  });

  it('ships the five the operator chose on, and the other three off', () => {
    expect(DEFAULT_TAB_INDICATORS).toEqual(['running', 'waiting', 'failed', 'icon', 'draft']);
    expect(isTabIndicatorOn(DEFAULT_TAB_INDICATORS, 'done')).toBe(false);
    expect(isTabIndicatorOn(DEFAULT_TAB_INDICATORS, 'pending')).toBe(false);
    expect(isTabIndicatorOn(DEFAULT_TAB_INDICATORS, 'agents')).toBe(false);
  });
});

describe('reading a stored value', () => {
  it('keeps a list of known ids, in canonical order, without duplicates', () => {
    // Stored in whatever order the operator threw the switches, read back in
    // the one order every surface agrees on -- so two payloads that mean the
    // same set compare equal, and the dialog never shows a row twice.
    expect(readTabIndicators(['draft', 'running', 'draft', 'icon'])).toEqual([
      'running',
      'icon',
      'draft',
    ]);
  });

  it('drops an id this vam has no indicator for, and keeps the rest', () => {
    // A vam that knew a ninth indicator, or a hand edit. One unknown word
    // must not cost the operator the seven choices around it.
    expect(readTabIndicators(['running', 'sparkles', 'waiting'])).toEqual(['running', 'waiting']);
    expect(readTabIndicators(['running', 42, null, { id: 'waiting' }])).toEqual(['running']);
  });

  it('reads an empty list as "nothing", which is a choice and not a bad shape', () => {
    // An operator who turned every switch off has an empty list, and it must
    // come back empty rather than as the defaults they just left.
    expect(readTabIndicators([])).toEqual([]);
  });

  it('answers the defaults for anything that is not a list', () => {
    for (const raw of [undefined, null, 'running', 7, true, {}, { running: true }, Number.NaN]) {
      expect(readTabIndicators(raw), String(raw)).toEqual(DEFAULT_TAB_INDICATORS);
    }
  });

  it('never throws, whatever the payload', () => {
    for (const raw of [Symbol('x'), () => 'running', Object.create(null), new Proxy({}, {})]) {
      expect(() => readTabIndicators(raw)).not.toThrow();
    }
  });
});

describe('through the store', () => {
  it('reads the defaults from a payload written before the field existed', () => {
    expect(stored({ theme: 'light' }).tabIndicators).toEqual(DEFAULT_TAB_INDICATORS);
    expect(EMPTY_PREFS.tabIndicators).toEqual(DEFAULT_TAB_INDICATORS);
  });

  it('turns one indicator on and off, disturbing no neighbour', () => {
    const on = setTabIndicator(EMPTY_PREFS, 'done', true);
    expect(on.tabIndicators).toEqual(['running', 'waiting', 'failed', 'done', 'icon', 'draft']);
    const off = setTabIndicator(on, 'running', false);
    expect(off.tabIndicators).toEqual(['waiting', 'failed', 'done', 'icon', 'draft']);
    // Idempotent both ways: a second click on a switch already thrown is
    // the same list, not a duplicate and not a hole.
    expect(setTabIndicator(on, 'done', true).tabIndicators).toEqual(on.tabIndicators);
    expect(setTabIndicator(off, 'running', false).tabIndicators).toEqual(off.tabIndicators);
  });

  it('resets to the defaults from any state, including all-off', () => {
    let prefs = EMPTY_PREFS;
    for (const id of TAB_INDICATOR_IDS) prefs = setTabIndicator(prefs, id, false);
    expect(prefs.tabIndicators).toEqual([]);
    expect(resetTabIndicators(prefs).tabIndicators).toEqual(DEFAULT_TAB_INDICATORS);
  });

  it('survives a round trip through storage as the same list', () => {
    const storage = fake();
    writePrefs(
      storage,
      setTabIndicator(setTabIndicator(EMPTY_PREFS, 'agents', true), 'icon', false),
    );
    expect(readPrefs(storage).tabIndicators).toEqual([
      'running',
      'waiting',
      'failed',
      'draft',
      'agents',
    ]);
  });

  it('normalises a stored value on the way in, not only on the way out', () => {
    // The setter is typed, but the store is not: the same total reader
    // stands behind both, so a hand-edited payload and a switch land in the
    // same shape.
    expect(stored({ tabIndicators: ['idle', 'pending', 'pending'] }).tabIndicators).toEqual([
      'pending',
    ]);
    expect(stored({ tabIndicators: 'all' }).tabIndicators).toEqual(DEFAULT_TAB_INDICATORS);
  });
});
