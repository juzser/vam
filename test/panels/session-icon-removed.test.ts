/**
 * THE SESSION ICON IS GONE, AND THIS IS WHAT KEEPS IT GONE.
 *
 * #433 took the session icon off the tab strip -- the only surface that had
 * ever drawn one, the sidebar row having given its up long before. That left a
 * picker writing into a store nothing read: an operator could still press `s`,
 * choose a glyph and a tone, and watch nothing at all happen. The operator's
 * answer to that, translated: "remove the picker."
 *
 * So this file is an ABSENCE, asserted at every door the feature had. Each
 * check below names a route a person could take to set a session's own icon,
 * and asserts the route is not there: the chord, the key sheet row, the row
 * context menu, the tab indicator id, and the stored key. A deletion sweep
 * with no test is a deletion that comes back the first time someone reads
 * `IconPicker` and thinks "a session should have one of these too".
 *
 * ── THE BOUNDARY, AND WHY IT IS IN THIS FILE ──────────────────────────────
 * PROJECT and GROUP icons are a different feature that happens to share
 * `IconPicker` and `icon-value.tsx` with the one being removed. The last two
 * checks are here, rather than only in the project-icon tests, because THIS is
 * the file a future sweep will read when it wants to know how far the deletion
 * went. A green suite that has simply stopped looking at icons altogether is
 * the failure mode this change has to avoid, and the cheapest guard against it
 * is an assertion that the surviving half still works, sitting in the same
 * file as the assertions that the removed half does not.
 */

import { describe, expect, it } from 'vitest';
import {
  activeBindings,
  EMPTY_CHORD,
  type KeyAction,
  resolveChord,
} from '../../src/renderer/keyboard/chords.js';
import { buildKeySheet } from '../../src/renderer/keyboard/keysheet.js';
import { rowMenuItems } from '../../src/renderer/panels/SessionList.js';
import {
  applyProjectIcons,
  readPrefs,
  type StorageLike,
  setProjectIcon,
} from '../../src/renderer/prefs/prefs.js';
import { TAB_INDICATOR_IDS } from '../../src/renderer/prefs/tab-indicators.js';

const NOW = new Date('2026-09-21T12:00:00.000Z');

function fake(initial: string | null): StorageLike {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

/** Every action the grammar can still produce, as a flat list of kinds. */
function kindsFrom(keys: readonly string[]): string[] {
  let state = EMPTY_CHORD;
  const kinds: string[] = [];
  for (const key of keys) {
    const step = resolveChord(state, key);
    state = step.state;
    if (step.action !== null) {
      kinds.push((step.action as KeyAction).kind);
    }
  }
  return kinds;
}

describe('the session icon has no way in', () => {
  it('`s` is unbound — and the freed key was NOT handed to something else', () => {
    // The operator's rule for a removal: the key goes quiet. Reassigning it
    // would mean an operator's muscle memory silently doing a new thing, which
    // is worse than the dead key it replaced.
    expect(kindsFrom(['s'])).toEqual([]);
  });

  it('no chord anywhere in the grammar resolves to a session-icon action', () => {
    // The sweep, not the sample: `s` is where it was, but a union member that
    // survives can be re-bound from the settings editor and would answer on
    // some other key. Nothing may produce it.
    const everyKey = [
      's',
      'S',
      'i',
      'I',
      'r',
      'x',
      'o',
      'g',
      'z',
      'y',
      'd',
      ',',
      '.',
      'E',
      '?',
      'f',
      'F',
      'G',
      '/',
    ];
    for (const key of everyKey) {
      expect(kindsFrom([key])).not.toContain('icon');
    }
  });

  it('the key sheet lists no row for it — a sheet promising a dead key is worse than the key', () => {
    const rows = buildKeySheet(activeBindings()).flatMap((group) => group.rows);
    expect(rows.some((row) => /icon/i.test(row.label))).toBe(false);
    // And the sheet still has rows at all, so the check above is a filter over
    // a corpus rather than a sweep over nothing.
    expect(rows.length).toBeGreaterThan(20);
  });

  it('the session row context menu offers rename, reopen and close — and no icon', () => {
    const items = rowMenuItems('s-1', {
      closing: false,
      onClose: () => {},
      onRenameSession: () => {},
      canReopen: true,
      ended: true,
    });
    expect(items.map((item) => item.id)).toEqual(['rename', 'reopen', 'close']);
  });

  it('`icon` is not a tab indicator id — the union has no re-enable path left', () => {
    // #433 deliberately kept it in the union as the documented way back. With
    // no picker left, that path leads to a value nothing can set, so the
    // member goes with the feature it described.
    expect(TAB_INDICATOR_IDS).not.toContain('icon');
  });

  it('a stored `icons` key from the old build is ignored, not migrated', () => {
    // The `tabIndicators` precedent: `parsePrefs` no longer looks for the key,
    // and an unknown key in the stored document has always been dropped. An
    // operator who picked icons last week loses nothing they can see, because
    // there was nothing to see.
    const stored = JSON.stringify({
      icons: { factory: { 's-1': { icon: '🦊', at: NOW.toISOString() } } },
      theme: 'light',
    });
    const prefs = readPrefs(fake(stored), NOW) as Record<string, unknown>;
    expect(prefs['icons']).toBeUndefined();
    // Read, not crashed: the rest of the document still parses around it.
    expect(prefs['theme']).toBe('light');
  });
});

describe('the boundary — project icons are a different feature and still work', () => {
  it('a stored project icon still reaches the model', () => {
    const withIcon = setProjectIcon(readPrefs(null, NOW), 'factory', 'p-1', '🏭', NOW);
    const model = {
      projects: [
        {
          id: 'p-1',
          name: 'factory',
          source: 'factory' as const,
          sessions: [],
        },
      ],
    };
    const out = applyProjectIcons(model, withIcon.projectIcons);
    expect(out.projects[0]?.icon).toBe('🏭');
  });

  it('the picker a project heading opens is still there', async () => {
    const mod = await import('../../src/renderer/panels/IconPicker.js');
    expect(typeof mod.IconPicker).toBe('function');
  });
});
