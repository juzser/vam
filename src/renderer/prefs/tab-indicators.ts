/**
 * WHAT A SESSION TAB SHOWS BESIDE ITS TITLE -- and why a resting tab shows
 * nothing.
 *
 * The operator's ask, translated: "if a tab is idle (not running, not waiting
 * for you, ...) there is no need to show the dot on the tab. A tab should
 * only show certain indicators." Every tab used to wear a 6px dot coloured by
 * its status, idle included, and a strip of mostly-idle tabs was a row of
 * grey dots saying "nothing" eight times. The dot is gone. What a tab draws
 * instead is a short list of INDICATORS, and this module is that list.
 *
 * IT WAS A PREF WITH A SWITCH PER ID FOR ONE DAY. The operator, reading the
 * panel the switches had landed in: "there is no need for a session tab
 * indicator setting". So the pref, its reader, its two setters, its Settings
 * block and the tests for all of them are gone, and what the operator picked
 * is a constant. A stored `tabIndicators` from that day is simply
 * ignored -- `parsePrefs` no longer looks for the key, and an unknown key in
 * the stored document has always been dropped.
 *
 * ── IDLE IS NOT ON THE LIST, AND CANNOT BE PUT THERE ──────────────────────
 * `idle` is a status the model has (`SessionStatus`) and is deliberately not
 * an indicator id. The operator's sentence is that a quiet tab needs no mark,
 * and `TabIndicatorId` does not spell `idle`, so a resting tab with no draft
 * is its provider glyph and its title and nothing else -- there is now no
 * value anywhere, stored or typed, that could ask for one.
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
 * ── `icon` IS GONE ENTIRELY, NOT MERELY OFF ───────────────────────────────
 * The operator, once vam had a second source: "put the provider glyph after
 * the indicator, on the tab name. Remove the session icon from the tab." What
 * `icon` drew was a session-else-project chain, and down a strip of one
 * project's tabs that is the project's own mark repeated on every tab -- the
 * same "it says again what the heading already said" the operator used when
 * they took that glyph off the sidebar row.
 *
 * It sat here one more release as an id that was merely OFF, kept as the
 * documented way to switch it back on. That path is closed now: the tab was
 * the last surface that drew a session icon, so with it gone the picker wrote
 * into a store nobody read, and the operator's answer was "remove the picker".
 * There is no longer any way to SET a session icon, which makes an id for
 * drawing one an instruction to render a value that cannot exist. So the id
 * went with the feature, and this paragraph is its headstone rather than its
 * switch.
 *
 * The provider mark answers the one question a strip of tabs cannot otherwise
 * answer, which agent ran this, and it is NOT an indicator: it is a constant
 * property of the tab rather than a state that comes and goes, so it has no id
 * here, no switch to be off, and the strip draws it unconditionally.
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
 * (a tab draws at most one), then the three that follow the title. What the
 * strip reads TODAY is mark, provider glyph, title, draft: the provider is not
 * in this list and never will be, because it is not an indicator (the header
 * says why), and it stands in the slot the session's own icon used to have.
 */
export const TAB_INDICATOR_IDS = [
  'running',
  'waiting',
  'failed',
  'done',
  'draft',
  'pending',
  'agents',
] as const;

export type TabIndicatorId = (typeof TAB_INDICATOR_IDS)[number];

/**
 * WHAT A TAB DRAWS, AND IT IS NOT A SETTING.
 *
 * The operator chose from what the model can answer -- running, waiting,
 * failed and an unsent draft -- and then, reading the settings panel the
 * switches had appeared in: "there is no need for a session tab indicator
 * setting". So the list is a constant and the switches are gone. `done` is not
 * here on purpose: a finished turn with nothing pending is the resting state
 * of most tabs, and a mark on all of them is a mark that says nothing.
 * `pending` and `agents` are the two the operator did not pick.
 *
 * The session's own icon was once a fifth. It is not off, it is GONE -- both
 * from this list and from the union above, because the feature it drew was
 * removed outright (the header says why, and `Canvas.tsx` draws the provider
 * mark outside this list because a provider is not a state).
 *
 * THE THREE UNPICKED IDS STAY IN THE UNION, and that is not dead code: they
 * are what `tabStatusMark` and the strip are written against, so switching one
 * on is one entry in this list rather than a new branch. They are also what
 * the tests that cover "an indicator that is off draws nothing" are about --
 * `done` is the one they are about today, `icon` having been the one they used
 * before it was deleted (`test/canvas/Canvas.tab-indicators.test.tsx`).
 */
export const TAB_INDICATORS: readonly TabIndicatorId[] = ['running', 'waiting', 'failed', 'draft'];

/** Whether the tab strip draws `id`. */
export function isTabIndicatorOn(id: TabIndicatorId): boolean {
  return TAB_INDICATORS.includes(id);
}
