/**
 * THE TYPE SCALE, AND THE REASON IT IS A SCALE RATHER THAN A FOURTH SWEEP.
 *
 * The operator asked twice, in the same words: "the small fonts need to be 1px
 * larger". They got a one-off sweep both times, and both times the sweep drifted
 * back — because there was nothing to drift back FROM. `src/renderer` carried
 * 204 hardcoded `text-[Npx]` classes across eighteen files, in twelve distinct
 * sizes with half-pixel steps (54 at 11px, 47 at 12px, 31 at 11.5px, 19 at 10px,
 * 14 at 9.5px, and fifty of them at or below 10.5px), plus 23 more spelled as
 * Tailwind's own `text-xs` / `text-sm`. Nobody could answer "what size is a
 * caption here" without grepping, so every new caption invented its own answer.
 *
 * There are now four named steps and a floor. A call site picks a ROLE, not a
 * number:
 *
 *   text-meta     11px / 16px   subordinate text — the eyebrow over a value,
 *                               the count on an icon, the key cap beside an
 *                               action, the timestamp beside a message, the
 *                               path beside a name, the status bar under the
 *                               app. Never the only thing in its container.
 *   text-control  12px / 16px   the workhorse — button and menu labels, inputs,
 *                               hints, tooltips, empty states, refusals, the
 *                               secondary line under a title.
 *   text-body     13px / 20px   what the operator is actually reading or
 *                               naming — session, project, PR, agent and device
 *                               names, question text, the prompt they type, the
 *                               answer they read, a settings label.
 *   text-heading  15px / 20px   a section heading that has to out-rank the
 *                               13px labels underneath it.
 *
 * THE FLOOR IS 11px AND IT IS THE OPERATOR'S ACTUAL REQUEST. Fifty call sites
 * sat below it; none does now. `belowTheFloor` below is the assertion that says
 * so, and it reads the shipped source rather than this file's own table.
 *
 * WHY THE LINE HEIGHTS ARE IN THE SCALE. Every one of those 204 literals set a
 * size and no leading, so leading came from preflight's `line-height: 1.5` on
 * `html` and moved whenever the size did. Two of anything is how the
 * fragmentation comes back, so the pair is one decision: 16px under the two
 * small steps, 20px under the two large ones. Both numbers are Tailwind's own
 * (`text-xs` is 12/16 and `text-sm` is 14/20), which is why converting the 19
 * `text-xs` call sites to `text-control` moved nothing at all.
 *
 * A `leading-*` utility still wins over the role's line height, by Tailwind's
 * own design — `text-*` emits `line-height: var(--tw-leading, <the role's>)`.
 * That is deliberate and is used exactly where a glyph is centred in a fixed
 * box (`leading-none`), never to reintroduce a second leading for prose.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());
const RENDERER = resolve(ROOT, 'src/renderer');
const STYLES = resolve(RENDERER, 'styles.css');

/** The scale, as this test requires the stylesheet to declare it. */
const SCALE: ReadonlyArray<readonly [string, number, number]> = [
  ['meta', 11, 16],
  ['control', 12, 16],
  ['body', 13, 20],
  ['heading', 15, 20],
];

/** The smallest step. Nothing in the renderer may be set below this. */
const FLOOR = 11;

/**
 * The literal sizes that are allowed to remain, why, and how many there are.
 *
 * Every entry is a decision that the scale would make WORSE, written down so
 * that it stays a decision. A count rather than a floor, so that deleting one
 * of these reddens as loudly as adding a sixth.
 */
const EXCEPTIONS: ReadonlyArray<{
  readonly file: string;
  readonly size: string;
  readonly count: number;
  readonly why: string;
}> = [
  {
    file: 'panels/TerminalTab.tsx',
    size: '10.5',
    count: 1,
    why:
      'THE TMUX SCREEN IS MEASURED, NOT STYLED. `terminal-size.ts` divides the ' +
      "pane's box by the advance of one rendered character to decide the " +
      'columns and rows tmux is told to compose at, and its own header records ' +
      'the measurement it took: "Geist Mono at 10.5px measures 6.6015625px per ' +
      'advance here". Rounding this up to the scale would silently re-flow the ' +
      "operator's live session, and the screen tmux returns is already wrapped " +
      'by then — no CSS can undo a break that is in the text. The chrome AROUND ' +
      'the screen (its empty, pending and unreachable lines, and the size chip) ' +
      'is on the scale; the screen itself is not.',
  },
  {
    file: 'settings/PairingPanel.tsx',
    size: '40',
    count: 1,
    why:
      'The pairing code, and not body text at all. It is read off a desktop ' +
      'screen while typing it into a phone held in the other hand, which is the ' +
      'one thing in vam that is deliberately set at display size.',
  },
  {
    file: 'phone/PhoneShell.tsx',
    size: '18',
    count: 1,
    why:
      'The back chevron `\u2039`, which is a GLYPH used as an icon rather than ' +
      'text. Its size is chosen against the 16px lucide icons in the same bar, ' +
      'optically — a chevron paints far smaller than its em box, so matching it ' +
      'to a text step would make it the smallest thing in a 44px target.',
  },
  {
    file: 'phone/PhoneShell.tsx',
    size: '16',
    count: 1,
    why:
      'The close `\u00d7`, the other glyph-as-icon in the same bar, and 2px ' +
      'smaller than the chevron for the same optical reason in the other ' +
      'direction: a multiplication sign fills its em box where a chevron does ' +
      'not.',
  },
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return ['.ts', '.tsx'].includes(extname(name)) ? [path] : [];
  });
}

