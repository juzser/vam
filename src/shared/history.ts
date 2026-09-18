/**
 * One backward page of a session's turns, and the three answers it must keep
 * apart.
 *
 * In `src/shared/` for the reason `terminal.ts` and `usage.ts` are here: main
 * produces this, the preload and the remote server forward it, and the renderer
 * draws it, so it cannot live in any one of the three.
 *
 * THE SPLIT IS THE POINT, and it is this repo's oldest lesson said again
 * (`sources/claude-code/pull-requests.ts`: "'No PRs' and 'vam could not ask'
 * must never look the same"). A scroll-back has three outcomes and a renderer
 * has to be able to tell them apart, because they are three different things to
 * draw:
 *
 *  1. `page` with turns -- here is more of the session.
 *  2. `page` with no turns and `reachedStart: true` -- this IS the beginning.
 *     It is a POSITIVE fact, read off the window having begun at byte 0, and it
 *     is never inferred from an empty list: a window can legitimately contain
 *     no complete turn (measured, one tool-result line can exceed 128 KiB on
 *     its own), and reporting that as the beginning would have vam claim the
 *     session started where it merely stopped reading.
 *  3. `page` with no turns and a `cursor` -- vam read a window, found no whole
 *     turn in it, and there IS more: ask again with that cursor.
 *  4. `unavailable` -- vam could not read at all. A different sentence from
 *     any of the above, carrying the source's own words for why.
 */

import type { Decision } from '../renderer/domain/model.js';
import type { SourceError } from '../renderer/sources/port.js';

/**
 * Where a backward read starts, exclusive: nothing at or after it is returned.
 *
 * OPAQUE TO EVERY CALLER. Two shapes are accepted and only one module knows
 * that: the id of a turn already on screen (page the transcript before it), and
 * a cursor a previous page handed back. `sources/claude-code/transcript.ts`'s
 * `turnStartOf` is the one reader of both, and it lives beside the function
 * that mints them so the two cannot drift.
 */
export type HistoryCursor = string;

export type TranscriptPage =
  | {
      readonly kind: 'page';
      /** NEWEST FIRST, the same order as `Session.decisions`. */
      readonly turns: readonly Decision[];
      /**
       * Where the next step back begins, or `null` when there is nothing older
       * to ask for. Null exactly when `reachedStart` is true -- both are
       * carried because a consumer must never have to derive one of them from
       * an empty `turns` list.
       */
      readonly cursor: HistoryCursor | null;
      /** True only when the window vam read actually began at byte 0. */
      readonly reachedStart: boolean;
    }
  | { readonly kind: 'unavailable'; readonly error: SourceError };
