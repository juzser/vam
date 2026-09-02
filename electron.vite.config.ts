import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

/**
 * The three targets, and the one decision that makes them boot.
 *
 * `package.json` keeps `"type": "module"`, so a bare `.js` file anywhere in
 * this package is ESM — and electron-vite emits CommonJS for main and preload,
 * because a sandboxed preload MUST be CommonJS and Electron's own entry is
 * loaded with `require`. Left alone, the two facts collide at the first launch
 * as `require is not defined`, which reads like a bundler bug and is not one.
 * The fix is the output extension: main and preload emit `.cjs`, which Node
 * parses as CommonJS whatever the package `type` says. Dropping `"type":
 * "module"` instead would work too, but it changes module resolution for every
 * `.js` and every tool config in a public repo to fix two generated files.
 */
const commonjsOutput = {
  format: 'cjs' as const,
  entryFileNames: '[name].cjs',
  chunkFileNames: '[name].cjs',
};

/**
 * `electron` is provided by the runtime, never bundled. Left to the bundler it
 * inlines the npm package's *shim* — the one whose job is to download a binary
 * — and the built main greets its first launch with "Downloading Electron
 * binary...", observed before this line existed.
 */
const external = ['electron'];

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: 'src/main/index.ts' },
        output: commonjsOutput,
        external,
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: 'src/preload/index.ts' },
        output: commonjsOutput,
        external,
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    // `envDir` defaults to `root`; without this the repo-root `.env.local` that
    // README documents is silently ignored, exactly as in the browser config.
    envDir: '../..',
    build: {
      rollupOptions: { input: { index: 'src/renderer/index.html' } },
    },
    plugins: [react(), tailwindcss()],
  },
});
