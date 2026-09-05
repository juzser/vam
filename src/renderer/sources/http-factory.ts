/**
 * The HTTP twin of the preload bridge.
 *
 * A browser has no preload, so it has no `window.api` -- but it does not need
 * a second capability design. `src/shared/preload-api.ts` already states the
 * protocol as ten functions and a descriptor, and
 * `createSourceFromPreload` already turns that pair into a `SessionSource`
 * whose optional members exist exactly when the descriptor says so. So this
 * module builds a `PreloadSourceApi` over `fetch` and hands it to THAT
 * factory: the absent-means-absent rule keeps living in the one module that
 * has ever kept it, and there is no second place for the two shapes to drift.
 *
 * WHAT ENFORCES IS THE SERVER. The descriptor this reads is the one the
 * remote server projected onto the routes it actually registered, and a
 * member whose route was never registered answers 404 whoever asks. The
 * client's job is to not draw an affordance it was told does not exist --
 * politeness, on top of a refusal that does not depend on it.
 */

import type { Project } from '../domain/model.js';
import type { PreloadSourceApi, SourceDescriptor } from '../../shared/preload-api.js';
import type { SessionSource, SourceError } from './port.js';
import { createSourceFromPreload } from './preload-factory.js';
import { activeProviderId } from './provider.js';

/** The server's envelope, the same one the IPC layer sends. */
type Envelope = { ok: true; value: unknown } | { ok: false; error: SourceError };

/**
 * The transport, injectable -- and only the two members used. Typed
 * structurally rather than as `typeof fetch` and `EventSource` so this module
 * (and its tests) need no DOM lib, exactly as `preload/api.ts` types the slice
 * of `ipcRenderer` it uses.
 */
export type HttpTransport = {
  fetch: (
    url: string,
    init?: { method: string; headers: Record<string, string>; body: string },
  ) => Promise<{ status: number; statusText: string; json(): Promise<unknown> }>;
  openStream: (url: string) => {
    addEventListener(type: 'change', listener: () => void): void;
    close(): void;
  };
};

/** Same-origin by default: the page came from the server it now asks. */
export type HttpSourceOptions = Partial<HttpTransport> & { readonly baseUrl?: string };

const unreachable = (code: string, message: string): SourceError => ({
  kind: 'unreachable',
  code,
  message,
});

function defaultStream(url: string): ReturnType<HttpTransport['openStream']> {
  const Ctor = (globalThis as { EventSource?: new (url: string) => ReturnType<HttpTransport['openStream']> })
    .EventSource;
  if (Ctor === undefined) {
    throw unreachable('no-event-source', 'this browser cannot open a server-sent event stream');
  }
  return new Ctor(url);
}

/**
 * One request, unwrapped exactly as the preload unwraps IPC: the value on
 * success, and a REJECTION CARRYING THE SERVER'S OWN `SourceError` on refusal,
 * so `session-running` and its remedy survive the network the same way they
 * survive the bridge. A transport failure -- the tunnel down, the laptop
 * asleep -- becomes one too, because `describeFailure` renders `code: message`
 * and a raw `TypeError: Failed to fetch` renders nothing an operator can act
 * on.
 */
async function call<T>(
  transport: HttpTransport,
  url: string,
  body?: Record<string, unknown>,
): Promise<T> {
  let answer: Awaited<ReturnType<HttpTransport['fetch']>>;
  try {
    answer =
      body === undefined
        ? await transport.fetch(url)
        : await transport.fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
  } catch (cause) {
    throw unreachable(
      'transport-failed',
      cause instanceof Error ? cause.message : 'the remote endpoint did not answer',
    );
  }
  let parsed: unknown;
  try {
    parsed = await answer.json();
  } catch {
    parsed = null;
  }
  if (typeof parsed !== 'object' || parsed === null || !('ok' in parsed)) {
    throw unreachable(`http-${answer.status}`, answer.statusText || 'the answer was not an envelope');
  }
  const envelope = parsed as Envelope;
  if (!envelope.ok) {
    throw envelope.error;
  }
  return envelope.value as T;
}

/**
 * The ten-member api, over HTTP. Every member is present unconditionally, for
 * the same reason the preload's are: what a source can do is answered by the
 * descriptor, not by the shape of this object. Three of them
 * (`renameSession`, `applyWaivers`, `transitionLesson`) address routes the
 * remote server does not register -- calling one gets `no-such-route`, and the
 * descriptor's `false` is what keeps anything from calling it.
 */
export function createHttpSourceApi(options: HttpSourceOptions = {}): PreloadSourceApi {
  const base = options.baseUrl ?? '';
  const transport: HttpTransport = {
    fetch:
      options.fetch ??
      ((url, init) => fetch(url, init) as unknown as ReturnType<HttpTransport['fetch']>),
    openStream: options.openStream ?? defaultStream,
  };
  const get = <T,>(path: string): Promise<T> => call<T>(transport, `${base}${path}`);
  const post = (path: string, body: Record<string, unknown>): Promise<void> =>
    call<void>(transport, `${base}${path}`, body);

  return {
    describe: () => get<SourceDescriptor>('/api/describe'),
    load: () => get<readonly Project[]>('/api/load'),
    // Payload-free, like the IPC channel it mirrors: a tick says "ask again".
    // The unsubscribe closure is returned SYNCHRONOUSLY, which is why this is
    // a stream and not a poll built on the request path above.
    subscribe: (onChange) => {
      const stream = transport.openStream(`${base}/api/stream`);
      stream.addEventListener('change', onChange);
      return () => stream.close();
    },
    recordPrompt: (sessionId, prompt) => post('/api/record-prompt', { sessionId, prompt }),
    renameSession: (sessionId, title) => post('/api/rename-session', { sessionId, title }),
    closeSession: (sessionId) => post('/api/close-session', { sessionId }),
    createSession: (projectId, title, provider) =>
      post('/api/create-session', { projectId, title, provider: provider ?? activeProviderId() }),
    createSessionIn: (cwd, title, provider) =>
      post('/api/create-session-in', { cwd, title, provider: provider ?? activeProviderId() }),
    applyWaivers: (sessionId, findingIds) => post('/api/apply-waivers', { sessionId, findingIds }),
    transitionLesson: (sessionId, lessonId, status) =>
      post('/api/transition-lesson', { sessionId, lessonId, status }),
  };
}

/** The source a browser gets: the server's descriptor, assembled by the one factory. */
export function createSourceFromHttp(options: HttpSourceOptions = {}): Promise<SessionSource> {
  return createSourceFromPreload(createHttpSourceApi(options));
}
