/**
 * Config for `filter-panel.pw.ts`. testDir resolves to this directory; the
 * target is vam's own vite dev server, on a port distinct from the other
 * two harnesses here (AC-G1 uses 5273, AC-10's reconnect spec uses 5274)
 * so all three can run without colliding.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  testDir: '.',
  testMatch: 'filter-panel.pw.ts',
  outputDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'test-results'),
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:5275',
  },
  webServer: {
    command: 'node_modules/.bin/vite --port 5275',
    cwd: repoRoot,
    url: 'http://127.0.0.1:5275',
    reuseExistingServer: false,
  },
});
