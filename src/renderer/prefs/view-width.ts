/**
 * HOW WIDE A VIEW IS ALLOWED TO BE — and why one flag covers four of them.
 *
 * The operator's ask, translated: "a setting for whether the width of the
 * Response view, Terminal, PRs and Agents is full-pane or narrowed". Those
 * four views fill their pane today, and on a wide monitor a line of the
 * agent's answer runs past a hundred characters, which is a length the eye
 * loses its place returning from.
 *
 * ── THE RULE, AND THE TWO IT REPLACED ────────────────────────────────────
 * TWO THIRDS OF THE PANE, WHILE TWO THIRDS OF THE PANE IS AT LEAST EIGHTY
 * CHARACTERS; OTHERWISE THE WHOLE PANE. One sentence, and every clause of it
 * is the operator's.
 *
 * This shipped first as "no more than eighty characters on a line" — WCAG 2.2
 * SC 1.4.8, "Width is no more than 80 characters or glyphs", which is a number
 * rather than a taste, and which is also what a terminal has been read at since
 * the VT100. The operator used the build and asked for it back: "narrow width
 * cần lớn hơn, khoảng 2/3 pane width" — the narrowed width needs to be bigger,
 * around two thirds of the pane.
 *
 * SO THE CITATION NO LONGER JUSTIFIES THE CAP, and this file will not pretend
 * otherwise. Two thirds of the 1335px pane is 890px, which is about 148
 * characters of answer prose — comfortably PAST 1.4.8's eighty, and past the
 * 45–75 every typographic source gives. What the setting still does is halve
 * the 217 characters an uncapped 1600px window draws. That is the operator's
 * call to make about their own screen, it is what they asked for twice as
 * plainly as anything in this repo, and the honest thing is to implement it and
 * say what it costs rather than to keep a standard they did not ask for.
 *
 * THE EIGHTY SURVIVED THAT AS THE FLOOR — `max(two thirds, eighty characters)`:
 * the fraction while the pane is wide, the reading column while it is not, and
 * on anything narrower than that column no cap at all, because a bare
 * percentage would have taken the 390px phone down to 260px and vam's narrowest
 * legal pane down to 213px. Then the operator split a pane, and met the middle
 * clause of that rule as a defect. Translated: "with the narrowed view, the
 * split should be computed against the min width, so the narrow width does
 * not get too small when panes are split — once a certain size is reached,
 * the split pane goes full width." What they were looking at: a two-pane split
 * on their screen gives each pane about 700px, two thirds of that is under
 * eighty characters, so the floor won and pinned a ~508px column in the
 * middle of a ~700px pane with ~96px of margin either side — narrower than the
 * pane could comfortably give, for no reading benefit, because at 700px there
 * is no long line to shorten. Below one floor the column already filled the
 * pane (a `max-width` wider than its container changes nothing), so the defect
 * was exactly the band between one floor and one and a half: the floor
 * BINDING, with the margins shrinking around it as the pane shrank.
 *
 * SO THE EIGHTY IS NOW A THRESHOLD AND NOT A COLUMN. Narrowing applies while
 * two thirds of the pane is at least the floor — a pane of at least one and a
 * half floors — and below that the cap lets go entirely. A narrowed column is
 * therefore always one of two things, exactly two thirds of its pane or the
 * whole of it, and the state where it is "the floor, centred" no longer
 * exists. What the eighty decides is WHERE the fraction stops applying, which
 * is the boundary the floor was always describing: between a pane wide enough
 * for two thirds to be about line length and one where two thirds is just a
 * smaller rectangle. The floor's own definition — eighty characters of the
 * measured advance, at the pane's smallest reading step — is unchanged, and so
 * is the coupling to the reading size: step `out` up and the threshold moves
 * out with it, because a bigger character needs a wider pane before two
 * thirds of it holds eighty.
 *
 * MEASURED, BOTH HALVES OF THE FLOOR, AND NEITHER IS A CONSTANT IN THIS FILE.
 * That is the correction the first cut earned: the prose maximum shipped as
 * 480px, which was `80 × 6.0079px` measured on one macOS machine, and CI caught
 * it on the very first Linux run — the same font stack resolves there to a face
 * whose advance is 5.7180px, so the "eighty characters" the guard measured came
 * out at 83.95. AN ADVANCE IS A PROPERTY OF THE FACE THE APP ACTUALLY PAINTS
 * IN, and that is decided on the operator's machine. So it is measured there,
 * at run time, off a ruler — the shape `terminal-size.ts` has always had, and
 * for exactly the reason its header gives. THAT IS WHY THE RULER SURVIVED THE
 * rule change: a fraction of a pane needs no character measurement, but the
 * floor under it does, and the floor is the half that keeps the phone whole.
 *
 * ── WHY THE TERMINAL FOLLOWS THE SAME SENTENCE ───────────────────────────
 * It was worth asking whether it should, because eighty COLUMNS was the
 * strongest part of the old design: a terminal's width is not a reading width,
 * it is a composition width, and eighty is what every CLI that draws a box
 * assumes. The answer is that the sentence is unchanged for it — two thirds of
 * the pane, while that is at least eighty of ITS characters, which are cells.
 * The alternative was to leave it at eighty columns while the prose views went
 * to two thirds, and that inverts what the operator is looking at: at 12.5px
 * the narrowed terminal is 606px where the narrowed prose column would be 890,
 * so the one view they did not complain about would become the narrow one. The
 * eighty columns are not lost; they are the threshold, and the narrowest
 * terminal vam ever narrows TO is exactly eighty of them. A cell is wider than
 * a character of prose (7.5px against 6 at 12.5px), so the terminal's
 * threshold sits at a wider pane than the prose views' — which is the rule
 * applied to its own unit and not a second opinion about the width.
 *
 * ── WHY THE STEP IS CSS AND NOT AN OBSERVER ──────────────────────────────
 * The rule compares the pane against the floor, and it was tempting to do that
 * in `DetailPanel.tsx`, where a `ResizeObserver` already watches the ruler and
 * a second one on the pane could toggle a class. It is not done there because
 * the comparison is between quantities THIS FILE HAS ARGUED MUST STAY IN THE
 * BROWSER'S UNITS: the prose floor is measured pixels plus `1.75rem` of
 * padding, the terminal's is `80.5ch` plus `1.5rem` and a border, and a pane
 * is whatever a percentage resolves against. An observer would have to turn
 * every one of those into a number in JS — a `rem` into 16, a `ch` into "the
 * size times a monospace ratio", which is precisely the arithmetic
 * `terminal-size.ts` records being out by a column every seventeen — and then
 * write the answer back a frame after the pane moved. A `max-width` that
 * contains the comparison resolves in the same layout pass as the pane, on the
 * first frame, with no state, no listener and nothing to disconnect. The cost
 * is one expression that reads strangely, and `narrowMaxWidth` carries the
 * argument for its shape.
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
 * both narrower than the eighty-character floor, so at those widths the cap is
 * wider than the pane and changes no rectangle at all — which is the only
 * correct behaviour: a cap that became a floor would put a horizontal scrollbar
 * under the one surface that cannot afford one. NOTE THAT THE FRACTION ALONE
 * WOULD NOT HAVE THIS PROPERTY. A percentage always binds. The step is what
 * makes the sentence above true — and it makes it true over a wider band than
 * the floor did, because "wider than the pane" is now the cap's answer for
 * every pane under one and a half floors, not only for those under one.
 */

