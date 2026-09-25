import { type MutableRefObject, useCallback, useRef, useState } from 'react';
import { TABS, type Tab } from './tabs.js';

/**
 * The subset of `DetailPanelProps` this hook reads. Kept narrow rather than
 * importing `DetailPanelProps` wholesale, since the hook has no use for the
 * rest of that shape and a wider dependency would be a false claim about
 * what this module actually touches.
 */
export type DetailPanelTabProps = {
  readonly tab?: string | null;
  readonly initialTab?: string | null;
  readonly onTabChange?: (tab: string) => void;
};

export type DetailPanelTab = {
  readonly tab: Tab;
  readonly pickTab: (next: Tab) => void;
  readonly pickTabRef: MutableRefObject<(next: Tab) => void>;
};

/**
 * Which view the pane is showing -- the caller's fact when it has one, this
 * component's own when it does not.
 *
 * IT USED TO BE LOCAL STATE THAT DELIBERATELY SURVIVED A SESSION SWITCH, on
 * the reasoning that "an operator who opened Agents is looking at agents,
 * not at whichever tab the last session left behind". The operator has
 * overruled it: a view is a per-session choice, and switching session 1 to
 * PRs must leave every other session where it was. The sentence above was
 * true of ONE session in ONE pane and became false the moment a pane could
 * show several -- `Canvas.tsx` claimed the isolation in a comment on
 * `renderLeaf` while `key={leaf.id}` remounted nothing.
 *
 * The validating stays HERE, for both routes, because this is where the bar
 * is: a name that is not on it (an older vam's tab, a hand-edited store) is
 * simply not a view, so it costs the default and nothing else.
 */
export function useDetailPanelTab(props: DetailPanelTabProps): DetailPanelTab {
  const [ownTab, setOwnTab] = useState<Tab>(() => {
    const remembered = props.initialTab;
    return TABS.find((name) => name === remembered) ?? 'Response';
  });
  const named = props.tab;
  const controlled = named !== undefined;
  const tab = controlled ? (TABS.find((name) => name === named) ?? 'Response') : ownTab;
  const onTabChange = props.onTabChange;
  /**
   * Report the operator's CHOICE, never `current`. `current` falls back to
   * Response while a source withdraws the Terminal tab, and reporting that
   * would let walking past a session without a terminal erase a choice the
   * operator never changed.
   *
   * FROM THE ACT, NOT FROM AN EFFECT, and that is what closes a loop rather
   * than opening one. This used to be `useEffect(() => onTabChange?.(tab))`
   * gated on `paneFocused`: `onTabChange` is a fresh closure every render, so
   * it fired on every render, and with two panes showing two different tabs
   * each write re-rendered the other pane, which wrote back, forever --
   * measured, a synchronous `savePrefs` loop that hung the shell. Calling it
   * only when a view is actually PICKED means there is no render-driven write
   * left to loop, so the `paneFocused` gate that was holding the loop shut is
   * no longer load-bearing and is gone with it. A background pane can now
   * report its own session's view, which is correct: it is still an act the
   * operator performed, in the pane they performed it in.
   */
  const pickTab = useCallback(
    (next: Tab) => {
      if (!controlled) setOwnTab(next);
      onTabChange?.(next);
    },
    [controlled, onTabChange],
  );
  const pickTabRef = useRef(pickTab);
  pickTabRef.current = pickTab;
  return { tab, pickTab, pickTabRef };
}
