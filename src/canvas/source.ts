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
