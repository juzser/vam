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
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZES,
} from '../../src/renderer/prefs/terminal-font.js';

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
    file: 'panels/PairingScreen.tsx',
    size: '24',
    count: 1,
    why:
      'The MIRROR of the desktop exception below, and display type for the same ' +
      'reason. This is the field the code is typed INTO, on a phone, from an ' +
      'alphabet chosen so that no two glyphs are confusable — and a character ' +
      'the operator cannot verify as they type it defeats the choice of ' +
      'alphabet. 24px rather than 40 because it sits in an input on a 320px ' +
      'column with eight characters and 0.2em of tracking, where 40 would not ' +
      'fit. The prose around it is on the scale; the code is not.',
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
    file: 'panels/PairingScreen.tsx',
    size: '16',
    count: 1,
    why:
      'The device-name field, and not a reading size at all: iOS Safari zooms ' +
      'the page on focus for any control under 16px and does not undo it ' +
      'cleanly, which `styles.css`’s own `[data-phone-shell] input` rule ' +
      'already holds the floor for everywhere a shell exists. This screen ' +
      'mounts BEFORE any shell does -- there is nothing paired yet to host one ' +
      '-- so that selector cannot reach it, and a desktop browser can land ' +
      'here too, so the floor is unconditional rather than a phone-only class.',
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
  {
    file: 'panels/SessionList.tsx',
    size: '14',
    count: 5,
    why:
      'The sidebar\u2019s project and group titles. Operator, in one breath: ' +
      '"make the project and group titles bold and 1px smaller; the session ' +
      'name regular weight and also 1px smaller." One pixel below `heading` ' +
      '(15) and not a new number between two steps -- it lands on none of the ' +
      'other three, so it is written here rather than smuggled in as a fifth ' +
      'step. Five call sites, not one: the group heading name, the project ' +
      'heading name, the provisional project heading a session-in-flight ' +
      'draws before it has a real section to join (which has to match the ' +
      'real heading\u2019s size and weight exactly, or the row would visibly ' +
      'change size the moment the session arrives and the two swap), and the ' +
      'two heading ICON slots -- an emoji is text and takes its size from the ' +
      'slot it sits in, and `HEADING_GLYPH_PX`\u2019s own history is what a ' +
      'heading whose picture and word disagree on size looks like, so the ' +
      'icon moved with the caption rather than being left at `text-heading`.',
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
    // A SET, NOT A LIST, and the difference arrived with the pane's reading
    // size: `[data-reading-pane]` RE-DECLARES `--text-body` and
    // `--text-control` in terms of `--vam-out-font-size`, so two of the four
    // names now appear twice in this file. A scoped override is not a fifth
    // step — it is the same step, re-answered for one subtree — and the rule
    // this assertion exists for is about NAMES. The block itself is checked
    // below rather than merely tolerated here.
    const declared = new Set(
      [...css.matchAll(/^\s*--text-([a-z-]+):/gm)]
        .map((m) => m[1] as string)
        .filter((name) => !name.endsWith('--line-height')),
    );
    expect([...declared].sort()).toEqual(SCALE.map(([role]) => role).sort());
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
    // NOTHING AT ALL NOW, and the one thing that used to be here is worth a
    // sentence because it left rather than being raised. The tmux screen was
    // set at a literal 10.5px and exempted on the grounds that the size is a
    // MEASUREMENT (`terminal-size.ts` divides the pane's box by the advance of
    // one character rendered at it). It is still measured; it is no longer a
    // literal. The size is an operator setting whose default is above this
    // floor, so there is no class left to exempt.
    expect([...new Set(belowTheFloor)]).toEqual([]);
  });

  /**
   * THE FLOOR IS ABOUT CLASSES, NOT ABOUT PIXELS -- and the terminal is where
   * that distinction became load-bearing rather than pedantic.
   *
   * The rule above now finds nothing under 11px, and that would be a cheerful
   * lie on its own: `prefs/terminal-font.ts` offers 10.5px, and an operator
   * who picks it gets a pane set below the floor. That is not the thing the
   * floor exists to stop. Fifty call sites sat under it because captions had
   * been tuned smaller by eye, one at a time, with nobody able to say what
   * size a caption was; a person deliberately choosing the density of their
   * own terminal is the opposite act. The exception is written down HERE, in
   * the guard, so that it stays a decision -- and derived from the shipped
   * list, so that a fifth offered size cannot appear without this reading it.
   */
  it('names the one place a size below the floor is the operator’s to choose', () => {
    const under = TERMINAL_FONT_SIZES.filter((size) => size < FLOOR);
    expect(under).toEqual([10.5]);
    // And the DEFAULT is not one of them: shipping below the floor to everyone
    // is what the floor does stop.
    expect(DEFAULT_TERMINAL_FONT_SIZE).toBeGreaterThanOrEqual(FLOOR);
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

/**
 * THE PANE'S READING SIZE, DERIVED RATHER THAN RESTATED.
 *
 * Operator report, translated: "the font size of the other parts of the pane
 * (in bubble, heading, choice popover, prompt input...) needs to be in
 * proportion to the out font size; at `out` 15 the answers are comfortably
 * large but the prompt's choice options are now very small." Measured on the
 * shipped build at `out` 15: the answer prose is 15px and the option label is
 * `text-control` at a flat 12px.
 *
 * The answer is a SCOPE that re-declares two of the four steps as multiples of
 * the reading size, so that every call site keeps the role it already picked.
 * That puts a second table of type numbers in `styles.css`, which is exactly
 * what this file exists to prevent — so the numerators and the denominator are
 * recomputed here from the scale's own declarations. Change 13 to 14 in
 * `@theme` and this reddens until the ratios follow.
 */
describe('the response pane re-declares the scale against the reading size', () => {
  const css = readFileSync(STYLES, 'utf8');
  const block = /\[data-reading-pane\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const bodySize = SCALE.find(([role]) => role === 'body')?.[1] ?? 0;

  it('has a block at all, keyed to the pane and nothing wider', () => {
    // A selector that matches nothing reads exactly like one that works;
    // `e2e/view-width-shots.mjs` measures the painted result, and this only
    // claims the rule was typed.
    expect(block, 'no [data-reading-pane] rule in styles.css').not.toBe('');
    expect(bodySize).toBeGreaterThan(0);
  });

  it('scales exactly the two steps that carry what is being READ', () => {
    // `meta` is the scale's own floor and it is chrome ANNOTATING the reading —
    // the timestamp, the key cap, the count, and the terminal's status rule,
    // which sits under a screen whose size has a setting of its own. It is
    // pinned at 11px because the operator asked twice for the small fonts to be
    // bigger. `heading` has no call site in a response pane at all, and a
    // declaration with no reader is the shape `prefs.no-write-only-field.test.ts`
    // exists to catch one layer down.
    const overridden = [...block.matchAll(/--text-([a-z]+):/g)].map((m) => m[1] as string);
    expect(overridden.sort()).toEqual(['body', 'control']);
    for (const role of ['meta', 'heading']) {
      expect(block, `--text-${role} must not be scoped`).not.toContain(`--text-${role}:`);
    }
  });

  it('scales each one by its own share of the body step, sizes and leadings alike', () => {
    // The pair is one decision — the scale's own header says so, and every one
    // of the 204 literals it replaced set a size and no leading. A 20px body on
    // a 20px leading is a wall of text.
    for (const [role, size, leading] of SCALE.filter(([r]) => r === 'body' || r === 'control')) {
      const declaration = new RegExp(`--text-${role}:\\s*([^;]+);`).exec(block)?.[1]?.trim() ?? '';
      const paired =
        new RegExp(`--text-${role}--line-height:\\s*([^;]+);`).exec(block)?.[1]?.trim() ?? '';
      // The body step IS the reading size, so it carries no ratio at all.
      expect(declaration, `--text-${role}`).toBe(
        size === bodySize
          ? 'var(--vam-pane-size)'
          : `calc(var(--vam-pane-size) * ${size} / ${bodySize})`,
      );
      expect(paired, `--text-${role}--line-height`).toBe(
        `calc(var(--vam-pane-size) * ${leading} / ${bodySize})`,
      );
    }
  });

  it('scales UP only, so the 11px floor is never walked back through', () => {
    // `--vam-pane-size` is `max(<the body step>, <the out size>)`. The
    // operator's report is that a LARGE `out` leaves the rest of the pane too
    // small; nobody asked for a small `out` to shrink the chrome, and doing it
    // would put the control step at 9.2px at `out` 10 — under the floor this
    // file is named for. It is also what keeps the steps in order at every
    // setting, which a per-step floor would not.
    const size = /--vam-pane-size:\s*([^;]+);/.exec(css)?.[1]?.trim() ?? '';
    expect(size, 'no --vam-pane-size declaration').not.toBe('');
    expect(size).toMatch(/^max\(/);
    expect(size).toContain('var(--text-body)');
    expect(size).toContain('var(--vam-out-font-size)');
  });
});
