/**
 * Executable form of epic.md section 13.1, so `vitest run` enforces it
 * permanently instead of as prose duplicated across task specs.
 *
 * BLIND SPOT: the rule below is a CONTENT SCAN over source text — it cannot
 * distinguish code from prose, and cannot see a dynamic import, a re-export,
 * an aliased identifier or a string-keyed lookup. Not hypothetical: 13.1's
 * hex pattern once matched "PR #482 open", a pull-request number, not a
 * colour. No rule claims more than a regex over file content can prove.
 *
 * 0.2 migration, step 2: sections 13.2(a)/(b)/(c) and the drag/pin residue
 * instrument retired here, along with `grid.ts`, `canvas/*Node.tsx` and
 * `layoutCanvas` — the geometry, the props-only node contract and the
 * drag/pin vocabulary those rules pinned all left with the graph. 13.1 (no
 * literal hex colour) is not a graph rule; it survives verbatim.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url));
const SELF_PATH = fileURLToPath(import.meta.url);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

function listSrcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...listSrcFiles(full));
    else out.push(relative(SRC_DIR, full).split(sep).join('/'));
  }
  return out.sort();
}

const allSrcFiles = listSrcFiles(SRC_DIR);

/**
 * THE THREE FILES WHERE A HEX IS THE POINT, and why they are not holes in 13.1.
 *
 * The rule is "every colour must come from a token". What it really catches is
 * a COMPONENT that paints `#fff` instead of reaching for one -- a call site
 * with a colour baked into it. A file whose whole job is to DEFINE colour
 * values sits at the other end of that relationship, and scanning it would be
 * asking the definitions to come from themselves.
 *
 *  - `styles.css` is where the palette lives; it was always excluded, and the
 *    rule's own comment says why.
 *  - `renderer/prefs/palette-templates.ts` is where the colour TEMPLATES live.
 *    A template is a whole palette the operator applies in one press, and it is
 *    values by definition: there is no token for it to reach for, because its
 *    entire content is the alternative set of values a token can take.
 *
 *  - `renderer/prefs/terminal-scheme.ts` is where the TERMINAL'S SCHEMES
 *    live: twelve tables of twenty-three colours each, the shape every
 *    emulator publishes its themes in. It is values by definition in the
 *    same way a template is, and more so -- a scheme is what the sixteen
 *    `--vam-ansi-*` tokens are SET TO on the screen's own element, so there
 *    is no token above it for a value to come from.
 *
 * THE EXCLUSION IS PAID FOR RATHER THAN ASSERTED, which is the half that
 * matters. `test/prefs/palette-templates.test.ts` measures every value in that
 * file against every ink the stylesheet keeps -- 360 contrast pairs, plus the
 * elevation ladder, the two JND separations and the In bubble's floors, per
 * template, per theme. That is strictly stronger than "contains no hex", so
 * the file is not leaving cover; it is moving to better cover.
 *
 * The scheme file is paid for differently, and the difference is stated
 * rather than hidden: its values are NOT measured against vam's floors,
 * because they are not vam's -- the dark default is the operator's own
 * scheme taken verbatim, and the rest are published palettes under their
 * own names. What holds them is `test/prefs/terminal-scheme.test.ts`, which
 * pins both defaults digit for digit, holds every table to twenty-three
 * six-digit values, and holds the two `vam` themes to the stylesheet's own
 * ramp; and `e2e/terminal-scheme-shots.mjs`, which reads what those values
 * resolve to off a real paint and proves they reach nothing outside the
 * screen.
 *
 * NARROW, AND CHECKED TO STILL EXIST. An exclusion by path widens silently the
 * moment somebody renames the file, so all three names are asserted present
 * below.
 */
const COLOUR_DEFINITION_FILES = [
  'styles.css',
  'renderer/prefs/palette-templates.ts',
  'renderer/prefs/terminal-scheme.ts',
];

