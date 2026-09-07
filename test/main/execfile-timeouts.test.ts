/**
 * Every `execFile` in the main process must carry a deadline.
 *
 * Main runs the window. A child process that never calls back does not merely
 * delay one feature -- it can strand whatever awaits it for the life of the
 * process. `usage/ipc.ts` is the worked example: it de-duplicates concurrent
 * reads through an `inFlight` promise cleared only after the read settles, so
 * one call that never settles pins `inFlight` forever and every later read
 * returns the same pending promise. The usage cell stops updating silently,
 * with nothing on screen to say why.
 *
 * `security find-generic-password` shipped without a timeout and is exactly
 * the call that can wait on a person: reading another application's Keychain
 * item can raise a macOS authorization dialog. Five of the six other sites
 * already had a bound; this one was missed, which is what makes a per-site
 * review the wrong instrument and a swept invariant the right one.
 *
 * This asserts the SOURCE TEXT, which is the claim itself rather than a proxy
 * for it: "no execFile call in src/main is written without a timeout". The
 * window reaches backwards as well as forwards because options are sometimes
 * declared on a preceding line (`runTailscale` does exactly that), and a
 * check that only looked forwards would report a false violation there.
 *
 * It matches `timeout:` and not the bare word deliberately. The first draft
 * of this file used /\btimeout\b/, and when the fix was reverted to check it,
 * the test still passed -- a doc comment above the call contained the word.
 * A guard that reads the prose around a call rather than the call is the
 * exact failure it was written to prevent, and it survived only because it
 * was falsified before being trusted.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MAIN_DIR = fileURLToPath(new URL('../../src/main', import.meta.url));
const LOOK_BACK = 6;
const LOOK_AHEAD = 12;

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (extname(entry.name) === '.ts') out.push(full);
  }
  return out;
}

type Site = { readonly file: string; readonly line: number; readonly hasTimeout: boolean };

function execFileSites(): Site[] {
  const sites: Site[] = [];
  for (const file of listFiles(MAIN_DIR)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, index) => {
      // The call itself, not the import of the symbol.
      if (!/\bexecFile\s*\(/.test(text)) return;
      const from = Math.max(0, index - LOOK_BACK);
      const window = lines.slice(from, index + LOOK_AHEAD).join('\n');
      sites.push({
        file: relative(MAIN_DIR, file).split(sep).join('/'),
        line: index + 1,
        // `timeout:` with the colon, not the bare word. The first version of
        // this guard matched /\btimeout\b/ and passed while the bug was
        // reintroduced, because a doc comment three lines up said "timeout".
        // It was measuring prose. Only the option assignment counts.
        hasTimeout: /\btimeout\s*:/.test(window),
      });
    });
  }
  return sites;
}

describe('every execFile in main has a deadline', () => {
  it('finds the execFile call sites at all', () => {
    // A sweep that examined nothing passes vacuously. The count is not pinned
    // -- adding a bounded call site should not fail this -- but zero means the
    // pattern has stopped matching what the code writes.
    expect(execFileSites().length).toBeGreaterThan(0);
  });

  it('passes a timeout at every call site', () => {
    const unbounded = execFileSites()
      .filter((s) => !s.hasTimeout)
      .map((s) => `${s.file}:${s.line}`);
    expect(unbounded, 'an execFile with no timeout can strand main forever').toEqual([]);
  });
});
