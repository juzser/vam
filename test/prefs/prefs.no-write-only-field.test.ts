/**
 * NO STORED PREFERENCE MAY BE INVISIBLE TO THE APP.
 *
 * `dismissedSessions` shipped in PR 248 with a field on `Prefs`, a reader
 * branch, a source-key migration, a TTL exemption, three exported helpers
 * (`isSessionDismissed`, `setSessionDismissed`, `applySessionDismissals`) and
 * a test file of its own — and NOT ONE CALLER anywhere in `src/`. Nothing in
 * the sidebar ever dismissed a row, and no model was ever filtered by it. It
 * was born dead and stayed dead for fifty-odd commits, entirely green the
 * whole way, because a helper with a test looks exactly like a helper with a
 * user.
 *
 * That is the failure this file exists to make loud. A preference that no
 * surface reads and no act writes is the storage-shaped version of a control
 * that changes nothing: it costs the operator a key in their browser storage,
 * costs every reader a defensive branch, and — worst — its doc comment
 * describes a capability in the present tense that the operator does not have.
 *
 * THE SCAN IS DELIBERATELY LOOSE IN ONE DIRECTION. It counts a field name
 * appearing anywhere in a `src/` file, including inside a comment, exactly as
 * `test/renderer/type-scale.test.ts` counts a class name in a comment: a scan
 * that tries to strip comments learns to swallow real code, and a guard that
 * can silently miss a live field is worse than one that occasionally passes on
 * prose. It still has the teeth it was written for — `dismissedSessions` was
 * mentioned in NO `src/` file at all, not even in passing, and that is the
 * shape a born-dead field takes.
 *
 * WHAT IT DOES NOT CLAIM: that a field is USED WELL, or that it reaches a
 * control. It claims only that some module other than the store itself knows
 * the field exists. The stronger question — is every stored preference
 * reachable by the operator — is not answerable by a scan, because most of
 * these fields are deliberately NOT settings (a pane width, a fold, an icon)
 * and must never appear in a dialog.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMPTY_PREFS } from '../../src/renderer/prefs/prefs.js';

const ROOT = resolve(process.cwd());
const SRC = resolve(ROOT, 'src');
/** The store itself. Naming a field here is not knowing about it. */
const STORE = resolve(SRC, 'renderer/prefs/prefs.ts');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return ['.ts', '.tsx'].includes(extname(name)) ? [path] : [];
  });
}

const FILES = sources(SRC).filter((path) => path !== STORE);
const rel = (path: string): string => relative(SRC, path).split('\\').join('/');
const CORPUS = new Map(FILES.map((path) => [rel(path), readFileSync(path, 'utf8')]));

const FIELDS = Object.keys(EMPTY_PREFS);

/** Does any module outside the store name this field at all? */
const mentioned = (field: string): boolean =>
  [...CORPUS.values()].some((source) => new RegExp(`\\b${field}\\b`).test(source));

describe('every field of the stored prefs is known to something outside the store', () => {
  it('scanned a real corpus, and the store is excluded from it', () => {
    // Every assertion below is vacuously true over an empty list, and this
    // repo has shipped a guard that examined zero files.
    expect(FILES.length).toBeGreaterThan(100);
    expect(FIELDS.length).toBeGreaterThan(15);
    for (const name of [
      'renderer/canvas/Canvas.tsx',
      'renderer/settings/SettingsOverlay.tsx',
      'renderer/panels/DetailPanel.tsx',
    ]) {
      expect([...CORPUS.keys()]).toContain(name);
    }
    expect([...CORPUS.keys()]).not.toContain('renderer/prefs/prefs.ts');
    // And the corpus really does carry field names under the matcher the loop
    // below uses, or that loop is asserting over text that could not mention
    // one. A named pair, then a count: the pair proves the read, the count
    // proves the pair was not the only thing the regex could ever find.
    expect(CORPUS.get('renderer/settings/SettingsOverlay.tsx')).toMatch(/\boutFontSize\b/);
    expect(FIELDS.filter(mentioned).length).toBeGreaterThanOrEqual(15);
  });

  it('names no field that no module outside the store mentions', () => {
    expect(FIELDS.filter((field) => !mentioned(field))).toEqual([]);
  });
});
