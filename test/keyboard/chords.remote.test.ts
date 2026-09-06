/**
 * The Remote surface gets its own key, `.`, beside `,` for settings — the same
 * physical row, the same "open something" family. See epic.md for the
 * collision analysis; this only holds the grammar's half of it.
 */

import { describe, expect, it } from 'vitest';
import { EMPTY_CHORD, resolveChord } from '../../src/renderer/keyboard/chords.js';

describe('resolveChord — the remote surface', () => {
  it('resolves bare `.` to the remote action', () => {
    const step = resolveChord(EMPTY_CHORD, '.');
    expect(step.action).toEqual({ kind: 'remote' });
    expect(step.state).toEqual(EMPTY_CHORD);
  });

  it('does not disturb `,` (settings), which stays its own action', () => {
    const step = resolveChord(EMPTY_CHORD, ',');
    expect(step.action).toEqual({ kind: 'settings' });
  });
});
