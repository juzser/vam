import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // `test/electron/launch.test.ts` SPAWNS A REAL ELECTRON BINARY, which needs
    // a display. CI is `ubuntu-latest` with no xvfb, so leaving it in the
    // default run makes `pnpm test` die there with `Missing X server or
    // $DISPLAY` -- a headless-environment fault that reads as a broken app.
    // It is excluded here and run by `pnpm test:app`, the same bargain `e2e/`
    // already has. THE COST IS REAL AND IS NOT HIDDEN: AC-13's proof that the
    // application boots does not run in CI until a display is provided there.
    exclude: ['test/electron/launch.test.ts', '**/node_modules/**', '**/dist/**'],
    // Default to `node`. Most of vam's logic — spatial navigation, the chord
    // reducer, the adapters — is pure and has no business paying for a DOM.
    // A test that genuinely renders opts in with `// @vitest-environment
    // happy-dom` at the top of its own file, so the cost lands on the files
    // that need it rather than on the whole suite.
    environment: 'node',
    coverage: {
      provider: 'v8',
      // `json-summary` is not decoration: the text reporter suppresses rows for
      // files at 100% on every metric, so the file an acceptance criterion
      // names vanishes from the transcript exactly when it is doing best. The
      // gate reads coverage/coverage-summary.json instead (D-40/P9-25).
      reporter: ['text', 'text-summary', 'json-summary'],
      // `src/main` and `src/preload` stay OUT of the denominator: they are
      // Electron process entrypoints, exercised by the launch harness rather
      // than by unit tests. `src/shared` stays IN it — `src/shared/stream.ts`
      // is tested by `test/adapter/stream.test.ts`, and dropping it here would
      // quietly retire a tested module from the floor.
      include: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx', 'src/shared/**/*.ts'],
      // The renderer mount entrypoint is the Vite entry: three lines that hand
      // <App/> to createRoot, with nothing a node-environment test could assert
      // that a browser wouldn't. Counted, it drags a freshly scaffolded UI
      // project below the floor on its very first run — measured, not
      // predicted. Ambient declarations have no statements to cover at all.
      exclude: ['src/renderer/index.tsx', 'src/**/*.d.ts'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
