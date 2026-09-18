/**
 * EVERY BROWSER CAPABILITY VAM DENIES ITSELF, COUNTED.
 *
 * `src/main/index.ts` registers a deny-all permission policy: `callback(false)`
 * for every request and `setPermissionCheckHandler(() => false)` for every
 * check. That is a deliberate security decision and this file is not an
 * argument against it. It is the argument for knowing what it costs.
 *
 * ── WHY IT EXISTS ─────────────────────────────────────────────────────────
 * The policy shipped with a comment that read "Nothing this app renders needs
 * any of these, so nothing is allowlisted back in." That was true when it was
 * written and false twice over by the time anybody looked:
 *
 *  - the CLIPBOARD arrived and was handled correctly, by routing the write
 *    through main's own `clipboard` module rather than by widening the policy
 *    (`src/renderer/panels/clipboard.ts`, which says so);
 *  - DICTATION arrived and was NOT, because feature detection answers "is
 *    there a recogniser" and the policy answers a different question. The
 *    button was drawn in the packaged app and could only ever fail.
 *
 * A stale comment above a security policy is the worst place for one: the next
 * person weighing whether to widen it reads that sentence as the reason not to
 * look. So the claim is a TEST now, and it will fail the day a third capability
 * arrives -- which is the point. A loud failure is a sample of a silent family,
 * and this family had a written claim that it was empty.
 *
 * ── WHAT FAILING HERE MEANS ───────────────────────────────────────────────
 * Not "allowlist it". It means: decide, in the open, which of the three
 * answers this capability gets --
 *
 *  1. route it through main, as the clipboard does;
 *  2. withhold the control in the Electron build, as dictation does, on the
 *     repo's own rule that a control which cannot act is not drawn;
 *  3. widen the policy, which has never yet been the right answer.
 *
 * -- and then add it to `HANDLED` below with the file that carries the
 * decision. The census is a negative scan over source, which is the only safe
 * kind: prose containing a forbidden pattern makes this REDDER, never greener.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd(), 'src/renderer');

/**
 * The capabilities Chromium gates behind a permission, spelled as the source
 * text that reaches for them.
 *
 * Drawn from Electron's own permission list -- the strings its handler is
 * called with -- rather than from what vam happens to use, which is the whole
 * point: this has to name things nobody has written yet.
 */
const GATED: Readonly<Record<string, string>> = {
  'navigator.clipboard': 'clipboard-read / clipboard-sanitized-write',
  SpeechRecognition: 'media (microphone)',
  getUserMedia: 'media (microphone / camera)',
  getDisplayMedia: 'display-capture',
  'new Notification': 'notifications',
  'Notification.requestPermission': 'notifications',
  'navigator.geolocation': 'geolocation',
  requestMIDIAccess: 'midi',
  'navigator.usb': 'usb',
  'navigator.serial': 'serial',
  'navigator.bluetooth': 'bluetooth',
  'navigator.hid': 'hid',
  IdleDetector: 'idle-detection',
  requestPointerLock: 'pointerLock',
  requestFullscreen: 'fullscreen',
  'navigator.mediaDevices': 'media',
  'navigator.storage.persist': 'persistent-storage',
};

/**
 * The two that are known, each with the file that carries its decision.
 *
 * A file is named so that a reader who finds a hit has somewhere to go, and so
 * that deleting the decision without deleting the use turns this red.
 */
const HANDLED: Readonly<Record<string, string>> = {
  // Routed through main: `window.api.clipboard.writeText`, with
  // `navigator.clipboard` kept only for the browser build, which has no policy
  // to be refused by.
  'navigator.clipboard': 'panels/clipboard.ts',
  // Withheld in the Electron build: `dictationAvailable` answers false where
  // the preload bridge exists, so the control is absent rather than broken.
  SpeechRecognition: 'panels/dictation.ts',
};

/**
 * A pattern, as the source may really spell it.
 *
 * `?.` IS THE WHOLE REASON THIS IS A REGEX. The one live clipboard call in the
 * tree is `globalThis.navigator?.clipboard`, and a plain `includes()` over
 * `navigator.clipboard` misses it -- which this file's own exemption check
 * caught on its first run, reporting the clipboard as "exempted but no longer
 * used" while `clipboard.ts` was reaching for it two lines from the comment
 * that explains why. A scan that cannot see optional chaining is a scan that
 * passes on every careful caller.
 */
const matcher = (pattern: string): RegExp =>
  new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\./g, '\\??\\.'));

/** Every `.ts`/`.tsx` under the renderer, excluding nothing: a capability
 *  reached for in a fixture is still a capability reached for. */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sources(full, found);
    } else if (/\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Comments stripped, because a comment EXPLAINING the policy is not a use of
 * it -- three of the clipboard's five occurrences in this tree are exactly
 * that, including two in files that never touch the API.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the deny-all permission policy, and what it costs', () => {
  const files = sources(ROOT);

  it('reads a real corpus, or every claim below is about nothing', () => {
    // THE CORPUS FIRST. Four guards in a sibling repo ran green having
    // examined zero files; the assertion belongs inside the sweep's own
    // numbers, not beside them.
    // 86 files and ~1.4 MB when this was written. The floors are below the
    // measurement and above nothing: a tree that shrank by a third is a tree
    // this sweep is no longer about.
    expect(files.length).toBeGreaterThan(60);
    const bytes = files.reduce((sum, file) => sum + readFileSync(file, 'utf8').length, 0);
    expect(bytes).toBeGreaterThan(900_000);
  });

  it('finds the two capabilities it already knows about, still there', () => {
    // The inverse of the scan below, and the half that keeps it honest: if
    // `clipboard.ts` or `dictation.ts` stopped reaching for these, `HANDLED`
    // would be two exemptions guarding nothing and the next real use would
    // walk straight through one of them.
    const text = files.map((file) => code(readFileSync(file, 'utf8'))).join('\n');
    for (const pattern of Object.keys(HANDLED)) {
      expect(matcher(pattern).test(text), `${pattern} is exempted but no longer used`).toBe(true);
    }
  });

  it('reaches for no permission-gated capability that has not been decided', () => {
    const strays: string[] = [];
    for (const file of files) {
      const text = code(readFileSync(file, 'utf8'));
      for (const [pattern, permission] of Object.entries(GATED)) {
        if (!matcher(pattern).test(text)) continue;
        if (HANDLED[pattern] !== undefined) continue;
        strays.push(`${relative(process.cwd(), file)} reaches ${pattern} (${permission})`);
      }
    }
    // Not "allowlist it" -- see this file's header for the three answers.
    expect(strays).toEqual([]);
  });

  it('states the policy in main, where the policy is', () => {
    // THE COMMENT IS PART OF THE FIX. It claimed nothing rendered here needed
    // any of these, which stopped being true and stayed on screen -- directly
    // above the code a later reader would consult before widening it.
    const main = readFileSync(resolve(process.cwd(), 'src/main/index.ts'), 'utf8');
    const start = main.indexOf('function registerPermissionPolicy');
    expect(start).toBeGreaterThan(0);
    const comment = main.slice(Math.max(0, start - 1600), start);
    expect(comment).toContain('dictation');
    expect(comment.toLowerCase()).toContain('clipboard');
    expect(
      comment.includes('Nothing this app renders needs any of these'),
      'the superseded claim is still above the policy',
    ).toBe(false);
  });
});
