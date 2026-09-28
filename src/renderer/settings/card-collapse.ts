/**
 * Persisted open/closed state for the settings overlay's own cards.
 *
 * The Orca-style restructure (epic: "settings cards") turned each section
 * into a collapsible CARD, and gave some of them an "Advanced" disclosure at
 * the bottom for their rarely-touched rows. Both states are worth
 * remembering across a relaunch -- an operator who folds Terminal shut
 * because they never touch it should not have to fold it shut again next
 * time -- and neither belongs in the big `Prefs` blob `prefs.ts` owns: this
 * is chrome about the DIALOG, not a setting `o` or a session ever reads,
 * which is exactly the trade-off `prefs/local-storage.ts` exists to share.
 * Direct `localStorage`, wrapped in that one fail-open policy, rather than
 * growing `Prefs` with a field nothing outside this overlay would ever read.
 *
 * TWO MAPS, NOT ONE, because the two states are independent: collapsing a
 * card says nothing about whether its Advanced disclosure (if it has one) was
 * left open, and the reverse. Keeping them apart also keeps a section that
 * gains an Advanced disclosure later from disturbing the fold state of
 * sections that already shipped one.
 *
 * ABSENT MEANS THE DEFAULT, IN BOTH MAPS, and the two defaults point opposite
 * ways on purpose: a card starts OPEN -- an operator who has never touched
 * this dialog sees every row, exactly as the un-carded overlay showed them --
 * and Advanced starts CLOSED, because the rows behind it are the ones rarely
 * touched. Storing only the state that differs from the default is what
 * keeps an untouched install writing nothing at all, the same rule
 * `Prefs.collapsedProjects`' own list-membership follows.
 */

import { readItem, writeItem } from '../prefs/local-storage.js';
import type { SectionId } from './sections.js';

const CARD_KEY = 'vam.settings.cardCollapsed';
const ADVANCED_KEY = 'vam.settings.advancedOpen';

function readMap(key: string): Partial<Record<SectionId, boolean>> {
  return readItem(key, {}, (raw) => {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Partial<Record<SectionId, boolean>> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') out[id as SectionId] = value;
    }
    return out;
  });
}

function writeEntry(key: string, id: SectionId, value: boolean): void {
  const map = readMap(key);
  if (value) {
    map[id] = true;
  } else {
    delete map[id];
  }
  writeItem(key, JSON.stringify(map));
}

/** Has this section's own card been folded shut? Absent is "no": a card
 *  starts open, the same picture the un-carded overlay always drew. */
export function isCardCollapsed(id: SectionId): boolean {
  return readMap(CARD_KEY)[id] === true;
}

/** Fold or unfold one section's own card. */
export function setCardCollapsed(id: SectionId, collapsed: boolean): void {
  writeEntry(CARD_KEY, id, collapsed);
}

/** Has this section's "Advanced" disclosure been opened? Absent is "no": it
 *  starts closed, the opposite default from the card itself. */
export function isAdvancedOpen(id: SectionId): boolean {
  return readMap(ADVANCED_KEY)[id] === true;
}

/** Open or close one section's own "Advanced" disclosure. */
export function setAdvancedOpen(id: SectionId, open: boolean): void {
  writeEntry(ADVANCED_KEY, id, open);
}
