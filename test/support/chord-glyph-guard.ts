/**
 * THE STRUCTURAL HALF OF `no-stray-glyphs.test.ts`'S INVARIANT.
 *
 * That guard sweeps SOURCE for a glyph typed by hand — a second table nobody
 * keeps in sync with `chords.ts`'s own. It cannot see the defect the Keyboard
 * settings rows shipped with: `chordSymbols(keys)` computed the glyph at
 * runtime, assigned it to `said`, and a `<kbd>{said}</kbd>` three lines away
 * painted it as a flat string — no literal glyph anywhere in the source for a
 * grep to catch, and no `font-sans` span for the operator's own reference
 * (`docs/design/ref/send-key-reference.png`, the Send key option) to agree
 * with. `ChordGlyphs`' own doc comment carries the measurement: Geist Mono
 * (`font-mono`, every chip's ambient face but that button's own) draws a
 * noticeably narrower ⌘/⇧ than Geist does at the same size, which is why the
 * component wraps exactly the glyph segments in the body sans stack.
 *
 * SO THIS ASKS THE PAINTED TREE, generically, rather than re-deriving the
 * same question per surface the way `chord-symbols.test.tsx` and
 * `shortcut-tip.test.tsx` already do for the two they each own: walk every
 * text node, and for one that carries a pictogram sitting inside a
 * `font-mono` ancestor, the nearest wrapper between the two has to be a
 * `font-sans` span — `ChordGlyphs`' own shape — or the glyph is painted thin,
 * off the reference, exactly where the operator keeps finding it.
 *
 * `className` RATHER THAN A COMPUTED STYLE, because happy-dom applies no CSS
 * at all: there is no cascade to ask "what font is this?". What stands in for
 * it is the one fact every chip in `src/renderer` is styled through — `grep
 * font-mono` finds no second spelling of monospace anywhere in the tree — so
 * reading the class list is not a proxy here, it is the same fact
 * `e2e/chord-symbol-shots.mjs` confirms with real Chromium ink one layer
 * further out.
 *
 * PROSE IS SILENTLY FINE, and has to be: `chordSymbols('Mod-z')` sits inside
 * plain sentences all over this app (`FilesTab.tsx`'s notes, the reserved-key
 * refusal, both clash messages) and none of those paragraphs carries
 * `font-mono` — the body's own ambient face already is the sans stack, so a
 * bare glyph there reads exactly like the Send key option without needing a
 * wrapper of its own. Only a `font-mono` ancestor turns an unwrapped glyph
 * into a defect, which is what makes this check the SAME one #482 ran by
 * hand, not a stricter one.
 */

/** Apple's own modifier set, and the named keys `chords.ts`'s `APPLE_KEYS`
 *  draws as a pictogram — the literal set `ChordGlyphs` tags `glyph: true`. */
const GLYPHS = [
  '⌘',
  '⇧',
  '⌥',
  '⌃',
  '⏎',
  '⎋',
  '⇥',
  '⌫',
  '⌦',
  '↑',
  '↓',
  '←',
  '→',
  '⇞',
  '⇟',
  '↖',
  '↘',
  '⇪',
  '␣',
] as const;

export type GlyphViolation = {
  /** The whole text node that carried the glyph — context for the failure. */
  readonly text: string;
  readonly glyph: string;
  /** The `font-mono` ancestor's own class list, so a failure names the chip. */
  readonly monoAncestorClass: string;
};

/**
 * `root`'s text nodes, filtered to the ones this file's own header argues
 * over: a pictogram, sitting under a `font-mono` ancestor, with no
 * `font-sans` wrapper closer than that ancestor. Bounded to eight hops so a
 * whole-document sweep cannot walk past the component tree this ask is about
 * into chrome that was never a chip to begin with.
 */
export function findUnwrappedGlyphs(root: Node): readonly GlyphViolation[] {
  const doc = root.ownerDocument ?? (root as unknown as Document);
  const violations: GlyphViolation[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    const glyph = GLYPHS.find((each) => text.includes(each));
    if (glyph === undefined) {
      continue;
    }
    let el: Element | null = node.parentElement;
    let hops = 0;
    let sawMono: string | null = null;
    let wrapped = false;
    while (el !== null && hops < 8) {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (cls.includes('font-sans')) {
        wrapped = true;
        break;
      }
      if (cls.includes('font-mono')) {
        sawMono = cls;
        break;
      }
      el = el.parentElement;
      hops += 1;
    }
    if (sawMono !== null && !wrapped) {
      violations.push({ text, glyph, monoAncestorClass: sawMono });
    }
  }
  return violations;
}
