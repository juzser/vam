/**
 * THE PURE HALF of turning a raw `capture-pane` reply into text `xterm.write()`
 * can be handed with its cursor landing where tmux's REAL cursor is -- split
 * out of `client.ts` the same way `control-protocol.ts` is split out of
 * `control.ts`: this file spawns nothing, so it is provable without a real
 * tmux.
 *
 * ── THE BUG, MEASURED (a real screenshot,
 * `docs/design/ref/stream-cursor-offset-report.png`) ──────────────────────
 * `capture-pane`'s own text dump carries NO cursor position at all -- it is
 * a rendered screen, nothing more. `client.ts#reseed` used to hand that text
 * straight to xterm, so xterm's cursor, once the seed was written, simply
 * sat wherever the text happened to leave it: the END of the last line
 * written, never wherever tmux's REAL cursor was. For a Claude Code-style
 * input box drawn mid-screen, that end-of-text position lands a row below
 * the box's own prompt line -- exactly the operator's own report, typed text
 * overwriting the box's bottom border.
 *
 * `argv.ts`'s own `CURSOR_FORMAT` already answers "where is the cursor" --
 * the POLLING `TerminalTab.tsx` path has asked this since `spawn.ts`'s
 * `readCursorLine` was written, chained onto the SAME `display-message` this
 * file's own caller now sends. `seedWithCursor` reuses that exact parse
 * (never a second one) and turns its answer into the one thing a plain text
 * dump cannot carry on its own: an explicit `CSI row;col H` (1-based, tmux's
 * `cursor_x`/`cursor_y` are 0-based) placing xterm's cursor on the identical
 * cell, plus `CSI ?25h`/`CSI ?25l` so a program that turned the cursor off
 * (`cursor_flag`) reads that way in xterm too, never re-shown by accident.
 *
 * ── THE SECOND, COMPOUNDING BUG, found chasing the first ──────────────────
 * `client.ts`'s own block-body reconstruction (`${line}\n`, joined) puts a
 * trailing `\n` after EVERY captured line, including the LAST one -- so a
 * full `#{pane_height}`-line capture carries exactly `pane_height` newlines.
 * MEASURED against a real `@xterm/xterm` `Terminal`: writing that many
 * `\r\n`-terminated lines (`TerminalStreamTab.tsx`'s own `asXtermSeed`
 * converts every bare `\n`) into a terminal of the SAME row count SCROLLS IT
 * BY ONE the instant the final `\r\n` lands with the cursor already on the
 * bottom row -- the pane's own TOP row silently drops into scrollback before
 * any cursor placement below even runs, which would then misplace even a
 * CORRECTLY computed `cursor_y` by one row all over again (the whole screen
 * shifted up underneath it). `seedWithCursor` drops exactly that one
 * trailing newline -- never more -- before anything else, so
 * `#{pane_height}` lines fill `#{pane_height}` rows with zero rows to
 * spare and nothing left over to scroll on.
 *
 * ── WHY `-N`, NOT THIS FILE'S OLD `-J` (`client.ts`'s own capture-pane flag) ──
 * `-J` joins wrapped rows AND (its own implied `-T`) trims trailing blank
 * rows, both of which change the CAPTURED LINE COUNT away from
 * `#{pane_height}` -- MEASURED, a real 98x24 tmux fixture: `-J` returned 23
 * lines, `-N` (preserves trailing spaces, never joins or trims) returned the
 * full 24. `cursor_y` is an index into EXACTLY `pane_height` rows
 * (`argv.ts`'s own `CURSOR_FORMAT` doc), so a capture that returns fewer
 * rows than that already points `cursor_y` at the wrong line before this
 * file is ever reached -- `-N` is what `client.ts`'s own `#reseed` now asks
 * for instead.
 *
 * ── THE THIRD BUG, A HIDDEN CURSOR SEEDED WITHOUT ITS POSITION (review
 * finding) ──────────────────────────────────────────────────────────────
 * The `hidden` branch below used to emit `HIDE_CURSOR` alone, with no CUP
 * at all -- because `readCursorLine` itself discarded `cursor_x`/`cursor_y`
 * the moment `cursor_flag` read 0 (`spawn.ts`'s own history). Claude Code's
 * UI hides the real cursor and draws its own box-drawn one, redrawn
 * RELATIVELY against wherever xterm's cursor already sits -- so a reseed
 * that left it wherever the text happened to end (exactly THE FIRST bug
 * above, just for the hidden case) put every later relative redraw on the
 * wrong row. tmux keeps tracking the real cell the whole time the cursor is
 * hidden (MEASURED, a real tmux 3.7b on a private `-L` socket: hiding the
 * cursor, then moving it with a CUP, both changed `#{cursor_x}`/
 * `#{cursor_y}` on the very next `display-message`), so `spawn.ts`'s
 * `PaneMark.position` now carries it regardless of `cursor_flag`, and this
 * file places it -- THEN hides it, DECTCEM's own documented order (a
 * program is free to move the cursor while it is invisible; showing it
 * again later should not also relocate it).
 *
 * ── THE FOURTH BUG, BRACKETED PASTE NEVER SEEDED (review finding) ────────
 * `TerminalStreamTab.tsx`'s own paste listener wraps a paste in `CSI
 * 200~`/`201~` only when xterm's `modes.bracketedPasteMode` is already
 * true -- which xterm sets ONLY by parsing `CSI ?2004h` out of data this
 * component actually wrote to it. A program requests that mode ONCE, at
 * its own startup; ATTACHING to an already-running session (this client's
 * whole reason for being, `client.ts`'s own header) never sees that
 * request, so a paste into an already-running `claude` submitted one line
 * at a time -- multi-line text with no bracketing at all. `#{bracket_paste_
 * flag}` (`argv.ts`'s own `CURSOR_FORMAT`) is tmux's own per-pane record of
 * the identical fact, read here and re-emitted as the SAME `CSI ?2004h` the
 * program's own startup would have sent had this client been attached from
 * the beginning -- so xterm's mode is primed the instant the seed lands,
 * with no new IPC round trip and no client-side guessing. Only ever turns
 * IT ON: xterm's own `term.reset()` (`TerminalStreamTab.tsx`, before every
 * later seed) already puts the mode back to its own default (off), so
 * there is nothing to explicitly turn off here.
 */

