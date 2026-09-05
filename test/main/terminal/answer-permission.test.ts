import { describe, expect, it } from 'vitest';
import { readPicker } from '../../../src/main/terminal/answer.js';
import { BASH_PERMISSION, BASH_PERMISSION_FRAMED, EDIT_PERMISSION } from './permission-screens.js';

/**
 * THE ONE QUESTION THIS FILE ANSWERS: is answering a permission prompt wiring,
 * or a new parser? `readPicker` was written for `AskUserQuestion` and reads
 * `❯ 1. …` rows generically -- so the claim is that a permission prompt, which
 * is the same numbered grammar under a different title, already parses. That
 * claim was load-bearing and unverified. It is verified here, against invented
 * screens whose provenance `permission-screens.ts` states in full.
 */
describe('a permission prompt is the same numbered picker', () => {
  it('reads the three rows of a bash approval and the cursor on the first', () => {
    const picker = readPicker(BASH_PERMISSION);
    expect(picker?.rows.map((row) => row.label)).toEqual([
      'Yes',
      'Yes, and do not ask again for scripts/rebuild-index.sh',
      'No, and tell the agent what to do differently',
    ]);
    expect(picker?.cursor).toBe(0);
    // No checkbox on any row: a permission prompt is single-select and the
    // parser must not invent a `[ ]` where the CLI drew none.
    expect(picker?.rows.map((row) => row.checked)).toEqual([null, null, null]);
  });

  it('reads the same prompt when the CLI frames it in a box', () => {
    const picker = readPicker(BASH_PERMISSION_FRAMED);
    expect(picker?.rows.map((row) => row.label)).toEqual([
      'Yes',
      'Yes, and do not ask again for scripts/rebuild-index.sh',
      'No, and tell the agent what to do differently',
    ]);
    expect(picker?.cursor).toBe(0);
  });

  it('follows a cursor that is not on the first row', () => {
    const picker = readPicker(EDIT_PERMISSION);
    expect(picker?.cursor).toBe(1);
    expect(picker?.rows[1]?.label).toBe('Yes, allow all edits during this session');
  });
});
