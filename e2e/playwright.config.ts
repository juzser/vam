/**
 * Config for the AC-G1 harness (section 3.4 and AC-G1 of this epic). testDir
 * resolves to this directory; the target origin is vam's OWN vite dev
 * server, never the factory's port directly — cross-origin `EventSource`
 * from vam's origin to the factory's port was measured to deliver zero
 * events, and the proxy (`vite.config.ts`) is itself part of what this
 * criterion exists to exercise. See `e2e/sse-drop.spec.ts`'s header for what
 * this harness can and cannot show.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

// webServer.cwd (and, absent an explicit `cwd`, the spawned process's own
// cwd) defaults to this config file's own directory (e2e/) — but vite's
// project root (index.html) and its `node_modules/.bin/vite` binary are
// both at the repo root (the shared vam tree). e2e/node_modules holds only
// the Playwright harness.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  testDir: '.',
  // Playwright's outputDir default resolves against process.cwd(), not this
  // config's own directory — with webServer's cwd now pointed at repoRoot,
  // that would otherwise litter the repo root. Keep artifacts inside e2e/,
  // where .gitignore already ignores them.
  outputDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'test-results'),
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:5273',
  },
  webServer: {
    command: 'node_modules/.bin/vite --port 5273',
    cwd: repoRoot,
    url: 'http://127.0.0.1:5273',
    reuseExistingServer: false,
  },
});
