/**
 * `Ctrl-K` (docs/design/canvas-layout.md §4).
 *
 * The design says "no real modes, a handful of vim chords plus a palette". The
 * palette is what keeps that promise affordable: everything reachable by a
 * chord has to be memorised, so anything that does not earn a chord lives here
 * and stays discoverable. cmdk is the same library orca uses for its own
 * QuickOpen and WorktreeJumpPalette (§4.1).
 *
 * It lists destinations, not just names: what is waiting on you sorts to the
 * top, because that is what the canvas is for.
 *
 * TWO MODES NOW, VS CODE'S OWN SPLIT, at the operator's request: no prefix
 * finds a SESSION (unchanged from the paragraph above), a leading `/` finds
 * an ACTION. `keyboard/palette-actions.ts` owns every decision about WHICH
 * actions and whether one is disabled; this file is the box and the two
 * lists, same division `keysheet.ts`/`KeySheet.tsx` already draw between
 * "what a query matches" and "a box and a list".
 *
 * THE INPUT IS CONTROLLED, where it used to be `cmdk`'s own uncontrolled
 * state, for exactly one reason: the mode is a function of the query
 * (`paletteMode`), so this component has to read the query on every
 * keystroke to know which list to draw. `shouldFilter` still hands session
 * search to `cmdk`'s own fuzzy scorer, UNCHANGED from before this file had
 * two modes — only the action list is filtered by hand
 * (`filterPaletteActions`), because `cmdk`'s scorer would otherwise be asked
 * to match an action's row against a query that still carries the leading
 * `/` no row's `value` contains.
 */

import { Command } from 'cmdk';
import { useState } from 'react';
import { projectMergeKey, type SessionEntry } from '../domain/selectors.js';
import type { KeyAction } from '../keyboard/chords.js';
import {
  actionQueryText,
  buildPaletteActions,
  filterPaletteActions,
  type PaletteActionEntry,
  paletteHint,
  paletteMode,
} from '../keyboard/palette-actions.js';
import { ChordGlyphs } from '../keyboard/ShortcutTip.js';

export type PaletteProps = {
  readonly entries: readonly SessionEntry[];
  readonly onPick: (sessionId: string) => void;
  /** Run one action row — the same function the bound chord itself calls,
   *  reached through `runAction` in `Canvas.tsx`. */
  readonly onRunAction: (action: KeyAction) => void;
  /** Whether a session is focused right now — the one fact
   *  `buildPaletteActions` needs to decide which rows it can run. */
  readonly hasFocusedSession: boolean;
  readonly onClose: () => void;
};

