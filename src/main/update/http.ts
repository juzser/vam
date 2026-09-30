/**
 * The one way this feature downloads bytes: GET a URL, following redirects BY
 * HAND so every hop is checked against the host allowlist, and hand back a
 * capped, watchdogged byte stream.
 *
 * A GitHub release asset answers `github.com/...` with a 302 to a signed URL on
 * a `*.githubusercontent.com` host. `fetch`'s automatic following would take
 * that hop, and any other a compromised or misbehaving response named,
 * without asking. `redirect: 'manual'` makes undici (Node's, and so Electron
 * main's global `fetch`) return the 3xx itself with a readable `Location`
 * (verified against a local server on Node 22), which is what makes the
 * per-hop `isAllowedDownloadUrl` check possible with no extra dependency.
 *
 * Limits, each a typed failure rather than a hang or a full disk:
 *   - at most `MAX_REDIRECTS` hops, each hop allowlisted;
 *   - a `Content-Length` above `maxBytes` is refused before reading a byte, and
 *     a stream that outgrows `maxBytes` anyway is cut off;
 *   - an idle watchdog: no response headers, or no new chunk, for `idleMs`
 *     aborts the request.
 *
 * Never imports `electron`; the fetcher is injectable so tests use `Response`.
 */

import { isAllowedDownloadUrl } from '../../shared/update-manifest.js';

export const MAX_REDIRECTS = 5;
export const IDLE_TIMEOUT_MS = 60_000;

export type HttpErrorCode = 'network' | 'too-large';

export class UpdateHttpError extends Error {
  readonly code: HttpErrorCode;
  /** The final HTTP status, when the failure was one. */
  readonly status?: number;
  constructor(code: HttpErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'UpdateHttpError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

/** The subset of `fetch` this module uses. */
export type HttpFetcher = (
  url: string,
  init: { redirect: 'manual'; signal: AbortSignal; headers: Record<string, string> },
) => Promise<Response>;

export type FetchFollowingOptions = {
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
  /** Called per received chunk with bytes so far and the announced total, if any. */
  readonly onProgress?: (received: number, total: number | null) => void;
  readonly fetcher?: HttpFetcher;
  readonly idleMs?: number;
};

export type FetchFollowingResult = {
  readonly status: number;
  readonly body: AsyncIterable<Uint8Array>;
};

export type FollowFn = (
  url: string,
  options: FetchFollowingOptions,
) => Promise<FetchFollowingResult>;

const defaultFetcher: HttpFetcher = (url, init) => globalThis.fetch(url, init);

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

export async function fetchFollowing(
  startUrl: string,
  options: FetchFollowingOptions,
): Promise<FetchFollowingResult> {
  const fetcher = options.fetcher ?? defaultFetcher;
  const idleMs = options.idleMs ?? IDLE_TIMEOUT_MS;
  const control = new AbortController();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let fail!: (error: UpdateHttpError) => void;
  const failed = new Promise<never>((_resolve, reject) => {
    fail = (error) => {
      control.abort();
      reject(error);
    };
  });
  failed.catch(() => {});
  const arm = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => fail(new UpdateHttpError('network', 'connection went idle')), idleMs);
  };
  const disarm = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const onAbort = (): void => fail(new UpdateHttpError('network', 'request aborted'));
  if (options.signal?.aborted === true) {
    throw new UpdateHttpError('network', 'request aborted');
  }
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const cleanup = (): void => {
    disarm();
    options.signal?.removeEventListener('abort', onAbort);
  };

  try {
    let url = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!isAllowedDownloadUrl(url)) {
        throw new UpdateHttpError('network', 'download host is not allowed');
      }
      arm();
      let response: Response;
      try {
        response = await Promise.race([
          fetcher(url, {
            redirect: 'manual',
            signal: control.signal,
            headers: { 'User-Agent': 'vam' },
          }),
          failed,
        ]);
      } catch (error) {
        if (error instanceof UpdateHttpError) throw error;
        throw new UpdateHttpError('network', 'request failed');
      }

      if (REDIRECT_STATUSES.includes(response.status)) {
        const location = response.headers.get('location');
        void response.body?.cancel().catch(() => {});
        if (location === null || location === '') {
          throw new UpdateHttpError('network', 'redirect without a location', response.status);
        }
        try {
          url = new URL(location, url).href;
        } catch {
          throw new UpdateHttpError('network', 'redirect to an invalid URL', response.status);
        }
        continue;
      }

      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new UpdateHttpError(
          'network',
          `unexpected status ${response.status}`,
          response.status,
        );
      }

      const lengthHeader = response.headers.get('content-length');
      const announced =
        lengthHeader !== null && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;
      if (announced !== null && announced > options.maxBytes) {
        void response.body?.cancel().catch(() => {});
        throw new UpdateHttpError('too-large', 'download is larger than allowed');
      }

      return {
        status: response.status,
        body: stream(response, announced, options, { arm, cleanup, failed }),
      };
    }
    throw new UpdateHttpError('network', 'too many redirects');
  } catch (error) {
    cleanup();
    throw error;
  }
}

async function* stream(
  response: Response,
  announced: number | null,
  options: FetchFollowingOptions,
  watch: { arm: () => void; cleanup: () => void; failed: Promise<never> },
): AsyncGenerator<Uint8Array> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    watch.cleanup();
    return;
  }
  let received = 0;
  try {
    for (;;) {
      watch.arm();
      let step: Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>;
      try {
        step = await Promise.race([reader.read(), watch.failed]);
      } catch (error) {
        if (error instanceof UpdateHttpError) throw error;
        throw new UpdateHttpError('network', 'download interrupted');
      }
      if (step.done) return;
      received += step.value.byteLength;
      if (received > options.maxBytes) {
        throw new UpdateHttpError('too-large', 'download is larger than allowed');
      }
      options.onProgress?.(received, announced);
      yield step.value;
    }
  } finally {
    watch.cleanup();
    await reader.cancel().catch(() => {});
  }
}

/** Collect a capped body into one buffer. */
export async function readAll(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
