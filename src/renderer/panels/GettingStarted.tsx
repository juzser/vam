/**
 * TWO SCREENS, ONE SHORTCUT LIST. `TerminalOnlyStart` (`DetailPanel.tsx`) is
 * one PANE's own getting-started screen -- a `terminal` row whose agent
 * exited but whose conversation vam still knows. `GettingStarted` below is
 * the WHOLE APP's -- vam has no session to show anywhere, on first launch or
 * with every row hidden by `hideForeign` (PR 456's own origin filter). Both
 * end the same three-row sentence ("here is how you make something"), and
 * `StartShortcuts` is the one place that sentence is written, read live off
 * the chord table (`InlineChord`, `chords.ts`'s `primaryChord`) so a rebind
 * cannot leave either screen naming a key that does nothing. Copying the
 * `<ul>` a second time was the alternative, and it is exactly the drift this
 * file exists to make impossible: a change to the three actions, or to their
 * order, would then have to land twice to stay true on both screens, and
 * nothing would fail if it only landed on one.
 */

import { FolderPlus } from 'lucide-react';
import type { KeyAction } from '../keyboard/chords.js';
import { InlineChord } from '../keyboard/ShortcutTip.js';

const START_SHORTCUTS: readonly { readonly label: string; readonly action: KeyAction }[] = [
  { label: 'New session', action: { kind: 'newSession' } },
  { label: 'New project', action: { kind: 'newProject' } },
  { label: 'Command palette', action: { kind: 'palette' } },
];

/**
 * `testId` keeps each caller's own `document.querySelector` hook
 * (`data-terminal-only-shortcuts`, `data-getting-started-shortcuts`) rather
 * than merging two already-tested selectors into one neither existing test
 * expects -- `DetailPanel.terminal-only.test.tsx` predates this file and its
 * selector is untouched.
 */
export function StartShortcuts({ testId }: { readonly testId: string }) {
  return (
    <ul {...{ [`data-${testId}`]: '' }} className="flex flex-col gap-1 text-meta text-ink-quiet">
      {START_SHORTCUTS.map((item) => (
        <li key={item.action.kind} className="flex items-center justify-center gap-2">
          <span>{item.label}</span>
          <InlineChord
            action={item.action}
            className="rounded-[4px] border border-line-strong px-1 py-px font-mono text-ink-dim"
          />
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
}: GettingStartedProps) {
  const canCreate = newProjectDecline === null && hasDirectoryPicker;
  return (
    <div
      data-getting-started
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center"
    >
      {/* THE MARK VAM ALREADY SHIPS -- see `TerminalOnlyStart`'s own comment
          on this exact `<img>` for why the path is document-relative
          (`./favicon.png`) rather than root-absolute: the packaged app's
          document is `file://.../out/renderer/index.html`, where a leading
          `/` reads as the filesystem root and the image is simply gone. */}
      <img src="./favicon.png" width={32} height={32} alt="vam" className="opacity-90" />
      <div className="flex flex-col gap-1">
        <p className="text-control text-ink">vam</p>
        <p className="max-w-[38ch] text-meta text-ink-quiet">
          A keyboard-first agent manager — every Claude Code and Codex session on this machine, in
          one place.
        </p>
      </div>
      <StartShortcuts testId="getting-started-shortcuts" />
      {canCreate ? (
        <button
          type="button"
          data-getting-started-new-project
          onClick={onNewProject}
          className="vam-tap flex cursor-pointer items-center gap-1.5 rounded-[8px] bg-ink px-3.5 py-1.5 text-control text-panel hover:opacity-90"
        >
          <FolderPlus size={12} strokeWidth={2} />
          New project
        </button>
      ) : (
        // ABSENT, NOT DISABLED (`onStartSession`'s own rule, `DetailPanel.tsx`):
        // a control that cannot act is withdrawn, and the sentence that
        // replaces it says what DOES work here. `newProjectDecline` -- a
        // source-level refusal -- takes priority in its own words; the
        // picker's absence is the one case this screen has anything of its
        // own to say, because `newSessionRoute` never learned about it.
        <p data-getting-started-decline className="max-w-[36ch] text-meta text-ink-quiet">
          {newProjectDecline ??
            'Choosing a directory needs the desktop app — the browser build has no picker.'}
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
