import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Browser mode, standalone.
 *
 * vam ships two transports: the Electron shell and a plain page served over
 * HTTP. This config is the second one's own build — its own root, base, HTML
 * entry and out dir — so that the browser mode is something a command can
 * actually load and fail on, rather than a claim about the repo-root
 * `vite.config.ts` (which stays exactly as it is, dev server and proxy
 * included, because the e2e suite runs against it).
 */
export default defineConfig({
  root: 'src/renderer',
  envDir: '../..',
  // Relative, so the built page works under any path a static host puts it on.
  base: './',
  build: {
    outDir: '../../dist-web',
    emptyOutDir: true,
    // Report-only (see `electron.vite.config.ts`'s matching note): a build
    // SPEED toggle, not a bundle-size one -- the gzip size this build's own
    // CLI output would have printed is not read by anything here.
    reportCompressedSize: false,
    rollupOptions: { input: 'src/renderer/index.html' },
  },
  plugins: [react(), tailwindcss()],
});
