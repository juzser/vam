/**
 * A framework-free reader for black-smith's `GET /api/stream`. It parses the
 * two named SSE frames the server sends (`hello`, `change`) and hands the
 * caller parsed objects. No React, no timer, no clock.
 *
 * `HelloFrame` declares `heartbeatMs`/`floorMs` because the wire contract
 * requires it, but nothing here builds a watchdog on either number: a
 * keep-alive is an SSE comment, and `EventSource` never surfaces a comment to
 * JS in any form; the browser reconnects on its own at a measured constant
 * 3.00s; and `floorMs` (10000) is *less* than `heartbeatMs` (15000), so the
 * two cannot compose into a sound bound anyway. See black-smith's
 * factory/specs/active/vam-sse-canvas/epic.md sections 3.3 and 5.2 for the
 * full measurement this rests on.
 */

export type HelloFrame = {
  readonly heartbeatMs: number;
  readonly floorMs: number;
};

export type ChangeFrame = {
  readonly sessions: readonly string[];
  readonly at: string;
};

export type ChangeStreamOptions = {
  readonly url?: string;
  readonly createEventSource?: (url: string) => EventSource;
  readonly onHello?: (hello: HelloFrame) => void;
  readonly onChange: (frame: ChangeFrame) => void;
};

function isHelloFrame(value: unknown): value is HelloFrame {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.heartbeatMs === 'number' && typeof candidate.floorMs === 'number';
}

function isChangeFrame(value: unknown): value is ChangeFrame {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.sessions) &&
    candidate.sessions.every((session) => typeof session === 'string') &&
    typeof candidate.at === 'string'
  );
}

function parse(data: string | undefined): unknown {
  if (data === undefined) return undefined;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

export function openChangeStream(options: ChangeStreamOptions): { close(): void } {
  const url = options.url ?? '/api/stream';
  const createEventSource = options.createEventSource ?? ((source) => new EventSource(source));
  const source = createEventSource(url);

  let closed = false;

  source.addEventListener('hello', (event) => {
    if (closed) return;
    const parsed = parse((event as MessageEvent<string>).data);
    if (isHelloFrame(parsed)) {
      options.onHello?.(parsed);
    }
  });

  source.addEventListener('change', (event) => {
    if (closed) return;
    const parsed = parse((event as MessageEvent<string>).data);
    if (isChangeFrame(parsed)) {
      options.onChange({ sessions: parsed.sessions, at: parsed.at });
    }
  });

  // A stream `error` is not an outage: the browser already reconnects on its
  // own at a measured constant, so this module neither closes nor reopens.
  source.addEventListener('error', () => {});

  return {
    close() {
      if (closed) return;
      closed = true;
      source.close();
    },
  };
}
