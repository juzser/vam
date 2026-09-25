/**
 * Preparing a real clipboard paste before it reaches a Terminal pane.
 *
 * Insert mode used to refuse paste outright -- `TerminalTab.tsx`'s hidden
 * textarea dropped `insertFromPaste` on the floor, and
 * `TerminalStreamTab.tsx` cancelled the browser's own `paste` event on
 * xterm's textarea, both silently. The operator asked for it back. Both
 * renderers now read the clipboard text straight off the `paste` event --
 * no permission is needed for that (`composer-paste.ts`'s own note: a paste
 * event is not a clipboard READ, it is handed over because the operator
 * pressed the keys) -- and pass it through this one function before it
 * becomes a `PaneKey` or a stream write, so the two renderers cannot drift
 * into two different ideas of what a paste sanitizes.
 *
 * FOUR STEPS, IN THIS ORDER:
 *
 * 1. TRUNCATE FIRST, at `MAX_PASTE_TEXT` code points (never inside a
 *    surrogate pair -- half of one has no UTF-8 encoding at all, the same
 *    hazard `terminal-compose.ts`'s `composedStrokes` guards). Every step
 *    after this one can only shrink the text further, so truncating first is
 *    both the cheaper order (nothing downstream ever processes more than the
 *    bound) and the one that keeps the FINAL length under it.
 *
 * 2. STRIP NUL. It is the one byte a C string and tmux's own buffer handling
 *    cannot carry, and it is the one byte the operator's ask singles out:
 *    "strip nothing the user intended except NUL". Every other C0 control --
 *    Tab, a raw Escape, Ctrl+C copied out of some log -- is left exactly as
 *    pasted, because a real terminal paste delivers those raw rather than
 *    guessing which ones were meant.
 *
 * 3. CRLF, AND A BARE LF, BOTH BECOME ONE CR -- the same transform xterm.js's
 *    own `prepareTextForTerminal` applies before it hands a paste to
 *    `onData`, and the same byte `sendEnterArgv` presses for Return. Without
 *    it a pasted CRLF would submit ONE line the operator's clipboard meant as
 *    one line ending; collapsing the pair to a single CR (never CR-then-CR)
 *    is what keeps a paste from being split into more submitted lines than a
 *    real terminal paste produces.
 *
 * 4. AN EMBEDDED BRACKETED-PASTE MARKER LOSES ITS ESC BYTE. Bracketed paste
 *    has no escaping of its own: the six literal bytes of the END sentinel
 *    (`\x1b[201~`) inside the CONTENT look identical, to whatever is
 *    watching for it, to the real one this module's callers or tmux's own
 *    `paste-buffer -p` append after it. A clipboard that happened to contain
 *    those bytes -- copied out of a terminal log, say -- could otherwise end
 *    the bracket early and have whatever followed read as if it had been
 *    typed, landing keystrokes a person never pressed. Dropping just the ESC
 *    turns it into inert text (`[201~`) and changes nothing else the
 *    operator pasted. The START marker (`\x1b[200~`) is treated the same way,
 *    for symmetry and because there is no cost to it: a stray literal start
 *    marker cannot itself execute anything, but it costs nothing to close the
 *    same door on both sentinels rather than one.
 */

import { MAX_PASTE_TEXT } from '../../shared/terminal.js';

/** Either bracket sentinel, with its ESC byte captured separately so the
 *  replacement below can drop exactly that one byte and keep the rest. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the literal ESC byte is the whole point -- it is the one byte of a forged bracket marker this pattern exists to find.
const BRACKET_MARKER = /\x1b(\[20[01]~)/g;

/**
 * `text.slice(0, limit)` WOULD BE WRONG THE ONE TIME IT MATTERS: `slice`
 * counts UTF-16 code UNITS, so a limit that lands between the two halves of a
 * surrogate pair keeps a lone surrogate -- not a character in any encoding,
 * and not one UTF-8 can carry. Iterating code points (what `for...of` does
 * over a string) and stopping before a point would overflow the limit is the
 * same guard `terminal-compose.ts`'s `composedStrokes` already carries.
 */
function truncateAtCodePoint(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let out = '';
  for (const point of text) {
    if (out.length + point.length > limit) break;
    out += point;
  }
  return out;
}

export function preparePastedText(raw: string, limit: number = MAX_PASTE_TEXT): string {
  const bounded = truncateAtCodePoint(raw, limit);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: NUL is the one byte this step exists to strip.
  const withoutNul = bounded.replace(/\u0000/g, '');
  // `\r\n` matched before a bare `\n` in the same alternation, so a CRLF pair
  // is consumed WHOLE and becomes one CR -- matched the other way around, the
  // `\n` branch would fire first and leave the CR that preceded it untouched,
  // producing CR-CR for every Windows-style line ending in the paste.
  const withCr = withoutNul.replace(/\r\n|\n/g, '\r');
  return withCr.replace(BRACKET_MARKER, '$1');
}
