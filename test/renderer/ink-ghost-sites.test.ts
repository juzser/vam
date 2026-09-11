/**
 * Pins the CALL SITES of `ink-ghost`, not its value.
 *
 * `token-contrast.test.ts` measures what the token IS; this measures where it
 * is USED, and that is a different question from the one the standing lesson
 * (findings ledger: "a content scan proves a rule was typed, never that it
 * matches") warns about. That lesson is about a scan standing in for a
 * rendered measurement -- a class string in `styles.css` proving nothing
 * about an element nobody ever laid out. Here the property being asserted
 * IS the source text: "no file outside this allowlist writes the string
 * `text-ink-ghost` (or `border-` / `bg-` / `marker:text-`)". Reading the
 * source is not a proxy for that claim, it is the claim, so a regex over
 * `src/` is direct evidence rather than the banned shape. Do not read this
 * file's shape as an instance of that lesson; it is the case the lesson
 * itself does not cover.
 *
 * `ink-ghost` measures 1.84:1 dark / 2.39:1 light against `--vam-panel`
 * (issue 201) and is decorative-only after the token split: it may carry a
 * scrollbar thumb or a list bullet, never text or a border. A new site
 * outside the allowlist below is exactly the regression issue 201 fixed,
 * shipping again under a different component.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

function listSrcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...listSrcFiles(full));
    else if (['.ts', '.tsx'].includes(extname(e.name))) {
      out.push(relative(SRC_DIR, full).split(sep).join('/'));
    }
  }
  return out.sort();
}

/**
 * A Tailwind utility that actually paints `ink-ghost` onto something --
 * `text-`, `border-` or `bg-`, with an optional `marker:` variant in front.
 * Deliberately narrower than "the string ink-ghost appears": that would also
 * catch the token's own definition (`--vam-ink-ghost`, `--color-ink-ghost`
 * in `styles.css`) and prose that names the token without using it (the
 * comment one line above the allowlisted `DetailPanel` site, for instance).
 * Neither of those is a call site.
 */
const UTILITY_USE = /\b(?:marker:)?(?:text|border|bg)-ink-ghost\b/g;

/** Every file, and the exact utility class, allowed to use `ink-ghost`. */
const ALLOWLIST = [
  { file: 'renderer/panels/OverlayScroll.tsx', needle: 'bg-ink-ghost' },
  { file: 'renderer/panels/DetailPanel.tsx', needle: 'marker:text-ink-ghost' },
] as const;

interface Use {
  readonly file: string;
  readonly line: number;
  readonly needle: string;
}

function isAllowed(use: Use): boolean {
  return ALLOWLIST.some(({ file, needle }) => use.file === file && use.needle === needle);
}

describe('ink-ghost call sites (issue 201)', () => {
  it('is used only at the two decorative sites on the allowlist', () => {
    const files = listSrcFiles(SRC_DIR);
    // Proof the sweep read a corpus, not zero files: a scan of nothing passes
    // every assertion below for the wrong reason.
    expect(files.length).toBeGreaterThan(0);

    const found: Use[] = [];
    for (const file of files) {
      const lines = readFileSync(join(SRC_DIR, file), 'utf8').split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        for (const m of (lines[i] as string).matchAll(UTILITY_USE)) {
          found.push({ file, line: i + 1, needle: m[0] });
        }
      }
    }

    const unexpected = found.filter((use) => !isAllowed(use));
    expect(
      unexpected.map((u) => `${u.file}:${u.line}: ${u.needle}`),
      'ink-ghost is decorative-only (1.84:1 dark / 2.39:1 light on --vam-panel) -- ' +
        'text or a border belongs on --vam-ink-quiet',
    ).toEqual([]);

    // Every allowlisted site must actually be FOUND -- an empty scan and a
    // removed site both pass "no unexpected uses", so this is its own check.
    const missing = ALLOWLIST.filter(
      (site) => !found.some((use) => use.file === site.file && use.needle === site.needle),
    );
    expect(missing, 'allowlisted ink-ghost site(s) not found').toEqual([]);
  });
});