/**
 * THE OTHER KIND OF EXEMPTION: a colour that is not a colour.
 *
 * 13.1 says every colour must come from a token, and the thing it catches is a
 * component painting `#fff` where it should have reached for one. `QrAddress`
 * paints `#000000` on `#ffffff` and neither is a design decision: a QR symbol
 * is a MACHINE-READABLE OBJECT, and dark-modules-on-light-field is part of how
 * it is read, not of how it looks. Tokenised, it would follow the palette --
 * which the operator can repaint in one press from Settings -- and in the dark
 * theme it would become the photographic negative of a QR code.
 *
 * PAID FOR, like the two above. `test/settings/qr-address.test.tsx` asserts
 * those exact two literals, so changing them reddens a test rather than
 * slipping through a hole; `test/settings/qr.test.ts` holds the symbol's
 * structure; and `e2e/qr-decode-check.mjs` hands the rendered symbol to macOS's
 * own Vision barcode detector, which is a stronger statement about those
 * colours than "they came from a token" could ever be.
 */
const MACHINE_READABLE_FILES = ['renderer/settings/QrAddress.tsx'];

/** Every path 13.1 does not scan, and each one is named and checked below. */
const HEX_EXEMPT = [...COLOUR_DEFINITION_FILES, ...MACHINE_READABLE_FILES];

const cssAndTsFiles = allSrcFiles.filter(
  (f) =>
    !HEX_EXEMPT.some((skip) => f === skip || f.endsWith(`/${skip}`)) &&
    ['.ts', '.tsx', '.css'].includes(extname(f)),
);

const at = (f: string, i: number, l: string) => `src/${f}:${i + 1}: ${l.trim()}`;

