/**
 * THE SAVE-TIME NORMALISER — the operator's own ask: "on save, trim spaces
 * and create an empty line at the bottom." Unlike `files-format.ts`, which
 * refuses everywhere it cannot PROVE a rewrite changed nothing that matters
 * (that file's own header names the `.env` trailing-space case this
 * normaliser does NOT carve out — see this file's own note below), this runs
 * on every save, unconditionally, for every editable buffer.
 *
 * Trailing whitespace (spaces and tabs before a newline, including a
 * whitespace-only line, which becomes empty) is trimmed on every line, and
 * the file ends with exactly one final newline — several trailing blank
 * lines collapse to that one newline, and a missing one is added. An empty
 * file stays empty rather than becoming a lone `"\n"`: there is no content to
 * anchor a final newline to, and "empty" is already the tidiest a blank file
 * can be.
 *
 * CRLF STAYS CRLF. The heuristic — any `\r` in the file means CRLF — is
 * `files-format.ts`'s own (`formatFile`'s "a CRLF file cannot be formatted by
 * either path" guard), reused here rather than invented twice.
 *
 * NOT CARVED OUT FOR `.env`/`.ini`, UNLIKE `formatIni`. That file's own
 * comment argues a trailing space on a DATA line is data-adjacent and must
 * survive a Format press untouched, because vam does not know which reader
 * will parse the file. This normaliser trims it anyway, on the operator's
 * explicit instruction ("trim spaces" on save, no file-type exception named)
 * — the same trade the "trim trailing whitespace on save" setting most
 * editors ship makes for every file type at once. Flagged here, once, rather
 * than silently decided: a future operator ask to exempt `.env`/`.ini` the
 * way Format already does is a real possibility this test file's existence
 * should make easy to find.
 */

import { describe, expect, it } from 'vitest';
import {
  normalizeForSave,
  normalizeForSaveWithMap,
} from '../../src/renderer/panels/files-save-normalize.js';

describe('normalizeForSave', () => {
  it('trims trailing spaces and tabs from every line', () => {
    expect(normalizeForSave('a  \nb\t\nc \t \n')).toBe('a\nb\nc\n');
  });

  it('turns a whitespace-only line into an empty one', () => {
    expect(normalizeForSave('a\n   \nb\n')).toBe('a\n\nb\n');
    expect(normalizeForSave('a\n\t\t\nb\n')).toBe('a\n\nb\n');
  });

  it('adds a final newline when the file is missing one', () => {
    expect(normalizeForSave('a\nb')).toBe('a\nb\n');
  });

  it('collapses several trailing blank lines to exactly one final newline', () => {
    expect(normalizeForSave('a\nb\n\n\n\n')).toBe('a\nb\n');
    expect(normalizeForSave('a\n\n\n')).toBe('a\n');
  });

  it('leaves a blank RUN IN THE MIDDLE of the file alone — only the trailing run collapses', () => {
    expect(normalizeForSave('a\n\n\nb\n')).toBe('a\n\n\nb\n');
  });

  it('an empty file stays empty', () => {
    expect(normalizeForSave('')).toBe('');
  });

  it('a whitespace-only file collapses to empty, not to a lone newline', () => {
    expect(normalizeForSave('   \n\t\n  ')).toBe('');
  });

  it('a file that is already normalised is returned unchanged (byte for byte)', () => {
    const clean = 'a\nb\nc\n';
    expect(normalizeForSave(clean)).toBe(clean);
  });

  it('CRLF stays CRLF — every emitted newline is \\r\\n, trailing runs collapse to one', () => {
    expect(normalizeForSave('a \r\nb\t\r\n\r\n\r\n')).toBe('a\r\nb\r\n');
    // No final newline at all, CRLF file.
    expect(normalizeForSave('a\r\nb')).toBe('a\r\nb\r\n');
  });

  it('a single stray \\r anywhere is enough to read the whole file as CRLF', () => {
    // Mixed endings are not a case the operator asked for; the existing
    // `files-format.ts` heuristic ("any \r means CRLF") is reused rather than
    // inventing a second rule, so the behaviour here is at least consistent
    // with what Format already assumes.
    expect(normalizeForSave('a\nb\r\n')).toBe('a\r\nb\r\n');
  });
});

/**
 * X-SET-1 — the cross-provider review's own finding: per-line trimming
 * destroys meaningful trailing whitespace in a handful of file types where
 * the trailing spaces ARE the content, not incidental keystrokes. `path` is
 * the second argument precisely so this module can tell a `.env` from a
 * `.md` — the same reason `files-format.ts`'s own `editorFileKind` reads a
 * path rather than being told a kind.
 *
 * The final-newline rule is NOT part of this exemption — every file type
 * still ends with exactly one trailing newline. Only the per-LINE trim is
 * skipped for these extensions.
 */
