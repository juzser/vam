/**
 * Loading the canvas from a live black-smith, and keeping it loaded.
 *
 * Streaming, not polling. The old shape ran `load()` on a four-second timer
 * whether or not anything moved; this one reacts to `openChangeStream`
 * (`./stream.js`): once at mount, once on every `hello` (first connection and
 * every browser-driven reconnect — epic.md §7 q1's second answer), and once
 * per well-formed `change`. A stream `error` is not an outage — the browser
 * reconnects on its own at a measured constant, and the `hello` that follows
 * recovers whatever a client reconnect would have, without a second socket
 * (§3.3, §5.3). Every component still reads `CanvasModel` and cannot tell.
 *
 * It still refuses to show you a fixture when the server is down — offline
 * shows nothing and says why; the fixture lives behind `?demo=1`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { openChangeStream } from '../../shared/stream.js';
import type { CanvasModel } from '../domain/model.js';
import type { ApiTimelineEntry } from './api.js';
import type { SmithClient } from './client.js';
import { SmithUnreachableError } from './client.js';
import { toCanvasModel } from './to-canvas.js';

export type CanvasFeed = {
  readonly model: CanvasModel;
  /** `loading` only before the first answer; a later failure keeps the last good model and reports through `error`. */
  readonly status: 'loading' | 'live' | 'error';
  readonly error: string | null;
  /** Force a load now — what a write calls so its effect shows up at once. */
  readonly refresh: () => void;
};

/** Optional, and only for tests: how the hook builds its `EventSource`. */
export type UseCanvasOptions = {
  readonly createEventSource?: (url: string) => EventSource;
};

const EMPTY: CanvasModel = { projects: [] };

export function useCanvas(client: SmithClient, options?: UseCanvasOptions): CanvasFeed {
  const [model, setModel] = useState<CanvasModel>(EMPTY);
  const [status, setStatus] = useState<CanvasFeed['status']>('loading');
  const [error, setError] = useState<string | null>(null);

  // `alive`: no state write into an unmounted component. `generation`: no
  // older load overwriting a newer one when change/hello land mid-load.
  const alive = useRef(true);
  const generation = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const overview = await client.overview();
      // One call per session — a handful of small requests at this scale (§3).
      const timelines = new Map<string, readonly ApiTimelineEntry[]>();
      await Promise.all(
        overview.runningSessions.map(async (session) => {
          timelines.set(session.sessionId, await client.timeline(session.sessionId));
        }),
      );
      if (!alive.current || mine !== generation.current) {
        return;
      }
      // This hook only ever talks to black-smith; toCanvasModel now takes the
      // source id as a parameter instead of assuming it.
      setModel(toCanvasModel(overview, timelines, 'black-smith'));
      setStatus('live');
      setError(null);
    } catch (cause) {
      if (!alive.current || mine !== generation.current) {
        return;
      }
      setStatus('error');
      setError(
        cause instanceof SmithUnreachableError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : String(cause),
      );
    }
  }, [client]);

  // Unconditional: reading never waited on SSE (canvas-layout.md §6.1).
  useEffect(() => {
    void load();
  }, [load]);

  // Latest `load`/options read through refs, updated every render with no
  // dependency array of their own, so the stream effect below can depend on
  // nothing that changes per render — R-1: a churning dependency array
  // rebuilds the EventSource, and now also refetches, on every render.
  const loadRef = useRef(load);
  const createEventSourceRef = useRef(options?.createEventSource);
  useEffect(() => {
    loadRef.current = load;
    createEventSourceRef.current = options?.createEventSource;
  });

  useEffect(() => {
    // One load per connection (onHello) recovers a change frame emitted
    // while nobody held one (§3.2). `sessions` is never read on change:
    // runningSessions[] is the authority, and an ended session must still
    // refetch (§5.4).
    const handle = openChangeStream({
      createEventSource: createEventSourceRef.current,
      onHello: () => void loadRef.current(),
      onChange: () => void loadRef.current(),
    });
    return () => handle.close();
  }, []);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return { model, status, error, refresh };
}
