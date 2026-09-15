/**
 * The payload the renderer pushes, read by the least-trusting reader in the
 * app, and the sentence main builds out of it.
 *
 * Two separate jobs, two separate describes. `readUnsavedReport` is the
 * validator -- it is handed whatever the renderer sent, which is a process
 * this app treats as hostile by policy (`ipc/handlers.ts`'s own header), so
 * every shape below is a real request it must survive. `unsavedQuitPrompt` is
 * the WORDS, and they are asserted literally rather than by `toContain`: vam's
 * rule is that a prompt says something true and specific, and a count that
 * silently became "1" for every report would pass any loose assertion.
 */

import { describe, expect, it } from 'vitest';
import {
  NOTHING_UNSAVED,
  readUnsavedReport,
  unsavedQuitPrompt,
} from '../../../src/main/quit/unsaved.js';

describe('readUnsavedReport — the renderer is not trusted about its own state', () => {
  it('takes a well-formed report as it stands', () => {
    expect(readUnsavedReport({ count: 2, names: ['.env', 'src/app.ts'] })).toEqual({
      count: 2,
      names: ['.env', 'src/app.ts'],
    });
  });

  it('reads every unreadable shape as NOTHING unsaved — it never invents a reason to stay open', () => {
    for (const raw of [
      undefined,
      null,
      'two',
      42,
      [],
      ['.env'],
      {},
      { names: ['.env'] },
      { count: '2', names: ['.env'] },
      { count: 2.5, names: [] },
      { count: Number.NaN, names: [] },
      { count: -1, names: [] },
      { count: 0, names: [] },
    ]) {
      expect(readUnsavedReport(raw)).toEqual(NOTHING_UNSAVED);
    }
  });

  it('keeps the count when the names are missing or wrong — the number is the load-bearing fact', () => {
    expect(readUnsavedReport({ count: 3 })).toEqual({ count: 3, names: [] });
    expect(readUnsavedReport({ count: 3, names: 'nope' })).toEqual({ count: 3, names: [] });
    expect(readUnsavedReport({ count: 3, names: ['.env', 7, '', null] })).toEqual({
      count: 3,
      names: ['.env'],
    });
  });

  it('bounds what a compromised renderer can park on main: the list and each name', () => {
    const many = Array.from({ length: 500 }, (_, i) => `file-${i}`);
    const read = readUnsavedReport({ count: 500, names: many });
    expect(read.count).toBe(500);
    expect(read.names.length).toBe(64);
    expect(read.names[0]).toBe('file-0');

    const long = readUnsavedReport({ count: 1, names: ['x'.repeat(5_000)] });
    expect(long.names[0]?.length).toBe(257);
  });

  it('bounds the count itself — a number is not a licence to print a paragraph', () => {
    expect(readUnsavedReport({ count: 10 ** 9, names: [] }).count).toBe(9_999);
  });
});

describe('unsavedQuitPrompt — what the operator actually reads', () => {
  it('names one file in the singular, and lists it', () => {
    const prompt = unsavedQuitPrompt({ count: 1, names: ['.env'] });
    expect(prompt.message).toBe('1 file has unsaved changes.');
    expect(prompt.detail).toBe(
      '.env\n\nvam keeps no draft on disk, so quitting now discards this text. ' +
        'Cancel, save what you want to keep, then quit again.',
    );
  });

  it('counts, and names every file, when there is more than one', () => {
    const prompt = unsavedQuitPrompt({ count: 3, names: ['.env', 'notes.md', 'src/app.ts'] });
    expect(prompt.message).toBe('3 files have unsaved changes.');
    expect(prompt.detail.split('\n\n')[0]).toBe('.env\nnotes.md\nsrc/app.ts');
  });

  it('lists at most five, and says how many it did not list', () => {
    const prompt = unsavedQuitPrompt({
      count: 8,
      names: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    });
    expect(prompt.message).toBe('8 files have unsaved changes.');
    expect(prompt.detail.split('\n\n')[0]).toBe('a\nb\nc\nd\ne\n…and 3 more');
  });

  it('says how many it could not name at all, rather than listing nothing', () => {
    const prompt = unsavedQuitPrompt({ count: 2, names: [] });
    expect(prompt.detail.split('\n\n')[0]).toBe('…and 2 more');
  });

  it('offers exactly two answers, and the safe one is both the default and Escape', () => {
    const prompt = unsavedQuitPrompt({ count: 1, names: ['.env'] });
    expect(prompt.buttons).toEqual(['Cancel', 'Quit anyway']);
    expect(prompt.defaultId).toBe(0);
    expect(prompt.cancelId).toBe(0);
    expect(prompt.type).toBe('warning');
  });

  it('offers no "Save all" — a save main can refuse must not be promised by a quit dialog', () => {
    const prompt = unsavedQuitPrompt({ count: 4, names: ['.env'] });
    expect(prompt.buttons.some((label) => /save/i.test(label))).toBe(false);
  });
});
