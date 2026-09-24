/**
 * TWO SCREENS, ONE SHORTCUT-ROW RENDERER. `TerminalOnlyStart` (`DetailPanel.
 * tsx`) is one PANE's own getting-started screen -- a `terminal` row whose
 * agent exited but whose conversation vam still knows. `GettingStarted`
 * below is the WHOLE APP's -- vam has no session to show anywhere, on first
 * launch or with every row hidden by `hideForeign` (PR 456's own origin
 * filter). Both draw a short list of "here is how you make something" rows
 * read live off the chord table (`InlineChord`, `chords.ts`'s
 * `primaryChord`), through the ONE `StartShortcuts` renderer, so a rebind
 * cannot leave either screen naming a key that does nothing.
 *
 * THE ROWS ARE NOT THE SAME LIST. `TerminalOnlyStart`'s row is a real
 * session's own pane: `o`/`Mod-n` starts a SECOND session in that project,
 * genuinely distinct from `newProject`'s own `Mod-Shift-p`, so it keeps its
 * own three rows -- New session, New project, Command palette -- unchanged.
 * `GettingStarted`'s row is not a session at all: `Canvas.tsx`'s own
 * `case 'newSession'` falls back to `newProject()` here because there is no
 * focused project to add a session TO, so `o` and `Mod-Shift-p` do the
 * IDENTICAL act on THIS screen. A row reading "New session · o" beside one
 * reading "New project · ⇧⌘P" would have told the operator two different
 * things happen on two different keys when only one thing does -- the
 * operator's own finding, reading the first screenshot. So this screen
 * collapses both chords onto one "New project" row and drops the session
 * row entirely; `StartShortcuts` takes a row's actions as a LIST for exactly
 * this, and a second, now-unbound chord simply draws no chip
 * (`InlineChord`'s own absent-not-disabled rule) rather than needing a
 * second component.
 */

import { FolderPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import type { KeyAction } from '../keyboard/chords.js';
import { InlineChord } from '../keyboard/ShortcutTip.js';

/**
 * THE MACOS APP-ICON FRAME. The operator's own ask: draw the mark "inside a
 * frame with a radius like a macOS app icon" -- Apple's own proportion is a
 * corner radius of 22.37% of the side, `styles.css`'s `--radius-xl` (14px)
 * at this frame's own 64px (`h-16 w-16`) being close enough that reusing the
 * token beats inventing a new arbitrary value for one component. A hairline
 * border and a soft shadow off the SAME two tokens every dialog in this app
 * already borrows (`border-line-strong`, `shadow-sm`) rather than a new
 * pairing invented for this one screen.
 *
 * ONE FRAME, TWO FILLS. `GettingStarted` below hands it vam's own mark --
 * the WHOLE APP has no session to name, so there is no session mark to draw
 * instead. `TerminalOnlyStart` (`DetailPanel.tsx`) hands it a session's own
 * AGENT mark, through the SAME `SourceMark` resolver the sidebar row and the
 * status bar already draw theirs through -- one table, so a rebind or a new
 * provider can never leave one surface out of step with the other two.
 *
 * `overflow-hidden` DOES THE CLIPPING, not a `rounded` class on the mark
 * itself: the frame owns the shape, and a fill that is smaller than the
 * frame (every `SourceMark` register except `GettingStarted`'s full-bleed
 * SVG) is simply centred inside it rather than stretched to match.
 */
export function IconFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div
      data-icon-frame
      className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-[14px] border border-line-strong bg-card shadow-sm"
    >
      {children}
    </div>
  );
}

export type StartShortcutRow = {
  readonly label: string;
  /**
   * One chip per action, in order. Usually one action; `GettingStarted`'s
   * own "New project" row is two, because `o` and `Mod-Shift-p` both reach
   * it from this screen and neither chord deserves to be left unmentioned.
   * An action with no current binding draws no chip at all (`InlineChord`),
   * so a row can shrink to nothing wider than its label without this
   * component needing to know why.
   */
  readonly actions: readonly KeyAction[];
};

/** `TerminalOnlyStart`'s three rows, unchanged since before this file
 *  existed -- a real session's own pane, where New session genuinely
 *  differs from New project. */
export const TERMINAL_ONLY_SHORTCUT_ROWS: readonly StartShortcutRow[] = [
  { label: 'New session', actions: [{ kind: 'newSession' }] },
  { label: 'New project', actions: [{ kind: 'newProject' }] },
  { label: 'Command palette', actions: [{ kind: 'palette' }] },
];

/** `GettingStarted`'s two rows -- see this file's own header for why New
 *  session is not one of them here, and why New project carries two chips. */
export const GETTING_STARTED_SHORTCUT_ROWS: readonly StartShortcutRow[] = [
  { label: 'New project', actions: [{ kind: 'newSession' }, { kind: 'newProject' }] },
  { label: 'Command palette', actions: [{ kind: 'palette' }] },
];

