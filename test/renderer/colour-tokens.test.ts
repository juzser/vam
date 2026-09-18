/**
 * EVERY COLOUR CLASS THE RENDERER WRITES NAMES A TOKEN THAT EXISTS.
 *
 * Tailwind emits a rule for `bg-panel` because `styles.css` declares
 * `--color-panel`. It emits NOTHING for `bg-surface`, and nothing is not an
 * error anywhere: the element keeps whatever it inherited, the class sits in
 * the markup looking deliberate, and every test that reads `className` passes.
 *
 * TWO WERE FOUND BY THE SAME SWEEP, and they are the two shapes this failure
 * takes. `bg-surface` on the command palette was LOUD -- the floating panel
 * had no background at all and the canvas read straight through the command
 * list, which is how the operator found it ("the command palette needs a
 * background, it is transparent now so the text overlaps"). `text-ink-soft`
 * on a sub-agent's answer was SILENT: the line inherited its parent's ink, so
 * it looked fine and simply never wore the quieter tone it asked for. A guard
 * that only caught the loud one would have left the silent one for ever.
 *
 * WHAT IS AND IS NOT A COLOUR CLASS. The prefixes below are colour utilities,
 * but three families share them and take no colour: the type scale
 * (`text-body`, read from `--text-*` here rather than listed), widths and
 * keywords (`border-2`, `text-center`, `bg-cover`), and arbitrary values in
 * brackets. Each is excluded by a rule rather than by naming the classes, so
 * a new `text-meta` needs no edit here and a new `text-ink-soft` cannot hide
 * behind one.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDERER = new URL('../../src/renderer', import.meta.url).pathname;
const CSS = readFileSync(join(RENDERER, 'styles.css'), 'utf8');

/** `--color-x: …` in `@theme inline`, which is what makes `bg-x` a rule. */
const colourTokens = new Set([...CSS.matchAll(/^\s*--color-([a-z0-9-]+):/gm)].map((m) => m[1]));
/** `--text-x: …`, the type scale: `text-body` is a SIZE, not an ink. */
const sizeTokens = new Set([...CSS.matchAll(/^\s*--text-([a-z0-9-]+):/gm)].map((m) => m[1]));

const COLOUR_PREFIXES = [
  'bg',
  'text',
  'border',
  'border-t',
  'border-b',
  'border-l',
  'border-r',
  'ring',
  'fill',
  'stroke',
  'outline',
  'decoration',
  'caret',
  'accent',
  'divide',
  'placeholder',
  'from',
  'via',
  'to',
  'shadow',
] as const;

/** Tailwind keywords that share a colour prefix and are not colours. */
const KEYWORDS = new Set([
  'transparent',
  'current',
  'inherit',
  'white',
  'black',
  'none',
  'auto',
  'solid',
  'dashed',
  'dotted',
  'double',
  'hidden',
  'left',
  'right',
  'center',
  'justify',
  'start',
  'end',
  'top',
  'bottom',
  'wrap',
  'nowrap',
  'balance',
  'pretty',
  'ellipsis',
  'clip',
  'underline',
  'overline',
  'line-through',
  'no-underline',
  'uppercase',
  'lowercase',
  'capitalize',
  'normal-case',
  'wavy',
  'from-font',
  'cover',
  'contain',
  'repeat',
  'no-repeat',
  'fixed',
  'local',
  'scroll',
  'origin',
  'gradient',
  'collapse',
  'separate',
  'offset',
  'inset',
  // Shadow and outline take t-shirt sizes and offsets on the same prefix.
  'sm',
  'md',
  'lg',
  'xl',
  '2xl',
  'xs',
  '2xs',
  'offset-1',
  'offset-2',
  'offset-4',
]);

/**
 * `.tsx` ONLY, and comments stripped before anything is read.
 *
 * Both are corrections the first run demanded rather than taste. A `.ts`
 * module carries identifiers that read as classes to any regex --
 * `to-canvas.ts` in an import, `border-box` in a CSS value, `border-top-width`
 * in a DOM read -- and none of them is markup. And a doc comment that
 * EXPLAINS one of these bugs ("`bg-panel`, NOT `bg-surface` ...") is prose
 * about a class, not a use of it: left in, this sweep reported the very
 * classes whose removal it was describing.
 */
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...tsxFiles(path));
    else if (name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/** A class in the source, minus any variant prefix (`hover:`, `data-[x]:`). */
const CLASS =
  /(?:^|[\s"'`])((?:[a-z-]+:|data-\[[^\]]+\]:|group-[a-z-]+:)*)((?:[a-z]+-)+[a-z0-9-]+)/g;

describe('every colour class in the renderer names a token that exists', () => {
  const files = tsxFiles(RENDERER);

  it('found the renderer to scan, so the sweep below is about something', () => {
    // Without this the whole file is "no unknown classes in zero files".
    expect(files.length).toBeGreaterThan(30);
    expect(colourTokens.size).toBeGreaterThan(30);
    expect(sizeTokens.has('body')).toBe(true);
  });

  it('names no colour this stylesheet does not declare', () => {
    const unknown = new Map<string, string>();
    for (const file of files) {
      const source = withoutComments(readFileSync(file, 'utf8'));
      for (const [, , raw] of source.matchAll(CLASS)) {
        const cls = raw as string;
        for (const prefix of COLOUR_PREFIXES) {
          if (!cls.startsWith(`${prefix}-`)) continue;
          // A side letter is a WIDTH utility's axis, not part of a colour
          // name: `border-b`, `border-b-0`, `border-l-2`. Stripped so the
          // numeric and keyword rules below see what they are meant to.
          const raw2 = cls.slice(prefix.length + 1).split('/')[0] ?? '';
          const name = /^[tblrxy]-/.test(raw2) ? raw2.slice(2) : raw2;
          // A width (`border-2`), an arbitrary value, a keyword, or the type
          // scale: none of them is an ink.
          // A fragment of a template literal (`text-mode-${…}`) names no
          // class on its own; the value it builds is checked where it is
          // declared, which for the four of them is a token map.
          if (name === '' || name.endsWith('-') || /^\d/.test(name) || name.startsWith('[')) break;
          if (/^[tblrxy]$/.test(name)) break;
          if (KEYWORDS.has(name)) break;
          if (prefix === 'text' && sizeTokens.has(name)) break;
          if (colourTokens.has(name)) break;
          // `border-t-…` also matches the `border-` prefix; only report a
          // class no prefix could resolve.
          if (
            COLOUR_PREFIXES.some(
              (p) =>
                p !== prefix &&
                cls.startsWith(`${p}-`) &&
                colourTokens.has(cls.slice(p.length + 1)),
            )
          ) {
            break;
          }
          unknown.set(cls, file.replace(RENDERER, 'src/renderer'));
          break;
        }
      }
    }
    // Printed, not just counted: the failure has to name the class and the
    // file, or the next reader gets "20 unknown" and no way in.
    expect(
      [...unknown].map(([cls, file]) => `${cls} (${file})`),
      'colour classes that name no --color-* token',
    ).toEqual([]);
  });
});
