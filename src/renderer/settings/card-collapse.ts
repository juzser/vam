/**
 * Persisted open/closed state for the settings overlay's own "Advanced"
 * disclosures -- one per section that has one.
 *
 * KEPT DIRECTLY IN `localStorage`, wrapped in that one fail-open policy
 * `prefs/local-storage.ts` exists to share -- the same trade-off
 * `worktree-tree-collapse.ts` already makes for its own per-project fold:
 * this is chrome about the DIALOG, not a setting `o` or a session ever
 * reads, so it does not belong in the big `Prefs` blob `prefs.ts` owns
 * either. Storing only the sections an operator actually opened is what
 * keeps an untouched install writing nothing at all.
 *
 * THE CARD-LEVEL FOLD THIS FILE USED TO ALSO KEEP (`isCardCollapsed` /
 * `setCardCollapsed`) IS GONE, not renamed -- see this file's own test for
 * the restructure that retired it. `last-section.ts` is what replaced its
 * whole reason to exist.
 */

import { readItem, writeItem } from '../prefs/local-storage.js';
import type { SectionId } from './sections.js';

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

/** Has this section's "Advanced" disclosure been opened? Absent is "no": it
 *  starts closed. */
export function isAdvancedOpen(id: SectionId): boolean {
  return readMap(ADVANCED_KEY)[id] === true;
}

/** Open or close one section's own "Advanced" disclosure. */
export function setAdvancedOpen(id: SectionId, open: boolean): void {
  writeEntry(ADVANCED_KEY, id, open);
}