/**
 * Two thirds of the pane — the operator's own fraction, and the rule.
 *
 * WRITTEN AS A DIVISION rather than `66.6667%` so the number in the source is
 * the fraction they asked for rather than a rounding of it. `calc()` accepts a
 * percentage over a number, and the engine keeps the exact value.
 *
 * A PERCENTAGE RESOLVES AGAINST THE CONTAINING BLOCK, which for the three prose
 * views is the pane itself (the body carries the gutter) and for the Terminal
 * is the body's CONTENT box, inside that gutter — so the terminal column lands
 * two thirds of the gutter under the prose one: 871px against 890px at a
 * 1335px pane, 2.1% apart, 9px a side. That is a consequence of where each cap
 * has to live (the terminal's floor is in `ch` and only resolves on an element
 * carrying the mono face) and not a second opinion about the width;
 * `e2e/view-width-shots.mjs` measures each against its own containing block
 * and holds the two to within 3% of each other rather than pinning a fudge
 * factor between them.
 */
export const NARROW_PANE_FRACTION = 'calc(200% / 3)';

/**
 * The floor, in characters — eighty.
 *
 * NO LONGER THE PROMISE, AND NO LONGER A COLUMN EITHER. It was the promise,
 * then the column a mid-width pane got, and this file's header carries what
 * changed each time and who changed it. What it is now is the boundary between
 * a pane that is wide enough for two thirds to be about line length and one
 * where two thirds is just a smaller rectangle — and a comfortable reading
 * column is exactly where that boundary sits.
 *
 * STILL THE ONLY NUMBER — the prose floor is derived from it, the terminal's
 * `ch` floor is derived from it, and the tests derive theirs from those,
 * because two counts of eighty is how one of them comes to be seventy-two.
 */
