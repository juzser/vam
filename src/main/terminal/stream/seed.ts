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
 */

import { readCursorLine } from '../../sources/tmux/spawn.js';

/** `CSI ?25h`/`CSI ?25l` -- DECTCEM, show/hide the text cursor. */
const SHOW_CURSOR = '\x1b[?25h';
const HIDE_CURSOR = '\x1b[?25l';

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
 */
export function seedWithCursor(screenBody: string, cursorLine: string): string {
  const withoutTrailingNewline = screenBody.endsWith('\n') ? screenBody.slice(0, -1) : screenBody;
  const firstLine = cursorLine.split('\n', 1)[0] ?? '';
  const mark = readCursorLine(firstLine);
  if (mark.cursor.kind === 'hidden') return `${withoutTrailingNewline}${HIDE_CURSOR}`;
  if (mark.cursor.kind !== 'at') return withoutTrailingNewline;
  const row = mark.cursor.row + 1;
  const column = mark.cursor.column + 1;
  return `${withoutTrailingNewline}\x1b[${row};${column}H${SHOW_CURSOR}`;
}
