/**
 * HOW WIDE A VIEW IS ALLOWED TO BE — and why one flag covers four of them.
 *
 * The operator's ask, translated: "a setting for whether the width of the
 * Response view, Terminal, PRs and Agents is full-pane or narrowed". Those
 * four views fill their pane today, and on a wide monitor a line of the
 * agent's answer runs past a hundred characters, which is a length the eye
 * loses its place returning from.
 *
 * ── WHY ONE SETTING AND NOT TWO ──────────────────────────────────────────
 * The Terminal is not prose and it was worth asking whether it belongs with
 * the other three. It does, because the thing the operator is asking for is
 * not a pixel width — it is a LINE LENGTH, and a line length is a count of
 * characters in all four views. WCAG 2.2 SC 1.4.8 puts a number on it that is
 * not a taste: "Width is no more than 80 characters or glyphs." Eighty is also
 * what a terminal has been read at since the VT100, and what every CLI that
 * draws a box still assumes. So ONE flag, ONE promise — no more than eighty
 * characters on a line — and the pixel answers differ per view only because a
 * proportional character and a terminal cell are not the same width.
 *
 * MEASURED, both of them, and the measurements are below. They come out 481px
 * and 529–704px (the terminal's varies with its own text size), which is the
 * evidence for the paragraph above: a single shared pixel maximum would have
 * been right for at most one of the two and wrong by a third for the other.
 *
 * ── WHY THE FILES TAB IS NOT IN IT ───────────────────────────────────────
 * The operator did not name it, and it is the one view that would be harmed:
 * its tree is already a CLAMPED SHARE of the pane (`filesTreeWidth`'s own
 * note), and its editor's gutter numbers lines against a text column whose
 * width is the operator's own drag. A second cap over that is a second
 * opinion about the same pixels.
 *
 * ── WHY A STORE AND NOT A CUSTOM PROPERTY ────────────────────────────────
 * `outFontSize` reaches the document as `--vam-out-font-size` because only
 * paint depends on it. THIS FLAG DECIDES HOW MANY COLUMNS TMUX IS TOLD TO
 * COMPOSE AT: narrowing the Terminal shrinks the box `terminal-size.ts`
 * divides by the measured advance, and the new column count is sent to a
 * running session. That has to reach React, which is a store with a snapshot
 * and a subscription — the shape `useSyncExternalStore` asks for and the shape
 * `progress.ts`, `submit-key.ts`, `editor.ts` and `terminal-font.ts` already
 * have here.
 *
 * ── A MAXIMUM, NEVER A FLOOR ─────────────────────────────────────────────
 * Every number here is spent as `max-width` and nothing else. vam's narrowest
 * legal pane is 320px (`DETAIL_MIN`) and the phone's whole screen is 390px,
 * both well under every maximum below, so at those widths the setting changes
 * no rectangle at all — which is the only correct behaviour: a cap that became
 * a floor would put a horizontal scrollbar under the one surface that cannot
 * afford one.
 */

/**
 * The line length the narrowed state promises, in characters.
 *
 * THE ONLY NUMBER — the prose maximum is derived from it below, the terminal's
 * `ch` maximum is derived from it below, and the tests derive theirs from
 * those, because two counts of eighty is how one of them comes to be
 * seventy-two.
 */
export const NARROW_MAX_CHARACTERS = 80;

/**
 * One character of the agent's answer, in pixels, at the size `out` ships at.
 *
 * A MEASUREMENT, NOT A RATIO, for the reason `terminal-size.ts` states about
 * its own advance: a font's average advance is a property of the face, the
 * size, the platform's hinting and the operator's zoom. Measured in Chromium
 * against the demo transcript's own answer prose — 822 characters over eleven
 * single-line runs, 4938.52px of ink, at the 13px `DEFAULT_OUT_FONT_SIZE` in
 * the face the app actually paints in (the stack's first bundled entry; Geist
 * is named but not shipped, so this is the system UI face). 6.0079px per
 * character; the run-to-run spread was 5.64–6.36.
 *
 * `ch` IS THE WRONG UNIT HERE and that is the reason this constant exists at
 * all. `ch` is the advance of `0`, which in this face measures 8.125px at
 * 13px — 35% wider than a character of English. `80ch` of prose would have
 * been 108 characters, which is the width being fixed. (The Terminal's cap IS
 * written in `ch`, and correctly: in a monospace face `ch` is the cell, so it
 * is the same measurement rather than a proxy for it.)
 *
 * AT THE DEFAULT SIZE, AND ONLY THERE — the one limitation of this number,
 * stated rather than discovered. `outFontSize` is a stepper over 10..20, and
 * this pixel maximum does not follow it, so an operator reading at 10px gets
 * about 104 characters in the same column and one at 20px about 52. Both are
 * still a large improvement on the 217 measured at 1600px full-pane, and the
 * alternative is worse than the defect: scaling the cap by
 * `--vam-out-font-size` would move the PRs and Agents views too, and neither
 * of them draws a character at that size — they are on vam's own type scale.
 * A cap that moved for a setting that does not touch their text is a stranger
 * thing than a cap that is exact at the default.
 */
export const PROSE_ADVANCE_PX = 6.0079;

/**
 * Eighty characters of answer text, in pixels: 480.
 *
 * Derived rather than chosen. The ONE thing to know when re-measuring: this is
 * the TEXT, not the box — the padding the box wears is added at the call site
 * by `NARROW_PROSE_MAX_WIDTH` below.
 *
 * FLOORED AND NOT ROUNDED, which is not a detail. 80 × 6.0079 is 480.63, and
 * rounding it up put 80.06 characters on the line — a maximum that breaks its
 * own promise in the last place. Measured in Chromium at 481px: the guard read
 * 80.4 characters and went red, which is how the rounding was found. A cap
 * rounds DOWN or it is not a cap.
 */
