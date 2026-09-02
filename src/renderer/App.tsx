/**
 * Which black-smith vam is looking at, and whether it is looking at one at all.
 *
 * Two modes, and the difference between them is deliberately loud:
 *
 *  - **live** (the default) — a real `smith ui serve`. Rows are real sessions,
 *    the prompt box writes to a real log.
 *  - **demo** (`?demo=1`) — the fixture from §3. Every write is refused HERE,
 *    before it reaches the client, and the banner says so. A demo you can type
 *    into is a demo that teaches you the wrong reflex.
 *
 * The fixture is not a fallback. When the server is down, live mode shows
 * nothing and says why: a dashboard that quietly swapped in fake sessions is
 * one you would send a real prompt to.
 */

import { useMemo } from 'react';
import { SmithClient } from './adapter/client.js';
import { useCanvas } from './adapter/useCanvas.js';
import { Canvas } from './canvas/Canvas.js';
import { DEMO_MODEL } from './fixtures/demo.js';

/**
 * Empty means "my own origin", which is where the real answer lives: vite.config
 * proxies `/api/*` to the factory. Going direct would be cross-origin, and
 * `ui/server` sends no CORS headers — the fix for that is a proxy, not opening
 * a server that accepts writes to every page in the browser.
 *
 * `VITE_SMITH_URL` overrides it for the case where vam is served from somewhere
 * that already sits in front of a factory.
 */
function smithUrl(): string {
  const configured = import.meta.env.VITE_SMITH_URL;
  return typeof configured === 'string' ? configured : '';
}

function isDemo(): boolean {
  return new URLSearchParams(globalThis.location?.search ?? '').get('demo') === '1';
}

export function App() {
  const client = useMemo(() => new SmithClient({ baseUrl: smithUrl() }), []);
  return isDemo() ? <DemoCanvas /> : <LiveCanvas client={client} />;
}

function DemoCanvas() {
  return (
    <Canvas
      model={DEMO_MODEL}
      source={{
        kind: 'demo',
        // Refused here rather than at the server: in demo mode there is no
        // session to refuse it, and "unknown session" is a confusing way to
        // learn the rows were never real.
        note: 'demo data — every write is refused',
      }}
    />
  );
}

function LiveCanvas({ client }: { client: SmithClient }) {
  const feed = useCanvas(client);
  return (
    <Canvas
      model={feed.model}
      source={{
        kind: 'live',
        client,
        status: feed.status,
        error: feed.error,
        onWrote: feed.refresh,
      }}
    />
  );
}