export function CommandPalette({
  entries,
  onPick,
  onRunAction,
  hasFocusedSession,
  onClose,
}: PaletteProps) {
  const [query, setQuery] = useState('');
  const mode = paletteMode(query);

  const waiting = entries.filter(({ session }) => session.status === 'waiting');
  const rest = entries.filter(({ session }) => session.status !== 'waiting');

  // ONE LABEL PER CHECKOUT, ACROSS BOTH GROUPS. Two sources reading the same
  // directory hand the palette two `Project` objects with the same name
  // (`projectMergeKey`'s own doc comment has the id schemes that disagree) —
  // printed on every row the way this used to, the operator sees `vam/`
  // twice with nothing to say it is the same checkout underneath. `seen` is
  // built once, in draw order (`needs you` before `all sessions`, matching
  // the layout below), so the SECOND row for a merge key never repeats the
  // label a row above it already showed.
  const seen = new Set<string>();
  const shouldLabel = (entry: SessionEntry): boolean => {
    const key = projectMergeKey(entry.project);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const waitingLabels = waiting.map(shouldLabel);
  const restLabels = rest.map(shouldLabel);

  const actionRows =
    mode === 'actions'
      ? filterPaletteActions(buildPaletteActions(hasFocusedSession), actionQueryText(query))
      : [];

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center pt-24">
      {/*
        The scrim is a real button, not a div with a click handler, because that
        is what it is: a control whose whole job is closing the palette. Written
        as a div it would be invisible to a screen reader and to the keyboard —
        exactly the users who most need the way out to be announced. The mouse
        path is a convenience over the real one, which is Escape.
      */}
      <button
        type="button"
        aria-label="close palette"
        className="absolute inset-0 cursor-default bg-ground/70"
        onMouseDown={onClose}
      />
      <Command
        label="Command palette"
        /* `bg-panel`, NOT `bg-surface`. There is no `--color-surface` token
           in `styles.css` and there never was: Tailwind emitted no rule for
           it, so this panel had NO background at all and the canvas behind it
           read straight through the command list -- the operator's report,
           "the command palette needs a background, it is transparent now so
           the text overlaps". `bg-panel` is what the settings dialog wears,
           which is the same kind of thing: a floating surface over the app.
           `e2e/command-palette-shots.mjs` measures the painted pixel now, so
           a class that names nothing cannot pass again. */
        data-command-palette
        data-palette-mode={mode}
        className="relative w-[min(560px,90vw)] overflow-hidden rounded-md border border-line bg-panel"
        // SESSION SEARCH KEEPS `cmdk`'s OWN SCORER, unchanged from before this
        // component had two modes; the action list is pre-filtered by hand and
        // drawn as-is, so `cmdk` is told to stand down rather than score a
        // query that still carries a leading `/` no action row's `value`
        // holds.
        shouldFilter={mode === 'sessions'}
        onKeyDown={(event) => {
          // The window listener ignores keys typed in an input, so Escape has
          // to be caught here or the overlay would have no keyboard way out —
          // which on a keyboard-first tool is a trap, not a rough edge.
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
        loop
      >
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          // UNCHANGED IN SESSION MODE, deliberately: `go to session…` is what
          // `Canvas.keyboard.test.tsx`/`Canvas.overlay-keys.test.tsx` already
          // find the box by, and the one-line hint below is where "/ for
          // actions" belongs — repeating it in the placeholder too would be
          // the same sentence twice for no reader who cannot already see it.
          placeholder={mode === 'actions' ? 'action name…' : 'go to session…'}
          className="w-full border-line border-b bg-transparent px-3 py-2 text-ink outline-none placeholder:text-ink-faint"
        />
        {/* THE ONE-LINE HINT, directly under the box, in the muted text token
            every other secondary line in this shell already wears
            (`text-ink-faint`, the same class `Command.Empty` below and
            `placeholder:` above both use) — short enough that
            `e2e/command-palette-shots.mjs` can assert it never clips at
            390px, which is the narrowest legal pane this shell draws. */}
        <p data-palette-hint className="truncate px-3 pt-1 pb-1.5 text-ink-faint text-meta">
          {paletteHint(mode)}
        </p>
        <Command.List className="vam-no-scrollbar max-h-72 overflow-y-auto p-1">
          {mode === 'actions' ? (
            <>
              <Command.Empty className="px-3 py-4 text-ink-faint">No matching action</Command.Empty>
              <Command.Group heading="actions" className="px-1 text-ink-faint text-meta">
                {actionRows.map((row) => (
                  <ActionRow key={row.id} row={row} onRunAction={onRunAction} />
                ))}
              </Command.Group>
            </>
          ) : (
            <>
              <Command.Empty className="px-3 py-4 text-ink-faint">No match</Command.Empty>

              {waiting.length > 0 && (
                <Command.Group heading="needs you" className="px-1 text-ink-faint text-meta">
                  {waiting.map((entry, i) => (
                    <PaletteRow
                      key={entry.session.id}
                      entry={entry}
                      onPick={onPick}
                      showProjectName={waitingLabels[i] ?? true}
                    />
                  ))}
                </Command.Group>
              )}

              <Command.Group heading="all sessions" className="px-1 text-ink-faint text-meta">
                {rest.map((entry, i) => (
                  <PaletteRow
                    key={entry.session.id}
                    entry={entry}
                    onPick={onPick}
                    showProjectName={restLabels[i] ?? true}
                  />
                ))}
              </Command.Group>
            </>
          )}
        </Command.List>
      </Command>
    </div>
  );
}

function PaletteRow({
  entry,
  onPick,
  showProjectName,
}: {
  readonly entry: SessionEntry;
  readonly onPick: (sessionId: string) => void;
  /**
   * Whether THIS row is the one that names its checkout. `false` for every
   * row after the first with the same `projectMergeKey` — the operator has
   * already read `vam/` once by the time a second `codex` row for the same
   * directory scrolls by, and a second label would be the duplicate project
   * entry this component used to draw.
   */
  readonly showProjectName: boolean;
}) {
  const { project, session } = entry;
  return (
    <Command.Item
      // cmdk filters on this string, so it must carry everything a person might
      // type — the project name included, not just the session's own title —
      // REGARDLESS of `showProjectName`: a row that does not print its
      // project's name still belongs to it as far as search is concerned.
      value={`${project.name} ${session.title} ${session.epic ?? ''} ${session.id}`}
      onSelect={() => onPick(session.id)}
      className="flex cursor-pointer items-baseline gap-2 rounded px-2 py-1 text-ink text-body data-[selected=true]:bg-raised"
    >
      {showProjectName && (
        <span data-palette-project className="text-ink-faint">
          {project.name}/
        </span>
      )}
      <span>{session.title}</span>
      {session.status === 'waiting' && <span className="text-waiting">⏸</span>}
      {session.runningAgents > 0 && (
        <span className="ml-auto text-running">●{session.runningAgents}</span>
      )}
    </Command.Item>
  );
}

/**
 * One action row: its label, its bound chord(s), and — DISABLED RATHER THAN
 * HIDDEN when it needs a session nothing has focused, the operator's own
 * choice between the two named in `palette-actions.ts`'s own header. A row
 * an operator cannot run yet still says the command exists and what it is
 * waiting for, the same "never fail silently" rule `Canvas.tsx`'s own switch
 * keeps for every refusal it already has a sentence for.
 *
 * `cmdk` itself withholds `onSelect` and keyboard selection from a
 * `disabled` item, so the guard inside `onSelect` below is redundant against
 * a mouse or a keyboard — it exists only so this row never dispatches by
 * accident if that contract ever changes under it.
 */
function ActionRow({
  row,
  onRunAction,
}: {
  readonly row: PaletteActionEntry;
  readonly onRunAction: (action: KeyAction) => void;
}) {
  return (
    <Command.Item
      value={`${row.title} ${row.id}`}
      disabled={row.disabled}
      onSelect={() => {
        if (row.disabled) return;
        onRunAction(row.action);
      }}
      className="flex cursor-pointer items-baseline gap-2 rounded px-2 py-1 text-ink text-body data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50 data-[selected=true]:bg-raised"
    >
      <span className="min-w-0 flex-1 truncate">{row.title}</span>
      {row.disabled && row.disabledReason !== null && (
        <span className="shrink-0 text-ink-faint text-meta">{row.disabledReason}</span>
      )}
      {/* ONE CHORD, the same one a tooltip's chip would show
          (`primaryChord`, `ShortcutTip.tsx`) — not every bound chord joined
          with "or". `newSession` alone holds two (`o`, `Mod-n`); the row
          shows the first and `filterPaletteActions` still finds it by
          either, the same split `InlineChord`'s own doc comment draws
          between a box with room for a whole list and a control that shares
          its line with a label. */}
      <span className="shrink-0 font-mono text-ink-faint text-meta">
        <ChordGlyphs chord={row.primaryChord} />
      </span>
    </Command.Item>
  );
}
