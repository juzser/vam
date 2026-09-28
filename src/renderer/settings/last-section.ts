/**
 * Which section Settings reopens on -- the settings-views restructure
 * (item C): "Settings reopens on the last viewed section (prefs or
 * localStorage in try/catch), falling back to the first."
 *
 * `card-collapse.ts`'s OWN SHAPE, reused rather than reinvented: direct
 * `localStorage`, wrapped in try/catch on every read and write, chrome about
 * the DIALOG rather than a setting `o` or a session ever reads, so it does
 * not belong in the big `Prefs` blob either.
 *
 * ONE SCALAR, NOT A MAP -- unlike `card-collapse.ts`'s per-section maps,
 * there is exactly one "last section", because only one card is ever on
 * screen at a time now (the single-view restructure, item C). `SectionId`
 * itself validates the read: a value this build no longer recognises (an
 * old install's stored id for a section since renamed or retired) reads back
 * as `null`, the same "absent" a first launch sees, rather than a caller
 * having to re-check membership itself.
 */

import { SECTIONS, type SectionId } from './sections.js';

const KEY = 'vam.settings.lastSection';

const KNOWN_IDS: ReadonlySet<string> = new Set(SECTIONS.map((section) => section.id));

function isSectionId(value: unknown): value is SectionId {
  return typeof value === 'string' && KNOWN_IDS.has(value);
}

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Access ITSELF throws in some privacy modes, before any method runs --
    // `foreign-hidden-note.ts`'s own reason, `card-collapse.ts`'s own guard.
    return null;
  }
}

/** The last section the operator actually looked at, or `null` for "never
 *  opened this build has recorded" -- a first launch, a cleared profile, or
 *  a stored id this build no longer knows. */
export function readLastSection(): SectionId | null {
  try {
    const raw = store()?.getItem(KEY) ?? null;
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSectionId(parsed) ? parsed : null;
  } catch {
    // Corrupt JSON, or a `getItem` that throws -- reads back as "never
    // opened", the same fail-open direction `card-collapse.ts` takes.
    return null;
  }
}

/** Remember the section the operator just navigated to. */
export function writeLastSection(id: SectionId): void {
  try {
    store()?.setItem(KEY, JSON.stringify(id));
  } catch {
    // Same shape as `card-collapse.ts`: a viewer who cannot persist this is
    // asked again next launch, which is not a broken dialog.
  }
}
