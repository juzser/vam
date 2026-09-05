/**
 * vam over HTTP: the same protocol the preload speaks, addressed by URL.
 *
 * THREE PROPERTIES ARE STRUCTURAL, not policy a handler applies.
 *
 * 1. It binds 127.0.0.1 and nothing else. `tailscale serve` proxies tailnet
 *    requests to `http://127.0.0.1:<port>` on this machine, so no listening
 *    address of its own is needed -- and Tailscale recommends loopback-only
 *    for exactly this reason (https://tailscale.com/kb/1312/serve). Any other
 *    bind address is refused rather than honoured.
 * 2. It refuses to start without a device registry. A route here can type into
 *    a running agent and kill sessions; a default-open mode someone later runs
 *    by accident is remote code execution by proxy.
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
 *
 * TAILSCALE AUTHENTICATES A DEVICE ONTO A NETWORK; IT DOES NOT AUTHORISE THAT
 * DEVICE TO DRIVE YOUR AGENTS. The whole tailnet -- and every shared-in
 * external user, and every local process that can reach loopback -- can open a
 * socket here. The bearer token is what separates reaching the port from being
 * allowed to use it. `Tailscale-User-*` headers are proxy-asserted and forgeable
 * by anything local, so they are never read as a credential.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { SourceCapabilities } from '../../renderer/sources/port.js';
import type { SourceDescriptor } from '../../shared/preload-api.js';
import type { SourceError } from '../ipc/channels.js';
import type { MainSource } from '../sources/source.js';
import { serveAsset } from './assets.js';
import { authenticateDevice, type DeviceDirectory, type Identity } from './auth.js';
import type { PairOutcome } from './pairing.js';

/** The one address this server may ever bind. */
export const LOOPBACK = '127.0.0.1';

/** Far above any real payload; `recordPrompt` accepts a pasted prompt. */
const MAX_BODY_BYTES = 2_000_000;
const MAX_TEXT_LENGTH = 10_000;
const MAX_PROMPT_LENGTH = 1_000_000;

export type RemoteServerOptions = {
  readonly port: number;
  /** Optional in the TYPE so the unconfigured case is testable, never at runtime. */
  readonly devices: DeviceDirectory | undefined;
  /**
   * Present only so a test can prove the refusal below. There is no
   * configuration path that sets it to anything but `LOOPBACK`.
   */
  readonly host?: string;
  /**
   * The pairing screen's half of `/api/pair`. Absent means the route answers
   * 401 like any other path an unpaired caller reaches -- see below.
   */
  readonly pairing?: PairPort;
  /** Where live SSE connections are held, so a revoked device can be dropped. */
  readonly streams?: StreamRegistry;
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

/** What this server needs of `createPairing`, and nothing more. */
export type PairPort = {
  submit(code: string, name: string, source: string): Promise<PairOutcome>;
};

/**
 * The live SSE connections, by device.
 *
 * Revocation has to reach INSIDE an open connection: a stream opened while a
 * device was paired outlives the pairing otherwise, and "remove this device"
 * would leave it reading the model until it chose to hang up.
 */
export type StreamRegistry = {
  add(deviceId: string, close: () => void): () => void;
  closeFor(deviceId: string): void;
};

export function createStreamRegistry(): StreamRegistry {
  const open = new Map<string, Set<() => void>>();
  return {
    add(deviceId, close) {
      const set = open.get(deviceId) ?? new Set();
      set.add(close);
      open.set(deviceId, set);
      return () => {
        set.delete(close);
        if (set.size === 0) {
          open.delete(deviceId);
        }
      };
    },
    closeFor(deviceId) {
      // Only this device's connections: revoking one pairing must not hang up
      // on the others.
      for (const close of open.get(deviceId) ?? []) {
        close();
      }
      open.delete(deviceId);
    },
  };
}

/**
 * THE ONLY 401 THIS SERVER SENDS, byte for byte, whoever asked and whatever
 * was wrong.
 *
 * An unpaired stranger, a forged token, a revoked device, a wrong pairing
 * code, a burned one, a screen that was never opened -- all of them get this.
 * The moment the reply names the state, `/api/pair` becomes an oracle for
 * "is the operator looking at the pairing screen right now", which is the one
 * moment worth attacking. The desktop learns that a code burned from
 * `pairing.state()`, on this side of the wire, not from a reply the phone
 * relayed back.
 */
const UNAUTHENTICATED = {
  ok: false,
  error: {
    kind: 'refused',
    code: 'unauthenticated',
    // What the phone is entitled to say. It CANNOT know whether the code was
    // wrong, burned, expired, or typed at a screen that was never open -- that
    // is the point of the uniform refusal -- so "wrong code" would be a
    // specific claim it has no standing to make. The desktop is two feet away
    // and shows the truth.
    message: 'not paired: check the pairing screen on the desktop',
  },
} as const;

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
    audit(`remote write ${name} by ${identity.name} (${identity.deviceId})`);
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

  read('/api/describe', async () =>
    servedDescriptor(options.source.descriptor, options.allowWrites),
  );
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
  return (request, response, { identity }) => {
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
    let forget = (): void => {};
    const stop = (): void => {
      unsubscribe();
      forget();
      response.end();
    };
    forget = options.streams?.add(identity.deviceId, stop) ?? (() => {});
    request.on('close', stop);
    request.on('error', stop);
  };
}

