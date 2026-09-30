/**
 * WHICH VAM THIS IS, WHETHER IT CHECKS BY ITSELF, AND A WAY TO ASK NOW.
 *
 * The card in the corner (`../update/UpdateNotice.tsx`) is for an update that
 * has been found. This section is the room the operator walks into on purpose,
 * so it says every answer, not only `available`: the version, an "automatically
 * check for updates" switch (the stored preference lives in main, read and
 * written over `getAutoCheck` / `setAutoCheck`), a "check now" button, and one
 * status line that follows main's pushes.
 *
 * ── THE PANEL HOLDS NO STATE OF ITS OWN ABOUT AN UPDATE ───────────────────
 * The status is main's: read once on mount (`getStatus`), then followed
 * (`onStatus`). `check()` answers the status it reached, which is shown at
 * once, but the push is what keeps the line honest during a download.
 *
 * ── THE RENDERER NAMES NO DESTINATION ─────────────────────────────────────
 * Release notes open in the operating system's own browser via
 * `shell.openExternal` in main; `openNotes()` takes no argument.
 *
 * ── THE PHONE AND THE BROWSER HAVE NO BRIDGE ──────────────────────────────
 * `api` is undefined there: the version stays (it needs nothing), the controls
 * are absent rather than dimmed, and a sentence says why.
 */

import { useEffect, useState } from 'react';
import type { UpdateApi } from '../../preload/api.js';
import type { UpdateStatus } from '../../shared/update.js';
import { VERSION } from '../../shared/update.js';
import { t } from '../i18n/strings.js';
import { errorSentence } from '../update/sentences.js';
import { SettingsRow } from './primitives.js';
import { Switch } from './Switch.js';

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

const BUTTON = `vam-tap flex h-[28px] w-fit cursor-pointer items-center rounded border border-line px-3 text-control text-ink-dim capitalize hover:border-line-strong hover:text-ink disabled:cursor-default disabled:opacity-60 ${FOCUS_RING}`;

/** The bridge, where there is one. A browser tab and the paired phone have no
 *  preload, which is what decides whether the controls are drawn at all. */
export function desktopUpdateApi(): UpdateApi | undefined {
  return (globalThis.window as { api?: { update?: UpdateApi } } | undefined)?.api?.update;
}

/**
 * One sentence per status, and the whole point of the line. NEVER A CODE.
 * `checking` only reaches here from a push; the local `asking` flag covers the
 * gap before main's own push arrives.
 */
