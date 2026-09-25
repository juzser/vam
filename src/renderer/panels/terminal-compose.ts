/**
 * Turning a committed IME composition into keystrokes the send channel takes.
 *
 * WHY THIS IS NOT `{ kind: 'text', text: data }` AND NOTHING ELSE. A keydown
 * carries one character, so `TerminalTab`'s keystroke path never came near
 * `MAX_KEY_TEXT` -- the sixteen-character bound `shared/terminal.ts` puts on a
 * `text` key so that this channel cannot become an unbounded paste into a
 * running agent. A COMPOSITION IS NOT A KEYSTROKE: an input method commits a
 * whole syllable in Vietnamese, and a whole clause in Japanese or Chinese,
 * which runs past sixteen routinely. Handed over whole, it fails `isPaneKey`
 * in main, and main's answer for a malformed ask is `unaimed` -- which the tab
 * draws as "vam can no longer name one session of its own for this project".
 * That sentence is about pairing, it would be false, and it would send the
 * operator looking for a tmux problem that is not there.
 *
 * SPLITTING IS SAFE, AND THE REASON IS THE PANE. Each piece becomes its own
 * `send-keys -l --` (`sources/tmux/argv.ts`), queued behind the last on the
 * tab's own chain, so the pane receives exactly the bytes the operator
 * composed, in order. A terminal is a byte stream: a combining mark that
 * arrives in the next write is still drawn on the base character before it,
 * because nothing downstream ever saw a boundary.
 *
 * THE ONE SPLIT THAT IS NOT SAFE is inside a surrogate pair, which is why this
 * counts code points and measures in code units rather than slicing the string
 * at an index. Half of a surrogate pair is not a character in any encoding --
 * `isPaneKey` would pass it (it counts units) and the UTF-8 encoding on the way
 * to `execFile` would turn it into a replacement character. So the code point
 * is the unit that is never divided, and the bound is what gives: a single
 * cluster longer than the bound (a ZWJ emoji sequence) goes whole and is
 * refused by main rather than cut in half, because there is no halving of it
 * that means anything.
 *
 * NORMALISED TO NFC BEFORE ANY OF THAT IS MEASURED. `TerminalTab.openkey
 * .test.tsx` carries the report: OpenKey, the Vietnamese input utility behind
 * it, builds its own replacement string from a hardcoded combining-mark
 * table rather than calling either of Foundation's canonical-mapping
 * normalisers, so whether one correction lands on the wire precomposed (`ố`,
 * one code point) or decomposed (`o` + a combining circumflex + a combining
 * acute, three) is the SOURCE's habit, not a contract this channel can trust
 * -- and a real input method's marked-text commit is not guaranteed NFC
 * either, only USUALLY. tmux and the agents vam starts both draw a decomposed
 * sequence as a base letter with a mark floating over the NEXT cell rather
 * than one accented glyph, so a piece handed over exactly as it arrived can
 * be byte-correct and still look wrong on screen. Normalising FIRST, before
 * the code points are counted and the bound applied, is what keeps a
 * three-code-point decomposed input from being chopped into more pieces than
 * its one-code-point NFC form ever needed.
 */

import { MAX_KEY_TEXT, type PaneKey } from '../../shared/terminal.js';

/**
 * The keystrokes a committed composition becomes, in the order they must be
 * sent. Empty for an empty commit -- a composition cancelled with Escape ends
 * with `data: ''`, and an empty `text` key fails `isPaneKey` and would be
 * drawn as a refusal for a keystroke the operator never finished.
 */
export function composedStrokes(text: string, limit: number = MAX_KEY_TEXT): readonly PaneKey[] {
  const strokes: PaneKey[] = [];
  let piece = '';
  const normalized = text.normalize('NFC');
  // `for...of` over a string iterates CODE POINTS, so a surrogate pair is one
  // step and can never be divided by the boundary below. `piece.length` is
  // still code UNITS, which is the unit `isPaneKey` bounds.
  for (const point of normalized) {
    if (piece !== '' && piece.length + point.length > limit) {
      strokes.push({ kind: 'text', text: piece });
      piece = '';
    }
    piece += point;
  }
  if (piece !== '') strokes.push({ kind: 'text', text: piece });
  return strokes;
}
