/**
 * Config for the reconnect harness (epic.md
 * `factory/specs/active/vam-acg1-discriminating-ac10/epic.md`, section 3.3).
 * A test cannot kill a `webServer` Playwright manages, and
 * `e2e/sse-drop-reconnect.pw.ts` must kill and restart vite mid-run — so this
 * config declares NO `webServer` block; the spec spawns and kills
 * `node_modules/.bin/vite` itself, with `cwd` at the repo root, same as
 * `startServer`/`kill` do for black-smith in the sibling spec.
 *
 * `testMatch` is explicit and load-bearing: `e2e/playwright.config.ts`
 * (`testDir: '.'`, no `testMatch`, no `testIgnore`) is byte-identical-
 * protected (epic AC-6) and collects every `*.spec.ts` under `e2e/` by
 * Playwright's default. This spec is therefore named `sse-drop-reconnect.pw.ts`
 * — a suffix the default collector does not match.
 *
 * `testMatch` names this file exactly, not a `*.pw.ts` suffix class: a
 * suffix pattern once matched this spec alone, then silently widened to
 * also collect `phone-shell.pw.ts` the day that file was added, sending all
 * 18 of its tests against this config's vite-less setup (no `webServer`
 * block — see above) with nothing at `http://127.0.0.1:5274` to serve them.
 * Naming the file is the only form that cannot re-widen when a future spec
 * picks the same suffix. `test/e2e/config-collection.test.ts` guards this
 * against each config's real `--list` output, not by re-reading this string.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

// Same reasoning as e2e/playwright.config.ts: vite's project root and its
// node_modules/.bin/vite binary are both at the repo root, not e2e/.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  testDir: '.',
  // The file itself, not a suffix glob — see the header for why.
  testMatch: 'sse-drop-reconnect.pw.ts',
  // Keep artifacts inside e2e/, where .gitignore already ignores them, same
  // as the AC-G1 config.
  outputDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'test-results', 'reconnect'),
  workers: 1,
  retries: 0,
  use: {
    // Vite's own port for this run, distinct from the AC-G1 config's 5273 so
    // a leftover process from a prior run cannot collide with this one.
    baseURL: 'http://127.0.0.1:5274',
  },
  // No webServer block: the spec spawns and kills vite itself so it can drop
  // the transport mid-test, which Playwright's own webServer management does
  // not allow.
});