import { readCursorLine } from '../../sources/tmux/spawn.js';

/** `CSI ?25h`/`CSI ?25l` -- DECTCEM, show/hide the text cursor. */
const SHOW_CURSOR = '\x1b[?25h';
const HIDE_CURSOR = '\x1b[?25l';

/** `CSI ?2004h` -- DECSET 2004, the SAME sequence a program's own startup
 * sends to ask a terminal for bracketed paste. Only ever emitted, never its
 * `l` counterpart -- see this file's own header. */
const ENABLE_BRACKETED_PASTE = '\x1b[?2004h';

/**
 * `screenBody` is `capture-pane -p -e -N`'s own raw block body (bare `\n`
 * between lines, one trailing `\n` after the last -- `client.ts`'s own
 * `${line}\n` join). `cursorLine` is the paired `display-message -F
 * CURSOR_FORMAT` reply's raw block body -- only its FIRST line is read
 * (defensive: a `display-message` answers exactly one line, but nothing
 * here assumes a caller never hands it more).
 *
 * Returns `screenBody` with its one trailing newline dropped and, when the
 * cursor reply parses to a real cell, an absolute-position CSI plus a
 * show/hide CSI appended -- ready for `TerminalStreamTab.tsx`'s own
 * `asXtermSeed()` (bare `\n` -> `\r\n`) and `term.write()`, in that order.
 * `readCursorLine`'s `unreadable` case (an old tmux, a dead target, a
 * malformed reply) appends nothing beyond the newline drop -- exactly
 * today's shape, the same "never draw a position vam did not really read"
 * rule `PaneCursor`'s own header states for the polling path.
 *
 * BRACKETED PASTE RIDES ALONG, unconditionally appended after whichever
 * cursor branch below runs (module header, "THE FOURTH BUG"): it is
 * orthogonal to where -- or whether -- a caret gets drawn, so it never
 * changes which of the branches below fires.
 */
export function seedWithCursor(screenBody: string, cursorLine: string): string {
  const withoutTrailingNewline = screenBody.endsWith('\n') ? screenBody.slice(0, -1) : screenBody;
  const firstLine = cursorLine.split('\n', 1)[0] ?? '';
  const mark = readCursorLine(firstLine);
  const bracketedPaste = mark.bracketPaste === true ? ENABLE_BRACKETED_PASTE : '';
  if (mark.cursor.kind === 'hidden') {
    // KEEP THE COORDINATES (module header, "THE THIRD BUG"): `position` is
    // read independently of `cursor_flag` now, so a hidden cursor still
    // places xterm's own cursor on the real cell -- THEN hides it, never
    // the reverse (DECTCEM's own order: moving while invisible must not
    // itself become visible, and showing later must not also relocate).
    const cup =
      mark.position === null ? '' : `\x1b[${mark.position.row + 1};${mark.position.column + 1}H`;
    return `${withoutTrailingNewline}${cup}${HIDE_CURSOR}${bracketedPaste}`;
  }
  if (mark.cursor.kind !== 'at') return `${withoutTrailingNewline}${bracketedPaste}`;
  const row = mark.cursor.row + 1;
  const column = mark.cursor.column + 1;
  return `${withoutTrailingNewline}\x1b[${row};${column}H${SHOW_CURSOR}${bracketedPaste}`;
}
