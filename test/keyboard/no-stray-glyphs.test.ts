/**
 * ONE TABLE, AND NOTHING ELSE MAY SPELL A KEY GLYPH BY HAND.
 *
 * The operator, translated: "use the Shift, Enter, Command, … icons
 * consistently across the whole app; the icons in the Send key option under
 * Sessions settings are the best." `chords.ts`'s `APPLE_MODIFIERS` /
 * `APPLE_KEYS` are that one table — `chordSegments` and `chordSymbols` are its
 * only readers, and `ShortcutTip.tsx`'s `ChordGlyphs` is the one PAINTED
 * rendering built on top of them. A second file that types `⌘`/`⇧`/`⏎`/… into
 * a string or a JSX child is a second table nobody keeps in sync with the
 * first — the defect the phone keystroke strip shipped with, unicode
 * characters typed straight into `KEY_STRIP`'s captions, never once asking
 * `chords.ts` what platform it was even painting for.
 *
 * COMMENTS ARE EXEMPT AND STRIPPED FIRST. This codebase's own convention is a
 * doc comment that quotes the rendered form as prose — "⌘K on a Mac, Ctrl+K
 * off one" appears a dozen times over — and a scan that flagged those would
 * be too noisy to ever stay green. What is swept is CODE: string and template
 * literals and JSX text a browser can actually paint.
 *
 * A CORPUS FLOOR, OR THIS PROVES NOTHING (`a sweep must prove it found a
 * corpus`): the naive comment-stripper below could regress to matching zero
 * files just as easily as it could regress to matching every glyph away, and
 * a green run over an empty list is not a passing guard.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDERER_ROOT = join(__dirname, '../../src/renderer');

/** Apple's own glyphs, and the two named-Enter spellings this app has ever
 *  shipped (`chords.ts`'s own comment: "one app with two glyphs for Enter is
 *  the same defect as one key with two spellings"). */
const GLYPHS = ['⌘', '⇧', '⌥', '⌃', '⏎', '⎋', '⌫', '⇥', '␣', '↵'] as const;

/** The one file allowed to type a glyph literally: the table itself.
 *  `ShortcutTip.tsx` — the one PAINTED consumer — computes every glyph
 *  through `chordSegments`/`chordSymbols` and holds none of its own; it is
 *  not here on purpose, so a literal added to it would trip this guard too. */
const ALLOWED = new Set(['src/renderer/keyboard/chords.ts']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (/\.(tsx?|ts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Block comments, then line comments — order matters, or a `//` inside a
 *  `/* ... *\/` block would cut the block comment short. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('no hand-written key glyph escapes chords.ts’s one table', () => {
  it('sweeps a real corpus and finds the glyphs nowhere else', () => {
    const files = walk(RENDERER_ROOT);
    expect(files.length, 'the sweep must examine a real corpus').toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(join(RENDERER_ROOT, '../..'), file).replace(/\\/g, '/');
      if (ALLOWED.has(rel)) continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const glyph of GLYPHS) {
        if (code.includes(glyph)) {
          offenders.push(`${rel} paints "${glyph}" by hand instead of through chords.ts`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