export const NARROW_PROSE_TEXT_PX = Math.floor(NARROW_MAX_CHARACTERS * PROSE_ADVANCE_PX);

/**
 * What a prose view's container is given as its `max-width`.
 *
 * THE `1.75rem` IS THAT CONTAINER'S OWN `px-3.5`, and it is added rather than
 * ignored because `max-width` resolves against the BORDER box (Tailwind sets
 * `box-sizing: border-box` on everything): without it the cap would be 28px of
 * padding plus 453px of text, and the promise would quietly be 75 characters.
 * It is the one number here that mirrors a utility class in
 * `DetailPanel.tsx` rather than deriving from a measurement — so the guard
 * that holds this setting honest counts CHARACTERS ON A RENDERED LINE
 * (`e2e/view-width-shots.mjs`) and not this expression, and a change to that
 * padding reddens there.
 */
export const NARROW_PROSE_MAX_WIDTH = `calc(${NARROW_PROSE_TEXT_PX}px + 1.75rem)`;

/**
 * What the Terminal tab is given as its `max-width` — eighty COLUMNS.
 *
 * `ch` IS THE BROWSER MEASURING FOR US, and that is the whole argument for
 * this expression. `terminal-size.ts` warns that a plausible-looking
 * width-to-height ratio "would have been out by a column every seventeen", so
 * a pixel maximum computed from `fontSize * 0.63` is exactly the mistake that
 * file already paid for. `ch` is the advance of `0` as the engine itself
 * measures it, and in a monospace face every glyph has that advance — so
 * `80ch` IS eighty columns, at 10.5px and at 14px alike, with nothing in this
 * repo doing the arithmetic. IT RESOLVES AGAINST THE ELEMENT'S OWN FONT, which
 * is why `TerminalTab.tsx` carries the pane's face and size on the element
 * this lands on even though every child re-declares both.
 *
 * THE HALF CELL IS ROUNDING SLACK, and it was measured rather than guessed:
 * `measurePane` divides `clientWidth`, which the engine rounds to an integer,
 * so an exact `80ch` lands a fraction of a pixel short at some sizes and
 * `Math.floor` charges a whole column for it — 79 at 10.5px. Half a cell can
 * never buy an eighty-first column (that would take a full one) and always
 * pays for the rounding.
 *
 * THE `1.5rem + 2px` IS THE PANE'S OWN `px-3` AND ITS 1px BORDER, added for
 * the reason `NARROW_PROSE_MAX_WIDTH` adds its padding: the cap is a border
 * box and the measurement subtracts the padding again, so the two terms cancel
 * exactly and the content box is eighty cells wide.
 * `e2e/view-width-shots.mjs` reads the column count vam actually sent tmux, at
 * every offered size, rather than trusting any of this.
 */
export const NARROW_TERMINAL_MAX_WIDTH = `calc(${NARROW_MAX_CHARACTERS + 0.5}ch + 1.5rem + 2px)`;

/**
 * Full pane, as it shipped.
 *
 * NOT ON BY DEFAULT, and this is the one default in this file with a cost
 * behind it. Narrowing the Terminal tells tmux a smaller width, and tmux
 * re-wraps the screen of a RUNNING agent. Defaulting to on would reflow every
 * operator's live sessions on the release they upgraded, for a choice none of
 * them made — the opposite of `DEFAULT_TERMINAL_FONT_SIZE`, which could move
 * everyone precisely because nobody had ever been able to choose it.
 */
export const DEFAULT_NARROW_VIEWS = false;

/**
 * Only a literal `true` narrows.
 *
 * The safe direction, and the same one `readEditorHighlight` argues for: a
 * value this vam cannot read must not re-shape four views — and resize
 * somebody's tmux session — on the strength of a choice nobody made.
 */
export function readNarrowViews(raw: unknown): boolean {
  return raw === true ? true : DEFAULT_NARROW_VIEWS;
}

/**
 * THE FLAG IN FORCE, module state rather than a prop, for the reason
 * `terminal-font.ts` gives at length: `Canvas.tsx` owns the prefs and mounts
 * one `DetailPanel` — hence one of each of these four views — per split leaf,
 * `PhoneShell` mounts another, and a pane opened by a keystroke has no
 * dialogue in which it could be asked.
 */
let active: boolean = DEFAULT_NARROW_VIEWS;
const listeners = new Set<() => void>();

/** The snapshot `useSyncExternalStore` compares by identity — a boolean, so it
 *  is stable by construction and no cache is needed. */
export function activeNarrowViews(): boolean {
  return active;
}

/**
 * Put the flag in force. Called by `activatePrefs`, which every read and every
 * write goes through.
 *
 * A CHANGE, NOT EVERY WRITE, and here that rule is load-bearing rather than an
 * optimisation, exactly as it is for the terminal's text size: every Terminal
 * tab that wakes re-measures its pane and may spawn a `tmux resize-window`, so
 * telling them all about a theme flip would resize the operator's sessions for
 * a setting nobody touched.
 */
export function setActiveNarrowViews(next: boolean): void {
  const narrow = readNarrowViews(next);
  if (narrow === active) return;
  active = narrow;
  for (const listener of listeners) listener();
}

/** Subscribe; the returned function unsubscribes. `useSyncExternalStore`'s
 *  contract, and the shape `subscribeTerminalFontSize` already has here. */
export function subscribeNarrowViews(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
