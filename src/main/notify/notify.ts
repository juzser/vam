/**
 * THE OS NOTIFICATION, AND THE INSTRUMENT WRAPPED AROUND IT.
 *
 * ── WHY MAIN, AND ONLY THE CALL ───────────────────────────────────────────
 * The renderer decides WHEN (`src/renderer/notify/waiting.ts` -- it is the
 * only process that holds a previous model, because main never polls). Main
 * decides nothing: it is handed a title and a body, makes the one call the
 * renderer cannot (the renderer's `Notification` is behind the permission
 * policy `src/main/index.ts` denies, and `test/main/permission-census.test.ts`
 * scans for it), and reports what happened. Same split as the clipboard.
 *
 * ── `isSupported()` IS NOT A GATE, AND THIS FILE DOES NOT CALL IT ─────────
 * Measured, not recalled (the research brief this shipped from): on a bundle
 * whose code signature says `Identifier=Electron`, `isSupported()` answers
 * `true`, `show()` returns, and the only thing that ever says otherwise is a
 * `failed` event carrying `UNErrorDomain error 1` -- or, once the bundle is
 * re-signed with its own identifier, `"Notifications are not allowed for this
 * application"`. A feature gated on `isSupported()` would be a feature that
 * silently does nothing on every machine where it does not work.
 *
 * ── SO: SILENCE IS THE ONE OUTCOME THIS MODULE FORBIDS ────────────────────
 * Every notification ends in exactly one of three records, and two of them
 * are written to `recordMainFailure` -- main's own failure buffer, which the
 * renderer already pulls into the log the `E` key opens
 * (`src/main/errors/log.ts` -> `src/renderer/errors/main-errors-bridge.ts`):
 *
 *  1. `show` (or `click`) arrived: delivered. Nothing is written; the operator
 *     saw the banner, and a log line saying so would be noise.
 *  2. `failed` arrived: written, with the OS's text VERBATIM under
 *     `notification-failed`. Not paraphrased, not softened, not turned into a
 *     modal -- the text is the diagnosis, and the operator reads it in the
 *     error log next to everything else that went wrong.
 *  3. NEITHER arrived within `NOTIFY_VERDICT_TIMEOUT_MS`: written under
 *     `notification-unconfirmed`, worded as what it is -- vam could not tell
 *     -- rather than as a failure it did not observe. Electron promises
 *     `failed` for an unsigned app; nothing promises it for every other way a
 *     banner can vanish, and a promise this module has not seen kept is not
 *     one it relies on.
 *
 * The result is that the operator can launch the packaged app, put a session
 * into `waiting`, and either see a banner or open the error log and read
 * exactly why not. Whether macOS delivers to THIS bundle on THEIR machine
 * becomes a measurement they can take, instead of a guess anybody has to
 * make for them.
 *
 * A `failed` for the same reason on every crossing is not a flood in the
 * log: `recordFailure`'s consecutive-duplicate rule on the renderer side
 * collapses identical repeats (`src/renderer/errors/log.ts`).
 *
 * ── ONE BANNER PER SESSION ────────────────────────────────────────────────
 * Held per `(sourceId, sessionId)` so the renderer can ask for it to be
 * closed when the session leaves `waiting`, and so a second `show` for the
 * same session replaces the first rather than stacking.
 */

import { recordMainFailure } from '../errors/log.js';
import { truncateBody } from './body.js';

/** The slice of Electron's `Notification` this module needs, so it is testable without one. */
export type NotificationLike = {
  on(event: 'show', listener: (event: unknown) => void): unknown;
  on(event: 'click', listener: (event: unknown) => void): unknown;
  on(event: 'close', listener: (event: unknown) => void): unknown;
  /** Electron's signature: `(event, error: string)`. The string is the diagnosis. */
  on(event: 'failed', listener: (event: unknown, error: string) => void): unknown;
  show(): void;
  close(): void;
};

