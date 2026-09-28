/**
 * ONE `electron-vite build` FOR THE WHOLE LAUNCH-HARNESS RUN.
 *
 * Every file in `vitest.app.config.ts` needs `out/` built: `launch`,
 * `userdata-isolation`, `getting-started-image` and `settings-update` spawn the
 * real Electron binary against it, and `stats-worker` loads
 * `out/main/statsWorker.cjs`. Each of the four used to run its own build in
 * its own `beforeAll`. vitest runs files in parallel workers, so those builds
 * wrote the same `out/` directory at the same moment. With five files the race
 * turned main's CI red on #541: one build read a half-written config
 * ("config must export or return an object"), and another launch found
 * `out/renderer/index.html` missing (`ERR_FILE_NOT_FOUND`).
 *
 * A globalSetup runs once, before any test file is collected, so there is
 * exactly one writer and every file sees a finished `out/`. It also runs for
 * an explicit single-file run (`vitest run --config vitest.app.config.ts
 * test/electron/launch.test.ts`), so no file needs its own build back.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export default function setup(): void {
  execFileSync(path.join(repoRoot, 'node_modules', '.bin', 'electron-vite'), ['build'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
}
