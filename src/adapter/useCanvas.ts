/**
 * Loading the canvas from a live black-smith, and keeping it loaded.
 *
 * Polling, not streaming. §5 records that SSE for `ui/server` is a black-smith
 * epic that has not landed, and this is the honest thing to do until it does:
 * one overview call per tick plus one timeline call per session, at a rate slow
 * enough to be unremarkable. When SSE arrives this file changes and nothing
 * else does — every component reads `CanvasModel` and cannot tell the two apart.
 *
 * What it refuses to do is show you a fixture when the server is down. A demo
 * that looks live is the setup for typing a real prompt at a session that does
 * not exist, and the write would be refused by black-smith with a message about
 * an unknown session, which is a confusing way to learn your dashboard was
 * pretending. Offline shows nothing and says why; the fixture lives behind an
 * explicit switch (`?demo=1`).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasModel } from '../domain/model.js';
import type { ApiTimelineEntry } from './api.js';
import type { SmithClient } from './client.js';
import { SmithUnreachableError } from './client.js';
import { toCanvasModel } from './to-canvas.js';

/** Slow on purpose. The factory moves in seconds, not frames. */
export const POLL_MS = 4000;

export type CanvasFeed = {
  readonly model: CanvasModel;
  /**
   * `loading` only before the first answer. After that a failed tick keeps the
   * last good model on screen and reports through `error` — a dashboard that
   * blanked on one dropped request would be unreadable next to a restarting
   * server.
   */
  readonly status: 'loading' | 'live' | 'error';
  readonly error: string | null;
  /** Force a tick now — what a write calls so its effect shows up at once. */
  readonly refresh: () => void;
};

const EMPTY: CanvasModel = { projects: [] };

export function useCanvas(client: SmithClient): CanvasFeed {
  const [model, setModel] = useState<CanvasModel>(EMPTY);
  const [status, setStatus] = useState<CanvasFeed['status']>('loading');
  const [error, setError] = useState<string | null>(null);

  // Two guards, for two different races. `alive` stops a slow tick writing
  // state into a component that is gone; `generation` stops an older tick
  // overwriting a newer one when the server answers unevenly — which it does
  // exactly when a write has just forced a refresh mid-poll.
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
      // One call per session. At the design's scale — §3 says 3–5 repos of 1–3
      // sessions — that is a handful of small requests, and it keeps the
      // adapter honest: no endpoint has to be invented to batch them.
      const timelines = new Map<string, readonly ApiTimelineEntry[]>();
      await Promise.all(
        overview.runningSessions.map(async (session) => {
          timelines.set(session.sessionId, await client.timeline(session.sessionId));
        }),
      );
      if (!alive.current || mine !== generation.current) {
        return;
      }
      setModel(toCanvasModel(overview, timelines));
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

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Calls the loader directly rather than nudging a counter in a deps array.
  // Same effect, minus a dependency that exists only to re-trigger — the kind
  // that reads as a mistake to everyone including the linter.
  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return { model, status, error, refresh };
}
