/**
 * THE TEST NOTIFICATION BUTTON, and the sentence beside it.
 *
 * Operator: "add a setting for notifications in the desktop app. Include a
 * test-notification button too."
 *
 * ── WHY THE ANSWER IS INLINE ─────────────────────────────────────────────
 * A real banner's fate goes to the error log (`src/main/notify/notify.ts`):
 * the operator did not ask for that banner, and a modal about a banner that
 * did not appear would be worse than the banner. A button is the opposite
 * case. Somebody just pressed it in order to find out what happens, and "open
 * the error log" is not an answer to that -- the answer goes where the finger
 * is. The log still gets its line as well; this is in addition, not instead.
 *
 * ── THE SAME PATH ────────────────────────────────────────────────────────
 * `api.test()` reaches `Notifier.test()`, which is the notifier's one `raise`
 * with a report attached. Same `create`, same `failed` and `unconfirmed`
 * accounting, same 10 s verdict timer. A button that took a shorter path
 * would be testing the shorter path, and the operator would read "sent" on a
 * machine where the real banner never arrives.
 *
 * ── THREE VERDICTS, ONE SENTENCE EACH ────────────────────────────────────
 * `sent` says the OS confirmed `show` -- and that if nothing appeared anyway,
 * the place to look is System Settings, because a confirmed banner the OS
 * then hid (Focus, a per-app switch) is not something vam can see. `failed`
 * is the OS's text VERBATIM after a colon; it is the diagnosis. `unconfirmed`
 * says what it is: neither answer came, vam cannot tell.
 *
 * Modelled on `UpdatePanel.tsx`: same button rank, same outcome paragraph,
 * same "no bridge, no button" rule for the browser build.
 */

import { useState } from 'react';
import type { NotifyApi } from '../../preload/api.js';
import type { NotifyVerdict } from '../../shared/notify.js';
import { t } from '../i18n/strings.js';

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

const BUTTON = `vam-tap flex h-[28px] w-fit cursor-pointer items-center rounded border border-line px-3 text-control text-ink-dim capitalize hover:border-line-strong hover:text-ink disabled:cursor-default disabled:opacity-60 ${FOCUS_RING}`;

/** The bridge, where there is one. A browser tab has no preload, which is
 *  what decides whether the button is drawn at all. */
export function desktopNotifyApi(): NotifyApi | undefined {
  return (globalThis.window as { api?: { notify?: NotifyApi } } | undefined)?.api?.notify;
}

function sentenceFor(verdict: NotifyVerdict): string {
  switch (verdict.kind) {
    case 'sent':
      return t('settings.notifications.test.sent');
    case 'failed':
      return t('settings.notifications.test.failed', { reason: verdict.reason });
    default:
      return t('settings.notifications.test.unconfirmed');
  }
}

export type NotifyTestProps = {
  /** Absent in the browser build, which has no preload and no bridge. */
  readonly api: NotifyApi | undefined;
};

export function NotifyTest({ api }: NotifyTestProps) {
  const [verdict, setVerdict] = useState<NotifyVerdict | null>(null);
  const [asking, setAsking] = useState(false);

  async function ask(): Promise<void> {
    if (api === undefined || asking) return;
    setAsking(true);
    setVerdict(null);
    try {
      setVerdict(await api.test());
    } catch {
      // A bridge that rejects is a channel that is not there. Nothing was
      // observed either way, which is exactly what `unconfirmed` says.
      setVerdict({ kind: 'unconfirmed' });
    } finally {
      setAsking(false);
    }
  }

  if (api === undefined) {
    // NO BRIDGE, NO BUTTON -- absent rather than dimmed, this surface's own
    // rule. The sentence is there because a missing control with no
    // explanation reads as a broken screen.
    return (
      <p data-notify-test-outcome className="m-0 max-w-[52ch] text-control text-ink-dim">
        {t('settings.notifications.test.browser')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        data-notify-test
        disabled={asking}
        aria-busy={asking}
        onClick={() => {
          void ask();
        }}
        className={BUTTON}
      >
        {t('settings.notifications.test.button')}
      </button>
      {/* `aria-live`: the operator's focus is on the button, and the sentence
          arrives up to 10 s later. Polite, because it is one line and never
          urgent. */}
      {(asking || verdict !== null) && (
        <p
          data-notify-test-outcome
          aria-live="polite"
          className="m-0 max-w-[52ch] text-control text-ink-dim"
        >
          {asking
            ? t('settings.notifications.test.pending')
            : sentenceFor(verdict as NotifyVerdict)}
        </p>
      )}
    </div>
  );
}
