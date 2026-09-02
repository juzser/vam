import { defineConfig } from 'vitest/config';

/**
 * The launch harness, which is excluded from the default run.
 *
 * `test/electron/launch.test.ts` spawns a REAL Electron binary, so it needs a
 * display. CI is `ubuntu-latest` with no xvfb, and leaving it in `pnpm test`
 * makes CI die with `Missing X server or $DISPLAY` -- a headless-environment
 * fault that reads as a broken application.
 *
 * It lives in its own config rather than behind an `exclude` alone, because an
 * `exclude` in the default config also suppresses an EXPLICIT run of the same
 * path: the file is never collected, and `vitest run test/electron/launch
 * .test.ts` reports "no tests" while looking like it passed. A separate config
 * is the only shape where the default run skips it and `pnpm test:app` really
 * runs it.
 *
 * AC-13's proof that the application boots therefore runs locally and NOT in
 * CI until a display is provided there. That is a real gap, stated rather than
 * hidden.
 */
export default defineConfig({
  test: {
    include: ['test/electron/launch.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
