/**
 * Config for the packaged-app launch harness (task-6-packaging, AC-18).
 * `e2e/electron-launch.et.ts` drives Playwright's `_electron` launcher
 * against the ACTUAL electron-builder `--dir` output, not `electron-vite
 * dev`, so `app.isPackaged` is true and the renderer loads from the built
 * files.
 *
 * `testMatch` is explicit and load-bearing, same reasoning as
 * `e2e/playwright.reconnect.config.ts`: Playwright's default collector
 * claims `**\/*.spec.ts` and `**\/*.test.ts`, and
 * `e2e/playwright.reconnect.config.ts`'s `testMatch` used to be a
 * `**\/*.pw.ts` suffix glob that claimed recursively too -- until it
 * silently swept up a second `*.pw.ts` spec, and that config now names its
 * own file exactly instead of a suffix class. This spec is named
 * `electron-launch.et.ts` -- a suffix none of the other three configs
 * match -- and this config narrows to it explicitly, so each config still
 * collects exactly its own spec (AC-18(b)).
 *
 * No `webServer` block: the packaged binary is its own server -- nothing to
 * spawn beforehand.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.et.ts',
  outputDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'test-results', 'electron'),
  workers: 1,
  retries: 0,
  timeout: 60_000,
});
