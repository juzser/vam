/**
 * NOTHING VAM SAYS OUT LOUD NAMES THE CANVAS ANY MORE.
 *
 * 0.2 deleted the node graph. The epic's step 5 is a copy sweep, and it is not
 * cosmetic: four refusals told the operator a session "may have exited since
 * the canvas was drawn", the stream's failure card said "the canvas will not
 * update on its own", and the demo's own status bar read "this canvas is
 * read-only". Every one of those sentences now names a surface that does not
 * exist — so the operator reading them either learns a word for nothing, or
 * goes looking for a view that was removed.
 *
 * A REFUSAL IS THE WORST PLACE TO BE VAGUE. Those four are the sentences a
 * person reads at the exact moment something did not work, which is when a
 * stale noun costs the most.
 *
 * ── WHAT IS SCANNED, AND WHY THE SCAN IS NEGATIVE ────────────────────────
 * A negative scan is the only safe kind over source: an earlier guard in this
 * repo asked for a class to be PRESENT and was satisfied by finding it inside
 * a comment. This asks for an ABSENCE, so prose containing the forbidden
 * pattern can only make it redder.
 *
 * Comments are stripped first, because the canvas is part of this project's
 * history and a comment explaining what was removed is worth keeping — the
 * epic lists `stop.ts`, `repo.ts` and `session-status.ts` as comment mentions
 * and asks for none of them to change.
 *
 * `src/renderer/fixtures/` IS EXCLUDED, deliberately and narrowly: it is a
 * fabricated TRANSCRIPT, and its lines are dialogue an imaginary operator and
 * agent exchanged about vam's own design. Editing them would be rewriting a
 * conversation rather than fixing a label. They are sample CONTENT; this guard
 * is about vam's CHROME. (If the demo's dialogue should move on from the
 * canvas too, that is a content decision, not a copy defect.)
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd(), 'src');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'fixtures') continue;
      out.push(...sources(path));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(path);
    }
  }
  return out;
}

/**
 * The file with its comments removed.
 *
 * Block comments first, then whole-line `//`. An inline `//` after code is
 * left alone on purpose: stripping it needs a parser that knows a `//` inside
 * a string from one that starts a comment, and getting that wrong would hide
 * real prose rather than reveal it.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Every quoted or templated literal long enough to be a sentence. */
function literals(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*?)\1/gs)) {
    const value = match[2] ?? '';
    if (value.includes(' ')) out.push(value);
  }
  return out;
}

describe('the copy vam shows', () => {
  it('never names the canvas, which 0.2 removed', () => {
    const files = sources(ROOT);
    // THE CORPUS, INSIDE THE ASSERTION. A sweep that walked an empty tree
    // would pass every claim about what it did not find.
    expect(files.length, 'no sources were scanned at all').toBeGreaterThan(50);

    let sentences = 0;
    const stale: string[] = [];
    for (const file of files) {
      for (const value of literals(code(readFileSync(file, 'utf8')))) {
        sentences += 1;
        // `the canvas` / `this canvas`, which is how a SURFACE is named. It
        // leaves `session-canvas` in a design note about an external mockup,
        // and it leaves every identifier — `DemoCanvas`, `CanvasSource`,
        // `to-canvas.ts` — where they are. Renaming code is a different
        // change with a different risk, and this one is about what the
        // operator reads.
        if (/\b(the|this) canvas\b/i.test(value)) {
          stale.push(`${relative(ROOT, file)}: ${value.slice(0, 80)}`);
        }
      }
    }

    expect(sentences, 'no sentence-shaped literals were found').toBeGreaterThan(200);
    expect(stale).toEqual([]);
  });
});
