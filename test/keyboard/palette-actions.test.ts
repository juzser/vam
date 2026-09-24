/**
 * The command palette's action half, in isolation — no DOM, no cmdk.
 *
 * `docs/design/canvas-layout.md` §4 gives the palette a second mode: no
 * prefix finds a session, `/` finds an action, VS Code's own split. These
 * tests hold the pure decisions apart from `CommandPalette.tsx` so the mode
 * switch, the filter and the focus gate can each be asserted without
 * mounting a component — the same split `keysheet.ts`'s own
 * `filterSheet`/`buildKeySheet` already draw against `KeySheet.tsx`.
 */

import { describe, expect, it } from 'vitest';
import { type KeyBindings, NO_BINDINGS } from '../../src/renderer/keyboard/chords.js';
import {
  actionQueryText,
  buildPaletteActions,
  filterPaletteActions,
  PALETTE_DISABLED_REASON,
  paletteHint,
  paletteMode,
} from '../../src/renderer/keyboard/palette-actions.js';
import { primaryChord as tooltipPrimaryChord } from '../../src/renderer/keyboard/ShortcutTip.js';

describe('paletteMode', () => {
  it('is sessions with no prefix, including the empty query', () => {
    expect(paletteMode('')).toBe('sessions');
    expect(paletteMode('fix the thing')).toBe('sessions');
  });

  it('is actions the moment the query starts with /', () => {
    expect(paletteMode('/')).toBe('actions');
    expect(paletteMode('/close')).toBe('actions');
  });

  it('returns to sessions the instant the leading / is deleted', () => {
    // The whole switch is a pure function of the query, so "deleting the /"
    // needs no state of its own to test — it is just this same predicate
    // read again against the shorter string.
    expect(paletteMode('/close'.slice(1))).toBe('sessions');
  });
});

describe('actionQueryText', () => {
  it('strips the leading / in action mode', () => {
    expect(actionQueryText('/close session')).toBe('close session');
  });

  it('is the query unchanged in session mode', () => {
    expect(actionQueryText('fix the thing')).toBe('fix the thing');
  });

  it('is the empty string right after typing a bare /', () => {
    expect(actionQueryText('/')).toBe('');
  });
});

