/**
 * Ties `README.md`'s "In the Files tab" table to the keys that tab actually
 * answers — the same bargain `chords.readme.test.ts` already holds for the
 * app-wide grammar, for the same reason and after the same defect.
 *
 * THE DEFECT, NAMED: `Mod-s` saved the open file for a whole release and
 * appeared nowhere in the README. Nothing caught it, because the existing
 * README test reads the app-wide binding tables and this tab's keys are not
 * in them: they are local to one surface, wired in its own `onKeyDown` the
 * way the composer's `Mod-[` is. An undocumented binding is a bug in this
 * repo, so the local keyboard gets a local check rather than an exemption.
 *
 * BOTH SIDES ARE READ, NEITHER IS RESTATED. The left is `TREE_KEYS` and
 * `EDITOR_KEYS`, which are not documentation: `resolveTreeKey` and
 * `FilesTab.tsx`'s editor handler each answer a key ONLY if it is in theirs,
 * so a key taken out of a list stops working and one put in without a branch
 * does nothing. The right is column one of the README's own table, parsed the
 * way the sibling test parses its own.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EDITOR_KEYS, TREE_KEYS } from '../../src/renderer/panels/files-tree.js';

const README = fileURLToPath(new URL('../../README.md', import.meta.url));

/**
 * Spellings the README gives a keystroke that `normalizeKey` does not.
 *
 * `Shift-Tab` is the keystroke an operator presses and the one the table has
 * to name, because "Tab indents and Shift+Tab outdents" is the whole of what
 * that row says. `normalizeKey` folds Shift into a token for LETTERS only —
 * a named key like `Tab` keeps its own spelling and arrives as `Tab` either
 * way — so the handler reads `event.shiftKey` for the direction and there is
 * no `Shift-Tab` for a key list to hold. One exemption, named, with its
 * reason, rather than dropping the direction of the check that catches a row
 * outliving its binding.
 */
const SPELLED_BUT_NOT_NORMALIZED = ['Shift-Tab'];

/** Every key the Files tab dispatches on, deduplicated. */
function answeredKeys(): string[] {
  return [...new Set([...TREE_KEYS, ...EDITOR_KEYS])].sort();
}

/** The backticked tokens in column one of the README's Files-tab table. */
function documentedKeys(): string[] {
  const lines = readFileSync(README, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.startsWith('| In the Files tab |'));
  if (start === -1) {
    throw new Error('README.md has no "| In the Files tab | ... |" table header');
  }
  const out: string[] = [];
  // start+1 is the `|---|---|` rule; data begins at start+2 and ends at the
  // first line that is no longer a table row.
  for (
    let i = start + 2;
    i < lines.length && (lines[i] ?? '').trimStart().startsWith('|');
    i += 1
  ) {
    const keyColumn = (lines[i] ?? '').split('|')[1] ?? '';
    for (const match of keyColumn.matchAll(/`([^`]+)`/g)) {
      out.push(match[1] as string);
    }
  }
  return out;
}

describe('README.md’s Files-tab table matches the keys that tab answers', () => {
  it('finds a non-empty key list on each side', () => {
    // Four guards in this repo have gone green having examined zero of
    // anything. Both literals are the point: a shrunken list or a table that
    // stopped parsing would otherwise pass everything below silently.
    expect(TREE_KEYS.length).toBeGreaterThanOrEqual(8);
    expect(EDITOR_KEYS.length).toBeGreaterThanOrEqual(4);
    expect(documentedKeys().length).toBeGreaterThanOrEqual(10);
  });

  it('gives every key the tab answers a README row', () => {
    const documented = new Set(documentedKeys());
    const missing = answeredKeys().filter((key) => !documented.has(key));
    expect(missing, 'answered by the Files tab but missing a README row').toEqual([]);
  });

  it('documents no key the tab does not answer', () => {
    const answered = new Set([...answeredKeys(), ...SPELLED_BUT_NOT_NORMALIZED]);
    const stale = documentedKeys().filter((key) => !answered.has(key));
    expect(stale, 'a README row names a key the Files tab does not answer').toEqual([]);
  });

  it('leaves the app-wide table alone — the two are read separately', () => {
    // `chords.readme.test.ts` finds its own table by the FIRST `| Key |`
    // header and would fail outright if this table had reused that heading,
    // because none of these keys is in `BINDING_TABLES`. Stated as a check so
    // that renaming this column back to `Key` reddens here rather than
    // reddening the sibling test with a confusing message.
    const text = readFileSync(README, 'utf8');
    expect(text.indexOf('| Key |')).toBeLessThan(text.indexOf('| In the Files tab |'));
  });
});
