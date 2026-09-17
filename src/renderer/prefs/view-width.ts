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
 * MEASURED, both of them, and NEITHER IS A CONSTANT IN THIS FILE. That is the
 * correction this module's first cut earned: the prose maximum shipped as
 * 480px, which was `80 × 6.0079px` measured on one macOS machine, and CI
 * caught it on the very first Linux run — the same font stack resolves there to
 * a face whose advance is 5.7180px, so the "eighty characters" the guard
 * measured came out at 83.95. AN ADVANCE IS A PROPERTY OF THE FACE THE APP
 * ACTUALLY PAINTS IN, and that is decided on the operator's machine. So it is
 * measured there, at run time, off a ruler — the shape `terminal-size.ts` has
 * always had, and for exactly the reason its header gives.
 *
 * The two answers still differ: on this macOS machine 471px of prose against
 * 509–704px of terminal screen. That gap is the evidence for the paragraph
 * above — a single shared pixel maximum would have been right for at most one
 * of the two.
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
 * THE PROSE RULER'S TEXT — what one character of the pane's prose is measured
 * on.
 *
 * WHY A RULER AT ALL. This started as a constant, `6.0079`, measured once on a
 * macOS machine. The first Linux CI run read 83.95 characters across the column
 * that arithmetic produced: the same stack (`Geist, -apple-system, system-ui,
 * 'Segoe UI', sans-serif` — Geist is NAMED BUT NOT SHIPPED, so what paints is
 * whatever the platform has) resolves to a face measuring 5.7180px there
 * against 6.0079px here. A frozen advance is a claim about somebody else's
 * machine. So the advance is measured where it is true, off an element rendered
 * in the real face at the real size, exactly as `terminal-size.ts` measures its
 * own — "a MEASUREMENT and not a RATIO".
 *
 * AND IT IS MEASURED AT THE SIZE, not scaled from one. Hinting makes the
 * advance markedly non-proportional to the size: measured on this face,
 * 4.7089px at 10px, 5.8930 at 13 and 8.4402 at 20 — ratios of 0.471, 0.453 and
 * 0.422, an 11% spread. A cap computed by scaling one measurement would be out
 * by that much at the ends of the `out` stepper.
 *
 * `ch` IS THE WRONG UNIT FOR PROSE, which is why this exists and the Terminal's
 * cap does not need it. `ch` is the advance of `0`, which in this face measures
 * 8.125px at 13px — 35% wider than a character of English. `80ch` of prose is
 * 108 characters. In a MONOSPACE face `ch` IS the cell, so the Terminal can and
 * does use it; here it would be a proxy, and a bad one.
 *
 * WHAT THE STRING IS, AND WHY IT IS ORDINARY. Lowercase English with ordinary
 * punctuation, and deliberately no capitals, digits or identifiers. Agent
 * answers carry all three, and they run WIDER: measured against the demo
 * transcript's own answers (822 characters, 11 single-line runs) this sample is
 * 5.8930px where the answers average 6.0079 — 1.9% narrower. That direction is
 * the safe one and it is the reason for the choice rather than an accident: a
 * ruler NARROWER than the prose it protects yields a column of at most eighty
 * of that prose's characters (78.4 here), and a wider one would silently
 * promise eighty and deliver eighty-one. The ratio being relied on is between
 * two TEXTS, not two faces, so it carries across platforms — and
 * `e2e/view-width-shots.mjs` re-measures the real answer prose on whatever
 * platform CI runs, which is the check that caught the frozen constant.
 *
 * LONG ON PURPOSE. A browser rounds a rectangle; over ~300 characters that
 * rounding is a thousandth of the advance, which is the same argument
 * `RULER_TEXT` in `TerminalTab.tsx` makes for using ten characters instead of
 * one.
 */
export const PROSE_RULER_TEXT =
  'the plan is open, so the agent reads the diff it was given, writes the test it needs, runs it once, and says what it found before it changes a line of anyone else running work. it asks again only when the answer it has is older than the question, and it never guesses at a number it could measure.';

/**
 * The class that gives the ruler its size — the SMALLER of the two prose steps
 * a response pane draws.
 *
 * THE DECLARATION IS IN `styles.css`, under this same name, and its own comment
 * carries why: it is a fixed expression rather than a value anything here
 * computes, and `min()` in a `font-size` does not survive every CSSOM this repo
 * tests against. What is exported is the NAME, so the panel that wears it and
 * the test that scans for the rule cannot drift apart.
 *
 * TWO SIZES LIVE IN A RESPONSE PANE and the capped column is shared by both, so
 * the cap has to hold for the narrower character or it is not a maximum: `out`
 * is the operator's stepper over 10..20 and everything else — PR titles, agent
 * turns, the question card, the draft being typed — is the type scale's body
 * step. At `out` 10 the answers are the long lines and the ruler follows them
 * down; at `out` 20 the answers are short and the body step is what the eighty
 * has to be counted in.
 */
export const PROSE_RULER_CLASS = 'vam-prose-ruler';

/**
 * The `max-width` a prose surface is given, from a measured advance — or
 * `undefined`, which means "not measured yet, so do not cap".
 *
 * `undefined` IS THE IMPORTANT RETURN, and it is `fitPane`'s rule in this
 * file's own terms: a ruler that has not been laid out reports a zero box, and
 * a zero advance would produce a 28px column. Answering "no cap" leaves the
 * pane exactly as it ships, for the one frame before the ruler is measured.
 *
 * FLOORED AND NOT ROUNDED, which is not a detail. With the old constant,
 * 80 × 6.0079 = 480.63 rounded UP to 481 and Chromium measured 80.06 characters
 * on the line — a maximum that breaks its own promise in the last place, found
 * by the guard. A cap rounds DOWN or it is not a cap.
 *
 * THE `1.75rem` IS THE SURFACE'S OWN `px-3.5`, added rather than ignored
 * because `max-width` resolves against the BORDER box (Tailwind sets
 * `box-sizing: border-box` on everything): without it the cap would be 28px of
 * padding plus 443px of text, and the promise would quietly be 75 characters.
 * It is the one term here that mirrors a utility class in `DetailPanel.tsx`
 * rather than coming from a measurement — so the guard that holds this setting
 * honest counts CHARACTERS ON A RENDERED LINE and not this expression, and a
 * change to that padding reddens there.
 */
export function narrowProseMaxWidth(advance: number | null): string | undefined {
  if (advance === null || !Number.isFinite(advance) || advance <= 0) return undefined;
  return `calc(${Math.floor(NARROW_MAX_CHARACTERS * advance)}px + 1.75rem)`;
}

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
 * the reason `narrowProseMaxWidth` adds its padding: the cap is a border
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