export type NotificationOptionsLike = {
  readonly title: string;
  readonly body: string;
};

export type NotifyTarget = {
  readonly sourceId: string;
  readonly sessionId: string;
};

export type NotifyRequest = NotifyTarget & NotificationOptionsLike;

export type NotifierDeps = {
  /** `(options) => new Notification(options)` in production. */
  readonly create: (options: NotificationOptionsLike) => NotificationLike;
  /** The banner was clicked: focus vam and go to that session. */
  readonly onActivate: (target: NotifyTarget) => void;
};

export type Notifier = {
  /** Hand a banner to the OS. `false` only when the constructor itself threw. */
  show(request: NotifyRequest): boolean;
  /** Take down the banner for that session, if one is held. */
  close(target: NotifyTarget): void;
};

/**
 * How long to wait for the OS to say `show` or `failed` before writing that it
 * said neither. Generous: a notification centre under load answers in
 * milliseconds, and the cost of a late false "unconfirmed" line is a wrong
 * sentence in a diagnostic log, which is exactly the thing the sentence is
 * worded to survive ("vam could not tell").
 */
export const NOTIFY_VERDICT_TIMEOUT_MS = 10_000;

const ACTION = 'show a notification';

function keyOf(target: NotifyTarget): string {
  return `${target.sourceId} ${target.sessionId}`;
}

function textOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function createNotifier(deps: NotifierDeps): Notifier {
  const held = new Map<string, { notification: NotificationLike; verdict: NodeJS.Timeout }>();

  const forget = (key: string): void => {
    const entry = held.get(key);
    if (entry === undefined) return;
    clearTimeout(entry.verdict);
    held.delete(key);
  };

  return {
    show(request) {
      const key = keyOf(request);
      const target = { sourceId: request.sourceId, sessionId: request.sessionId };
      // Replace, never stack: the banner is ABOUT the session, and two banners
      // about one session say the same thing twice.
      const previous = held.get(key);
      if (previous !== undefined) {
        forget(key);
        previous.notification.close();
      }

      let notification: NotificationLike;
      try {
        notification = deps.create({ title: request.title, body: truncateBody(request.body) });
      } catch (reason: unknown) {
        recordMainFailure(ACTION, 'notification-failed', textOf(reason));
        return false;
      }

      // Records only. The handle stays held: a banner the OS never confirmed
      // may still be on screen, and the renderer's `close` must still reach it.
      const verdict = setTimeout(() => {
        recordMainFailure(
          ACTION,
          'notification-unconfirmed',
          `the OS answered neither \`show\` nor \`failed\` within ${NOTIFY_VERDICT_TIMEOUT_MS / 1000}s for "${request.title}" — vam cannot tell whether it was delivered`,
        );
      }, NOTIFY_VERDICT_TIMEOUT_MS);
      held.set(key, { notification, verdict });

      const delivered = (): void => {
        const entry = held.get(key);
        if (entry?.notification === notification) clearTimeout(entry.verdict);
      };
      notification.on('show', delivered);
      notification.on('click', () => {
        delivered();
        deps.onActivate(target);
      });
      notification.on('close', () => {
        // The OS or the operator dismissed it; the handle is dead. Only forget
        // it if it is still the one held -- a replacement may already be in.
        if (held.get(key)?.notification === notification) forget(key);
      });
      notification.on('failed', (_event: unknown, error: string) => {
        // The text is what matters and it is written VERBATIM. See the header.
        if (held.get(key)?.notification === notification) forget(key);
        recordMainFailure(ACTION, 'notification-failed', textOf(error));
      });

      try {
        notification.show();
      } catch (reason: unknown) {
        forget(key);
        recordMainFailure(ACTION, 'notification-failed', textOf(reason));
        return false;
      }
      return true;
    },

    close(target) {
      const key = keyOf(target);
      const entry = held.get(key);
      if (entry === undefined) return;
      forget(key);
      entry.notification.close();
    },
  };
}
