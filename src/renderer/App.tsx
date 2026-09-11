/**
 * Which factory vam is looking at, and whether it is looking at one at all.
 *
 * Two modes, and the difference between them is deliberately loud:
 *
 *  - **live** (the default) — a real factory server. Rows are real sessions,
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
  MainErrorsApi,
  TerminalApi,
  UpdateApi,
  UsageApi,
} from '../preload/api.js';
import type { PreloadSourceApi } from '../shared/preload-api.js';
import { SmithClient } from './adapter/client.js';
import { useCanvas } from './adapter/useCanvas.js';
import { Canvas } from './canvas/Canvas.js';
import { ErrorBoundary } from './errors/ErrorBoundary.js';
import { bridgeMainErrors } from './errors/main-errors-bridge.js';
import { DEMO_MODEL, demoModelWithTurns } from './fixtures/demo.js';
import { createDemoHistory } from './fixtures/demo-history.js';
import { HistoryReaderProvider } from './sources/history-reader.js';
import { createSourceFromHttp } from './sources/http-factory.js';
import { describeFailure, type SessionSource } from './sources/port.js';
import { createSourceFromPreload } from './sources/preload-factory.js';
import { useSourceModel } from './sources/useSourceModel.js';
import { UpdateNotice } from './update/UpdateNotice.js';

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
      /**
       * The launch check's answer, and the click that opens the release page
       * in the operator's browser. Desktop-only: the browser build has no
       * bridge, so `UpdateNotice` simply never draws there.
       */
      readonly update: UpdateApi;
      /**
       * MAIN's own failure buffer, read side (`src/main/errors/log.ts`,
       * `src/main/errors/ipc.ts`). `DesktopCanvas` below is the one caller,
       * through `bridgeMainErrors`.
       */
      readonly mainErrors: MainErrorsApi;
      /**
       * PREFERENCES MAIN NEEDS A COPY OF -- one today: where to ask GitHub
       * from, per project. Desktop-only, and OPTIONAL in this type rather than
       * merely absent at runtime, because `activatePrefs` runs in the browser
       * build too and must be able to see that it is not there.
       */
      readonly prefs?: {
        setPrRepos(map: unknown): Promise<void>;
      };
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

/**
 * How many turns the demo's first session should carry — `?turns=N`, and only
 * inside the demo.
 *
 * A MEASUREMENT KNOB, not a feature. The detail pane draws every turn the
 * model gives it, and the real cap is `MAX_DECISIONS = 3276`
 * (`main/sources/claude-code/transcript.ts`); the hand-written fixture has
 * seven. Without a way to build the worst case in a real browser, the only
 * thing anyone could say about the pane at volume is a guess, and this repo
 * has a rule against those. `e2e/transcript-column-shots.mjs` uses it to time
 * the column at 3,276 turns.
 *
 * Read only where the demo model is built, so it is unreachable outside
 * `?demo=1`; anything unparseable or below the fixture's own length simply
 * leaves the fixture alone.
 */
