/**
 * Config for the AC-G1 harness (epic.md `factory/specs/active/vam-sse-canvas/epic.md`,
 * section 3.4 and AC-G1). testDir resolves to this directory; the target
 * origin is vam's OWN vite dev server, never black-smith's port directly —
 * cross-origin `EventSource` from vam's origin to black-smith's port was
 * measured to deliver zero events, and the proxy (`vite.config.ts`) is
 * itself part of what this criterion exists to exercise. See
 * `e2e/sse-drop.spec.ts`'s header for what this harness can and cannot show.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: __dirname,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:5273',
  },
  webServer: {
    command: 'node_modules/.bin/vite --port 5273',
    url: 'http://127.0.0.1:5273',
    reuseExistingServer: false,
  },
});
