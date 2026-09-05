/**
 * vam over HTTP: the same protocol the preload speaks, addressed by URL.
 *
 * THREE PROPERTIES ARE STRUCTURAL, not policy a handler applies.
 *
 * 1. It binds 127.0.0.1 and nothing else. `cloudflared` dials OUT from this
 *    machine, so a tunnel needs no listening address of its own -- and
 *    `vite.config.ts` already says nothing here should be reachable from
 *    another machine. This keeps that true while letting a tunnel reach in.
 * 2. It refuses to start without Cloudflare Access configured. A route here
 *    can type into a running agent and kill sessions; a default-open mode
 *    someone later runs by accident is remote code execution by proxy.
 * 3. In read-only mode the write routes ARE NOT REGISTERED. Not a flag a
 *    handler consults, not a descriptor capability the client reads -- the
 *    table has no entry, and the process answers 404. Capability gating in
 *    this app otherwise lives in the renderer, which over a network is a
 *    client politely not asking.
 *
 * Identity is checked BEFORE the route table is consulted, per request. So an
 * anonymous caller cannot even learn which paths exist, and a long-lived SSE
 * connection was opened by a verified identity rather than merely by whoever
 * reached the port first.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { SourceCapabilities } from '../../renderer/sources/port.js';
import type { SourceDescriptor } from '../../shared/preload-api.js';
import type { SourceError } from '../ipc/channels.js';
import type { MainSource } from '../sources/source.js';
import { serveAsset } from './assets.js';
import { type AccessAuth, type Identity, verifyAccessToken } from './auth.js';

/** The one address this server may ever bind. */
export const LOOPBACK = '127.0.0.1';

/** The header Cloudflare Access sets on every request it lets through. */
const ASSERTION_HEADER = 'cf-access-jwt-assertion';

/** Far above any real payload; `recordPrompt` accepts a pasted prompt. */
const MAX_BODY_BYTES = 2_000_000;
const MAX_TEXT_LENGTH = 10_000;
const MAX_PROMPT_LENGTH = 1_000_000;

export type RemoteServerOptions = {
  readonly port: number;
  /** Optional in the TYPE so the unconfigured case is testable, never at runtime. */
  readonly auth: AccessAuth | undefined;
  readonly allowWrites: boolean;
  readonly source: MainSource;
  readonly subscribe: (onChange: () => void) => () => void;
  /** One line per write that reached a source. Defaults to the process log. */
  readonly audit?: (line: string) => void;
  /**
   * The directory holding the browser build (`dist-web`). Absent means this
   * server answers JSON and nothing else -- serving a page is a decision, not
   * a default, and an absent build must 404 rather than half-load.
   */
  readonly webRoot?: string;
};

type Envelope = { ok: true; value: unknown } | { ok: false; error: SourceError };

type Route = (
  request: IncomingMessage,
  response: ServerResponse,
  context: { readonly identity: Identity; readonly body: Record<string, unknown> },
) => Promise<void> | void;

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT_LENGTH;
const isPrompt = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_PROMPT_LENGTH;
const isDirectory = (value: unknown): value is string =>
  isText(value) && value.startsWith('/') && !value.includes('\0');
const isOptionalText = (value: unknown): value is string | undefined =>
  value === undefined || isText(value);

function send(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  response.end(text);
}

