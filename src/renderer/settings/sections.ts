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
  Brain,
  ChartColumn,
  Keyboard,
  type LucideIcon,
  Palette,
  PanelLeft,
  Puzzle,
  RefreshCw,
  SlidersHorizontal,
  Smartphone,
  SquareTerminal,
} from 'lucide-react';
import {
  type BindingGroup,
  type BindingRow,
  CURSOR_MODES,
  type CursorMode,
  MODE_TITLES,
} from '../keyboard/keysheet.js';

export type SectionId =
  | 'interface'
  | 'stats'
  | 'terminal'
  | 'window'
  | 'agents'
  | 'skills'
  | 'behaviour'
  | 'notifications'
  | 'integrations'
  | 'remote'
  | 'keyboard'
  | 'update';

/**
 * Every section this build can ever offer, filtered to the ones a DESKTOP
 * bridge actually backs -- `id`s absent from this set need no membership
 * test elsewhere, because `visibleSections` (`SettingsOverlay.tsx`) is
 * built by filtering `SECTIONS` against this predicate, once, rather than
 * by a scattered `if (id === 'skills') …` at every call site that needs to
 * know.
 *
 * SKILLS IS THE ONE SECTION THIS GATES TODAY (operator, item D: "Desktop
 * only: hide it where window.api is absent"), and it is a STRONGER rule
 * than Integrations/Remote's own desktop-only reasoning right above
 * `PHONE_SECTIONS`: those two stay in the nav on a wide BROWSER build (no
 * bridge, but not phone-WIDTH either) and degrade their own content to a
 * "not available" sentence instead -- `GithubPanel.tsx`'s and
 * `RemotePanel.tsx`'s own `api === undefined` branches. Skills' entire
 * reason to exist is a `window.api.adhdSkill` write to this machine's own
 * disk; a browser tab showing an Install button that cannot install
 * anything is worse than one section fewer in the nav.
 */
export function isDesktopOnlySection(id: SectionId): boolean {
  return id === 'skills';
}

/**
 * WHAT A PHONE MAY SEE OF THIS OVERLAY, and why it is almost none of it.
 *
 * Operator instruction: "on mobile the settings part can be removed; remote
 * only needs to show the paired devices". The reason it is right is stronger
 * than the screen being small. Every section but Remote reads and writes
 * `prefs`, which is `localStorage` ON WHICHEVER DEVICE IS LOOKING -- so a
 * theme chosen on the phone changes the phone, not the machine the sessions
 * run on, and a shortcut edited there binds keys for a device with no
 * keyboard. Update reaches `window.api.update`, which the browser build does
 * not have at all. Controls that look like they configure vam configure a
 * copy of vam nobody is watching.
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
 * operator is a nav nobody learns.
 *
 * ── THE CARDS RESTRUCTURE (Orca's appearance settings, adapted) ───────────
 * Operator: "these are Orca's appearance settings; see what vam can do and
 * add it. Split into clear, separate sections." What used to be Appearance
 * (theme, templates, colours, both text sizes, and the terminal's own
 * scheme, all in one panel) is now three: INTERFACE keeps the app's own
 * paint (theme, templates, out text, with the per-token colour overrides
 * behind an Advanced disclosure -- the row most operators never touch).
 * TERMINAL takes everything that was about the terminal specifically (its
 * text size, its theme list, and -- behind its own Advanced disclosure --
 * its colour overrides, its background opacity, and the streaming-terminal
 * switch that used to live in Behaviour: all four are rows a terminal-first
 * operator reaches for and everyone else never opens). WINDOW & SIDEBAR is
 * new and, for now, holds only `view width` (moved from Behaviour, for the
 * same reason it moved out of Appearance before it -- a width is not paint,
 * it is the whole choice) -- it exists ahead of the sidebar-appearance and
 * status-bar rows a later PR adds, so those land in a section already named
 * for them rather than forcing a second reshuffle.
 *
 * SESSIONS BECOMES AGENTS, and gains the two rows that are about the AGENT
 * a session drives rather than about vam's own look: the ADHD skill (moved
 * from Behaviour -- it decides what the agent is told to write, not what vam
 * draws) and the cache timer, which was already here.
 *
 * BEHAVIOUR IS SMALLER, NOT GONE: focus view is still the one row about what
 * a turn shows on screen, and it gains the file editor's own two rows (moved
 * from Appearance) as a small "Files" sub-group -- whether a file is
 * coloured and how many spaces `Tab` writes into it are both about a FILE
 * `o` can open, which is closer kin to focus view's "what does vam draw"
 * than to Interface's own paint.
 *
 * Notifications, Integrations, Remote, Keyboard and Update are unchanged --
 * this restructure is the layout and the split, not a fourth pass over
 * sections that were never the ones the operator pointed at.
 */
