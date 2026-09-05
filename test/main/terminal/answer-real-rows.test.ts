import { describe, expect, it } from 'vitest';
import { readPicker } from '../../../src/main/terminal/answer.js';
import { COLOUR_ASKED, COLOUR_ON, REVIEW } from './answer-live-screens.js';

describe('a real picker, whose rows are interleaved with their descriptions', () => {
  it('reads every row, not just the one the cursor happens to sit beside', () => {
    const picker = readPicker(COLOUR_ASKED);
    expect(picker?.rows.map((row) => row.label)).toEqual([
      'Crimson',
      'Cobalt',
      'Emerald',
      'Type something.',
      'Chat about this',
    ]);
    expect(picker?.cursor).toBe(0);
  });

  it('follows the cursor down a list whose rows are not adjacent lines', () => {
    expect(readPicker(COLOUR_ON(3))?.cursor).toBe(2);
  });

  it('still reads the review screen, whose rows ARE adjacent', () => {
    expect(readPicker(REVIEW)?.rows.map((row) => row.label)).toEqual([
      'Submit answers',
      'Cancel',
    ]);
  });
});