/** A source failure travels as data, exactly as it does over IPC. */
async function envelope(produce: () => Promise<unknown>): Promise<Envelope> {
  try {
    return { ok: true, value: await produce() };
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: 'unreachable',
        code: 'source-failed',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function readBody(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        request.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', () => resolve(null));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.length === 0) {
        resolve({});
        return;
      }
      try {
        const value: unknown = JSON.parse(raw);
        resolve(
          typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null,
        );
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * A write route: validate, then call the member if the source carries one.
 * The source's own `SourceError` is forwarded WHOLE -- re-wrapping it would
 * cost the code a consumer branches on and the message it renders.
 */
function write(
  options: RemoteServerOptions,
  name: string,
  valid: (body: Record<string, unknown>) => boolean,
  call: (source: MainSource, body: Record<string, unknown>) => Promise<SourceError | null> | null,
): Route {
  const audit = options.audit ?? ((line: string) => console.info(line));
  return async (_request, response, { identity, body }) => {
    if (!valid(body)) {
      send(response, 400, {
        ok: false,
        error: { kind: 'refused', code: 'invalid-payload', message: `${name}: wrong shape` },
      });
      return;
    }
    const performed = call(options.source, body);
    if (performed === null) {
      send(response, 200, {
        ok: false,
        error: {
          kind: 'refused',
          code: 'not-implemented',
          message: `${name} is advertised but not yet wired in main`,
        },
      });
      return;
    }
    audit(`remote write ${name} by ${identity.email}`);
    // The source RESOLVES to its refusal rather than throwing it, exactly as
    // over IPC, so `null` is the success -- and `envelope` is still here for
    // the unexpected throw that must never take the process with it.
    const result = await envelope(async () => await performed);
    if (!result.ok) {
      send(response, 200, result);
      return;
    }
    const failure = result.value as SourceError | null;
    send(
      response,
      200,
      failure === null ? { ok: true, value: null } : { ok: false, error: failure },
    );
  };
}

/**
 * Capabilities whose renderer member reaches for a route this server does not
 * carry -- with the server's own words for why, because a decline is written
 * by whoever lacks the thing.
 */
const UNSERVED: Partial<Record<keyof SourceCapabilities, string>> = {
  renameSession: 'the remote endpoint carries no rename route',
  governance: 'the remote endpoint carries no waiver or lesson routes',
  terminal:
    'the remote endpoint does not expose the terminal surface: read, send, answer ' +
    'and resize type into a running agent and need their own rate limit and decision',
};

/** The capabilities that live behind the write routes, registered or not. */
const WRITE_CAPABILITIES = [
  'recordPrompt',
  'deliverPrompt',
  'closeSession',
  'createSession',
] as const;

/**
 * The descriptor as THIS SERVER can honour it.
 *
 * Main's descriptor describes what the desktop source can do; over HTTP a
 * subset of those members has no route, and in read-only mode the writes have
 * none either. Answering the unprojected descriptor would hand a browser
 * affordances that 404 on use -- present-and-failing, which is exactly what
 * the port's absent-means-absent rule exists to prevent. A capability already
 * false keeps the SOURCE's own decline; only one this server turns off gets
 * the server's.
 */
export function servedDescriptor(
  descriptor: SourceDescriptor,
  allowWrites: boolean,
): SourceDescriptor {
  const capabilities: Record<string, boolean> = { ...descriptor.capabilities };
  const declines: Record<string, string> = { ...descriptor.declines };
  const off = (key: string, why: string): void => {
    if (capabilities[key] === true) {
      capabilities[key] = false;
      declines[key] = why;
    }
  };
  for (const [key, why] of Object.entries(UNSERVED)) {
    off(key, why);
  }
  if (!allowWrites) {
    for (const key of WRITE_CAPABILITIES) {
      off(key, 'this server was started read-only; the write routes are not registered');
    }
  }
  return {
    ...descriptor,
    capabilities: capabilities as unknown as SourceCapabilities,
    declines,
  };
}

function routesFor(options: RemoteServerOptions): Map<string, { method: string; route: Route }> {
  const table = new Map<string, { method: string; route: Route }>();
  const read = (path: string, produce: () => Promise<unknown>): void => {
    table.set(path, {
      method: 'GET',
      route: async (_request, response) => {
        send(response, 200, await envelope(produce));
      },
    });
  };

  read('/api/describe', async () => servedDescriptor(options.source.descriptor, options.allowWrites));
  read('/api/load', async () => await options.source.load());

  table.set('/api/stream', { method: 'GET', route: stream(options) });

  if (!options.allowWrites) {
    return table;
  }

  const writes: [
    string,
    string,
    (b: Record<string, unknown>) => boolean,
    (s: MainSource, b: Record<string, unknown>) => Promise<SourceError | null> | null,
  ][] = [
    [
      '/api/record-prompt',
      'recordPrompt',
      (b) => isText(b.sessionId) && isPrompt(b.prompt),
      (s, b) => s.recordPrompt?.(b.sessionId as string, b.prompt as string) ?? null,
    ],
    [
      '/api/close-session',
      'closeSession',
      (b) => isText(b.sessionId),
      (s, b) => s.closeSession?.(b.sessionId as string) ?? null,
    ],
    [
      '/api/create-session',
      'createSession',
      (b) => isText(b.projectId) && isText(b.title) && isOptionalText(b.provider),
      (s, b) =>
        s.createSession?.(
          b.projectId as string,
          b.title as string,
          b.provider as string | undefined,
        ) ?? null,
    ],
    [
      '/api/create-session-in',
      'createSessionIn',
      (b) => isDirectory(b.cwd) && isText(b.title) && isOptionalText(b.provider),
      (s, b) =>
        s.createSessionInDirectory?.(
          b.cwd as string,
          b.title as string,
          b.provider as string | undefined,
        ) ?? null,
    ],
  ];
  for (const [path, name, valid, call] of writes) {
    table.set(path, { method: 'POST', route: write(options, name, valid, call) });
  }
  return table;
}

/**
 * The live model, pushed. Payload-free like the IPC channel it mirrors: a tick
 * says "ask again", and the client re-reads `/api/load`.
 */
function stream(options: RemoteServerOptions): Route {
  return (request, response) => {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    // Flushed before subscribing so a client knows the stream is open, and so
    // a proxy cannot hold the headers back waiting for a first byte.
    response.write(': open\n\nretry: 2000\n\n');
    const unsubscribe = options.subscribe(() => {
      response.write('event: change\ndata: {}\n\n');
    });
    const stop = (): void => {
      unsubscribe();
      response.end();
    };
    request.on('close', stop);
    request.on('error', stop);
  };
}

/**
 * Starts the server, or refuses and says why.
 *
 * The refusal is the point: there is no mode of this server that answers a
 * request nobody signed for.
 */
export async function startRemoteServer(options: RemoteServerOptions): Promise<Server> {
  const { auth } = options;
  if (auth === undefined || auth.audience.length === 0 || auth.issuer.length === 0) {
    throw new Error(
      'the remote server will not start without Cloudflare Access configured: ' +
        'set the Access application audience and team issuer. This endpoint can ' +
        'type into running agents, so there is no unauthenticated mode of it.',
    );
  }

  const table = routesFor(options);
  const webRoot = options.webRoot === undefined ? null : resolve(options.webRoot);

  const server = createServer((request, response) => {
    void (async () => {
      const assertion = request.headers[ASSERTION_HEADER];
      const token = typeof assertion === 'string' ? assertion : '';
      const outcome = await verifyAccessToken(token, auth);
      if (!outcome.ok) {
        send(response, 401, {
          ok: false,
          error: { kind: 'refused', code: 'unauthenticated', message: outcome.reason },
        });
        return;
      }
      const path = new URL(request.url ?? '/', `http://${LOOPBACK}`).pathname;
      const entry = table.get(path);
      if (entry === undefined) {
        // AFTER the identity check and only after it: a static file must not
        // be reachable by someone `/api/load` would refuse. `/api/*` never
        // falls through to a file, so no upload or stray name under the web
        // root can shadow a route or answer where JSON is expected.
        if (
          webRoot !== null &&
          request.method === 'GET' &&
          !path.startsWith('/api/') &&
          (await serveAsset(webRoot, path, response))
        ) {
          return;
        }
        // `unreachable`, deliberately, not `refused`: in read-only mode this
        // is the answer a write path gets, and it must not read as a
        // capability decline -- there is no route here to decline anything.
        send(response, 404, {
          ok: false,
          error: { kind: 'unreachable', code: 'no-such-route', message: path },
        });
        return;
      }
      if (request.method !== entry.method) {
        send(response, 405, {
          ok: false,
          error: { kind: 'refused', code: 'wrong-method', message: entry.method },
        });
        return;
      }
      const body = entry.method === 'POST' ? await readBody(request) : {};
      if (body === null) {
        send(response, 400, {
          ok: false,
          error: { kind: 'refused', code: 'invalid-payload', message: 'body is not a JSON object' },
        });
        return;
      }
      await entry.route(request, response, { identity: outcome.identity, body });
    })();
  });

  await new Promise<void>((resolve) => server.listen(options.port, LOOPBACK, resolve));
  return server;
}
