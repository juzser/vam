/**
 * The response pane's tab bar, as data.
 *
 * It lives in its own module because three places have to agree about it and
 * two of them are not the panel: the panel draws the bar, `Canvas` resolves
 * `Mod-<digit>` against it, and the key sheet may only caption a digit that
 * can open something. They disagreed -- the handler counted the constant while
 * the bar drew a filtered list, so with the Terminal tab withdrawn `Mod-3`
 * opened a tab that was not there and refused with "only 4 tabs" over a bar
 * showing three. `visibleTabs` is the one derivation, and nothing indexes
 * `TABS` directly any more.
 */

/** Every tab the pane can hold, in bar order. */
export const TABS = ['Response', 'PRs', 'Terminal', 'Agents'] as const;

export type Tab = (typeof TABS)[number];

/**
 * The tabs actually drawn, given whether the source has a terminal to show.
 *
 * `Terminal` is withdrawn rather than mounted-and-apologising when the source
 * declares none, which moves every tab after it up a position. The digit has
 * to count the survivors: a handler with its own idea of how many tabs there
 * are is a fifth digit that opens nothing.
 */
export function visibleTabs(terminal: boolean): readonly Tab[] {
  return TABS.filter((name) => name !== 'Terminal' || terminal);
}