// Each rule scans one set of files, line by line; a non-null return is a violation
// with the file, line number and rule it breaks, per the honesty requirement above.
const RULES: {
  name: string;
  files: string[];
  rule: string;
  check: (f: string, l: string, i: number) => string | null;
}[] = [
  {
    // epic.md 13.1's recorded target ("one line", SessionList.tsx:69, a "PR #482"
    // comment) is stale: removed at b7bb3c8 by task-8-sidebar-row while
    // rebuilding the row, not to force a zero. Zero is the correct reading now.
    // styles.css is excluded: it is where the tokens are defined.
    name: '13.1: no literal hex colour under src/ *.ts, *.tsx or *.css, excluding styles.css',
    files: cssAndTsFiles,
    rule: 'Every colour must come from a token, never a literal hex (13.1):',
    check: (f, l, i) => (/#[0-9a-fA-F]{3,8}\b/.test(l) ? at(f, i, l) : null),
  },
];

describe('epic.md section 13: standing constraints, made permanent and checkable', () => {
  it.each(RULES)('$name', ({ files, rule, check }) => {
    // A rule whose selector matches nothing scans nothing and reports no
    // violations, so it passes -- silently, forever, and most likely right
    // after someone renames or moves the files it was watching. That is the
    // exact failure this file was written to end (finding b80ce28a: a
    // case-sensitive grep that printed 0 and read clean), so it must not be
    // reachable from inside the instrument itself. If this fires, fix the
    // selector; deleting the rule is how the check dies quietly.
    expect(
      files.length,
      `${rule}\nThis rule matched NO files, so it checked nothing and would have passed vacuously.`,
    ).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const f of files) {
      readFileSync(join(SRC_DIR, f), 'utf8')
        .split('\n')
        .forEach((l, i) => {
          const m = check(f, l, i);
          if (m) violations.push(m);
        });
    }
    expect(violations, [rule, ...violations].join('\n')).toEqual([]);
  });

  it('excludes only files that still exist, so a rename cannot widen 13.1 in silence', () => {
    // An exclusion list is a hole with a name on it. The moment one of these
    // files moves, the name stops matching, the exclusion stops excluding --
    // and the DANGEROUS half is the other direction: a file renamed INTO one
    // of these paths would be excluded without anyone deciding that. Both are
    // caught by requiring each entry to name a real file.
    const missing = HEX_EXEMPT.filter(
      (skip) => !allSrcFiles.some((f) => f === skip || f.endsWith(`/${skip}`)),
    );
    expect(missing, 'a 13.1 exclusion names a file that is no longer there').toEqual([]);
    // And the exclusion actually removed something, or it is decoration.
    expect(allSrcFiles.length).toBeGreaterThan(cssAndTsFiles.length);
  });

  /**
   * EVERY `<hr>` HAS TO SAY WHAT ITS TOP BORDER IS, because Tailwind's
   * preflight already decided for it.
   *
   * Preflight resets `*` to `border: 0 solid` and then gives `hr` a
   * `border-top-width: 1px` back, coloured `currentColor`. So an `<hr>` this
   * repo writes without saying otherwise paints a one-pixel rule across its
   * own top edge in the ink colour of its column — the near-white hairline the
   * operator reported at the sidebar's top corner, and the same rule drawn
   * hundreds of pixels wide across a horizontal split divider.
   *
   * The three drag handles now take that decision from one place
   * (`RESIZE_HANDLE_RESET`), which is what this scans for. An `<hr>` that
   * WANTS a rule — the markdown one in `out-markdown.tsx` — satisfies the same
   * question by declaring a `border-` utility of its own. What cannot pass is
   * an `<hr>` that answers neither, because that is a border nobody chose.
   *
   * THIS IS A CONTENT SCAN AND IT PROVES ONLY THAT THE RULE WAS TYPED. What is
   * actually painted at the seam is measured in
   * `e2e/sidebar-seam-shots.mjs`, which rasterises it. The two are not
   * redundant: this one catches a FOURTH handle written next year, which no
   * screenshot of today's app can.
   */
  it('every <hr> either takes the shared handle reset or declares its own border', () => {
    const tsxFiles = allSrcFiles.filter((f) => f.endsWith('.tsx'));
    expect(
      tsxFiles.length,
      'the .tsx selector matched nothing, so this rule scanned no files at all',
    ).toBeGreaterThan(0);
    const found: string[] = [];
    const composing: string[] = [];
    const undecided: string[] = [];
    for (const f of tsxFiles) {
      const text = readFileSync(join(SRC_DIR, f), 'utf8');
      // Each JSX `<hr` element up to the `/>` that closes it — these are all
      // self-closing, and an `<hr>` with children would not be an `<hr>`.
      //
      // `<hr` FOLLOWED BY WHITESPACE, never `<hr>`: the prose above every one
      // of these handles says "a native <hr>", and a match that started in
      // that sentence ran on to the real element's `/>` and carried the
      // comment's own mention of the constant with it — so a handle whose
      // class list had dropped the reset still read as composing it. Found by
      // mutation, not by inspection: the harness stripped `PaneResizer`'s
      // reset and this test stayed green.
      for (const m of text.matchAll(/<hr\s+(?!>)[\s\S]*?\/>/g)) {
        // Comments inside the element (a `//` line in a class array) are
        // prose too, and are removed before the element is read.
        const element = m[0].replace(/\/\/[^\n]*/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
        found.push(`src/${f}`);
        // The interpolated form, which is the only way a constant reaches a
        // class string — a bare mention would be a name, not a class.
        const composes = /\$\{RESIZE_HANDLE_RESET\}/.test(element);
        if (composes) composing.push(`src/${f}`);
        const decided = composes || /\bborder-(?:0|t\b|t-)/.test(element);
        if (!decided) undecided.push(`src/${f}: ${element.split('\n')[0]?.trim() ?? ''}`);
      }
    }
    // Both halves of the corpus, asserted rather than printed. Four `<hr>`
    // elements exist: three resize handles and the markdown rule. A rename
    // that stopped the pattern matching would otherwise leave this green.
    expect(
      found.length,
      `only found ${found.length} <hr> elements: ${found.join(', ')}`,
    ).toBeGreaterThanOrEqual(4);
    expect(
      composing.length,
      `only ${composing.length} <hr> compose RESIZE_HANDLE_RESET: ${composing.join(', ')}`,
    ).toBeGreaterThanOrEqual(3);
    expect(
      undecided,
      `an <hr> takes preflight's 1px top border by default:\n${undecided.join('\n')}`,
    ).toEqual([]);
  });

  it('this file documents its own blind spot, so a future editor cannot silently strip it', () => {
    const contents = readFileSync(SELF_PATH, 'utf8');
    const phrases = ['CONTENT SCAN', 'cannot distinguish code from prose', 'PR #482'];
    for (const phrase of phrases) {
      expect(contents.includes(phrase), `blind-spot comment is missing "${phrase}"`).toBe(true);
    }
  });
});