function sentenceFor(status: UpdateStatus): string {
  switch (status.kind) {
    case 'idle':
      return t('settings.update.idle');
    case 'checking':
      return t('settings.update.checking');
    case 'available':
      return t('settings.update.available', { version: status.version });
    case 'not-available':
      switch (status.reason) {
        case 'none':
          return t('settings.update.none');
        case 'incomplete':
          return t('settings.update.incomplete');
        default:
          return t('settings.update.current');
      }
    case 'downloading':
      return t('settings.update.downloading', {
        version: status.version,
        percent: String(Math.max(0, Math.min(100, Math.round(status.percent)))),
      });
    case 'installing':
      return t('settings.update.installing');
    case 'error':
      return errorSentence(status.code);
  }
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

/** How long ago the last check was, in the coarsest unit that is not zero.
 *  Under a minute is "just now" rather than a count of seconds that would
 *  have to tick. */
function lastCheckSentence(at: number | null, now: number): string {
  if (at === null) return t('settings.update.lastCheck.never');
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  let when: string;
  if (minutes < 1) when = t('settings.update.lastCheck.now');
  else if (minutes < 60) when = RELATIVE.format(-minutes, 'minute');
  else if (minutes < 60 * 24) when = RELATIVE.format(-Math.floor(minutes / 60), 'hour');
  else when = RELATIVE.format(-Math.floor(minutes / (60 * 24)), 'day');
  return t('settings.update.lastCheck', { when });
}

export type UpdatePanelProps = {
  /** Absent in the browser build, which has no preload and no bridge. */
  readonly api: UpdateApi | undefined;
};

export function UpdatePanel({ api }: UpdatePanelProps) {
  const [status, setStatus] = useState<UpdateStatus>({ kind: 'idle' });
  const [autoCheck, setAutoCheck] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);
  // Epoch ms of main's last check, `undefined` until the first read answers.
  const [lastCheck, setLastCheck] = useState<number | null | undefined>(undefined);
  // Only there so the relative wording moves on while the panel is open.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (api === undefined) return;
    let cancelled = false;
    api
      .getStatus()
      .then((answer) => {
        if (!cancelled) setStatus(answer);
      })
      .catch(() => {});
    api
      .getAutoCheck()
      .then((answer) => {
        if (!cancelled) setAutoCheck(answer);
      })
      .catch(() => {});
    const readLastCheck = (): void => {
      api
        .getLastCheck()
        .then((answer) => {
          if (!cancelled) setLastCheck(answer);
        })
        .catch(() => {});
    };
    readLastCheck();
    const off = api.onStatus((answer) => {
      setStatus(answer);
      if (answer.kind !== 'checking') readLastCheck();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [api]);

  async function ask(): Promise<void> {
    if (api === undefined || asking) return;
    setAsking(true);
    try {
      const answer = await api.check();
      setStatus(answer);
      // Main stamps the time when a check goes out, so it is asked again
      // whenever one has finished (here, and in `onStatus` above): an answer
      // whose kind is not `checking`.
      if (answer.kind !== 'checking') {
        api
          .getLastCheck()
          .then(setLastCheck)
          .catch(() => {});
      }
    } catch {
      // A bridge that rejects is a channel that is not there. It is still an
      // answer the operator asked for, so it gets the same sentence a failed
      // request gets rather than a stuck button.
      setStatus({ kind: 'error', code: 'network', message: 'network' });
    } finally {
      setAsking(false);
    }
  }

  const working =
    asking ||
    status.kind === 'checking' ||
    status.kind === 'downloading' ||
    status.kind === 'installing';

  return (
    <div className="flex flex-col gap-3">
      {/* THE VERSION IS UNCONDITIONAL. It needs no bridge, no network and no
          permission, and it is the one fact an operator filing a bug reads off
          the screen. Monospace, because it is an identifier.
          `data-verbatim`: the panel's structural rule capitalises the first
          letter of every paragraph, and the product is called `vam` in lower
          case everywhere it appears -- see `styles.css`. */}
      <p data-update-version data-verbatim className="m-0 font-mono text-body text-ink">
        vam {VERSION}
      </p>

      {api === undefined ? (
        // NO BRIDGE, NO CONTROLS -- absent rather than dimmed, this surface's
        // own rule. The sentence is there because a missing control with no
        // explanation reads as a broken screen, and this is the phone.
        <p data-update-outcome data-verbatim className="m-0 max-w-[52ch] text-control text-ink-dim">
          {t('settings.update.browser')}
        </p>
      ) : (
        <>
          {/* A ROW LIKE EVERY OTHER SWITCH IN SETTINGS: the switch's own
              `label` is only its accessible name, so without the row's
              heading a sighted operator sees "on" and nothing saying what
              is on. */}
          {autoCheck !== null && (
            <SettingsRow
              label={t('settings.update.auto.label')}
              hint={t('settings.update.auto.hint')}
            >
              <Switch
                name="auto-update"
                label={t('settings.update.auto.label')}
                checked={autoCheck}
                on={t('settings.update.auto.on')}
                off={t('settings.update.auto.off')}
                onChange={(next) => {
                  setAutoCheck(next);
                  api
                    .setAutoCheck(next)
                    // Main answers what it stored, which is what is shown.
                    .then(setAutoCheck)
                    .catch(() => setAutoCheck(!next));
                }}
              />
            </SettingsRow>
          )}
          {lastCheck !== undefined && (
            <p
              data-update-last-check
              title={lastCheck === null ? undefined : new Date(lastCheck).toLocaleString()}
              className="m-0 text-control text-ink-dim"
            >
              {lastCheckSentence(lastCheck, now)}
            </p>
          )}
          <button
            type="button"
            data-update-check
            disabled={working}
            aria-busy={working}
            onClick={() => {
              void ask();
            }}
            className={BUTTON}
          >
            {asking || status.kind === 'checking'
              ? t('settings.update.checking')
              : t('settings.update.check')}
          </button>
          <p data-update-outcome className="m-0 max-w-[52ch] text-control text-ink-dim">
            {asking ? t('settings.update.checking') : sentenceFor(status)}
          </p>
          {status.kind === 'available' && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-update-install
                onClick={() => {
                  api
                    .download()
                    .then(setStatus)
                    .catch(() => {});
                }}
                className={BUTTON}
              >
                {t('settings.update.install')}
              </button>
              <button
                type="button"
                data-update-open
                onClick={() => {
                  void api.openNotes();
                }}
                className={BUTTON}
              >
                {t('settings.update.notes')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