/**
 * `testId` keeps each caller's own `document.querySelector` hook
 * (`data-terminal-only-shortcuts`, `data-getting-started-shortcuts`) rather
 * than merging two already-tested selectors into one neither existing test
 * expects -- `DetailPanel.terminal-only.test.tsx` predates this file and its
 * selector is untouched.
 */
export function StartShortcuts({
  rows,
  testId,
}: {
  readonly rows: readonly StartShortcutRow[];
  readonly testId: string;
}) {
  return (
    <ul {...{ [`data-${testId}`]: '' }} className="flex flex-col gap-1 text-meta text-ink-quiet">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center justify-center gap-2">
          <span>{row.label}</span>
          {row.actions.map((action) => (
            <InlineChord
              key={action.kind}
              action={action}
              className="rounded-[4px] border border-line-strong px-1 py-px font-mono text-ink-dim"
            />
          ))}
        </li>
      ))}
    </ul>
  );
}

export type GettingStartedProps = {
  /**
   * Choose a directory, start vam's first session in it -- the SAME act
   * `newProject` (`Canvas.tsx`) already is for the Projects header's `+` and
   * `Mod-Shift-p`; this screen adds no second implementation, only a third
   * caller. The coordinator's own note applies here as everywhere else it is
   * wired: the row that lands is `unstarted`, not already running an agent --
   * this button chooses a directory, nothing more.
   */
  readonly onNewProject: () => void;
  /**
   * Why a new project cannot be started, in the SOURCE's own words -- the
   * same `newSessionRoute(source).decline` the sidebar's two `+` buttons
   * already caption themselves from. `null` when it can.
   */
  readonly newProjectDecline: string | null;
  /**
   * Whether THIS BUILD can open a native directory picker at all --
   * `window.api?.dialog?.chooseDirectory !== undefined`, read at the call
   * site exactly as `prRepo`'s own comment insists on for the same bridge.
   * `false` in the browser build and on a phone, where there is no Electron
   * behind it: ABSENT, NOT DISABLED -- the button is withdrawn rather than
   * drawn and refused on tap, and the screen says what DOES need the desktop
   * app instead of leaving a dead control on screen.
   */
  readonly hasDirectoryPicker: boolean;
  /**
   * PR 456's own quiet line, reused rather than redrawn: how many rows
   * `hideForeign` is hiding RIGHT NOW (`Canvas.tsx`'s `foreignHiddenCount`),
   * so an operator whose projects are all foreign-owned learns why the
   * screen reads "no sessions" rather than reading it as vam being broken.
   * `0` draws nothing, the same as the sidebar's own strip.
   */
  readonly foreignHiddenCount: number;
  /** The SAME pref the sidebar's own "Show" flips -- `hideForeign: false`. */
  readonly onShowForeign: () => void;
  /**
   * True only for `SessionList.tsx`'s own phone instance of this screen --
   * absent (falsy) for the desktop's, which is what `DetailPanel.tsx` mounts
   * and never sets it. Two consequences, both about what a touchscreen
   * cannot use:
   *
   *  1. THE SHORTCUT ROWS ARE WITHDRAWN. `InlineChord` draws nothing on a
   *     phone at all (`styles.css`'s `.vam-phone [data-inline-chord]`), so
   *     `StartShortcuts` on a phone was three or four bare words -- "New
   *     project", "Command palette" -- naming keys a touch operator has no
   *     way to press. A hint with no hint in it is not a smaller hint, it is
   *     noise, so the whole list is absent rather than drawn empty-handed.
   *  2. NO DIRECTORY PICKER MEANS SOMETHING DIFFERENT HERE. The desktop's
   *     "the browser build has no picker" is a fact about THIS build; a
   *     phone reaches vam over Tailscale Serve (`docs/design/...`, the
   *     operator's own mobile rule) -- a browser build BY DEFINITION, so the
   *     sentence would be true but point nowhere an operator holding a phone
   *     can act on. The phone's own copy says what DOES exist instead: the
   *     desktop app, on the machine this phone is connected to.
   */
  readonly phone?: boolean;
  /**
   * TRUE WHILE `onNewProject` IS RUNNING -- the directory dialog and the
   * spawn that follows it (`Canvas.tsx`'s `newProject`, `pendingAction ===
   * NEW_PROJECT_PENDING`). The sidebar's own New project button already
   * wears this exact wait visibly (`SessionList.tsx`'s `pending()` helper:
   * disabled, `aria-busy`, the breathing `data-pending` mark); this button
   * offers the identical act and had worn none of it, which is the operator's
   * own complaint made concrete: a native directory picker is the OS's
   * feedback, not vam's, and it is gone for the ~10s of spawning that follows
   * it, so THIS control is the only thing on screen that could have said so.
   * `false`/absent draws the ordinary button.
   */
  readonly pending?: boolean;
};

