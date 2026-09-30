/**
 * The update card in the top-right corner: one state per updater status.
 *
 * It reads the status main already holds (`getStatus`) and follows the pushes
 * (`onStatus`); checking is main's scheduler's job, not this card's. The flow
 * is prompt-then-download: `available` asks, and only the operator's press on
 * Update starts a download (`update.download()`), after which main verifies,
 * quits and installs.
 *
 *   available      "vam vX.Y.Z available"  Update / Later / Release notes
 *   downloading    progress bar and percent
 *   installing     "Restarting to update…"
 *   error          the sentence for its code, and Retry where retrying can work
 *   not-available  only after a MANUAL check: "vam is up to date", then it
 *                  hides itself
 *   idle/checking  nothing; an automatic check that finds nothing is silence
 *
 * The renderer names no URL and fetches nothing: the release notes open in the
 * operating system's browser via `shell.openExternal` in main.
 *
 * Top-right was free: the overlays are centred at `z-50`, `SessionList`'s menus
 * are `z-20` inside the projects panel, and the canvas' own control sits
 * bottom-right. `z-40` keeps this under any overlay rather than over a dialog.
 */

import { useEffect, useState } from 'react';
import type { UpdateApi } from '../../preload/api.js';
import type { UpdateStatus } from '../../shared/update.js';
import { t } from '../i18n/strings.js';
import { errorSentence, retryFor } from './sentences.js';

/** How long "vam is up to date" stays before hiding itself. */
export const UP_TO_DATE_VISIBLE_MS = 4000;

export type UpdateNoticeProps = {
  /** Absent in the browser build, where there is no bridge and no check. */
  readonly update?: UpdateApi;
};

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';
const BUTTON = `vam-tap flex h-[28px] cursor-pointer items-center rounded border border-line px-3 text-control text-ink-dim capitalize hover:border-line-strong hover:text-ink ${FOCUS_RING}`;
const PRIMARY = `vam-tap flex h-[28px] cursor-pointer items-center rounded border border-ink-faint bg-ink-faint px-3 text-control text-ground capitalize ${FOCUS_RING}`;

const stripV = (version: string) => version.replace(/^v/, '');

function clampPercent(percent: number): number {
  return Math.max(0, Math.min(100, Math.round(percent)));
}

/** Whether the card has anything to say for this status. */
function visible(status: UpdateStatus | null): status is UpdateStatus {
  if (status === null) return false;
  switch (status.kind) {
    case 'available':
    case 'downloading':
    case 'installing':
    case 'error':
      return true;
    case 'not-available':
      return status.manual;
    default:
      return false;
  }
}

function headline(status: UpdateStatus): string {
  switch (status.kind) {
    case 'available':
      return t('update.card.available', { version: stripV(status.version) });
    case 'downloading':
      return t('update.card.downloading', { version: stripV(status.version) });
    case 'installing':
      return t('update.card.installing');
    case 'error':
      return errorSentence(status.code);
    default:
      return t('update.card.upToDate');
  }
}

export function UpdateNotice({ update }: UpdateNoticeProps) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [openFailed, setOpenFailed] = useState(false);

  useEffect(() => {
    if (update === undefined) return;
    let cancelled = false;
    update
      .getStatus()
      .then((answer) => {
        if (!cancelled) setStatus(answer);
      })
      // A bridge that rejects leaves the card unmounted. Nothing about an
      // update check is worth an error on screen.
      .catch(() => {});
    const off = update.onStatus((answer) => setStatus(answer));
    return () => {
      cancelled = true;
      off();
    };
  }, [update]);

  const upToDate = status?.kind === 'not-available' && status.manual;
  // "Up to date" is an answer, not a task: it goes by itself.
  useEffect(() => {
    if (!upToDate || update === undefined) return;
    const timer = setTimeout(() => {
      void update
        .dismiss()
        .then(setStatus)
        .catch(() => setStatus({ kind: 'idle' }));
    }, UP_TO_DATE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [upToDate, update]);

  if (update === undefined || !visible(status)) return null;

  /** Runs a bridge call and shows whatever status it reached. */
  const run = (call: () => Promise<UpdateStatus>) => {
    void call()
      .then(setStatus)
      .catch(() => {});
  };
  const close = () => run(() => update.dismiss());
  const retry = status.kind === 'error' ? retryFor(status.code) : null;

  return (
    <div
      data-testid="update-notice"
      role="status"
      aria-label={t('update.card.label')}
      className="fixed top-3 right-3 z-40 flex w-[300px] flex-col gap-2 rounded-[9px] border border-line-strong bg-panel p-3 shadow-lg"
    >
      <div className="flex items-baseline gap-2">
        <span className="font-semibold text-ink text-body">{headline(status)}</span>
        {(status.kind === 'error' || status.kind === 'not-available') && (
          <button
            type="button"
            aria-label={t('update.card.dismiss')}
            onClick={close}
            className={`ml-auto cursor-pointer rounded px-1 text-ink-faint text-control ${FOCUS_RING}`}
          >
            ×
          </button>
        )}
      </div>

      {status.kind === 'available' && (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => run(() => update.download())} className={PRIMARY}>
              {t('update.card.update')}
            </button>
            <button type="button" onClick={close} className={BUTTON}>
              {t('update.card.later')}
            </button>
            <button
              type="button"
              onClick={() => {
                void update
                  .openNotes()
                  .then((opened) => setOpenFailed(!opened))
                  .catch(() => setOpenFailed(true));
              }}
              className={BUTTON}
            >
              {t('update.card.notes')}
            </button>
          </div>
          {openFailed && (
            <p
              data-testid="update-open-failed"
              className="m-0 select-text break-all text-control text-ink-faint"
            >
              {status.notesUrl}
            </p>
          )}
        </>
      )}

      {status.kind === 'downloading' && (
        <div className="flex items-center gap-2">
          <div
            role="progressbar"
            aria-label={t('update.card.downloading', { version: stripV(status.version) })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={clampPercent(status.percent)}
            className="h-[6px] flex-1 overflow-hidden rounded-full bg-sunken"
          >
            <div
              data-testid="update-progress-fill"
              className="h-full bg-ink-faint transition-[width]"
              style={{ width: `${clampPercent(status.percent)}%` }}
            />
          </div>
          <span data-testid="update-percent" className="text-control text-ink-dim tabular-nums">
            {clampPercent(status.percent)}%
          </span>
        </div>
      )}

      {retry !== null && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => run(() => (retry === 'download' ? update.download() : update.check()))}
            className={BUTTON}
          >
            {t('update.card.retry')}
          </button>
        </div>
      )}
    </div>
  );
}
