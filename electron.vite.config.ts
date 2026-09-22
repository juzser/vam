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

/**
 * `electron-vite build`'s own CLI defaults `minify` to `false` for all three
 * targets -- unlike plain `vite build`, which defaults it to `true` -- and
 * nothing here used to override that. The result was a renderer chunk
 * shipped as 2.28 MB of full-name, fully-commented source: every session
 * parsing and evaluating code nobody was ever meant to read, before the
 * renderer painted anything at all. Same code, same chunks, set explicitly
 * rather than left to a default this CLI does not share with the rest of
 * the Vite ecosystem.
 */
const minify = true;

export default defineConfig({
  main: {
    build: {
      minify,
      rollupOptions: {
        input: { index: 'src/main/index.ts' },
        output: commonjsOutput,
        external,
      },
    },
  },
  preload: {
    build: {
      minify,
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
      minify,
      // Report-only; does not change what ships. `vite build`'s own gzip-size
      // report (what the CLI prints per-chunk after a build) computes and
      // discards one gzip pass per chunk purely to print the number in the
      // build's own console output. Turned off here for build SPEED, not
      // bundle size -- see `test/renderer/bundle-budget.test.ts`, which
      // computes gzip size itself (via `node:zlib`) for the one chunk it
      // actually asserts on, independent of this flag either way.
      //
      // Two other candidates were measured and dropped rather than added
      // here: `build.target: 'chrome152'` (Electron 44.1.1's own Chromium,
      // via `ELECTRON_RUN_AS_NODE=1 electron -e
      // "console.log(process.versions)"`) and `build.modulePreload.polyfill:
      // false`. Both produced a byte-for-byte IDENTICAL entry chunk --
      // esbuild's default target already lowers nothing this codebase uses,
      // and the polyfill is only ever injected for a STATIC `<link
      // rel="modulepreload">` the built HTML would need to guard, which
      // this single-entry-script renderer never emits in the first place.
      // (Vite's internal dynamic-`import()` preloading helper, unrelated to
      // that flag and required for every lazy chunk this turn added, is the
      // `relList`/`supports("modulepreload")` code actually visible in the
      // chunk -- checked before assuming either candidate did anything.)
      reportCompressedSize: false,
      rollupOptions: { input: { index: 'src/renderer/index.html' } },
    },
    plugins: [react(), tailwindcss()],
  },
});