export const NARROW_FLOOR_CHARACTERS = 80;

/**
 * How many floors wide a pane must be before it is narrowed — one and a half.
 *
 * DERIVED, NOT CHOSEN: it is the reciprocal of two thirds, which is to say the
 * one pane width at which two thirds of the pane IS the floor. Narrower than
 * that, the fraction would give a column under eighty characters, and the old
 * rule answered by pinning the column at eighty with the margins shrinking
 * around it; this rule answers by not narrowing at all. Written as `1.5` and
 * not `3 / 2` because, unlike the fraction it is the reciprocal of, one and a
 * half is exact in binary — there is no rounding for a division to avoid.
 */
export const NARROW_THRESHOLD_FLOORS = 1.5;

/**
 * The gain that turns a `max()` into a step.
 *
 * `max()` AND `min()` CANNOT MAKE A DISCONTINUITY, and a step is one: the
 * column has to go from "the whole pane" at a pane one layout unit under the
 * threshold to "two thirds" at the threshold, and every CSS math function is
 * continuous. What CAN be done is a ramp so steep it crosses inside a distance
 * layout cannot resolve. `(threshold − pane) × gain` is positive, and this
 * many times too wide to bind, while the pane is short of the threshold, and
 * negative — so the fraction wins the `max()` — once past it; in between it
 * ramps from the pane down to zero over a band `pane / gain` wide.
 *
 * ONE MILLION KEEPS THAT BAND UNDER A LAYOUT UNIT FOR ANY PANE AN OPERATOR
 * HAS. Chromium lays out in 1/64px (0.015625); at a 762px threshold the band
 * is 0.00076px, and even at 4000px — past a 4K monitor's whole width — it is
 * 0.004. MEASURED, in a real Chromium, sweeping the pane a 1/64px at a time
 * across three pixels either side of the threshold for five floors (four in
 * pixels, one in `ch`): no width resolved to anything but two thirds or the
 * whole pane. `e2e/view-width-shots.mjs` holds the same claim against the
 * shipped bundle — one pixel of window either side of the bisected threshold
 * at three `out` sizes and four terminal sizes, and every pane of a one-,
 * two- and three-way split. A gain of a thousand, the first cut, left a
 * quarter-pixel band and showed 617px and 539px columns in it — the old
 * defect, a hundredth of a pixel wide.
 *
 * WHY THE TERM IS ZERO AT THE THRESHOLD AND NOT THE FLOOR. The obvious shape
 * is `floor + (threshold − pane) × gain`, which lands on the floor exactly at
 * the tie. It was tried, and at the tie the engine gave 512px where the floor
 * was 508: its own subtraction of two equal lengths is out by about 4e-5px,
 * and the gain multiplies that into four pixels sitting on top of the floor.
 * A term that is ZERO at the tie has the same error, four pixels against a
 * five-hundred-pixel fraction, and the `max()` never sees it. At the tie the
 * two answers coincide anyway — two thirds of one and a half floors is the
 * floor — so which way the engine's rounding decides it is not a defect; which
 * way a whole band decided it was.
 */
export const NARROW_STEP_GAIN = 1_000_000;

/**
 * The cap, given a floor: two thirds of the pane while the pane is at least
 * `NARROW_THRESHOLD_FLOORS` of that floor, and wider than the pane — which is
 * to say no cap — below that.
 *
 * ONE FUNCTION FOR BOTH VIEWS' CAPS, so that there is one rule and not two
 * that happen to agree: the prose views pass a floor in measured pixels and
 * the Terminal one in `ch`, and the step around each is built here from the
 * same threshold and the same gain. `floor` is a complete CSS length —
 * `calc(480px + 1.75rem)`, `calc(80.5ch + 1.5rem + 2px)` — and is spent once,
 * inside the step; the nested `calc()` is legal CSS and keeps the floor a
 * recognisable token in the DOM a test can find.
 *
 * THE PERCENTAGES RESOLVE AGAINST THE CONTAINING BLOCK, both of them: the
 * `100%` the floor is compared against is the same box the `200% / 3` is a
 * fraction of, so "two thirds of the pane" and "the pane" are two thirds and
 * the whole of the same thing, whichever box that is for the element the cap
 * lands on (`NARROW_PANE_FRACTION`'s note on the terminal's gutter).
 */
