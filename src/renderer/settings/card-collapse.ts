/**
 * Persisted open/closed state for the settings overlay's own "Advanced"
 * disclosures -- one per section that has one.
 *
 * KEPT DIRECTLY IN `localStorage`, wrapped in try/catch, the same trade-off
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

import type { SectionId } from './sections.js';

const ADVANCED_KEY = 'vam.settings.advancedOpen';

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Access ITSELF throws in some privacy modes, before any method runs --
    // `foreign-hidden-note.ts`'s own reason.
    return null;
  }
}

function readMap(key: string): Partial<Record<SectionId, boolean>> {
  try {
    const raw = store()?.getItem(key) ?? null;
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Partial<Record<SectionId, boolean>> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') out[id as SectionId] = value;
    }
    return out;
  } catch {
    // Corrupt JSON, or a `getItem` that throws -- reads back as "nothing
    // touched", the same fail-open direction `foreign-hidden-note.ts` takes.
    return {};
  }
}

function writeEntry(key: string, id: SectionId, value: boolean): void {
  try {
    const map = readMap(key);
    if (value) {
      map[id] = true;
    } else {
      delete map[id];
    }
    store()?.setItem(key, JSON.stringify(map));
  } catch {
    // Same shape as `foreign-hidden-note.ts`: a viewer who cannot persist
    // this is asked again next launch, which is not a broken dialog.
  }
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