/**
 * THE GETTING-STARTED SCREEN: the detail pane's Response view when vam has
 * NO session to show ANYWHERE in the app -- first launch, or every row
 * hidden by `hideForeign`. `Canvas.tsx` opts this in with the `gettingStarted`
 * prop rather than `DetailPanel` guessing it from `entry === null` alone: a
 * pane can hold nothing while a sibling pane, or another project entirely,
 * still has a real session, and this screen is a statement about the WHOLE
 * app, not about one empty pane.
 *
 * NO PROVIDER PICKER. `StartSession`/`TerminalOnlyStart` both offer one
 * because their row already has a project to start a session IN; this
 * screen's row does not exist yet. The coordinator's own note: New project
 * only chooses a directory and lands an `unstarted` row, which THEN draws
 * `StartSession`'s picker -- the one implementation of it, reached a step
 * later rather than duplicated here.
 */
export function GettingStarted({
  onNewProject,
  newProjectDecline,
  hasDirectoryPicker,
  foreignHiddenCount,
  onShowForeign,
  phone = false,
  pending = false,
}: GettingStartedProps) {
  const canCreate = newProjectDecline === null && hasDirectoryPicker;
  return (
    <div
      data-getting-started
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center"
    >
      {/* THE MARK VAM ALREADY SHIPS, LARGER AND CRISP -- `build/icon.svg`,
          copied verbatim to `public/icon.svg` (never re-rendered: it is
          authored art, the same rule `build/favicon.svg`'s own header
          states for why nothing here regenerates it). NOT `favicon.png`:
          that asset is deliberately the SMALL mark, hand-tuned for 16/32px
          legibility (`index.html`'s own comment) and never meant to be
          scaled up -- at this frame's 64px the detailed `icon.svg` is the
          one that reads clearly, the same reasoning `index.html` already
          gives for why the OS-level app icon uses it over the favicon.

          DOCUMENT-RELATIVE, NOT ROOT-ABSOLUTE -- see `TerminalOnlyStart`'s
          own comment on this exact point: the packaged app's document is
          `file://.../out/renderer/index.html`, where a leading `/` reads as
          the filesystem root and the image is simply gone. */}
      <IconFrame>
        <img src="./icon.svg" width={64} height={64} alt="vam" className="h-full w-full" />
      </IconFrame>
      <div className="flex flex-col gap-1">
        <p className="text-control text-ink">vam</p>
        <p className="max-w-[38ch] text-meta text-ink-quiet">
          A keyboard-first agent manager — every Claude Code and Codex session on this machine, in
          one place.
        </p>
      </div>
      {/* WITHDRAWN ON A PHONE -- see `phone`'s own comment: a touch screen
          cannot press a chord, so a list of bare labels is noise, not help. */}
      {!phone && (
        <StartShortcuts testId="getting-started-shortcuts" rows={GETTING_STARTED_SHORTCUT_ROWS} />
      )}
      {canCreate ? (
        <button
          type="button"
          data-getting-started-new-project
          onClick={onNewProject}
          disabled={pending}
          aria-busy={pending}
          // The SAME three channels the sidebar's own New project button
          // already wears for this exact wait (`SessionList.tsx`'s
          // `pending()`): `disabled`, `aria-busy`, and `data-pending`'s own
          // breathing mark (`styles.css`) -- one idiom for "this button's
          // act is running", not a second one invented for this screen.
          data-pending={pending ? 'true' : undefined}
          title={pending ? 'Starting a session in the chosen directory…' : undefined}
          className="vam-tap flex cursor-pointer items-center gap-1.5 rounded-[8px] bg-ink px-3.5 py-1.5 text-control text-panel hover:opacity-90"
        >
          <FolderPlus size={12} strokeWidth={2} />
          New project
        </button>
      ) : (
        // ABSENT, NOT DISABLED (`onStartSession`'s own rule, `DetailPanel.tsx`):
        // a control that cannot act is withdrawn, and the sentence that
        // replaces it says what DOES work here. `newProjectDecline` -- a
        // source-level refusal -- takes priority in its own words, on either
        // surface; the picker's absence is the one case this screen has
        // anything of its OWN to say, and what it says depends on which
        // surface is asking -- see `phone`'s own comment.
        <p data-getting-started-decline className="max-w-[36ch] text-meta text-ink-quiet">
          {newProjectDecline ??
            (phone
              ? 'New project needs the desktop app — open vam on the machine you’re connected to.'
              : 'Choosing a directory needs the desktop app — the browser build has no picker.')}
        </p>
      )}
      {foreignHiddenCount > 0 && (
        <div
          data-getting-started-hidden
          className="flex flex-wrap items-center justify-center gap-1.5 text-meta text-ink-faint"
        >
          <span data-getting-started-hidden-count>
            {foreignHiddenCount} session{foreignHiddenCount === 1 ? '' : 's'} hidden — vam did not
            start {foreignHiddenCount === 1 ? 'it' : 'them'}
          </span>
          <button
            type="button"
            data-getting-started-show
            aria-label="show sessions vam did not start"
            onClick={onShowForeign}
            className="vam-tap cursor-pointer font-mono text-control text-ink-dim underline hover:text-ink"
          >
            Show
          </button>
        </div>
      )}
    </div>
  );
}