function demoTurns(): number {
  const asked = new URLSearchParams(globalThis.location?.search ?? '').get('turns');
  const count = Number(asked);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/**
 * Whether the demo has a backward pager — `?demo=1&history=off` takes it away.
 *
 * THE SAME KIND OF KNOB AS `?turns=N` ABOVE, and it earns its keep the same
 * way: it makes a real state of the app REACHABLE that otherwise is not.
 * `SessionSource.history` is optional (`sources/port.ts`), and every source vam
 * itself assembles has it — so the branch where it is ABSENT, which the column
 * draws as a stated refusal rather than as "there is nothing older", is a
 * branch no shipped source can put on screen. Without this it would ship
 * undrawn and untested in a browser, which is how a message ends up wrong for
 * a year.
 *
 * It is also what keeps the column's geometry guards honest. With a pager, the
 * column GROWS whenever a check scrolls near its top, so a sticky-position
 * sweep computed against one set of offsets would be walking a different
 * column by the time it got there. Off, the fixture is the fixed seven turns
 * those checks were written against.
 *
 * Read only inside the demo, like `demoTurns`.
 */
function demoHasHistory(): boolean {
  return new URLSearchParams(globalThis.location?.search ?? '').get('history') !== 'off';
}

export function App() {
  const client = useMemo(() => new SmithClient({ baseUrl: smithUrl() }), []);
  // The bridge exists only in the Electron shell. In a browser there is no
  // `window.api` and nothing below it is reachable, which is why the check is
  // for the object rather than for a build flag.
  const api = globalThis.window?.api;
  // The outer boundary: the backstop for a throw in the routing itself or in
  // `UpdateNotice`, neither of which the canvas boundary in `SourceCanvas`
  // can see. It is the coarse one -- when it draws, the app is gone and only
  // the card is left -- which is exactly why it is not the only one.
  return (
    <ErrorBoundary surface="vam">
      {api !== undefined ? (
        <DesktopCanvas api={api} update={api.update} mainErrors={api.mainErrors} />
      ) : isDemo() ? (
        <DemoCanvas />
      ) : (
        <BrowserCanvas client={client} />
      )}
    </ErrorBoundary>
  );
}

/**
 * A browser, asking its own origin what it is.
 *
 * Two servers can put this page in front of an operator: vam's remote
 * endpoint, which speaks the port's protocol at `/api/describe`, and anything
 * else, where the page has always rendered the factory feed. The
 * page cannot be built twice for that -- an operator serving `dist-web`
 * through a tunnel would have to know which build they had -- so it ASKS, and
 * the answer is the descriptor it needs anyway.
 *
 * The fallback is narrow on purpose. A `no-such-route` or a non-envelope
 * answer means "no vam server here", and the factory feed is the right page. A
 * vam endpoint that answered and FAILED is reported, because a refusal
 * silently replaced by another data source is the swap this file already
 * refuses to make for the demo fixture.
 */
export function BrowserCanvas({ client }: { readonly client: SmithClient }) {
  const [remote, setRemote] = useState<SessionSource | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    createSourceFromHttp()
      .then((assembled) => {
        if (!cancelled) setRemote(assembled);
      })
      .catch((reason: unknown) => {
        const code =
          typeof reason === 'object' && reason !== null && 'code' in reason
            ? String(reason.code)
            : '';
        // Not a vam endpoint at all -- no route, or no envelope behind it.
        if (!(code === 'no-such-route' || code.startsWith('http-'))) {
          if (!cancelled) setFailure(describeFailure(reason));
        }
      })
      .finally(() => {
        if (!cancelled) setAsked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing until the origin has answered: a canvas drawn from the wrong
  // source and swapped a tick later is two claims about the operator's work.
  if (!asked) {
    return null;
  }
  if (remote === null && failure === null) {
    return <LiveCanvas client={client} />;
  }
  return <SourceCanvas source={remote} failure={failure} />;
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
export function DesktopCanvas({
  api,
  update,
  mainErrors,
}: {
  readonly api: DesktopSourceApi;
  readonly update?: UpdateApi;
  /**
   * Main's own failure buffer's read side. Optional so every existing test
   * fixture (a bare `DesktopSourceApi`) keeps compiling; `bridgeMainErrors`
   * below is a no-op when it is absent, same as `UpdateNotice` already is
   * without `update`.
   */
  readonly mainErrors?: MainErrorsApi;
}) {
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

  // Started once, for the life of this shell: `bridgeMainErrors` pulls the
  // WHOLE backlog on its first call (recovering anything main recorded
  // before this component -- or this window -- existed) and again on every
  // tick. See `./errors/main-errors-bridge.js` for why a push alone would
  // drop exactly the earliest failures.
  useEffect(() => {
    if (mainErrors === undefined) return;
    return bridgeMainErrors(mainErrors);
  }, [mainErrors]);

  // The notice is a `fixed` popover in the top-right corner, so it takes no
  // room from the canvas and pushes nothing off the bottom of the viewport --
  // the failure the banner in `SourceCanvas` documents.
  return (
    <>
      <UpdateNotice update={update} />
      <SourceCanvas source={source} failure={assembleError} />
    </>
  );
}

/**
 * A canvas over an assembled `SessionSource`, whichever transport assembled
 * it: the Electron bridge or the remote endpoint. Shared rather than copied
 * because the layout below is load-bearing, not decoration.
 */
function SourceCanvas({
  source,
  failure,
}: {
  readonly source: SessionSource | null;
  readonly failure: string | null;
}) {
  const { model, error, loading, reload } = useSourceModel(source);
  const shown = failure ?? error;

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
        {/* The canvas is where the throw actually comes from, and the banner
            above it is usually the sentence that explains why -- so the
            boundary goes HERE, under the banner, rather than at the root
            where it would take the explanation down with the canvas. It also
            covers the phone shell, which `Canvas` renders. */}
        <ErrorBoundary surface="the canvas">
          {/* THE SOURCE'S BACKWARD PAGER, published to every pane below.
              `source.history ?? null`, and both halves of that are deliberate:
              the member is optional on the port (`sources/port.ts` says why),
              and a source that has not answered yet -- or failed to assemble --
              publishes NOTHING rather than a stub that resolves empty. A stub
              would tell the column "there is nothing older" about a source that
              has said no such thing, which is the confusion `TranscriptPage`'s
              whole shape exists to prevent.

              HERE RATHER THAN THROUGH `Canvas`: it is the source's own member,
              one per app, and it takes the session id it acts on as an
              argument, so the panes that draw a column all want the same
              function. `sources/history-reader.ts` carries the argument in
              full. */}
          <HistoryReaderProvider value={source?.history ?? null}>
            <Canvas
              model={model}
              source={
                source === null
                  ? // Not the default `READ_ONLY_SOURCE`: it says "no write route
                    // — this canvas is read-only", which is a claim about a source
                    // that has not answered yet and, here, is usually wrong. With
                    // `shown` set there is no source and there will not be one, so
                    // the cell says that instead of connecting forever.
                    { kind: 'connecting', error: shown }
                  : { kind: 'session', source, error: shown, loading, onWrote: reload }
              }
            />
          </HistoryReaderProvider>
        </ErrorBoundary>
      </div>
    </div>
  );
}

function DemoCanvas() {
  // Once per mount: padding 3,276 turns is real work, and doing it on every
  // render would measure the fixture instead of the pane.
  const model = useMemo(() => {
    const asked = demoTurns();
    return asked > 0 ? demoModelWithTurns(asked) : DEMO_MODEL;
  }, []);
  /**
   * THE DEMO'S OWN PAGER, and the demo is the only session this repo may drive
   * a guard against or put in a screenshot -- vam is public and every real
   * transcript on this machine is somebody's work. It is a real `TranscriptPage`
   * producer read by the same walk as any source's, and it gives all four of
   * the answers a source can give, the blank window and the refusal included
   * (`fixtures/demo-history.ts` states the order).
   *
   * ONCE PER MOUNT, like the model above: the scripted refusal is a step in a
   * closure, so a pager rebuilt on every render would refuse forever.
   */
  const history = useMemo(() => (demoHasHistory() ? createDemoHistory() : null), []);
  return (
    <HistoryReaderProvider value={history}>
      <Canvas
        model={model}
        source={{
          kind: 'demo',
          // Refused here rather than at the server: in demo mode there is no
          // session to refuse it, and "unknown session" is a confusing way to
          // learn the rows were never real.
          note: 'demo data — every write is refused',
        }}
      />
    </HistoryReaderProvider>
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
