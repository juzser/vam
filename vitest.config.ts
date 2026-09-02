import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
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
      include: ['src/**/*.ts', 'src/**/*.tsx'],
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
