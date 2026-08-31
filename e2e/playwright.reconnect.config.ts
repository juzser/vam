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
 * — a suffix the default collector does not match — and this config narrows
 * to it explicitly, so the two configs each collect exactly one spec (AC-9).
 * Verified with `--list` on both configs; see the task result for both
 * listings.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

// Same reasoning as e2e/playwright.config.ts: vite's project root and its
// node_modules/.bin/vite binary are both at the repo root, not e2e/.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.pw.ts',
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