const FILES = sources(RENDERER);
const rel = (path: string): string => relative(RENDERER, path).split('\\').join('/');

/**
 * Every `text-[<n>px]` in the renderer, as `{file, size}` pairs.
 *
 * The scan reads each file as TEXT, so a class name written inside a comment
 * counts as a call site. That is a limitation on purpose rather than an
 * oversight: teaching it to strip comments means teaching it to strip `//` out
 * of a URL inside a string as well, and a scan that can silently swallow a
 * real class is worse than one that occasionally reddens on prose. The two
 * files with exempt sizes spell them in words in their comments, and say why
 * where they do it.
 */
const literals = FILES.flatMap((path) => {
  const source = readFileSync(path, 'utf8');
  return [...source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map((m) => ({
    file: rel(path),
    size: m[1] as string,
  }));
});

describe('the renderer sizes its type from one named scale', () => {
  it('scanned a real corpus', () => {
    // Every assertion below is vacuously true over an empty list, and this
    // repo has shipped a guard that examined zero files.
    expect(FILES.length).toBeGreaterThan(40);
    for (const name of ['panels/DetailPanel.tsx', 'panels/SessionList.tsx', 'canvas/Canvas.tsx']) {
      expect(FILES.map(rel)).toContain(name);
    }
  });

  it('declares the four steps, each with its own line height, in styles.css', () => {
    const css = readFileSync(STYLES, 'utf8');
    for (const [role, size, leading] of SCALE) {
      expect(css, `--text-${role}`).toMatch(new RegExp(`--text-${role}:\\s*${size}px\\s*;`));
      expect(css, `--text-${role}--line-height`).toMatch(
        new RegExp(`--text-${role}--line-height:\\s*${leading}px\\s*;`),
      );
    }
  });

  it('declares no fifth step — a scale nobody can add to by accident', () => {
    const css = readFileSync(STYLES, 'utf8');
    const declared = [...css.matchAll(/^\s*--text-([a-z-]+):/gm)]
      .map((m) => m[1] as string)
      .filter((name) => !name.endsWith('--line-height'));
    expect(declared.sort()).toEqual(SCALE.map(([role]) => role).sort());
  });

  it('uses the roles at a real number of call sites', () => {
    // The scale is only a scale if the code actually reaches for it. Under
    // this count the rules below would be passing over a renderer that had
    // simply deleted its type classes.
    const used = FILES.flatMap((path) => [
      ...readFileSync(path, 'utf8').matchAll(/text-(meta|control|body|heading)\b/g),
    ]);
    expect(used.length).toBeGreaterThan(180);
    for (const role of SCALE.map(([r]) => r)) {
      expect(used.filter((m) => m[1] === role).length, role).toBeGreaterThan(0);
    }
  });

  it('leaves no raw text-[Npx] outside the named exceptions', () => {
    const allowed = new Map(EXCEPTIONS.map((e) => [`${e.file}|${e.size}`, e.count]));
    const found = new Map<string, number>();
    for (const { file, size } of literals) {
      const key = `${file}|${size}`;
      found.set(key, (found.get(key) ?? 0) + 1);
    }
    expect(Object.fromEntries([...found].sort())).toEqual(Object.fromEntries([...allowed].sort()));
  });

  it('sets nothing below the 11px floor — the operator asked twice', () => {
    const belowTheFloor = literals
      .filter(({ size }) => Number(size) < FLOOR)
      .map(({ file, size }) => `${file}: ${size}px`);
    // The one thing under the floor is the tmux screen, and it is under it
    // because a measurement says so rather than because a caption was tuned by
    // eye. Spelled as the exact list, so a second one cannot join it quietly.
    expect([...new Set(belowTheFloor)]).toEqual(['panels/TerminalTab.tsx: 10.5px']);
  });

  it("spells no size as Tailwind's own text-xs / text-sm either", () => {
    // The other door. `text-xs` is 12/16 and `text-sm` is 14/20 — two more
    // sizes with no role attached, and the place the fragmentation would
    // reappear the day `text-[Npx]` was banned on its own.
    const strays = FILES.flatMap((path) => {
      const hits = [...readFileSync(path, 'utf8').matchAll(/\btext-(xs|sm|base|lg|xl|\dxl)\b/g)];
      return hits.map((m) => `${rel(path)}: text-${m[1]}`);
    });
    expect([...new Set(strays)].sort()).toEqual([]);
  });
});
