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
import { normalizeForSave } from '../../src/renderer/panels/files-save-normalize.js';

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
