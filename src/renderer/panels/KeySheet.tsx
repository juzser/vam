/**
 * `?` — every keyboard binding there is (docs/design/canvas-layout.md §4).
 *
 * Its rows come from two generators — `buildKeySheet()`, which walks the chord
 * tables, and `buildFilesSheet()`, which walks the Files tab's own two key
 * lists — so this component holds no key strings of its own and cannot
 * advertise a control that does not exist. Everything here is layout.
 *
 * TWO GENERATORS RATHER THAN ONE, and `keysheet.ts`'s own header on
 * `buildFilesSheet` carries the argument: that tab's keyboard is hardcoded and
 * out of `BINDING_TABLES` on purpose, so it cannot be derived the same way —
 * but it is still a keyboard, and leaving it off the sheet is how its filter
 * stayed invisible for a release while an operator asked for a file search
 * that already half existed.
 *
 * The overlay idiom is `CommandPalette`'s, deliberately not a second one: a
 * scrim that is a real button (a div with a click handler is invisible to
 * exactly the users who most need the way out announced). What it adds is
 * returning the keyboard to wherever it came from on close — a full-screen
 * overlay that drops focus on the body leaves a keyboard-first app with no
 * cursor at all.
 *
 * ── THE SHAPE, WHICH THE OPERATOR ASKED FOR IN ONE SENTENCE ───────────────
 *
 * Translated: "the shortcut table when you press `?` needs a search box,
 * clearer section separation, and a one-column layout with the label on one
 * side and the shortcut on the other."
 *
 * ONE COLUMN, LABEL LEFT, KEY RIGHT. It was two columns of `chip label` pairs,
 * which put a key in the middle of the sheet and made a caption the thing that
 * had to fit around it. One column reads down the CAPTIONS, which is the
 * question an operator actually has ("how do I …"), and it gives a caption the
 * whole width — which the half-page rows need, because they disclose a second
 * keystroke in prose and a narrow column is what would tempt a truncation.
 *
 * SECTIONS THAT READ AS SECTIONS: a rule above each heading and real space
 * around it, rather than two columns of headings at whatever height the
 * previous group happened to end.
 *
 * ── THE SEARCH BOX HOLDS THE KEYBOARD, AND WHAT FOLLOWS FROM THAT ─────────
 *
 * It autofocuses. A search box a keyboard-first tool makes you Tab to is a
 * control its own users cannot find, and nothing is lost by giving it the
 * keyboard: `Canvas.tsx` already stands the whole grammar down while an
 * overlay is open ("the canvas hears Escape and nothing else"), so no chord
 * was working here to be taken away.
 *
 * TWO CONSEQUENCES, BOTH DELIBERATE AND BOTH PINNED BY
 * `test/panels/KeySheet.search.test.tsx`:
 *
 *   `?` TYPES A QUESTION MARK rather than closing the sheet. The window
 *   listener steps aside for an INPUT (`Canvas.tsx`'s `typing` guard), so the
 *   character reaches the box — which is exactly what lets an operator search
 *   for the `?` key itself. `?` never closed this sheet in any case: it opens
 *   it, and Escape is the way out.
 *
 *   ESCAPE IS CAUGHT HERE. That same guard means the canvas never sees an
 *   Escape typed in this box, so without a handler of its own the sheet would
 *   have no keyboard way out at all. It is `CommandPalette`'s idiom, for
 *   `CommandPalette`'s reason, and it `preventDefault`s so one press cannot
 *   also reach the canvas and peel a second layer.
 *
 * IT CARRIES NO PHONE OVERLAY-HOST MARKER, deliberately, and
 * `test/phone/overlay-sheets.test.ts` holds that line — by SCANNING THIS FILE
 * FOR THE ATTRIBUTE'S NAME, which is why the name is not written here. The
 * sheet is reached by `?`, there are no chords on a phone, and a sheet
 * geometry would make it look reachable while nothing can open it. The search
 * box adds no 390px surface for the same reason.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { chordSymbols } from '../keyboard/chords.js';
import { buildFilesSheet, buildKeySheet, filterSheet } from '../keyboard/keysheet.js';

export type KeySheetProps = {
  readonly onClose: () => void;
};

export function KeySheet({ onClose }: KeySheetProps) {
  const box = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const returnTo = document.activeElement;
    box.current?.focus();
    return () => {
      if (returnTo instanceof HTMLElement && document.contains(returnTo)) {
        returnTo.focus();
      }
    };
  }, []);

  // The grammar first, then the one surface with a keyboard of its own: the
  // sheet reads outward from what works everywhere to what works in one tab.
  // Built once rather than per keystroke — the filter is what the query moves.
  const all = useMemo(() => [...buildKeySheet(), ...buildFilesSheet()], []);
  const groups = useMemo(() => filterSheet(all, query), [all, query]);
  const total = useMemo(() => all.reduce((count, group) => count + group.rows.length, 0), [all]);

  return (
    <div
      data-key-sheet
      role="dialog"
      aria-label="keyboard shortcuts"
      aria-modal="true"
      className="absolute inset-0 z-50 flex items-start justify-center pt-16"
      onKeyDown={(event) => {
        // The window listener ignores keys typed in an input, so Escape has to
        // be caught here or the box would be a trap. On the sheet's own root
        // rather than on the input, so it answers wherever the keyboard is
        // inside the panel — the close button, a scrolled list, the box.
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <button
        type="button"
        aria-label="close keyboard shortcuts"
        className="absolute inset-0 cursor-default bg-ground/70"
        onMouseDown={onClose}
      />
      {/* A COLUMN THAT SCROLLS INSIDE ITSELF: the header and the search box
          are `flex-none` and the list takes the rest, so the box stays on
          screen while a hundred rows scroll under it. It was one scrolling
          block, which would have carried the search box away on the first
          wheel. */}
      <div className="relative flex max-h-[80vh] w-[min(620px,92vw)] flex-col overflow-hidden rounded-md border border-line bg-panel">
        <div className="flex flex-none items-baseline gap-2 border-line border-b px-4 py-3">
          <h2 className="font-semibold text-heading text-ink">keyboard</h2>
          <span className="text-ink-faint text-meta">
            every binding there is — generated from the key tables
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded border border-line px-2 py-0.5 text-control text-ink-dim"
          >
            Esc
          </button>
        </div>
        {/* THE BOX. `type="text"` rather than `search`: the browser's own
            clear affordance is a control with no keyboard route in this
            overlay, and an Escape pressed over a `search` input clears it in
            WebKit instead of closing the sheet — two different acts on one
            key, decided by which browser is drawing. */}
        <div className="flex-none border-line border-b px-4 py-2">
          <input
            ref={box}
            data-key-sheet-search
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="search the shortcuts"
            placeholder="search by what it does, or by the key…"
            className="w-full bg-transparent text-body text-ink outline-none placeholder:text-ink-faint"
          />
        </div>
        <div data-key-sheet-groups className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {groups.length === 0 ? (
            // NOT A BLANK SHEET. A list that empties under a keystroke reads
            // as a broken surface; this names what was searched for, says how
            // much is behind it, and is announced as well as drawn — the
            // operator's eyes are on the box, not on the list.
            <p
              data-key-sheet-empty
              role="status"
              className="vam-sentence py-6 text-center text-control text-ink-dim"
            >
              no key matches “{query}” — clear the box to see all {total}
            </p>
          ) : (
            groups.map((group) => (
              // A RULE AND REAL SPACE ABOVE EACH HEADING, and none above the
              // first: a boundary between two things needs one line, not one
              // before the first thing on the sheet.
              <section
                key={group.group}
                className="mt-4 border-line border-t pt-3 first:mt-0 first:border-0 first:pt-0"
              >
                <h3
                  data-key-sheet-group={group.group}
                  className="mb-1.5 font-semibold text-ink-dim text-meta uppercase tracking-wide"
                >
                  {group.title}
                </h3>
                <ul>
                  {group.rows.map((row) => (
                    // Keyed by everything that distinguishes a row, not by its
                    // keystroke: one key already yields a row PER MODE, and a
                    // key two actions claim yields one row each. Keyed by
                    // `row.keys` alone they collided, and React reconciled
                    // them by position.
                    <li
                      key={`${row.keys}·${row.mode ?? ''}·${row.label}`}
                      className="flex items-baseline gap-3 py-[3px] text-control"
                    >
                      {/* THE ACTION FIRST — in document order, which is both
                          the reading order a screen reader takes and the side
                          the operator asked for. `min-w-0` lets a long caption
                          wrap inside its own cell instead of pushing the key
                          off the row. */}
                      <span data-key-sheet-label className="min-w-0 flex-1 text-ink-dim">
                        {row.label}
                      </span>
                      {/* IN WORDS, not only in the strikethrough beside it:
                          what an operator cannot work out for themselves is
                          WHO took the key, and a struck-through chip does not
                          say it. The row stays rather than being dropped —
                          dropping it would take the shadowed action off the
                          sheet altogether, which is the hiding this is the fix
                          for. It rides with the label, so the key column is
                          the one thing every row has. */}
                      {row.dead === null ? null : (
                        <span data-key-sheet-dead className="shrink-0 text-waiting">
                          dead — {row.dead} has this key
                        </span>
                      )}
                      <kbd
                        data-key-sheet-keys
                        className={`shrink-0 rounded border border-line px-1 text-center font-mono ${
                          row.dead === null
                            ? 'bg-raised text-ink'
                            : 'bg-transparent text-ink-dim line-through'
                        }`}
                      >
                        {/* THE SYMBOLS ARE PAINTED HERE AND NOWHERE EARLIER.
                            `row.keys` is the grammar's own spelling — the
                            string `buildKeySheet` judged `isSelectOnlyChord`
                            against and keyed `row.dead` by — and
                            `chordSymbols` is what a person reads: ⌘ on a Mac,
                            `Ctrl` off one. */}
                        {chordSymbols(row.keys)}
                      </kbd>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
