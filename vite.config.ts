import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Where `/api/*` goes. `smith ui serve`'s own default port
 * (ui/server/src/index.ts), overridable for a factory running elsewhere.
 */
const SMITH_URL = process.env.VAM_SMITH_URL ?? 'http://127.0.0.1:4680';

/**
 * The proxy is not a convenience — it is what keeps black-smith unchanged.
 *
 * vam on :5273 talking to a factory on :4680 is cross-origin, and `ui/server`
 * sends no CORS headers. The alternatives were to add some or to serve vam from
 * the factory itself. Adding CORS to a server that accepts writes widens what
 * any page in the browser can reach; proxying keeps the factory exactly as
 * closed as it is today and costs one config block. So vam asks its OWN origin
 * for `/api/*` and Vite forwards it — which is also why the client's default
 * base URL is the empty string.
 */
const proxy = {
  '/api': {
    target: SMITH_URL,
    changeOrigin: false,
    // node-http-proxy pipes the upstream response into the client response,
    // but a pipe only reacts to a graceful `end` — an upstream that dies
    // (SIGKILL, ECONNRESET) leaves the client response open indefinitely,
    // so the browser's EventSource never sees `error` and never reconnects.
    // Watch the upstream response ourselves and close the client side the
    // moment it goes away, however it goes away.
    configure: (proxyServer: import('http-proxy').Server) => {
      proxyServer.on('proxyRes', (proxyRes, _req, res) => {
        const closeClient = () => {
          if (!res.writableEnded) {
            res.end();
          }
        };
        proxyRes.on('close', closeClient);
        proxyRes.on('error', closeClient);
      });
    },
  },
};

export default defineConfig({
  root: 'src/renderer',
  build: { outDir: '../../dist', emptyOutDir: true },
  plugins: [react(), tailwindcss()],
  server: {
    // 127.0.0.1 only, like every service this tool talks to. Vam reads a local
    // factory's event log and a local orca; there is nothing here that should
    // be reachable from another machine, and binding wider is how a dev server
    // ends up serving one.
    host: '127.0.0.1',
    port: 5273,
    proxy,
  },
  // `preview` serves the built bundle and needs the same forwarding, or the
  // production build is the one build nobody can point at a real factory.
  preview: {
    host: '127.0.0.1',
    port: 5274,
    proxy,
  },
});