export function narrowMaxWidth(floor: string): string {
  return `max(${NARROW_PANE_FRACTION}, calc((${floor} * ${NARROW_THRESHOLD_FLOORS} - 100%) * ${NARROW_STEP_GAIN}))`;
}

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
 * The `max-width` a prose surface is given — two thirds of the pane, while
 * that is at least eighty characters of the measured advance, and no cap
 * below that — or `undefined`, which means "not measured yet, so do not cap".
 *
 * `undefined` IS THE IMPORTANT RETURN, and it is `fitPane`'s rule in this
 * file's own terms: a ruler that has not been laid out reports a zero box, and
 * a zero advance would put the threshold at 42px and narrow every pane there
 * is. IT RETURNS NOTHING RATHER THAN THE BARE FRACTION, which is the one thing
 * worth pausing on here: the fraction needs no measurement and could be
 * applied on the first frame, but the fraction WITHOUT its threshold is not the
 * rule — it is the rule's wrong half, the one that narrows a phone to 260px.
 * Half a rule for one frame is a flicker in the shape of a bug, so the cap
 * waits for the floor.
 *
 * FLOORED AND NOT ROUNDED, which is not a detail. With the old constant,
 * 80 × 6.0079 = 480.63 rounded UP to 481 and Chromium measured 80.06 characters
 * on the line — a maximum that breaks its own promise in the last place, found
 * by the guard. A cap rounds DOWN or it is not a cap. The floor is spent as a
 * threshold now rather than as a column, and the direction still matters the
 * same way: the narrowest column this ever produces is two thirds of a pane
 * that is exactly one and a half floors, which IS the floor, and it must hold
 * eighty. `prefs.view-width.test.ts` is where the direction is held.
 *
 * THE `1.75rem` IS THE SURFACE'S OWN `px-3.5`, added rather than ignored
 * because `max-width` resolves against the BORDER box (Tailwind sets
 * `box-sizing: border-box` on everything): without it the floor would be 28px
 * of padding plus 443px of text, and it would sit at 75 characters instead of
 * eighty. It is the one term here that mirrors a utility class in
 * `DetailPanel.tsx` rather than coming from a measurement — so the guard that
 * holds this setting honest measures RENDERED RECTANGLES and not this
 * expression, and a change to that padding reddens there.
 */
export function narrowProseMaxWidth(advance: number | null): string | undefined {
  if (advance === null || !Number.isFinite(advance) || advance <= 0) return undefined;
  return narrowMaxWidth(`calc(${Math.floor(NARROW_FLOOR_CHARACTERS * advance)}px + 1.75rem)`);
}

/**
 * The Terminal's floor — eighty COLUMNS, and the half cell and the chrome
 * that make the content box come out at exactly eighty.
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
 * pays for the rounding. It still earns its place now that the floor is a
 * threshold: the narrowest terminal vam ever narrows to is two thirds of a
 * pane exactly one and a half floors wide, which is this floor, and 79
 * columns there would be the same defect at a different pane.
 *
 * THE `1.5rem + 2px` IS THE PANE'S OWN `px-3` AND ITS 1px BORDER, added for
 * the reason `narrowProseMaxWidth` adds its padding: the cap is a border
 * box and the measurement subtracts the padding again, so the two terms cancel
 * exactly and the content box is eighty cells wide.
 */
export const NARROW_TERMINAL_FLOOR = `calc(${NARROW_FLOOR_CHARACTERS + 0.5}ch + 1.5rem + 2px)`;

/**
 * What the Terminal tab is given as its `max-width` — two thirds of its pane,
 * while that is at least eighty COLUMNS, and the whole pane below that.
 *
 * THE SAME SENTENCE THE PROSE VIEWS GET, built by the same function, in the
 * only unit a terminal has. The header argues why it did not stay at a flat
 * eighty columns; what matters at this line is that the floor is the eighty,
 * unchanged, and that the threshold it sets is measured off the face the
 * screen is really drawn in. `e2e/view-width-shots.mjs` reads the column
 * count vam actually sent tmux, at every offered size, rather than trusting
 * any of this.
 */
export const NARROW_TERMINAL_MAX_WIDTH = narrowMaxWidth(NARROW_TERMINAL_FLOOR);

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
