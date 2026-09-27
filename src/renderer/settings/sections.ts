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

import {
  Bell,
  Bot,
  Keyboard,
  type LucideIcon,
  Palette,
  Puzzle,
  RefreshCw,
  SlidersHorizontal,
  Smartphone,
} from 'lucide-react';
import {
  type BindingGroup,
  type BindingRow,
  CURSOR_MODES,
  type CursorMode,
  MODE_TITLES,
} from '../keyboard/keysheet.js';

export type SectionId =
  | 'appearance'
  | 'behaviour'
  | 'notifications'
  | 'sessions'
  | 'integrations'
  | 'remote'
  | 'keyboard'
  | 'update';

/**
 * WHAT A PHONE MAY SEE OF THIS OVERLAY, and why it is almost none of it.
 *
 * Operator instruction: "on mobile the settings part can be removed; remote
 * only needs to show the paired devices". The reason it is right is stronger
 * than the screen being small. Appearance, Behaviour, Sessions and Keyboard
 * read and write `prefs`, which is `localStorage` ON WHICHEVER DEVICE IS
 * LOOKING -- so a theme chosen on the phone changes the phone, not the machine
 * the sessions run on, and a shortcut edited there binds keys for a device
 * with no keyboard. Update reaches `window.api.update`, which the browser
 * build does not have at all. Controls that look like they configure vam and
 * configure a copy of vam nobody is watching.
 *
 * BEHAVIOUR INHERITS THAT ARGUMENT UNCHANGED, and it is worth writing down
 * rather than leaving to be re-derived: its rows are `prefs`, so a phone that
 * folded a turn away or chose an indent width would be configuring the copy of
 * vam in its own browser. It is left out for the reason Appearance is, not by
 * default.
 *
 * NOTIFICATIONS IS OUT FOR A SECOND REASON ON TOP OF THAT ONE: its switch is
 * `prefs` like the rest, and its button raises a banner through the desktop's
 * main process, which a phone has no bridge to. A button drawn there would be
 * a button that does nothing.
 *
 * Remote is the one whose subject is the DESKTOP rather than the device
 * holding it, which is exactly what a phone has a reason to look at.
 *
 * A LIST RATHER THAN A BOOLEAN, so the next section added has to answer the
 * question "can this act from a phone?" by being put in or left out, instead
 * of inheriting an answer from whatever `id !== 'remote'` happened to mean.
 */
export const PHONE_SECTIONS: readonly SectionId[] = ['remote'];

/**
 * The order is hard-coded and never sorted: a nav that reorders under the
 * operator is a nav nobody learns. `appearance` is first because it is where
 * the overlay opens, which is also what keeps the theme assertions in
 * `Canvas.settings` reachable without navigating.
 *
 * ── WHERE THE LINE BETWEEN APPEARANCE AND BEHAVIOUR IS ────────────────────
 * Operator, translated: "can you separate the appearance and colour settings
 * from the feature settings?" Appearance had grown two unrelated kinds of row
 * and the comments in `SettingsOverlay.tsx` had to argue, once per row, that a
 * switch which folds half a turn away was "really" paint. Four such arguments
 * in a row is the shape of a section that is two sections.
 *
 * THE RULE THAT DECIDES A ROW, and it is one rule with no exceptions: NAME THE
 * THING THE OPERATOR IS CHOOSING, NOT THE MACHINERY IT MOVES. Appearance is
 * where COLOUR and TYPE live -- the theme, the templates, the swatches, the
 * two text sizes, the terminal's own scheme. Behaviour is where the rows whose
 * subject is what vam DOES live: what it draws of a turn, how far it lets a
 * line run, what Tab puts in a file, and what it asks the agent for.
 *
 * The rule is worth stating because two rows LOOK like counter-examples and
 * are not. `terminal text` changes how many columns tmux is told to compose
 * at -- but the operator is choosing a glyph size and the column count
 * follows, so it is type, and it stays. `file editor colours` also stops a
 * tokeniser running -- but the operator is choosing whether a file is
 * coloured, and its own name says so, so it is colour, and it stays. Against
 * them: `view width` IS a width (nothing else is being chosen), `file editor
 * indent` is bytes in the operator's own file, and `focus view` decides which
 * parts of a turn exist on screen at all.
 *
 * THE COST, NAMED: the file editor's two rows now sit in different panels.
 * That is the price of an Appearance panel that keeps every row called
 * "colours", which is the thing the operator actually asked for, and each row
 * points at the other in its own note.
 */
