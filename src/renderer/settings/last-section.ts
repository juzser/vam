/**
 * Which section Settings reopens on -- the settings-views restructure
 * (item C): "Settings reopens on the last viewed section (prefs or
 * localStorage in try/catch), falling back to the first."
 *
 * Direct `localStorage`, wrapped in that one fail-open policy
 * `prefs/local-storage.ts` exists to share -- `card-collapse.ts`'s own
 * shape, reused rather than reinvented: chrome about the DIALOG rather than
 * a setting `o` or a session ever reads, so it does not belong in the big
 * `Prefs` blob either.
 *
 * ONE SCALAR, NOT A MAP -- unlike `card-collapse.ts`'s per-section maps,
 * there is exactly one "last section", because only one card is ever on
 * screen at a time now (the single-view restructure, item C). `SectionId`
 * itself validates the read: a value this build no longer recognises (an
 * old install's stored id for a section since renamed or retired) reads back
 * as `null`, the same "absent" a first launch sees, rather than a caller
 * having to re-check membership itself.
 */

import { readItem, writeItem } from '../prefs/local-storage.js';
import { SECTIONS, type SectionId } from './sections.js';

const KEY = 'vam.settings.lastSection';

const KNOWN_IDS: ReadonlySet<string> = new Set(SECTIONS.map((section) => section.id));

function isSectionId(value: unknown): value is SectionId {
  return typeof value === 'string' && KNOWN_IDS.has(value);
}

/** The last section the operator actually looked at, or `null` for "never
 *  opened this build has recorded" -- a first launch, a cleared profile, or
 *  a stored id this build no longer knows. */
export function readLastSection(): SectionId | null {
  return readItem(KEY, null, (raw) => {
    const parsed: unknown = JSON.parse(raw);
    return isSectionId(parsed) ? parsed : null;
  });
}

/** Remember the section the operator just navigated to. */
export function writeLastSection(id: SectionId): void {
  writeItem(KEY, JSON.stringify(id));
}