describe('normalizeForSave — the per-line-trim exemption', () => {
  it('a markdown hard line break (two trailing spaces) survives a save', () => {
    expect(normalizeForSave('line one  \nline two\n', 'notes.md')).toBe('line one  \nline two\n');
    expect(normalizeForSave('line one  \nline two', 'notes.markdown')).toBe(
      'line one  \nline two\n',
    );
    expect(normalizeForSave('line one  \nline two', 'notes.mdx')).toBe('line one  \nline two\n');
  });

  it('a patch/diff context line ending in a space survives a save', () => {
    const patch = '--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n context line \n-old \n+new \n';
    expect(normalizeForSave(patch, 'change.patch')).toBe(patch);
    expect(normalizeForSave(patch, 'change.diff')).toBe(patch);
  });

  it('a jest/vitest inline snapshot keeps its trailing whitespace', () => {
    expect(normalizeForSave('exports[`x`] = `line  \n`;\n', '__snapshots__/x.snap')).toBe(
      'exports[`x`] = `line  \n`;\n',
    );
  });

  it('the trailing-blank-line collapse and final newline still apply to an exempt type', () => {
    expect(normalizeForSave('line one  \nline two\n\n\n', 'notes.md')).toBe(
      'line one  \nline two\n',
    );
    expect(normalizeForSave('line one  \nline two', 'notes.md')).toBe('line one  \nline two\n');
  });

  it('.env and .ini are NOT exempt — they keep getting trimmed', () => {
    expect(normalizeForSave('A=1   \nB=2\t\n', '.env')).toBe('A=1\nB=2\n');
    expect(normalizeForSave('[a]\nkey=1  \n', 'settings.ini')).toBe('[a]\nkey=1\n');
  });

  it('an ordinary extension not on the exemption list still trims', () => {
    expect(normalizeForSave('a  \nb\t\n', 'notes.txt')).toBe('a\nb\n');
  });
});

/**
 * S3 — the caret jumps after a save trims whitespace on lines ABOVE it.
 * `normalizeForSaveWithMap` answers the same `value` `normalizeForSave` does,
 * plus `mapOffset`: an offset into the ORIGINAL content, moved to the same
 * logical position in the normalised one — shifted left by whatever was
 * removed strictly before it, not merely clamped to the new, shorter length.
 */
describe('normalizeForSaveWithMap — mapping a caret through the normalisation', () => {
  it('shifts a caret on a later line left by the whitespace trimmed off an earlier one', () => {
    const original = 'hello   \nworld';
    const { value, mapOffset } = normalizeForSaveWithMap(original, 'notes.txt');
    expect(value).toBe('hello\nworld\n');
    // The caret sat right before "world" (offset 9 in the original: "hello   \n"
    // is 9 characters). After trimming, "world" starts at offset 6.
    const caret = original.indexOf('world');
    expect(mapOffset(caret)).toBe(value.indexOf('world'));
  });

  it('a caret inside the trimmed whitespace itself lands just past the surviving text', () => {
    const original = 'abc   \n';
    const { mapOffset } = normalizeForSaveWithMap(original, 'notes.txt');
    // Offset 5 is inside the run of trailing spaces (index 3, 4, 5 are the
    // three trimmed spaces) — it has nowhere left to be but right after "abc".
    expect(mapOffset(5)).toBe(3);
  });

  it('a caret on a line that gets dropped entirely (trailing blank-line collapse) lands at the end', () => {
    const original = 'a\nb\n\n\n';
    const { value, mapOffset } = normalizeForSaveWithMap(original, 'notes.txt');
    expect(value).toBe('a\nb\n');
    const caretOnDroppedLine = original.length - 1; // inside the collapsed run
    expect(mapOffset(caretOnDroppedLine)).toBe(value.length);
  });

  it('leaves a caret before any trimmed character exactly where it was', () => {
    const original = 'abc   \ndef';
    const { mapOffset } = normalizeForSaveWithMap(original, 'notes.txt');
    expect(mapOffset(0)).toBe(0);
    expect(mapOffset(2)).toBe(2); // right after "ab", still inside "abc"
  });

  it('an exempt type (markdown) never shifts a caret that sits before its own hard break', () => {
    const original = 'line one  \nline two';
    const { value, mapOffset } = normalizeForSaveWithMap(original, 'notes.md');
    expect(value).toBe('line one  \nline two\n');
    expect(mapOffset(4)).toBe(4); // inside "line" on the first line, untouched
  });
});
