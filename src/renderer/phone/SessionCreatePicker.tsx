/**
 * The FAB's own sheet: which project gets the new session.
 *
 * `PhoneShell.tsx`'s floating "+" used to guess -- the topmost project in
 * `sidebar.entries`' own urgency-first order -- because that was the only
 * project on screen without a second control. The operator asked for a
 * choice instead: tap the FAB, see every project, tap one. This is that
 * list, and nothing more: picking a row calls `onPick(projectId)`, which
 * `PhoneShell.tsx` wires straight to `sidebar.onAddInProject` -- the exact
 * handler the (now touch-reachable) per-project heading `+` already wears.
 * There is no second create-session implementation here, only a second
 * caller of the one that already exists.
 *
 * THE SHEET ITSELF IS THE SAME CONVENTION EVERY OTHER PHONE-REACHABLE
 * OVERLAY USES, not a new one: `data-overlay-host` on a full-screen host,
 * a scrim `<button>` that is the click-away target, and a panel inside it.
 * `styles.css`'s `.vam-phone [data-overlay-host]` rule is what turns that
 * shape into a bottom sheet, capped at 85dvh and scrolling within itself,
 * with the same safe-area padding `IconPicker`/`GroupPicker`/`ProjectPicker`
 * already get for free -- see that rule's own header. Escape closes it, the
 * same idiom every one of those three already uses (a `keydown` listener on
 * the panel itself, since the window listener ignores anything that can
 * hold a cursor); a phone has no Escape key, so the scrim tap is the real
 * route there, exactly as it is for the other three on a phone today.
 *
 * ROWS ARE 44px HERE UNCONDITIONALLY, not behind a `.vam-phone .vam-tap`
 * rule: this component only ever renders behind the FAB, which only ever
 * exists on a phone (`PhoneShell.tsx`), so there is no desktop arm to keep
 * smaller the way `IconPicker`'s own rows do.
 */

import { Monitor, Plus } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { IconMark, parseIcon } from '../panels/icon-value.js';

export type SessionCreateChoice = {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null | undefined;
  /**
   * Read off the model, not asked of a source: a project whose every session
   * (or none at all) is `unstarted` has no live conversation yet -- a tagged
   * tmux pane and nothing more, the renderer-visible shape of what pull
   * request 486 calls a pane-only project at the HTTP layer
   * (`docs/design/worktrees.md` §4, `create-session-in-confinement.test.ts`'s
   * own header). `PhoneShell.tsx`
   * computes this from `sidebar.entries`, the same list the sheet is built
   * from, so it costs no second read of the model.
   */
  readonly paneOnly: boolean;
};

export type SessionCreatePickerProps = {
  readonly choices: readonly SessionCreateChoice[];
  readonly onPick: (projectId: string) => void;
  readonly onClose: () => void;
};

export function SessionCreatePicker({ choices, onPick, onClose }: SessionCreatePickerProps) {
  const shellRef = useRef<HTMLDivElement>(null);

  // Escape from inside the panel -- `ProjectPicker`/`GroupPicker`/
  // `IconPicker`'s own idiom, kept identical rather than reinvented: the
  // window's own listener ignores anything that can hold a cursor, and this
  // sheet has none, so binding on the panel itself is what actually fires.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    }
    const shell = shellRef.current;
    shell?.addEventListener('keydown', onKeyDown);
    return () => shell?.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      data-overlay-host
      className="absolute inset-0 z-30 flex items-start justify-center pt-[12vh]"
    >
      <button
        type="button"
        // NOT "close the …", unlike its three siblings
        // (`GroupPicker`/`ProjectPicker`/`IconPicker`'s own scrims): those
        // three are rendered by `Canvas.tsx` as SIBLINGS of `[data-phone-
        // shell]`, never inside it, so `styles.css`'s
        // `[data-phone-shell] button[aria-label^='close ']:not([data-phone-
        // close])` rule -- written to `display: none` the session row's
        // hover-revealed `x`, unreachable and unhittable on a phone -- never
        // sees them. This sheet is rendered INSIDE `PhoneShell.tsx`'s own
        // tree (it only ever opens behind the FAB, which only the phone
        // shell draws), so it IS inside `[data-phone-shell]`, and "close the
        // project list" measured `display: none` here -- a real, painted-
        // away scrim, found by falsifying the tap this button exists for.
        aria-label="dismiss the project list"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ground/70"
      />
      <div
        ref={shellRef}
        data-session-create-picker
        className="relative z-10 flex max-h-[380px] w-[340px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-panel shadow-[var(--shadow-node)]"
      >
        <div className="flex items-center gap-2 border-line border-b px-3 py-2">
          <span className="text-meta text-ink-faint">new session in</span>
        </div>
        {choices.length === 0 ? (
          // Unreachable from the FAB today -- `PhoneShell.tsx` only draws the
          // FAB at all when `sidebar.entries.length > 0` -- but stated rather
          // than assumed: a future caller with an empty list gets a sentence,
          // not a blank sheet.
          <p className="px-3 py-4 text-control text-ink-faint">No project to start a session in.</p>
        ) : (
          <ul className="flex flex-col gap-0.5 overflow-y-auto p-1">
            {choices.map((choice) => (
              <li key={choice.id} className="flex items-center gap-0.5">
                <button
                  type="button"
                  data-project-choice-create={choice.id}
                  onClick={() => onPick(choice.id)}
                  className="flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-control text-ink-dim active:bg-raised"
                >
                  <span className="flex h-[16px] w-[16px] flex-none items-center justify-center text-ink-faint">
                    <IconMark
                      value={parseIcon(choice.icon)}
                      size={16}
                      fallback={<Monitor size={16} strokeWidth={1.7} />}
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{choice.name}</span>
                  {choice.paneOnly && (
                    <span
                      data-project-choice-pane-only
                      className="flex-none font-mono text-ink-faint text-meta"
                    >
                      pane only
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  data-project-choice-plus={choice.id}
                  aria-label={`New session in ${choice.name}`}
                  onClick={() => onPick(choice.id)}
                  className="vam-tap flex h-[44px] w-[44px] flex-none cursor-pointer items-center justify-center rounded-[6px] text-ink-dim active:bg-raised"
                >
                  <span
                    data-tap-skin
                    className="flex items-center justify-center border border-line"
                  >
                    <Plus size={16} strokeWidth={2} aria-hidden="true" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
