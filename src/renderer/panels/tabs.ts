/**
 * The response pane's tab bar, as data.
 *
 * It lives in its own module because three places have to agree about it and
 * two of them are not the panel: the panel draws the bar, `Canvas` resolves
 * `Mod-<digit>` against it, and the key sheet may only caption a digit that
 * can open something. They disagreed -- the handler counted the constant while
 * the bar drew a filtered list, so with the Terminal tab withdrawn `Mod-3`
 * opened a tab that was not there and refused with "only 4 tabs" over a bar
 * showing three.
 *
 * A15.6 found the SAME family of bug wearing a different shape, shipped after
 * the fix above: `tabForDigit` indexed the DRAWN list positionally, so a
 * digit's meaning slid whenever a name ahead of it was withdrawn -- `Alt-3`
 * meant Agents the moment Terminal disappeared, and would have silently meant
 * Terminal again the moment it came back. A digit must name the SAME view
 * every time, so `tabForDigit` now reads `TABS` -- the one place a name's
 * position is fixed -- and asks `visibleTabs`' output only whether that name
 * is currently drawn.
 *
 * "Nothing indexes `visible` directly by digit any more" was written here
 * while `Canvas.tsx`'s `Mod-<digit>` still did, one route down from the
 * `Alt-<digit>` this fixed: the same source, the same withdrawn Terminal, and
 * two different views depending on which key the operator pressed. BOTH
 * routes resolve through `tabForDigit` now, and that is what makes the
 * sentence true. A third caller must go through it too -- an index into
 * `visibleTabs`' return value is the bug, not an implementation detail.
 */

/** Every tab the pane can hold, in bar order. */
export const TABS = ['Response', 'PRs', 'Terminal', 'Agents'] as const;

export type Tab = (typeof TABS)[number];

/**
 * The tabs actually drawn, given whether the source has a terminal to show.
 *
 * `Terminal` is withdrawn rather than mounted-and-apologising when the source
 * declares none, which moves every tab after it up a position IN THIS LIST.
 * That shift is exactly why `tabForDigit` must not index this list by digit
 * (A15.6): a caller counting positions here would have Agents answer to
 * Terminal's old digit the moment Terminal leaves, and its own again the
 * moment it returns. This list answers one question only -- which names are
 * currently on the bar -- and `tabForDigit` is the one place that turns a
 * digit into a name.
 */
export function visibleTabs(terminal: boolean): readonly Tab[] {
  return TABS.filter((name) => name !== 'Terminal' || terminal);
}

/**
 * `Alt+<digit>` turned into a view — the one and only way a keypress may pick
 * one, per the same rule `visibleTabs` states above.
 *
 * A5.4/A15.6: the digit names a FIXED SLOT IN `TABS`, never a position in
 * whatever `visible` happens to contain. `Alt-3` is Terminal because
 * Terminal is `TABS[2]` — always, whether or not this source has one — and
 * `visible` is consulted only to ask "is that name actually drawn right
 * now". Indexing `visible` directly by digit (the bug this module's header
 * and A15.6 both describe) makes every name after a withdrawn one slide up a
 * position, so `Alt-3` silently opens whatever slid into third place instead
 * of refusing. `undefined` — for a digit past `TABS`' own length, or for a
 * digit whose name exists but is not in `visible` — is the caller's cue to
 * refuse aloud rather than fall through to something the operator did not
 * ask for.
 */
export function tabForDigit(visible: readonly Tab[], digit: number): Tab | undefined {
  const name = TABS[digit - 1];
  return name !== undefined && visible.includes(name) ? name : undefined;
}
