/**
 * The desktop's model, kept current.
 *
 * `DesktopCanvas` used to call `load()` once on mount and again only after a
 * write. Nothing polled, and the Claude Code source declares
 * `liveUpdates: false`, so the session list froze at launch: a session going
 * busy -> idle went on reading as running, a new session never appeared, a
 * failing one never showed as failed, and every `age` stopped moving. For an
 * app whose stated purpose is making the `waiting` state impossible to miss,
 * a frozen list loses the purpose.
 *
 * This is the same shape as the usage cell's poll, and it repeats none of the
 * mistakes that one was fixed for: only the most recently ISSUED load may
 * write, a load in flight is never joined by a second one, a failure keeps
 * the last good model rather than blanking a list somebody is reading, and
 * nothing sets state after unmount.
 *
 * It is a hook in its own module rather than an effect inside `App.tsx`
 * because `DesktopCanvas` is not exported and none of the above is testable
 * through it -- the same reason `csp.ts` and `origin.ts` are their own files.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasModel } from '../domain/model.js';
import type { SessionSource } from './port.js';

/**
 * How often to re-read the source.
 *
 * Measured on this machine: `claude agents --json --all` returns in
 * 0.20-0.41 s, and a transcript is read as a 128 KiB tail however large the
 * file is (the largest here is 157 MB), so a whole `load()` is well under half
 * a second for a single-digit session count. Ten seconds is roughly a 4 % duty
 * cycle -- close enough that a session finishing its turn surfaces while the
 * operator is still looking at the screen, and far enough apart that vam is
 * not spawning a subprocess every tick.
 *
 * The window-focus reload is what covers the gap this interval leaves: coming
 * back to vam is both when its numbers matter most and when they are stalest.
 */
export const SOURCE_POLL_INTERVAL_MS = 10_000;

/** A `SourceError` reads as `code: message`; anything else falls back to its text. */
function describeFailure(reason: unknown): string {
  if (typeof reason === 'object' && reason !== null && 'code' in reason && 'message' in reason) {
    return `${String(reason.code)}: ${String(reason.message)}`;
  }
  return reason instanceof Error ? reason.message : String(reason);
}

const EMPTY: CanvasModel = { projects: [] };

export function useSourceModel(source: SessionSource | null): {
  readonly model: CanvasModel;
  readonly error: string | null;
  readonly reload: () => void;
} {
  const [model, setModel] = useState<CanvasModel>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  // Refs, not state: these coordinate loads and must never cause a render.
  const cancelled = useRef(false);
  const inFlight = useRef(false);
  const issued = useRef(0);

  const load = useCallback(() => {
    if (source === null || inFlight.current) {
      return;
    }
    inFlight.current = true;
    issued.current += 1;
    const seq = issued.current;
    // Only the newest ISSUED load may write. Without this a slow load
    // answering after a newer one would put an older list back on screen.
    const mine = () => !cancelled.current && seq === issued.current;
    source
      .load()
      .then((projects) => {
        if (mine()) {
          setModel({ projects });
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        // The model is deliberately left alone: a transient CLI failure must
        // not blank a list the operator is in the middle of reading. The
        // error says what happened beside it.
        if (mine()) {
          setError(describeFailure(reason));
        }
      })
      .finally(() => {
        if (seq === issued.current) {
          inFlight.current = false;
        }
      });
  }, [source]);

  useEffect(() => {
    if (source === null) {
      return;
    }
    cancelled.current = false;
    inFlight.current = false;
    load();
    const id = window.setInterval(load, SOURCE_POLL_INTERVAL_MS);
    window.addEventListener('focus', load);
    return () => {
      cancelled.current = true;
      window.clearInterval(id);
      window.removeEventListener('focus', load);
    };
  }, [source, load]);

  return { model, error, reload: load };
}