export const SECTIONS: readonly {
  readonly id: SectionId;
  readonly label: string;
  readonly Icon: LucideIcon;
}[] = [
  // FIRST, because it is where the overlay has opened since before sections
  // existed, which is also what keeps the theme assertions in
  // `Canvas.settings` reachable without navigating anywhere or expanding
  // anything -- a card starts open by default for exactly this reason.
  { id: 'interface', label: 'Interface', Icon: Palette },
  // SECOND, ahead of every editable preference below it -- the settings-
  // views restructure (item B) folded the standalone Stats & Usage overlay
  // in here as a nav section rather than a second full-window surface.
  // PLACEMENT, ARGUED RATHER THAN GUESSED: the operator's own brief offered
  // "first or right after Interface" and asked for a pick. Not FIRST,
  // because Interface is where this overlay has opened since before
  // sections existed (see that section's own comment) and is what
  // `initialSection`'s fallback and every existing screenshot/guard assumes
  // lands on open with no navigation at all -- bumping it to second place
  // for a read-only report would move the one truly stable default. Right
  // AFTER it, rather than further down: the sidebar's own stats icon sits
  // beside the account icon at the very top of the app (`SessionList.tsx`),
  // opened often and on impulse, unlike the editable-preference cluster
  // (Terminal/Window/Agents/Behaviour) it would otherwise interrupt if
  // wedged between two of them. `ChartColumn`: the exact glyph that icon
  // already draws (`SessionList.tsx`'s `aria-label="stats"` button) -- the
  // nav entry and the icon that opens it cannot come to mean two shapes.
  { id: 'stats', label: 'Stats & Usage', Icon: ChartColumn },
  // RIGHT AFTER INTERFACE, the way Behaviour used to sit right after
  // Appearance: every row in it was in Appearance until this split, and the
  // two together still read as "how vam looks", split by WHICH surface the
  // paint is on. `SquareTerminal` over the bare `Terminal` glyph: this
  // section is about the terminal PANE, and the squared glyph is the one
  // `lucide-react` draws with a frame around the prompt, which is what a
  // pane is.
  { id: 'terminal', label: 'Terminal', Icon: SquareTerminal },
  // NEW, and placed beside the two panes it already governs one row of
  // (`view width` covers the Response view, Terminal, PRs and Agents at
  // once). `PanelLeft` draws a rectangle with a column down its left edge --
  // a window with a sidebar -- which is what the section is named for and
  // what the rows a later PR adds to it will still be about.
  { id: 'window', label: 'Window & Sidebar', Icon: PanelLeft },
  // RENAMED FROM SESSIONS. Its rows were always about the AGENT a session
  // drives -- which one starts, which key sends it a prompt, how long its
  // cache lives -- and the ADHD skill joining it from Behaviour is the same
  // family: what the agent is told to write, not what vam draws. `Bot` is
  // unchanged; it already named the right thing.
  { id: 'agents', label: 'Agents', Icon: Bot },
  // RIGHT AFTER AGENTS (operator, item D: "The skill setting should be
  // split out into its own section on the left"). `AdhdSkillCard` used to
  // be Agents' own last row; it gets a section of its own now rather than
  // staying a row, for the same reason the ORIGINAL restructure gave it a
  // row instead of a Behaviour switch -- it is big enough (its own status
  // pill, an install/reinstall/repair flow, per-agent coverage chips) to
  // read as a settled preference buried in a bigger card rather than as the
  // one thing this whole section is about. `Brain`: the identical icon
  // `AdhdSkillCard`'s own tile already draws -- the nav entry and the card
  // it opens cannot come to mean two shapes, `sections.ts`'s own rule for
  // Stats above. DESKTOP ONLY (`isDesktopOnlySection`): the card writes to
  // this machine's own `~/.claude/skills`/`~/.agents/skills`, which a
  // browser tab or a paired phone has no bridge to reach at all.
  { id: 'skills', label: 'Skills', Icon: Brain },
  // SMALLER THAN IT WAS, not retired: focus view is still the one row about
  // what a turn shows, and the file editor's pair joins it as a small
  // sub-group rather than as a section of one row each.
  { id: 'behaviour', label: 'Behaviour', Icon: SlidersHorizontal },
  // Operator: "add a setting for notifications in the desktop app. Include a
  // test-notification button too." Its switch was a Behaviour row (PR 440) and
  // moved here, not copied, when the button arrived: a row and a button that
  // exist to be found together are a section. `Bell` is what every OS draws
  // for the thing itself.
  { id: 'notifications', label: 'Notifications', Icon: Bell },
  // GITHUB: `gh` auth status, Connect/Disconnect, and which repo each
  // project reads pull requests from. Desktop-only, the same reasoning
  // `PHONE_SECTIONS`'s own note gives for Remote's neighbours: `gh` runs on
  // THIS machine with the operator's own credentials, and a phone has no
  // bridge to spawn it.
  { id: 'integrations', label: 'Integrations', Icon: Puzzle },
  // Where a phone is paired -- the one section a phone still draws.
  { id: 'remote', label: 'Remote', Icon: Smartphone },
  { id: 'keyboard', label: 'Keyboard', Icon: Keyboard },
  // LAST, and it is the one section whose position is an argument rather than
  // a shrug: it is opened rarely, on purpose, to read a version or ask a
  // question.
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
