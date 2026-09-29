/**
 * THE PHONE KEYSTROKE STRIP'S OWN CAPTIONS -- short, plain, and DELIBERATELY
 * NOT COMPUTED FROM `chords.ts`.
 *
 * Every other chip in this app reads its glyph off `chordSymbols`/
 * `ChordGlyphs`, which is `navigator.platform`-read (`chords.ts`'s own
 * comment: "a RUNTIME ANSWER and never a build-time one") -- correct for a
 * MENU SHORTCUT, wrong for this strip. The phone build ships to whatever
 * device reads a Tailscale URL, and the strip used to inherit that platform
 * split anyway: the SAME button painted `⎋ → agent` on an iPhone and
 * `Esc → agent` on the Android phone this same bundle is served to, which
 * read as two different apps depending on which pocket the phone came out
 * of. The operator asked for one short, plain caption regardless: `Esc`,
 * `Tab`, `Shift+Tab`, `Enter`, `Space`, `⌫`, `Del`, the four arrows and the
 * Ctrl chords -- none of it varies by
 * platform, so none of it belongs behind `chordSymbols` any more.
 *
 * THIS IS A SECOND TABLE, ON PURPOSE, and `test/keyboard/no-stray-glyphs
 * .test.ts` names this file in its own `ALLOWED` set for exactly that
 * reason -- the same exemption `ShortcutTip.tsx` already carries, for the
 * same reason: a table has to live somewhere, and a sweep that flagged the
 * ONE place a hand-typed glyph is supposed to live would never stay green.
 */
import type { ReactElement } from 'react';

export const PHONE_KEY_LABELS = {
  escape: 'Esc',
  tab: 'Tab',
  enter: 'Enter',
  'back-tab': 'Shift+Tab',
  space: 'Space',
  backspace: '⌫',
  delete: 'Del',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  'ctrl-c': 'Ctrl+C',
  'ctrl-d': 'Ctrl+D',
  'ctrl-l': 'Ctrl+L',
  'ctrl-z': 'Ctrl+Z',
  'ctrl-r': 'Ctrl+R',
  'ctrl-a': 'Ctrl+A',
  'ctrl-e': 'Ctrl+E',
  'ctrl-w': 'Ctrl+W',
  'ctrl-u': 'Ctrl+U',
} as const;

/**
 * THE PICTOGRAMS AMONG THOSE LABELS, wrapped in `font-sans` exactly the way
 * `ChordGlyphs` wraps a COMPUTED chord segment -- Geist Mono (this strip's
 * own ambient face, `font-mono` on every chip) draws these noticeably
 * narrower than Geist does at the same size (`ChordGlyphs`'s own doc comment
 * carries the measurement); `test/support/chord-glyph-guard.ts` sweeps the
 * painted tree for exactly this shape, and does not care whether the glyph
 * reached the page through `chordSymbols` or was typed straight in -- a thin
 * ⇧ reads the same either way. `Esc`/`Tab`/`Space` are plain words and never
 * enter this set at all.
 */
const LABEL_GLYPHS = new Set(['⌫', '↑', '↓', '←', '→']);

/**
 * `label`, split into plain runs and glyph runs, each glyph run wrapped for
 * the reason above. Returned as a plain array of strings/elements: React
 * accepts either as children, and every label here is short and fixed at
 * build time, so an index key is stable across renders.
 */
export function phoneKeyLabelNodes(label: string): readonly (string | ReactElement)[] {
  const nodes: (string | ReactElement)[] = [];
  let plain = '';
  let key = 0;
  for (const char of label) {
    if (LABEL_GLYPHS.has(char)) {
      if (plain !== '') {
        nodes.push(plain);
        plain = '';
      }
      nodes.push(
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, short, build-time label never reorders.
        <span key={key++} className="font-sans">
          {char}
        </span>,
      );
    } else {
      plain += char;
    }
  }
  if (plain !== '') nodes.push(plain);
  return nodes;
}
