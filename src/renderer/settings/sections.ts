/**
 * What the settings overlay is made of: its sections.
 *
 * One list, read by both the nav and the panels, so a section cannot exist in
 * one and not the other.
 *
 * 0.2 migration, A12.1: the layout-diagram machinery that used to live here
 * (`diagramColumns`, `canvasDots`, `WEIGHTS`, `DISPLAY_RANK`,
 * `LAYOUT_DESCRIPTION`, `LAYOUT_CHOICES`, `layoutOf`) went with its only
 * caller, `LayoutPicker.tsx` — the three named layouts it drew a picture of
 * were canvas presets, and the canvas is gone (epic.md decision 5). What
 * replaced it, a show/hide toggle per pane, is gone too at the operator's
 * request: with two panes and no canvas there was nothing worth hiding, and
 * the toggles were the only way to reach a state `z0` then had to rescue
 * people from. `PaneVisibility` went with them (`prefs/panes.ts`).
 */

import { Bot, Keyboard, type LucideIcon, Palette, Smartphone } from 'lucide-react';
import {
  type BindingGroup,
  type BindingRow,
  CURSOR_MODES,
  type CursorMode,
  MODE_TITLES,
} from '../keyboard/keysheet.js';

export type SectionId = 'appearance' | 'sessions' | 'remote' | 'keyboard';

/**
 * The order is hard-coded and never sorted: a nav that reorders under the
 * operator is a nav nobody learns. `appearance` is first because it is where
 * the overlay opens, which is also what keeps the theme assertions in
 * `Canvas.settings` reachable without navigating.
 */
export const SECTIONS: readonly {
  readonly id: SectionId;
  readonly label: string;
  readonly Icon: LucideIcon;
}[] = [
  { id: 'appearance', label: 'Appearance', Icon: Palette },
  // Before Keyboard rather than after it: Keyboard is the reference section
  // and the longest, and a list that ends in a reference reads as a list that
  // ended. Nothing else depends on the position.
  { id: 'sessions', label: 'Sessions', Icon: Bot },
  // Where a phone is paired. Beside Sessions rather than under it: what it
  // grants is the ability to drive those sessions from somewhere else, and it
  // stays before Keyboard for the reason above.
  { id: 'remote', label: 'Remote', Icon: Smartphone },
  { id: 'keyboard', label: 'Keyboard', Icon: Keyboard },
];

/**
 * The shortcut editor's own sections: the two cursor modes, then the groups.
 *
 * THE SPLIT IS THE OPERATOR'S POINT, and it is a point about interference.
 * `hjkl` chooses a session in Select and walks an open question's options in
 * Insert; `Mod+<digit>` picks a session in one and a tab in the other. The two
 * sets do not collide, and a single undifferentiated list says the opposite --
 * so each of those bindings appears in BOTH mode sections, wearing that mode's
 * own caption. Which bindings those are is never written down here: it is
 * `BindingRow.byMode`, the same field `buildKeySheet` splits the reference
 * sheet on, so the two surfaces cannot come to disagree about what depends on
 * the mode. (Re-deriving that list by hand is exactly what went stale three
 * times in this codebase.)
 *
 * A BINDING THAT MEANS ONE THING IN BOTH MODES IS LISTED ONCE, in the group it
 * always belonged to. `yy` copies in either mode; a row per mode would be the
 * same row twice, and a list padded with identical pairs buries the two rows
 * that really are different -- the opposite of what the split is for.
 *
 * The sections are a FLAT list on purpose. The mode is a level above the
 * groups in meaning, but rendering it as a level above them on screen would
 * need a third heading style over the two the refinement spec already fixed
 * (§4-5: a group heading over a rule, one column of rows). Two mode sections
 * at the front of the same list, in the same style, need no new style at all
 * -- and put the keys whose meaning is contested where they are read first.
 */
export type ShortcutSection = {
  /** A `CursorMode`, or the `ActionGroup` a group section came from. */
  readonly id: string;
  readonly title: string;
  /** A line under the heading, where a mode needs one; groups carry none. */
  readonly hint: string | null;
  readonly rows: readonly BindingRow[];
};

const MODE_HINTS: Readonly<Record<CursorMode, string>> = {
  select:
    'the keyboard is on the session list. The same keys as Insert, doing different work — that is why they never clash.',
  insert:
    'the keyboard is in the response pane. These keys are the ones above, meaning something else while you are here.',
};

export function shortcutSections(groups: readonly BindingGroup[]): readonly ShortcutSection[] {
  const rows = groups.flatMap((group) => group.rows);
  const modeSections = CURSOR_MODES.map((mode) => ({
    id: mode,
    title: MODE_TITLES[mode],
    hint: MODE_HINTS[mode],
    // The caption for THIS mode replaces the row's own, so the editor's line
    // says what the key does here rather than what it does somewhere.
    rows: rows
      .filter((row) => row.byMode !== null)
      .map((row) => ({ ...row, label: row.byMode?.[mode] ?? row.label })),
  }));
  const groupSections = groups.map((group) => ({
    id: group.group,
    title: group.title,
    hint: null,
    rows: group.rows.filter((row) => row.byMode === null),
  }));
  // An operator who unbinds a whole group leaves it with no rows, and a titled
  // empty section is a heading that advertises nothing -- the same rule
  // `buildKeySheet` keeps.
  return [...modeSections, ...groupSections].filter((section) => section.rows.length > 0);
}