export const SECTIONS: readonly {
  readonly id: SectionId;
  readonly label: string;
  readonly Icon: LucideIcon;
}[] = [
  { id: 'appearance', label: 'Appearance', Icon: Palette },
  // IMMEDIATELY AFTER APPEARANCE, and that is an argument rather than a shrug.
  // Every row in it was in Appearance until this split, so an operator who
  // learned where focus view lives finds it one step from where it was -- and
  // the pair reads as the two halves of one question ("how does vam look" /
  // "what does vam do") rather than as a section filed between Sessions and
  // Remote. `SlidersHorizontal` over `ToggleLeft`: most of its rows are
  // switches today and one is a stepper, so a glyph that draws a switch would
  // be naming the controls it happens to hold rather than the section.
  { id: 'behaviour', label: 'Behaviour', Icon: SlidersHorizontal },
  // Operator: "add a setting for notifications in the desktop app. Include a
  // test-notification button too." Its switch was a Behaviour row (PR 440) and
  // moved here, not copied, when the button arrived: a row and a button that
  // exist to be found together are a section. AFTER BEHAVIOUR, because that
  // is where the switch was yesterday, and before Sessions for the same
  // reason Behaviour is before it. `Bell` is what every OS draws for the
  // thing itself.
  { id: 'notifications', label: 'Notifications', Icon: Bell },
  // Before Keyboard rather than after it: Keyboard is the reference section
  // and the longest, and a list that ends in a reference reads as a list that
  // ended. Nothing else depends on the position.
  { id: 'sessions', label: 'Sessions', Icon: Bot },
  // GITHUB: `gh` auth status, Connect/Disconnect, and which repo each
  // project reads pull requests from. Desktop-only, the same reasoning
  // `PHONE_SECTIONS`'s own note gives for Remote's neighbours: `gh` runs on
  // THIS machine with the operator's own credentials, and a phone has no
  // bridge to spawn it. After Sessions, which is the other place a project's
  // directory matters, and before Remote, which is about the DEVICE rather
  // than a project.
  { id: 'integrations', label: 'Integrations', Icon: Puzzle },
  // Where a phone is paired. Beside Sessions rather than under it: what it
  // grants is the ability to drive those sessions from somewhere else, and it
  // stays before Keyboard for the reason above.
  { id: 'remote', label: 'Remote', Icon: Smartphone },
  { id: 'keyboard', label: 'Keyboard', Icon: Keyboard },
  // LAST, and it is the one section whose position is an argument rather than
  // a shrug: it is opened rarely, on purpose, to read a version or ask a
  // question -- and the note above about not ending on a reference is about
  // the two rows a reader SKIMS past, not about a destination they came for.
  { id: 'update', label: 'Update', Icon: RefreshCw },
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

/**
 * WHAT EACH MODE IS, stated as the rule rather than as a description.
 *
 * The mode is not a setting and not a toggle: it is a report about where the
 * keyboard is (`keyboard/focus-scope.ts`). Saying so is the difference between
 * an operator who knows how to leave Insert and one hunting for the key that
 * switches it — and the hint that stood here claimed the two key sets "never
 * clash", which is precisely what an audit then found four leaks in.
 */
const MODE_HINTS: Readonly<Record<CursorMode, string>> = {
  select:
    'nothing in a response pane holds the keyboard. This is the resting mode, and any key that takes the keyboard back out of a pane returns to it.',
  insert:
    'something in a response pane holds the keyboard — an open question’s options, the prompt box, or a terminal. The mode is that fact rather than a switch: these keys are the ones above, meaning something else while you are there.',
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
