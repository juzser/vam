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

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DesktopSourceApi, UsageApi } from '../preload/api.js';
import type { PreloadSourceApi } from '../shared/preload-api.js';
import { SmithClient } from './adapter/client.js';
import { useCanvas } from './adapter/useCanvas.js';
import { Canvas } from './canvas/Canvas.js';
import type { CanvasModel } from './domain/model.js';
import { DEMO_MODEL } from './fixtures/demo.js';
import type { SessionSource } from './sources/port.js';
import { createSourceFromPreload } from './sources/preload-factory.js';

declare global {
  interface Window {
    /**
     * Present only in the Electron shell; the preload put it there.
     * `usage` is a member of the SAME bridge object -- see
     * `src/preload/index.ts` -- kept out of `DesktopSourceApi` because it
     * answers `usage:get`'s bare `UsageSnapshot`, not a `PreloadSourceApi`
     * member's `IpcResult` envelope.
     */
    readonly api?: DesktopSourceApi & { readonly usage: UsageApi };
  }
}

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
  // The bridge exists only in the Electron shell. In a browser there is no
  // `window.api` and nothing below it is reachable, which is why the check is
  // for the object rather than for a build flag.
  const api = globalThis.window?.api;
  if (api !== undefined) {
    return <DesktopCanvas api={api} />;
  }
  return isDemo() ? <DemoCanvas /> : <LiveCanvas client={client} />;
}

/**
 * The desktop canvas: rows AND a write route, both assembled from the main
 * process's own descriptor.
 *
 * The Claude Code source declares `recordPrompt: true` and, when it can reach
 * a running `claude --resume`, `deliverPrompt: true` too -- so the
 * `SessionSource` `createSourceFromPreload` returns genuinely carries a
 * `write` member. `Canvas` is given it as a `'session'` source rather than
 * left on the `READ_ONLY_SOURCE` default, so this shell is exactly as
 * writable as the descriptor it was built from -- whether a given write
 * actually reaches anything is `canWriteTo`'s call at the point of the write,
 * not a decision made here.
 */
function DesktopCanvas({ api }: { readonly api: DesktopSourceApi }) {
  const [model, setModel] = useState<CanvasModel>({ projects: [] });
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<SessionSource | null>(null);
  // Holds the current reload so `onWrote` -- fired long after the effect
  // below has settled -- can still run under the SAME `cancelled` flag: a
  // reload that lands after unmount must not `setState` either.
  const reloadRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;

    function load(assembled: SessionSource) {
      assembled
        .load()
        .then((projects) => {
          if (!cancelled) setModel({ projects });
        })
        .catch((reason: unknown) => {
          if (!cancelled) setError(describeFailure(reason));
        });
    }

    // The cast is the `subscribe` member this task does not implement: it needs
    // `ipcRenderer.on`, not `invoke`. It is genuinely absent at runtime, and
    // with `liveUpdates: false` the factory never reads it.
    createSourceFromPreload(api as PreloadSourceApi)
      .then((assembled) => {
        if (cancelled) return;
        setSource(assembled);
        reloadRef.current = () => load(assembled);
        load(assembled);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(describeFailure(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Empty and saying why, never a fixture standing in for a source that failed.
  return (
    <>
      {error !== null && <p className="text-failed">● {error}</p>}
      <Canvas
        model={model}
        source={
          source === null
            ? undefined
            : { kind: 'session', source, onWrote: () => reloadRef.current() }
        }
      />
    </>
  );
}

/** A `SourceError` reads as `code: message`; anything else falls back to its text. */
function describeFailure(reason: unknown): string {
  if (typeof reason === 'object' && reason !== null && 'code' in reason && 'message' in reason) {
    return `${String(reason.code)}: ${String(reason.message)}`;
  }
  return reason instanceof Error ? reason.message : String(reason);
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
