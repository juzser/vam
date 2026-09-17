/**
 * WHAT A SESSION TAB SHOWS BESIDE ITS TITLE -- and why a resting tab shows
 * nothing.
 *
 * The operator's ask, translated: "if a tab is idle (not running, not waiting
 * for you, ...) there is no need to show the dot on the tab. A tab should
 * only show certain indicators." Every tab used to wear a 6px dot coloured by
 * its status, idle included, and a strip of mostly-idle tabs was a row of
 * grey dots saying "nothing" eight times. The dot is gone. What a tab may
 * draw instead is a short list of INDICATORS, each one a switch in Settings,
 * and this module is the list, the defaults, and the total reader that stands
 * between the store and the strip.
 *
 * ── IDLE IS NOT ON THE LIST, AND CANNOT BE PUT THERE ──────────────────────
 * `idle` is a status the model has (`SessionStatus`) and is deliberately not
 * an indicator id. The operator's sentence is that a quiet tab needs no mark;
 * making that a toggle would offer them a switch whose "on" position is the
 * clutter they asked to be rid of. So a resting tab with no icon and no draft
 * is its title and nothing else, whatever the store holds -- the reader drops
 * the word if it ever arrives, and `TabIndicatorId` does not spell it.
 *
 * ── ONE STATUS MARK, AT MOST ──────────────────────────────────────────────
 * `running`, `waiting`, `failed` and `done` are the four status glyphs
 * `panels/status-mark.tsx` draws on the sidebar row, and a tab draws the same
 * glyph so the two surfaces say one thing. A session has one status, so at
 * most one of the four is ever drawn; the toggles decide which STATUSES earn
 * a mark, not how many marks a tab gets. `done` ships off: a finished session
 * is the commonest thing left open after a working day, and a tick on every
 * one of them is the grey dot again in a different shape.
 *
 * ── THE THREE THAT RIDE AFTER THE TITLE ───────────────────────────────────
 * `draft` (a pencil: unsent text in this session's composer) ships on,
 * because it is the one indicator that is about the OPERATOR's state rather
 * than the agent's -- "I was in the middle of saying something here" is the
 * thing a strip of tabs most easily loses. `pending` (a hollow dot: a prompt
 * typed into the pane and not yet recorded in the transcript) and `agents`
 * (`●N`, sub-agents running) ship off: both are already reported inside the
 * pane and on the sidebar row, and both are transient enough that a tab
 * flashing them reads as noise to anyone who did not ask for it.
 *
 * ── STORED AS A LIST OF IDS ───────────────────────────────────────────────
 * A JSON array of the ids that are ON, rather than a record of eight
 * booleans: a payload from a vam that had seven indicators reads back with
 * seven, one that had nine reads back with eight, and neither shape needs a
 * migration. The cost is that the list has to be normalised -- deduplicated,
 * unknown words dropped, and put in `TAB_INDICATOR_IDS` order -- which
 * `readTabIndicators` does on every read AND every write, so two payloads
 * that mean the same set are the same list.
 *
 * NOT A STORE WITH A SUBSCRIPTION, unlike `terminal-font.ts` beside it. That
 * shape exists for a value read by components mounted far from the prefs
 * (one `DetailPanel` per split leaf, and another in `PhoneShell`). The tab
 * strip is rendered by `CanvasInner`, the component that owns `prefs`, so
 * the list is a prop and there is nothing for a subscription to shortcut.
 */

/**
 * Every indicator a tab can draw, in the order the dialog lists them and the
 * order a stored list is normalised to. THE ONLY LIST: the type below, the
 * defaults, the settings rows and the tests all derive from it.
 *
 * The order is also the strip's reading order: the four status marks first
 * (a tab draws at most one), then the session's own icon, then the three that
 * follow the title.
 */
export const TAB_INDICATOR_IDS = [
  'running',
  'waiting',
  'failed',
  'done',
  'icon',
  'draft',
  'pending',
  'agents',
] as const;

export type TabIndicatorId = (typeof TAB_INDICATOR_IDS)[number];

/**
 * What ships on: the five the operator chose from the list they were offered.
 * `done`, `pending` and `agents` are the three they left off, and the header
 * says why each one stays available.
 */
export const DEFAULT_TAB_INDICATORS: readonly TabIndicatorId[] = [
  'running',
  'waiting',
  'failed',
  'icon',
  'draft',
];

const KNOWN: ReadonlySet<string> = new Set<string>(TAB_INDICATOR_IDS);

/**
 * A stored value, reduced to a list of ids this vam draws, in canonical order.
 *
 * TOTAL, AND IN TWO SAFE DIRECTIONS. A value that is not a list at all -- a
 * payload predating the field, a hand edit, a word -- answers the DEFAULTS,
 * because that is what the operator saw before they had a choice. A list
 * answers ITSELF, filtered: an unknown id is dropped alone rather than
 * costing the seven choices around it, and an EMPTY list stays empty, because
 * "every switch off" is a choice an operator can make and must not be undone
 * by the read that follows it.
 *
 * Never throws: `Array.isArray` is the only question asked of the value, and
 * every element is compared by identity against a set of strings.
 */
export function readTabIndicators(raw: unknown): readonly TabIndicatorId[] {
  if (!Array.isArray(raw)) return DEFAULT_TAB_INDICATORS;
  const present = new Set<string>();
  for (const entry of raw) {
    if (typeof entry === 'string' && KNOWN.has(entry)) present.add(entry);
  }
  // Walked in canonical order, so the answer is ordered whatever order the
  // payload was in -- and so a duplicate cannot survive, since each id is
  // asked about exactly once.
  return TAB_INDICATOR_IDS.filter((id) => present.has(id));
}

/** Is this indicator on? A membership test, named so the strip reads as the
 *  rule it applies rather than as `includes` on a list. */
export function isTabIndicatorOn(
  indicators: readonly TabIndicatorId[],
  id: TabIndicatorId,
): boolean {
  return indicators.includes(id);
}

/**
 * The list with one indicator turned on or off. Idempotent: throwing a switch
 * that is already thrown is the same list. Normalised through the reader on
 * the way out, so the result is in canonical order however it was built.
 */
export function withTabIndicator(
  indicators: readonly TabIndicatorId[],
  id: TabIndicatorId,
  on: boolean,
): readonly TabIndicatorId[] {
  const next = new Set(indicators);
  if (on) next.add(id);
  else next.delete(id);
  return readTabIndicators([...next]);
}
