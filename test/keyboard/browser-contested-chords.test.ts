/**
 * THE CHORDS THE BROWSER ALSO WANTS, counted.
 *
 * vam ships ONE renderer TWO ways, and only one of them was ever reasoned
 * about here. In the Electron app the single thing that can take a keystroke
 * before the page sees it is the application menu -- vam owns that menu
 * (`src/main/menu.ts`) and `test/electron/launch.test.ts` walks the BUILT one,
 * so that half is measured. The other half is a page served over Tailscale
 * Serve, where the competitor is the browser itself, and nothing in this repo
 * had looked at it.
 *
 * IT SURFACED ON `Mod-0`. `chords.ts` argues that binding is safe and argues
 * it only about Electron: "vam owns its application menu since then and that
 * menu has no `viewMenu` at all, so nothing native answers the key". True, and
 * about one deployment. In a browser tab `Cmd/Ctrl+0` is zoom reset, and the
 * README promises `H` / `Mod-0` unconditionally.
 *
 * ── WHAT THIS FILE IS, AND WHAT IT IS HONESTLY NOT ────────────────────────
 * The left-hand side is MEASURED: `BINDING_TABLES` is vam's own grammar and
 * this walks it. The right-hand side is NOT. `CONTESTED` below is platform
 * lore -- what Chrome and Safari bind, and which of those a page may cancel --
 * and no test in this repo can verify it, for a structural reason worth
 * writing down once:
 *
 *   Playwright dispatches keys over CDP's `Input.dispatchKeyEvent`, straight
 *   into the renderer. They never pass through the browser's accelerator
 *   table, so a chord the browser reserves arrives at the page exactly like
 *   one it does not. Headed or headless makes no difference. This is proved
 *   rather than assumed in `e2e/key-truth-shots.mjs`, which presses `Mod-0`
 *   and reads the page's zoom back UNCHANGED.
 *
 * So this file cannot tell you that `Mod-5` is lost in Chrome. What it CAN do,
 * and the only reason it exists, is make the SET visible and make it redden
 * when it grows: bind a new action to a chord a browser reserves and this goes
 * red, and whoever did it has to decide knowingly rather than find out from an
 * operator. Confirming the right-hand column takes a person pressing keys in a
 * real window -- named here so it is a known gap rather than a silent one.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BINDING_TABLES, RESERVED_KEYS } from '../../src/renderer/keyboard/chords.js';

/**
 * What a browser does with a chord, as documented by Chrome and Apple.
 *
 *  - `reserved`   -- the browser acts and a page cannot stop it. Zoom, tab
 *                    selection, tab and window lifecycle.
 *  - `cancelable` -- the browser acts unless the page calls `preventDefault`,
 *                    which vam does for every chord it resolves
 *                    (`Canvas.tsx`, before the action switch).
 *
 * Anything not named here is not known to be claimed by a browser.
 */
const CONTESTED: Readonly<Record<string, 'reserved' | 'cancelable'>> = {
  // Zoom. The one that started this.
  'Mod-0': 'reserved',
  // Select tab N, and `Mod-9` is "the last tab" rather than the ninth.
  'Mod-1': 'reserved',
  'Mod-2': 'reserved',
  'Mod-3': 'reserved',
  'Mod-4': 'reserved',
  'Mod-5': 'reserved',
  'Mod-6': 'reserved',
  'Mod-7': 'reserved',
  'Mod-8': 'reserved',
  'Mod-9': 'reserved',
  // Tab and window lifecycle.
  'Mod-n': 'reserved',
  'Mod-t': 'reserved',
  'Mod-w': 'reserved',
  // Previous / next tab on macOS Chrome and Safari.
  'Mod-Shift-[': 'reserved',
  'Mod-Shift-]': 'reserved',
  // Bound, and a page may take them.
  'Mod-p': 'cancelable', // print
  'Mod-k': 'cancelable', // search from the address bar
  'Mod-d': 'cancelable', // bookmark this page
  'Mod-u': 'cancelable', // view source
  'Mod-[': 'cancelable', // back
};

/** Every `Mod-` chord the shipped grammar binds, plus the ones wired by hand
 *  outside the tables -- `Mod-[` lives in `DetailPanel`'s own `onKeyDown` and
 *  is declared in `RESERVED_KEYS`, so a walk of the tables alone would miss
 *  the single chord this whole question started on. */
function boundModChords(): string[] {
  const found = new Set<string>();
  for (const { table } of BINDING_TABLES) {
    for (const key of Object.keys(table)) {
      if (key.startsWith('Mod-')) found.add(key);
    }
  }
  for (const key of RESERVED_KEYS) {
    if (key.startsWith('Mod-')) found.add(key);
  }
  return [...found].sort();
}

const README = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8');

/** The section the README keeps this in, read as data rather than trusted as
 *  prose: the heading, then everything up to the next heading. */
function readmeSection(heading: string): string {
  const at = README.indexOf(heading);
  if (at === -1) throw new Error(`README has no "${heading}" section`);
  const rest = README.slice(at + heading.length);
  const end = rest.search(/\n#{1,6} /);
  return end === -1 ? rest : rest.slice(0, end);
}

describe('the chords a browser also wants', () => {
  it('binds a grammar big enough for this question to be about something', () => {
    // Four guards in this repo have gone green having examined zero of
    // anything. The literal is the point: it turns a shrunken grammar into a
    // failure rather than a quieter pass.
    expect(boundModChords().length).toBeGreaterThanOrEqual(20);
  });

  it('lands on exactly this many chords a browser will not give up', () => {
    // THE CENSUS. A loud failure is a sample of a silent family: `Mod-0` was
    // reported, and it has fourteen siblings. Written out rather than counted,
    // so that binding a new action to `Mod-r` (reload) reddens HERE, at the
    // moment of the decision, instead of on an operator's screen.
    const reserved = boundModChords().filter((key) => CONTESTED[key] === 'reserved');
    expect(reserved).toEqual([
      'Mod-0',
      'Mod-1',
      'Mod-2',
      'Mod-3',
      'Mod-4',
      'Mod-5',
      'Mod-6',
      'Mod-7',
      'Mod-8',
      'Mod-9',
      'Mod-Shift-[',
      'Mod-Shift-]',
      'Mod-n',
      'Mod-t',
      'Mod-w',
    ]);
  });

  it('names every one of them in the README, and names no chord it does not bind', () => {
    // THE CLAIM AND THE CODE, HELD TOGETHER. The README is where an operator
    // is told what a key does, and until now it promised all fifteen of these
    // with no mention that one of vam's two deployments has to share them. The
    // section is parsed rather than eyeballed, BOTH WAYS: a chord that joins
    // the list above and is not documented reddens, and a chord documented
    // here that vam does not actually bind reddens too -- the second is how a
    // caveat outlives the binding it was written for, which is the same defect
    // as a hint that outlives its behaviour.
    const section = readmeSection('#### In a browser tab');
    const named = [...section.matchAll(/`(Mod-[A-Za-z0-9[\]-]*)`/g)].map((m) => m[1] as string);
    const reserved = boundModChords().filter((key) => CONTESTED[key] === 'reserved');
    expect([...new Set(named)].sort()).toEqual(reserved);
  });

  it('says which deployment the caveat is about, and which one it is not', () => {
    // A caveat that did not name Electron would read as "these keys are
    // unreliable", and they are not: vam owns that menu and removed the four
    // items that used to claim them.
    const section = readmeSection('#### In a browser tab');
    expect(section).toMatch(/Electron|desktop app/);
  });
});
