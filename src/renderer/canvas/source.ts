/**
 * Where this canvas's rows came from, and therefore what a write may do.
 *
 * The canvas is the same component either way — it reads `CanvasModel` and
 * cannot tell a fixture from a factory. What it must be able to tell apart is
 * whether pressing Enter reaches a real log, and that is what this type is for:
 * a demo source carries no client at all, so there is nothing for a write to
 * call even by mistake.
 */

import type { SmithClient } from '../adapter/client.js';
import type { SessionSource } from '../sources/port.js';

export type CanvasSource =
  | {
      readonly kind: 'demo';
      /** Shown when a write is attempted. Says why nothing happened. */
      readonly note: string;
    }
  | {
      readonly kind: 'live';
      readonly client: SmithClient;
      readonly status: 'loading' | 'live' | 'error';
      readonly error: string | null;
      /** Called after a successful write so the next poll is not waited for. */
      readonly onWrote: () => void;
    }
  | {
      readonly kind: 'session';
      /** The assembled port source — capabilities and, when present, `write`. */
      readonly source: SessionSource;
      /**
       * What the last read of this source failed with, or `null`/absent while
       * it is answering. The canvas draws the source cell from it: a cell that
       * shows a green dot and a name while every poll is failing says the one
       * thing a dashboard must never say, and the failure badge beside it was
       * left contradicting itself.
       */
      readonly error?: string | null;
      /** Called after a successful write so the next load is not waited for. */
      readonly onWrote: () => void;
    }
  | {
      /**
       * No source yet, and not a claim that there will not be one.
       *
       * The shell assembles its source over IPC and then reads it, which is a
       * visible window (`claude agents --json --all` is 0.20-0.41 s before
       * transcripts). With no state for it, that window rendered as
       * `READ_ONLY_SOURCE` — an amber "no write route — this canvas is
       * read-only" beside an empty sidebar, both false about a source that had
       * not answered yet. Writes are refused here exactly as they are for a
       * demo: there is nothing to write through.
       */
      readonly kind: 'connecting';
      /**
       * Why there is still no source, when that is already known — assembling
       * one can fail outright, and then `connecting` never ends. Without this
       * the cell would sit at "connecting…" underneath a banner saying it had
       * failed: two surfaces, two different claims, which is the same defect
       * one state along.
       */
      readonly error?: string | null;
    };

/**
 * What a canvas with no source given is: a fixture nobody can write through.
 *
 * The default is the SAFE one on purpose. A component rendered without being
 * told where its data came from must not be the one that can write, or the day
 * someone forgets the prop is the day a test writes to a real log.
 */
export const READ_ONLY_SOURCE: CanvasSource = {
  kind: 'demo',
  note: 'no write route — this canvas is read-only',
};