describe('paletteHint', () => {
  it('names the way in, in session mode', () => {
    expect(paletteHint('sessions')).toMatch(/\//);
    expect(paletteHint('sessions').length).toBeLessThanOrEqual(60);
  });

  it('names the way back, in action mode', () => {
    expect(paletteHint('actions')).toMatch(/back to sessions/i);
    expect(paletteHint('actions').length).toBeLessThanOrEqual(60);
  });
});

describe('buildPaletteActions', () => {
  it('gives every row a non-empty chord, a non-empty title, and a primary chord drawn from the same list', () => {
    const rows = buildPaletteActions(true);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.chords.length).toBeGreaterThan(0);
      expect(row.title.length).toBeGreaterThan(0);
      expect(row.chords).toContain(row.primaryChord);
      expect(row.primaryChord).toBe(row.chords[0]);
    }
  });

  it('titles are short, Title Case command names — not the key sheet’s sentences', () => {
    // The exact wording the operator asked for, by id — falsifiable one row
    // at a time rather than a shape assertion nothing could fail.
    const byId = new Map(buildPaletteActions(true).map((row) => [row.id, row.title]));
    expect(byId.get('newSession')).toBe('New Session');
    expect(byId.get('newProject')).toBe('New Project…');
    expect(byId.get('close')).toBe('Close Session');
    expect(byId.get('rename')).toBe('Rename Session');
    expect(byId.get('pickView:1')).toBe('View: Response');
    expect(byId.get('pickView:2')).toBe('View: PRs');
    expect(byId.get('pickView:3')).toBe('View: Terminal');
    expect(byId.get('pickView:4')).toBe('View: Agents');
    expect(byId.get('pickView:5')).toBe('View: Files');
    expect(byId.get('splitPane:row')).toBe('Split: Side by Side');
    expect(byId.get('splitPane:column')).toBe('Split: Stacked');
    expect(byId.get('closeSplit')).toBe('Close Split');
    expect(byId.get('search')).toBe('Search Sessions');
    expect(byId.get('filterMenu')).toBe('Filter Sessions…');
    expect(byId.get('settings')).toBe('Settings');
    expect(byId.get('help')).toBe('Keyboard Shortcuts');
    // None of them is the sheet's own sentence -- the defect this table
    // exists to fix, pinned so it cannot come back by a well-meaning
    // "just read describeAction" refactor.
    for (const title of byId.values()) {
      expect(title).not.toMatch(/ — /); // the sheet's own em-dash clause separator
      expect(title.length).toBeLessThanOrEqual(24);
    }
  });

  it('shows the SAME primary chord a tooltip chip would, for every row — the single source of truth the operator asked for', () => {
    for (const row of buildPaletteActions(true)) {
      expect(row.primaryChord).toBe(tooltipPrimaryChord(row.action));
    }
  });

  it('includes the operator-named actions: new session, new project, close, the five views, both splits, search, settings, key sheet', () => {
    const ids = buildPaletteActions(true).map((row) => row.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'newSession',
        'newProject',
        'close',
        'pickView:1',
        'pickView:2',
        'pickView:3',
        'pickView:4',
        'pickView:5',
        'splitPane:row',
        'splitPane:column',
        'search',
        'settings',
        'help',
      ]),
    );
  });

  it('drops a candidate the operator has unbound entirely', () => {
    const overrides: KeyBindings = { ...NO_BINDINGS, close: [] };
    const ids = buildPaletteActions(true, overrides).map((row) => row.id);
    expect(ids).not.toContain('close');
  });

  it('reads a rebind rather than the shipped chord', () => {
    const overrides: KeyBindings = { ...NO_BINDINGS, close: ['Mod-Shift-x'] };
    const row = buildPaletteActions(true, overrides).find((r) => r.id === 'close');
    expect(row?.chords).toEqual(['Mod-Shift-x']);
  });

  it('disables session-scoped actions with no session focused, and says why', () => {
    const rows = buildPaletteActions(false);
    const close = rows.find((r) => r.id === 'close');
    expect(close?.disabled).toBe(true);
    expect(close?.disabledReason).toBe(PALETTE_DISABLED_REASON);
  });

  it('enables the same rows once a session is focused', () => {
    const rows = buildPaletteActions(true);
    const close = rows.find((r) => r.id === 'close');
    expect(close?.disabled).toBe(false);
    expect(close?.disabledReason).toBeNull();
  });

  it('never disables newSession — it falls back to newProject with nothing focused', () => {
    const row = buildPaletteActions(false).find((r) => r.id === 'newSession');
    expect(row?.disabled).toBe(false);
  });

  it('never disables settings, search, help or newProject — none of them touch a session', () => {
    const rows = buildPaletteActions(false);
    for (const id of ['settings', 'search', 'help', 'newProject']) {
      expect(rows.find((r) => r.id === id)?.disabled).toBe(false);
    }
  });
});

describe('filterPaletteActions', () => {
  const rows = buildPaletteActions(true);

  it('returns every row for an empty query', () => {
    expect(filterPaletteActions(rows, '')).toHaveLength(rows.length);
  });

  it('narrows by title', () => {
    // Unlike the sheet's sentence, "Close Split" carries no word "session" at
    // all, so this title alone disambiguates the two close-shaped rows —
    // `mod-w` is no longer needed to isolate `close` from `closeSplit`.
    const hits = filterPaletteActions(rows, 'close session', false);
    expect(hits.map((r) => r.id)).toEqual(['close']);
    expect(hits.every((r) => r.title.toLowerCase().includes('close'))).toBe(true);
  });

  it('requires every term to land', () => {
    // "close" alone matches several rows (Close Session, Close Split); adding
    // a second word that only one of them satisfies must narrow to it.
    const broad = filterPaletteActions(rows, 'close', false);
    const narrow = filterPaletteActions(rows, 'close split', false);
    expect(broad.length).toBeGreaterThan(narrow.length);
    expect(narrow.map((r) => r.id)).toEqual(['closeSplit']);
  });

  it('matches a chord token the way docs/keyboard.md spells it', () => {
    const hits = filterPaletteActions(rows, 'mod-w', false);
    expect(hits.map((r) => r.id)).toContain('close');
  });

  it('matches a painted symbol the operator can see on screen', () => {
    // ⌘ is the Mac spelling `chordSymbols` paints for Mod-, space-separated
    // from the letter (`chordSymbols`'s own mac join). The Mac reading has to
    // be requested explicitly since the module's own default reads this
    // machine, which CI runs as Linux.
    const hits = filterPaletteActions(rows, '⌘ w', true);
    expect(hits.map((r) => r.id)).toContain('close');
  });
});