/**
 * One pairing attempt. EVERY outcome that is not a grant is the same 401 as
 * any other unauthenticated request, and every one of them costs the caller a
 * counted failure -- including a body that is not a pairing request at all.
 * The token leaves in the RESPONSE BODY only, never in a URL, a redirect or a
 * query string, where a proxy log or a browser history would keep it.
 */
async function handlePair(
  pairing: PairPort,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readBody(request);
  // Recorded and shown, never trusted or counted on. BEHIND `tailscale serve`
  // THIS IS ALWAYS 127.0.0.1 -- the proxy is the peer -- so it discriminates
  // nothing and the rate limit is deliberately global rather than per-source.
  // It is here because on a direct loopback connection it is occasionally the
  // one clue the operator gets, not because it is evidence.
  const source = request.socket.remoteAddress ?? 'unknown';
  // A MALFORMED BODY IS STILL A KNOCK, and it used to be the one that cost
  // nothing: it answered `400 invalid-payload` where every other refusal
  // answers the uniform 401, and it did so before `submit` -- so before the
  // failure was counted. It discloses only that a pairing door exists, which
  // having the door implies, but free is free. It goes through `submit` like
  // everything else, with values that cannot match any minted code.
  const code = body !== null && isText(body.code) ? body.code : '';
  const name = body !== null && isText(body.name) ? body.name : 'an unnamed device';
  const outcome = await pairing.submit(code, name, source);
  if (!outcome.ok) {
    send(response, 401, UNAUTHENTICATED);
    return;
  }
  send(response, 200, {
    ok: true,
    value: {
      token: outcome.token,
      deviceId: outcome.identity.deviceId,
      name: outcome.identity.name,
    },
  });
}

/**
 * Starts the server, or refuses and says why.
 *
 * The refusal is the point: there is no mode of this server that answers a
 * request nobody signed for.
 */
export async function startRemoteServer(options: RemoteServerOptions): Promise<Server> {
  const { devices } = options;
  if (devices === undefined) {
    throw new Error(
      'the remote server will not start without a device registry: pairing is ' +
        'what authorises a device to drive an agent, and being on the tailnet ' +
        'is not that. This endpoint can type into running agents, so there is ' +
        'no unpaired mode of it.',
    );
  }
  const host = options.host ?? LOOPBACK;
  if (host !== LOOPBACK) {
    throw new Error(
      `the remote server binds ${LOOPBACK} and nothing else, not ${host}: ` +
        '`tailscale serve` proxies to loopback, so a tailnet-facing bind is ' +
        'an open port with no proxy in front of it.',
    );
  }

  const table = routesFor(options);
  const webRoot = options.webRoot === undefined ? null : resolve(options.webRoot);

  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', `http://${LOOPBACK}`).pathname;
      // THE ONE DOOR AN UNPAIRED CALLER MAY KNOCK ON, and the only way to
      // obtain the token every other path requires. It is not a hole in the
      // identity-before-routing rule: pairing is how identity is granted, and
      // this door exists only while the operator has the screen open, holds a
      // live code, and answers "allow this device?" in person.
      //
      // A refusal here is the SAME 401, byte for byte, that an unauthenticated
      // request to any other path gets -- see `UNAUTHENTICATED`. A caller
      // cannot tell "no screen is open" from "wrong code" from "no token", and
      // a knock costs it a counted failure either way.
      if (options.pairing !== undefined && request.method === 'POST' && path === '/api/pair') {
        await handlePair(options.pairing, request, response);
        return;
      }
      const outcome = authenticateDevice(request.headers.authorization, devices);
      if (!outcome.ok) {
        // The reason is deliberately dropped rather than reported: see
        // `UNAUTHENTICATED`. It exists for this process's own tests and logs.
        send(response, 401, UNAUTHENTICATED);
        return;
      }
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
    })().catch((error: unknown) => {
      // THE LAST BOUNDARY, and it is not decoration. This handler is a
      // floating promise: an unhandled rejection inside it terminates the
      // Electron main process under Node's default policy, which would make
      // this remote surface a way to kill the operator's whole session from
      // the far side of the network. `envelope` already covers a source that
      // throws; this covers everything else, including a registry write that
      // fails while a device is being granted.
      console.error(`[vam] remote request failed: ${String(error)}`);
      if (!response.headersSent) {
        send(response, 500, {
          ok: false,
          error: { kind: 'unreachable', code: 'server-failed', message: 'the request failed' },
        });
        return;
      }
      response.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(options.port, LOOPBACK, resolve));
  return server;
}
