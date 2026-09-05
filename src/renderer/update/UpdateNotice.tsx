/**
 * The popover in the top-right corner that says a newer vam exists.
 *
 * It draws for exactly one outcome. `available` is the only status an
 * operator can do anything about; `none` -- which is what `juzser/vam`
 * answers today, having published no release -- draws nothing, and neither
 * does `up-to-date`. `unknown` draws nothing either: a failed update check is
 * not the operator's problem to act on, and a banner about it would be a
 * daily error message about a question nobody asked.
 *
 * THE CLICK LEAVES VAM. `update.open()` reaches `shell.openExternal` in main,
 * which is the operating system's browser; this component fetches no bytes,
 * writes no file and navigates this window nowhere -- the window would refuse
 * anyway, every off-origin navigation being denied in `src/main/index.ts`.
 * That is the same bargain `../errors/report.ts` makes with its prefilled
 * issue URL: vam prepares the destination, the operator decides to go. The
 * text says so before the button does, because a popover reading only
 * "Update available" over a button is one that gets clicked unread.
 *
 * Top-right was free: the overlays (settings, error log, key sheet, command
 * palette) are centred at `z-50`, `SessionList`'s menus are `z-20` inside the
 * projects panel, and the canvas' own control sits bottom-right. `z-40` keeps
 * this under any of those overlays rather than floating on top of a dialog.
 */

import { useEffect, useState } from 'react';
import type { UpdateApi } from '../../preload/api.js';
import type { UpdateStatus } from '../../shared/update.js';

export type UpdateNoticeProps = {
  /** Absent in the browser build, where there is no bridge and no check. */
  readonly update?: UpdateApi;
};

export function UpdateNotice({ update }: UpdateNoticeProps) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);

  useEffect(() => {
    if (update === undefined) return;
    let cancelled = false;
    update
      .check()
      .then((answer) => {
        if (!cancelled) setStatus(answer);
      })
      // A bridge that rejects leaves the popover unmounted, which is the same
      // silence `unknown` gets. Nothing about an update check is worth an
      // error on screen.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [update]);

  // Dismissal is state on a component that stays mounted, so a re-render
  // cannot bring it back; the effect above depends on `update` alone and does
  // not run again to reset it.
  if (dismissed || status === null || status.kind !== 'available') return null;

  return (
    <div
      data-testid="update-notice"
      role="status"
      aria-label="update available"
      className="fixed top-3 right-3 z-40 flex w-[300px] flex-col gap-2 rounded-[9px] border border-line-strong bg-panel p-3 shadow-lg"
    >
      <div className="flex items-baseline gap-2">
        <span className="font-semibold text-ink text-xs">vam {status.version} is available</span>
        <button
          type="button"
          aria-label="dismiss update notice"
          onClick={() => setDismissed(true)}
          className="ml-auto cursor-pointer rounded px-1 text-ink-faint text-xs"
        >
          ×
        </button>
      </div>
      <p className="m-0 text-[11px] text-ink-dim leading-[1.45]">
        Opens the release page in your browser. vam does not download or install anything — the
        release is yours to read and to fetch.
      </p>
      <span data-testid="update-url" className="select-text break-all text-[10px] text-ink-faint">
        {status.url}
      </span>
      <button
        type="button"
        onClick={() => {
          void update?.open().then((opened) => setOpenFailed(!opened));
        }}
        className="cursor-pointer rounded border border-line px-2 py-0.5 text-ink-dim text-xs"
      >
        Open the release page
      </button>
      {openFailed && (
        <p data-testid="update-open-failed" className="m-0 text-[11px] text-ink-faint">
          Could not open a browser. The URL above is the release.
        </p>
      )}
    </div>
  );
}
