/**
 * WHICH VAM THIS IS, AND WHETHER IT IS THE NEWEST ONE.
 *
 * Operator: "add an update section in settings, show the version and a check
 * for updates button."
 *
 * ── WHAT THIS ADDS TO A CHECK THAT ALREADY EXISTED ────────────────────────
 * vam has checked for updates since before this: one unauthenticated GET at
 * launch (`src/main/update/check.ts`), and `UpdateNotice` -- a popover that
 * draws for exactly one outcome, `available`. Everything else is silence, and
 * that silence is right for a notice nobody asked for: a banner about a failed
 * update check would be a daily error message about a question nobody put.
 *
 * It is wrong for a room the operator walks into on purpose. Silence there
 * covers four different answers -- you are current, the repository has
 * published nothing, GitHub is rate-limiting this address, the check never got
 * out -- and the operator who opened this section is owed the distinction.
 *
 * ── THE RENDERER NAMES NO DESTINATION ─────────────────────────────────────
 * The release page opens in the operating system's own browser, via
 * `shell.openExternal` in main, and `CHANNELS.updateOpen` takes no argument:
 * main opens the URL its own check found. (Task 7 redesigns this panel around
 * the download-and-install flow; this is the minimal form that compiles
 * against the new bridge.)
 *
 * ── AND IT REALLY ASKS ────────────────────────────────────────────────────
 * `api.check()` is a MANUAL check: it always goes out, unlike the scheduler's
 * automatic ones, so the button never reports a cached reply.
 */

import { useState } from 'react';
import type { UpdateApi } from '../../preload/api.js';
import type { UpdateStatus } from '../../shared/update.js';
import { VERSION } from '../../shared/update.js';
import { t } from '../i18n/strings.js';

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

const BUTTON = `vam-tap flex h-[28px] w-fit cursor-pointer items-center rounded border border-line px-3 text-control text-ink-dim capitalize hover:border-line-strong hover:text-ink disabled:cursor-default disabled:opacity-60 ${FOCUS_RING}`;

/** The bridge, where there is one. A browser tab and the paired phone have no
 *  preload, which is what decides whether the button is drawn at all. */
export function desktopUpdateApi(): UpdateApi | undefined {
  return (globalThis.window as { api?: { update?: UpdateApi } } | undefined)?.api?.update;
}

/**
 * One sentence per outcome, and the whole point of the section.
 *
 * NEVER A CODE. `rate-limited` is a developer's word for a state an operator
 * acts on by waiting, and `malformed` for one they act on by doing nothing at
 * all. Each says what happened and, where there is one, what to do.
 */
function sentenceFor(status: UpdateStatus): string {
  switch (status.kind) {
    case 'available':
      return t('settings.update.available', { version: status.version });
    case 'not-available':
      return status.reason === 'none' ? t('settings.update.none') : t('settings.update.current');
    case 'error':
      switch (status.code) {
        case 'rate-limited':
          return t('settings.update.limited');
        case 'malformed':
          return t('settings.update.malformed');
        default:
          return t('settings.update.offline');
      }
    default:
      // idle, checking, downloading, installing: the button is what asked, and
      // the answer to it is one of the three kinds above.
      return t('settings.update.current');
  }
}

export type UpdatePanelProps = {
  /** Absent in the browser build, which has no preload and no bridge. */
  readonly api: UpdateApi | undefined;
};

export function UpdatePanel({ api }: UpdatePanelProps) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [asking, setAsking] = useState(false);

  async function ask(): Promise<void> {
    if (api === undefined || asking) return;
    setAsking(true);
    try {
      setStatus(await api.check());
    } catch {
      // A bridge that rejects is a channel that is not there. It is still an
      // answer the operator asked for, so it gets the same sentence a failed
      // request gets rather than a stuck button.
      setStatus({ kind: 'error', code: 'network', message: 'network' });
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* THE VERSION IS UNCONDITIONAL. It needs no bridge, no network and no
          permission, and it is the one fact an operator filing a bug reads off
          the screen. Monospace, because it is an identifier. */}
      {/* `data-verbatim`: the panel's structural rule capitalises the first
          letter of every paragraph, and the product is called `vam` in lower
          case everywhere it appears. This is the first copy on this surface to
          begin with the name, and without the opt-out it paints `Vam 0.1.0`
          -- see `styles.css`. */}
      <p data-update-version data-verbatim className="m-0 font-mono text-body text-ink">
        vam {VERSION}
      </p>

      {api === undefined ? (
        // NO BRIDGE, NO BUTTON -- absent rather than dimmed, this surface's
        // own rule. The sentence is there because a missing control with no
        // explanation reads as a broken screen, and this is the phone.
        <p data-update-outcome data-verbatim className="m-0 max-w-[52ch] text-control text-ink-dim">
          {t('settings.update.browser')}
        </p>
      ) : (
        <>
          <button
            type="button"
            data-update-check
            disabled={asking}
            aria-busy={asking}
            onClick={() => {
              void ask();
            }}
            className={BUTTON}
          >
            {asking ? t('settings.update.checking') : t('settings.update.check')}
          </button>
          {status !== null && (
            <p data-update-outcome className="m-0 max-w-[52ch] text-control text-ink-dim">
              {sentenceFor(status)}
            </p>
          )}
          {/* THE ONLY OUTCOME WITH SOMETHING TO PRESS. vam opens the release
              page in the operator's own browser and downloads nothing; the
              renderer names no URL, main opens the one its own check found. */}
          {status?.kind === 'available' && (
            <button
              type="button"
              data-update-open
              onClick={() => {
                void api.openNotes();
              }}
              className={BUTTON}
            >
              {t('settings.update.open')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
