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

import { useEffect, useMemo, useState } from 'react';
import type {
  ClipboardApi,
  DesktopSourceApi,
  DialogApi,
  TerminalApi,
  UsageApi,
} from '../preload/api.js';
import type { PreloadSourceApi } from '../shared/preload-api.js';
import { SmithClient } from './adapter/client.js';
import { useCanvas } from './adapter/useCanvas.js';
import { Canvas } from './canvas/Canvas.js';
import { DEMO_MODEL } from './fixtures/demo.js';
import { describeFailure, type SessionSource } from './sources/port.js';
import { createSourceFromPreload } from './sources/preload-factory.js';
import { useSourceModel } from './sources/useSourceModel.js';

declare global {
  interface Window {
    /**
     * Present only in the Electron shell; the preload put it there.
     * `usage` is a member of the SAME bridge object -- see
     * `src/preload/index.ts` -- kept out of `DesktopSourceApi` because it
     * answers `usage:get`'s bare `UsageSnapshot`, not a `PreloadSourceApi`
     * member's `IpcResult` envelope.
     */
    readonly api?: DesktopSourceApi & {
      readonly usage: UsageApi;
      readonly clipboard: ClipboardApi;
      readonly terminal: TerminalApi;
      /** Electron's `showOpenDialog`; the browser build has no picker at all. */
      readonly dialog: DialogApi;
    };
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
export function DesktopCanvas({ api }: { readonly api: DesktopSourceApi }) {
  const [source, setSource] = useState<SessionSource | null>(null);
  const [assembleError, setAssembleError] = useState<string | null>(null);

  // Assembling the source is a ONE-TIME step -- it reads the descriptor over
  // IPC and decides which members exist. Re-reading the MODEL is the repeating
  // part, and it lives in `useSourceModel`.
  useEffect(() => {
    let cancelled = false;
    // The cast is the `subscribe` member this shell does not implement: it
    // needs `ipcRenderer.on`, not `invoke`. It is genuinely absent at runtime,
    // and with `liveUpdates: false` the factory never reads it.
    createSourceFromPreload(api as PreloadSourceApi)
      .then((assembled) => {
        if (!cancelled) setSource(assembled);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setAssembleError(describeFailure(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const { model, error, reload } = useSourceModel(source);
  const shown = assembleError ?? error;

  // Empty and saying why, never a fixture standing in for a source that failed.
  //
  // A COLUMN, not two siblings. `html`, `body` and `#root` are all
  // `height: 100%` with no `overflow: hidden`, and the canvas' own root is
  // `h-full`: a paragraph added above it therefore did not shrink it, it
  // pushed it down, and what went off the bottom of the viewport was the
  // status bar carrying the `N failures` button -- the only route into the
  // error log, gone at the exact moment the operator needs it. Here the
  // banner takes its own row out of the full height and the canvas gets the
  // rest. `min-h-0` is load-bearing: without it a flex child will not go
  // below its content height and the overflow comes straight back.
  return (
    <div className="flex h-full min-h-0 flex-col">
      {shown !== null && (
        <p data-testid="source-failure" className="m-0 flex-none px-3 py-1 text-failed">
          ● {shown}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <Canvas
          model={model}
          source={source === null ? undefined : { kind: 'session', source, onWrote: reload }}
        />
      </div>
    </div>
  );
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
