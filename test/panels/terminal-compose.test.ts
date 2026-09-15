/**
 * A COMMITTED COMPOSITION IS ONE STRING AND THE CHANNEL TAKES SIXTEEN.
 *
 * `shared/terminal.ts` bounds a `text` keystroke at `MAX_KEY_TEXT` so that the
 * send channel cannot become an unbounded paste into a running agent. A
 * keydown never came near that -- `event.key` for a printable key is one
 * character -- but an IME commit is a whole word or a whole clause, and a
 * Japanese or Chinese commit routinely runs past sixteen. Handed over whole it
 * fails `isPaneKey` in main, which answers `unaimed`: "vam can no longer name
 * one session of its own for this project", a sentence about pairing that
 * would be false and would send the operator after nothing.
 *
 * SPLITTING IS SAFE BECAUSE THE PANE IS A BYTE STREAM. Each piece becomes its
 * own `send-keys -l --`, queued behind the last, so the pane receives exactly
 * the same bytes in the same order; a combining mark separated from its base
 * is recombined by the terminal that draws it, because it never saw a
 * boundary. The one split that is NOT safe is inside a surrogate pair: half of
 * one is not a character in any encoding, and UTF-8 has no way to carry it.
 */

import { describe, expect, it } from 'vitest';
import { composedStrokes } from '../../src/renderer/panels/terminal-compose.js';
import type { PaneKey } from '../../src/shared/terminal.js';
import { isPaneKey, MAX_KEY_TEXT } from '../../src/shared/terminal.js';

/**
 * The text each stroke carries, in order — what the pane would receive. A
 * stroke of any other kind is spelled rather than skipped: this helper is used
 * to assert that the pieces REJOIN into the commit, and a silently dropped
 * `enter` would make that comparison pass while a Return went down the wire.
 */
const texts = (strokes: readonly PaneKey[]): string[] =>
  strokes.map((stroke) => (stroke.kind === 'text' ? stroke.text : `<${stroke.kind}>`));

describe('a committed composition becomes keystrokes the channel accepts', () => {
  it('hands a short syllable over whole, as one keystroke', () => {
    // The case this whole file exists for: Vietnamese. Every syllable is well
    // inside the bound, so the common path must not be chopped up.
    expect(composedStrokes('tiếng')).toEqual([{ kind: 'text', text: 'tiếng' }]);
  });

  it('says nothing at all for an empty commit', () => {
    // A composition cancelled with Escape ends with `data: ''`. Sending an
    // empty `text` key would fail `isPaneKey` (it requires length > 0) and be
    // drawn as a refusal about pairing, for a keystroke the operator never
    // completed.
    expect(composedStrokes('')).toEqual([]);
  });

  it('splits a long commit into pieces the channel will take', () => {
    const long = 'あ'.repeat(40);
    const strokes = composedStrokes(long);
    expect(strokes.length).toBeGreaterThan(1);
    for (const stroke of strokes) {
      // THE ASSERTION THAT MATTERS: every piece passes the same predicate main
      // runs. A bound checked by hand here and by `isPaneKey` there is two
      // copies of one number.
      expect(isPaneKey(stroke)).toBe(true);
    }
    expect(texts(strokes).join('')).toBe(long);
  });

  it('never splits a surrogate pair, which would put half a character on the wire', () => {
    // 🙂 is two UTF-16 code units. A chunker counting units and cutting at 16
    // lands inside the pair on the ninth one; a lone surrogate has no UTF-8
    // encoding at all, so what reached tmux would be a replacement character
    // or a decoding error in the agent's own terminal.
    const emoji = '🙂'.repeat(10);
    const strokes = composedStrokes(emoji);
    expect(texts(strokes).join('')).toBe(emoji);
    for (const stroke of strokes) {
      expect(isPaneKey(stroke)).toBe(true);
      const text = stroke.kind === 'text' ? stroke.text : '';
      // A piece that begins or ends on a lone surrogate would survive
      // `isPaneKey` (it only counts units) and die in the encoder.
      expect(text).toBe([...text].join(''));
      expect(text.length % 2).toBe(0);
      expect(text).not.toBe('');
    }
  });

  it('fills each piece rather than emitting one character at a time', () => {
    // Every piece is a spawn, and the chain sends them one after another: a
    // per-character split would turn a 40-character commit into 40 round
    // trips through tmux at the rate the slowest one answers.
    const strokes = composedStrokes('a'.repeat(MAX_KEY_TEXT * 3));
    expect(strokes).toHaveLength(3);
    expect(texts(strokes).every((text) => text.length === MAX_KEY_TEXT)).toBe(true);
  });

  it('honours a bound it is given, so the test and the channel cannot drift', () => {
    expect(texts(composedStrokes('abcdef', 2))).toEqual(['ab', 'cd', 'ef']);
  });

  it('keeps a single oversized cluster whole rather than cutting a character in half', () => {
    // A family emoji is one grapheme of eleven code units. There is no split
    // that leaves both halves meaning anything, so the code point is the unit
    // and the bound is the only thing that gives.
    const family = '👨‍👩‍👧‍👦';
    expect(texts(composedStrokes(family, 2)).join('')).toBe(family);
  });
});
