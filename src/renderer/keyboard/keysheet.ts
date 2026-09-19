/**
 * The shortcut sheet, generated from the chord tables.
 *
 * Written this way for one reason: a hand-written sheet can name a key that is
 * not bound, and this codebase shipped three captions of exactly that shape in
 * one week (`⇧Tab · cycle mode`, with nothing on Tab). `buildKeySheet` walks
 * `BINDING_TABLES` and looks each action up here, so a row can only exist
 * because a binding exists, and a binding with no label throws rather than
 * rendering a blank line nobody notices.
 *
 * Labels live beside the grouping rather than in `chords.ts` so the grammar
 * stays a pure reducer with no presentation in it, and beside each other
 * rather than scattered through the handler's switch so there is one place to
 * read what a key does.
 */

import { EDITOR_KEYS, TREE_KEYS } from '../panels/files-tree.js';
import { TABS } from '../panels/tabs.js';
import {
  activeBindings,
  applePlatform,
  bindingClashes,
  chordSymbols,
  chordText,
  effectiveBindings,
  isSelectOnlyChord,
  type KeyAction,
  type KeyBindings,
  parseChord,
} from './chords.js';

/**
 * Five groups, argued rather than assumed.
 *
 * The split is by WHAT THE KEY ACTS ON, because that is the question an
 * operator has when they open the sheet ("how do I get to…", "how do I do
 * something to this session…"), not by which table the binding lives in:
 *
 * - `navigation` — moves the reader and nothing else. Mostly that is the
 *   cursor: search is here too, because `/`, `n` and `N` end with the cursor
 *   somewhere new, which is what they are for. `Mod-d`/`Mod-u` are the one
 *   pair that moves the VIEWPORT instead — half a screen of transcript — and
 *   they are here rather than in `panes` because "how do I get back up what
 *   this session said" is the same question the group answers, asked inside
 *   one session instead of across the list.
 * - `session` — acts on the focused session (rename, close, open, prompt).
 * - `panes` — the frame around the work: which pane holds the keyboard, and
 *   how wide the side panes are.
 * - `review` — taking something out of a session, which today is `yy`. Kept
 *   distinct from `session` because copying reads and never changes anything.
 * - `view` — surfaces that overlay the whole app: palette, filter, settings,
 *   this sheet.
 */
/**
 * The two cursor modes, named by the operator: Select is what the sheet used
 * to call NORMAL, Insert is the resting state of the right pane.
 *
 * They exist HERE, in the sheet, and not only in the canvas, because the
 * operator's point about them is a point about the sheet: `hjkl` means one
 * thing in each mode and the two sets do not interfere, and a sheet that lists
 * that binding undifferentiated hides exactly that. `Mod+<digit>` was the
 * second family in this sentence until the fourth arrangement of the digit row
 * gave it one fixed meaning; `hjkl` is the last one left.
 * `Canvas.tsx` imports `CursorMode` from here so there is one spelling of the
 * fact rather than two.
 */
export type CursorMode = 'select' | 'insert';

export const CURSOR_MODES = ['select', 'insert'] as const;

export const MODE_TITLES: Readonly<Record<CursorMode, string>> = {
  select: 'Select',
  insert: 'Insert',
};

export type ActionGroup = 'navigation' | 'session' | 'panes' | 'review' | 'view';

export const GROUP_ORDER = ['navigation', 'session', 'panes', 'review', 'view'] as const;

const GROUP_TITLES: Readonly<Record<ActionGroup, string>> = {
  navigation: 'move around',
  session: 'this session',
  panes: 'panes & focus',
  review: 'take away',
  view: 'open something',
};

type Meta<K extends KeyAction['kind']> = {
  readonly group: ActionGroup;
  /** A function of the action, so `h` and `j` cannot share one vague caption. */
  readonly label: (action: Extract<KeyAction, { kind: K }>) => string;
  /**
   * For a family whose meaning DEPENDS on the cursor mode: one caption per
   * mode, and the sheet prints a row for each. `hjkl` is the only one left —
   * `Mod+<digit>` was the other until it was given one fixed meaning.
   *
   * Absent means mode-independent, which is most of the table — `yy` copies in
   * either mode and a row per mode would be the same row twice. So this is
   * opt-in, and the day another mode-dependent binding is added, adding it here
   * is the whole change.
   */
  readonly byMode?: (
    action: Extract<KeyAction, { kind: K }>,
  ) => Readonly<Record<CursorMode, string>>;
};

/**
 * The one table of labels, keyed by action kind. The mapped type makes the
 * compiler demand an entry for every kind in the union — the day a binding is
 * added, this file is where the build stops.
 */
export const ACTION_LABELS: { readonly [K in KeyAction['kind']]: Meta<K> } = {
  move: {
    group: 'navigation',
    label: (a) => `move ${a.direction}`,
    /**
     * `hjkl`, PER DIRECTION AND PER MODE — audit F1, which was entirely about
     * these eight captions.
     *
     * They used to be two sentences: "the session list" for all four Select
     * motions and "the options of an open question" for all four Insert ones.
     * Both were half right, and a caption that is half right about a motion
     * key is worse than none — it names a list the key does not walk.
     *
     *   Select: `j`/`k` DO walk the session list, one row at a time, stopping
     *   at the ends. `h`/`l` walk the ACTIVE PROJECT's tabs, which is a
     *   different list AND a different shape: a ring that wraps. The
     *   behaviour is what the operator asked for; only the caption was wrong.
     *
     *   Insert: `j`/`k` DO walk an open question's options. `h` is the way
     *   BACK to Select — the one thing it never does is choose an option —
     *   and `l` walks the STEPS of a multi-question call, refusing aloud when
     *   there is no call to walk.
     */
    byMode: (a) => ({
      select:
        a.direction === 'down'
          ? 'next session in the list — it stops at the end'
          : a.direction === 'up'
            ? 'previous session in the list — it stops at the start'
            : a.direction === 'right'
              ? 'next tab of this project — a ring, so it wraps'
              : 'previous tab of this project — a ring, so it wraps',
      insert:
        a.direction === 'down'
          ? 'next option of an open question'
          : a.direction === 'up'
            ? 'previous option of an open question'
            : a.direction === 'right'
              ? 'next step of a question with several — there is nothing else to step'
              : 'previous step of a question with several, else back to Select',
    }),
  },
  first: { group: 'navigation', label: () => 'first session' },
  last: { group: 'navigation', label: () => 'last session' },
  // NAMES THE LANDING, because this pair's whole defect was a caption that
  // promised a scope the handler did not keep: it said "project" and moved one
  // SESSION. It moves projects now (`stepProject` in `Canvas.tsx`), and the
  // second half of the sentence says which session of it you arrive on — the
  // top row, in either direction — so nobody has to press it to find out.
  //
  // AND THAT IS A KNOWN DIFFERENCE FROM VIM, stated in the caption rather
  // than left to be discovered. Vim's `gT` returns to the tab you were on,
  // cursor and all; vam has no per-project memory to restore, and inventing
  // one would be a second notion of "where you were" beside the focused
  // session. So a project's entry point is its top row whichever way you
  // arrive, `gt` then `gT` comes back to the project rather than the exact
  // session, and `j`/`k` are the keys that go back to a session.
  project: {
    group: 'navigation',
    label: (a) =>
      a.delta === 1 ? 'next project — its first session' : 'previous project — its first session',
  },
  // NAMES ROWS, NOT NODES — the graph `f` used to label was deleted in 0.2;
  // the labels land on sidebar rows now (`jumpLabels`, `Canvas.tsx`), and
  // `JUMP_KEYS` is twenty characters long, so a session past the twentieth
  // row gets no label at all. Said here rather than left for an operator to
  // discover by running out of letters.
  jump: { group: 'navigation', label: () => 'jump to a session — labels reach the first 20 rows' },
  // ONE CAPTION, AND NO `byMode` ANY MORE — which is most of what the fourth
  // arrangement of the digit row did to this file. The row carried two
  // captions because the key carried two meanings; it now means one thing with
  // the keyboard in either place, and a row printed twice saying the same
  // sentence is noise this sheet already refuses for `yy`.
  //
  // It names no COUNT, because there is no fixed one to name: a pane's strip
  // draws as many tabs as the project has sessions. That is also why nothing
  // here is capped by `TABS.length` the way the Insert half used to be —
  // `TABS` counts the four VIEWS, which live on `Ctrl-Alt-<digit>` and are
  // captioned by `pickView` just below.
  //
  // Still generated: the label is a function of the action's own digit, so the
  // sheet lists precisely the digits the table binds and no others.
  selectTab: {
    group: 'navigation',
    label: (a) =>
      a.digit === 9
        ? 'the LAST tab on screen, whatever the count'
        : `tab ${a.digit}, counted across every pane`,
  },
  // The same list, stepped. Named for the RING rather than as "next tab",
  // which would read as a synonym of `l` — and `l` is a different list: the
  // active project's tabs in Select, an open question's steps in Insert. This
  // one steps what is DRAWN, from wherever the keyboard is.
  stepTab: {
    group: 'navigation',
    label: (a) =>
      a.delta === 1
        ? 'next tab on screen — wraps at the end'
        : 'previous tab on screen — wraps at the start',
  },
  // The response pane's four views, and the one row family whose caption is
  // GENERATED FROM `TABS` rather than written out: the bar's contents have
  // changed twice in this epic, and a hand-written caption is how the sheet
  // came to promise a view that had been renamed.
  //
  // No `byMode`, and its neighbour on the command modifier has none either
  // now: both digit families name the same thing in either cursor mode, which
  // is what the fourth arrangement bought.
  //
  // THE MODIFIER IS NOT WRITTEN INTO ANY CAPTION HERE, and that is what let
  // this family move from `Alt-<digit>` to `Ctrl-Alt-<digit>` without a single
  // sentence going stale: the chord comes from the binding, the caption says
  // only what the key does. The two comments in this file that DID name the
  // old modifier were prose about the table, and they are corrected above and
  // below rather than left to be believed.
  //
  // Digits past the last view get the honest caption instead of a promise.
  // `Ctrl-Alt-5`..`Ctrl-Alt-9` are bound so the pane can refuse them ALOUD
  // rather than let them reach the browser, and a sheet that captioned them as
  // views would be naming four that do not exist.
  pickView: {
    group: 'panes',
    label: (a) => {
      const name = TABS[a.digit - 1];
      return name === undefined
        ? `no view ${a.digit} — the pane holds ${TABS.length}`
        : `the ${name} view, in the focused pane`;
    },
  },
  revealProject: { group: 'navigation', label: () => 'reveal this session’s project' },
  moveToGroup: { group: 'session', label: () => 'move this project into a folder' },
  search: { group: 'navigation', label: () => 'search sessions' },
  searchNext: { group: 'navigation', label: () => 'next match' },
  searchPrev: { group: 'navigation', label: () => 'previous match' },
  // NAMES THE PANE, NOT ONE OF ITS SURFACES, because `i` goes wherever this
  // pane takes typing: the prompt box on a Response view, the screen on a
  // Terminal view, the editor on a Files view (`Canvas.tsx`, `case 'prompt'`).
  // The caption said "write a prompt to this session" while the key was doing
  // nothing at all on two of the five views -- and once it reached them, a
  // sheet still promising a prompt would be the same untruth from the other
  // side.
  prompt: { group: 'session', label: () => 'type into this pane — its box, or its screen' },
  rename: { group: 'session', label: () => 'rename this session' },
  icon: { group: 'session', label: () => 'pick this session’s icon' },
  close: { group: 'session', label: () => 'close this session' },
  newSession: { group: 'session', label: () => 'start a new session' },
  // Named for the pane, because that is the whole difference from
  // `newSession` above — one sheet row must not read as a second spelling of
  // the other, or an operator picks whichever they remember and gets a
  // different refusal.
  newTab: { group: 'session', label: () => 'new session as a tab in this pane' },
  // NAMES THE DIRECTORY, because that is what tells this row apart from the
  // two above it at a glance: the other two are born in a project that
  // already exists, and this one is how a project comes to exist — vam has no
  // stored project, so choosing a directory and starting a session in it IS
  // the act. In `session` rather than `view`: the group holds what the
  // operator DOES to their work (`gm` files a project into a folder from
  // here), while `view` is surfaces that open over everything.
  newProject: { group: 'session', label: () => 'new project — choose a directory to start it in' },
  // ENTER, WHICH OPENS NOTHING IN SELECT — audit F1. It was captioned "open
  // the focused step" in both modes, and there has been no focused step to
  // open since the command strip left the pane: in Select the key answers
  // that the detail is already on screen, and in Insert it marks the option
  // under the cursor (the question card claims it first) or raises the
  // composer. Two behaviours, so two captions — and the BASE label below is
  // a third: `buildKeySheet` and the settings editor's own mode sections
  // resolve `byMode` correctly, but `SettingsOverlay.tsx`'s `labelFor` names
  // an action in a binding-clash message straight off this field, with no
  // mode to split by. "open the focused step" there would tell an operator
  // whose key collided with `Enter` that Select opens something, which it
  // never has since the strip left. The base has to be true standing alone.
  open: {
    group: 'session',
    label: () => 'nothing to open in Select; marks the option or opens the prompt in Insert',
    byMode: () => ({
      select: 'nothing to open — the whole detail is already in the right pane',
      insert: 'mark the option under the cursor, or open the prompt box',
    }),
  },
  // NAMES WHAT IS THERE, NOT A CHOICE THAT DOES NOT EXIST. The pane holds one
  // stop (`buildActions`, `panels/actions.ts`) — the command rows that used
  // to sit beside the prompt went with the strip the operator asked removed,
  // and this caption calling it "the action pane" without saying so read as a
  // menu of several.
  focusAction: {
    group: 'panes',
    label: () => 'keyboard to the action pane — today, just the prompt box',
  },
  focusList: { group: 'panes', label: () => 'keyboard back to the session list' },
  // AND THE PAIR THAT REVERSES WITH THE MODE — audit F1's quietest half. One
  // caption said "widen the focused side pane" while the handler flips the
  // SIGN by cursor mode, so the same key moved the boundary opposite ways in
  // the two modes and nothing on screen said so.
  //
  // The rule underneath is one sentence — "resize the pane the keyboard is
  // in" — and naming that pane is what the old caption omitted. There is one
  // draggable boundary (A12.1: the detail pane fills everything to the
  // sidebar's right), so widening one pane is narrowing the other; which one
  // the operator MEANT is exactly what the mode already says.
  resizePane: {
    group: 'panes',
    label: (a) => (a.delta === 1 ? 'widen the pane' : 'narrow the pane'),
    byMode: (a) => ({
      select:
        a.delta === 1
          ? 'widen the pane the keyboard is in — the session list'
          : 'narrow the pane the keyboard is in — the session list',
      insert:
        a.delta === 1
          ? 'widen the pane the keyboard is in — the response pane'
          : 'narrow the pane the keyboard is in — the response pane',
    }),
  },
  resetPanes: { group: 'panes', label: () => 'reset both pane widths' },
  // Named by what it FOLDS and by the fact that it comes back, because the
  // sheet is the second place an operator meets this and the first is a
  // settings row they may never open.
  toggleFocusView: {
    group: 'panes',
    label: () => 'focus view — fold each turn’s working away, ··· brings it back',
  },
  splitPane: {
    group: 'panes',
    label: (a) =>
      a.orientation === 'row' ? 'split vertically (side by side)' : 'split horizontally (stacked)',
  },
  closeSplit: { group: 'panes', label: () => 'close this split — the session keeps running' },
  stepSplit: {
    group: 'panes',
    label: (a) => (a.delta === 1 ? 'next split' : 'previous split'),
  },
  /**
   * HALF A SCREEN OF TRANSCRIPT — and the second mode-dependent family this
   * sheet has ever had, for the reason `move`'s entry above states: a binding
   * that means two things gets one row per mode, because one undifferentiated
   * caption is the "half right about a motion key" failure audit F1 was
   * entirely about.
   *
   * Its Insert half is not a second behaviour, it is the ABSENCE of one
   * (`isSelectOnly` in `chords.ts`) — and that is exactly what has to be
   * printed. A sheet that captioned these "scroll half a screen" full stop
   * would promise a scroll to an operator whose caret is in the prompt box,
   * where the keystroke is the box's own delete.
   *
   * In `navigation` rather than `panes`: the group answers "how do I get
   * to…", and reading back up a transcript is the commonest way an operator
   * gets anywhere inside one. It is the one member that moves the READER
   * rather than the cursor, which is why the group's own note above now says
   * so.
   *
   * AND THE CAPTION NAMES BOTH SPELLINGS OUT LOUD, which no other row needs
   * to — and the reason it is the only one INVERTED once, which is why this
   * comment is worth reading rather than skimming.
   *
   * It used to be here because `Mod-` folded Ctrl and Cmd for every binding in
   * the grammar, so `Mod-d` was `Cmd+D` as well and an operator who asked for
   * vim's `Ctrl-D` met the alias as a surprise. That fold is gone from every
   * other letter: the operator gave Ctrl+letter to the terminal on PR 361 and
   * kept exactly these two ("keep them in the Response view; drop them in the
   * terminal"), so `Mod-` now means the platform's command modifier
   * everywhere — and these two rows are the exception, the only `Mod-<letter>`
   * chords that still answer Control as well.
   *
   * SO THE SURPRISE SWAPPED ENDS AND THE CAPTION STILL HAS TO CARRY IT. An
   * operator reading `Mod-k` is reading "Cmd+K, and Ctrl+K belongs to the
   * terminal"; an operator reading `Mod-d` is reading something that is true
   * of two keys. Naming both here is the whole disclosure, because nothing in
   * the sheet's layout can show that one `Mod-` row means more than another.
   * `test/keyboard/chords.half-page.test.ts` asserts both words are here, so
   * neither spelling can quietly leave the caption.
   */
  scrollHalf: {
    group: 'navigation',
    label: (a) =>
      a.delta === 1
        ? 'half a screen down this pane’s transcript — Ctrl+D and Cmd+D both'
        : 'half a screen up this pane’s transcript — Ctrl+U and Cmd+U both',
    byMode: (a) => ({
      select:
        a.delta === 1
          ? 'half a screen down this pane’s transcript — Ctrl+D and Cmd+D both'
          : 'half a screen up this pane’s transcript (Ctrl+U or Cmd+U) — its head reads further back',
      insert: 'nothing here — whatever you are typing in keeps Ctrl-D, Cmd+D and Ctrl-U',
    }),
  },
  // NAMES THE TURN, NOT A STEP NO CARD DRAWS ANY MORE. `copyAllCommands`
  // (`Canvas.tsx`) reads `focusedDecision?.commands` — the focused session's
  // NEWEST turn, its per-decision walk having left with the graph in 0.2 —
  // and it always finds `[]` against a real source today: `to-canvas.ts`
  // has no factory event yet that carries a command a person runs by hand.
  // The chord stays wired for the day there is one (see that file's own
  // comment), and it already refuses aloud when there is nothing to copy —
  // "no command to copy" is the one member of this feature that does not
  // fail silently the way the `!` typeahead's empty popover still does.
  copy: { group: 'review', label: () => 'copy this session’s newest turn’s commands' },
  palette: { group: 'view', label: () => 'command palette' },
  filterMenu: { group: 'view', label: () => 'filter the session list' },
  settings: { group: 'view', label: () => 'settings' },
  remote: { group: 'view', label: () => 'remote access — pair a phone, unpair one, or revoke all' },
  errorLog: { group: 'view', label: () => 'the error log and the report to send' },
  help: { group: 'view', label: () => 'this sheet' },
  // Escape is handled ahead of every table in `resolveChord`, so it is in no
  // table and gets no row: the sheet lists what the tables hold, and a row with
  // no binding behind it is the defect this module exists to make impossible.
  cancel: { group: 'view', label: () => 'close / cancel' },
};

type SheetRow = {
  readonly keys: string;
  readonly label: string;
  /**
   * Which cursor mode this row is true in, or `null` for a key that means the
   * same in both. A row tagged with a mode is one HALF of a binding: `hjkl`
   * yields two rows, and neither of them is the whole truth on its own.
   */
  readonly mode: CursorMode | null;
  /**
   * The action that answers this key INSTEAD of this row's, or `null` when the
   * row's key really reaches it.
   *
   * The sheet's contract is that it names no key nothing is bound to. A key
   * two actions claim is the neighbouring lie — bound, but not to what the row
   * says — so the row stays and carries the correction rather than being
   * dropped, which would make the shadowed action vanish from the sheet
   * altogether and take the operator's only way of finding it with it.
   */
  readonly dead: string | null;
};
/**
 * Which section of the sheet a group is.
 *
 * `files` is the one that is NOT an `ActionGroup`, and it is deliberately
 * absent from `GROUP_ORDER`: that tuple orders the groups derived from
 * `BINDING_TABLES`, and the Files tab's keyboard is not in that table. See
 * `buildFilesSheet` for the whole of why.
 */
export type SheetGroupId = ActionGroup | 'files';

type SheetGroup = {
  readonly group: SheetGroupId;
  readonly title: string;
  readonly rows: readonly SheetRow[];
};

/**
 * What one action is called and where it belongs.
 *
 * The single cast in this module: `ACTION_LABELS[action.kind]` widens to a
 * union of label functions the compiler cannot see is aligned with the action
 * it was just indexed by. Narrowing it away would mean a switch, which is the
 * scattering the table replaces.
 */
export function describeAction(action: KeyAction): {
  group: ActionGroup;
  label: string;
  /** One caption per mode, or `null` where the key means the same in both. */
  byMode: Readonly<Record<CursorMode, string>> | null;
} {
  // `never` in the parameter position is what makes every `Meta<K>` assignable
  // to one type here; the kind that produced it is checked at the table above.
  const meta:
    | {
        group: ActionGroup;
        label: (action: never) => string;
        byMode?: (action: never) => Readonly<Record<CursorMode, string>>;
      }
    | undefined = ACTION_LABELS[action.kind];
  if (meta === undefined) {
    throw new Error(`no label for key action "${action.kind}" — add one to ACTION_LABELS`);
  }
  const label = (meta.label as (a: KeyAction) => string)(action);
  if (label === '') {
    throw new Error(`empty label for key action "${action.kind}"`);
  }
  const byMode =
    meta.byMode === undefined
      ? null
      : (meta.byMode as (a: KeyAction) => Readonly<Record<CursorMode, string>>)(action);
  return { group: meta.group, label, byMode };
}

/** One editable action: what it is called, and the keys it holds right now. */
export type BindingRow = {
  readonly id: string;
  readonly label: string;
  /** Up to `MAX_BINDINGS` chords, as they are written down. */
  readonly keys: readonly string[];
  /**
   * The per-mode captions, for a binding whose meaning depends on the mode —
   * `null` otherwise. Exported so the settings shortcut page can group by mode
   * without re-deriving which bindings are mode-dependent; re-deriving it there
   * is how the two would drift apart.
   */
  readonly byMode: Readonly<Record<CursorMode, string>> | null;
  /** True when the operator moved it off the shipped keys. */
  readonly overridden: boolean;
  /**
   * The keys in `keys` that DO NOTHING, each mapped to the name of the action
   * that answers them instead — empty in the ordinary case.
   *
   * A row can advertise a key another action wins (audit F3, and an upgrade
   * that moves a shipped key onto a stored override). `resolveChord` has
   * always settled that deterministically; what was missing was any way for
   * the operator to SEE it, which left "press the key and watch something
   * else happen" as the only way to find out. Named rather than flagged: a
   * dead key with no culprit leaves them hunting.
   */
  readonly dead: Readonly<Record<string, string>>;
};

export type BindingGroup = {
  readonly group: ActionGroup;
  readonly title: string;
  readonly rows: readonly BindingRow[];
};

/**
 * The editor's model: one row per ACTION, grouped like the sheet.
 *
 * Derived from `effectiveBindings`, which is the same source `resolveChord`
 * answers from — so a slot cannot show a key that would not fire, which is the
 * generated sheet's original property carried into the editable one.
 */
export function buildBindingSheet(
  overrides: KeyBindings = activeBindings(),
): readonly BindingGroup[] {
  const bindings = effectiveBindings(overrides);
  // Names first, rows second: a dead key is named after the action that took
  // it, and that action is in some other group.
  const nameOf = new Map(bindings.map((binding) => [binding.id, describeAction(binding.action)]));
  const dead = new Map<string, Record<string, string>>();
  for (const clash of bindingClashes(overrides)) {
    for (const id of clash.shadowed) {
      const entry = dead.get(id) ?? {};
      entry[clash.chord] = nameOf.get(clash.winner)?.label ?? clash.winner;
      dead.set(id, entry);
    }
  }
  const byGroup = new Map<ActionGroup, BindingRow[]>();
  for (const binding of bindings) {
    const { group, label, byMode } = describeAction(binding.action);
    const rows = byGroup.get(group) ?? [];
    rows.push({
      id: binding.id,
      label,
      byMode,
      keys: binding.chords.map(chordText),
      overridden: overrides[binding.id] !== undefined,
      dead: dead.get(binding.id) ?? {},
    });
    byGroup.set(group, rows);
  }
  return GROUP_ORDER.flatMap((group) => {
    const rows = byGroup.get(group);
    return rows === undefined ? [] : [{ group, title: GROUP_TITLES[group], rows }];
  });
}

/**
 * The sheet: every binding, grouped, in the declared group order — and split
 * by cursor mode wherever a binding has two meanings.
 *
 * The split is the operator's requirement stated as data. `hjkl` chooses a
 * session in Select and an option in Insert; printing one undifferentiated row
 * for it is how the sheet came to be wrong about it. So a mode-dependent
 * binding contributes one row PER MODE, each carrying the mode it is true in,
 * in `CURSOR_MODES` order; every other binding contributes the one row it
 * always did, with `mode: null`.
 *
 * AND A MODE CAN BELONG TO ONE KEY RATHER THAN TO THE ACTION — the second way
 * a row gets tagged, added with the bare view digits.
 *
 * `pickView` holds two chords that are NOT alike: `Ctrl-Alt-3` reaches the
 * Terminal view from anywhere, including from inside the prompt box, and a
 * bare `3` is text wherever there is a caret and stands down
 * (`isSelectOnlyChord`, `chords.ts`). `byMode` cannot say that — it is a
 * function of the ACTION, so tagging the action would print "Select" against
 * the chord as well, which is the neighbouring lie: a sheet that understates a
 * binding sends the operator reaching for a three-key chord they have been
 * told not to trust under a caret.
 *
 * So the tag is computed per KEY, exactly where `dead` already is and for the
 * same reason — a row's two slots are judged separately. `SheetRow.mode` is
 * unchanged in meaning ("which cursor mode this row is true in") and needs no
 * new field; a Select-only key yields ONE row, tagged, rather than a second
 * row saying "nothing here". `scrollHalf` prints that second row because the
 * key is the text box's own editing command and an operator has to be told
 * where it went; a digit under a caret types itself, which is the least
 * surprising thing a key can do and not worth nine extra rows to say.
 */
export function buildKeySheet(overrides: KeyBindings = activeBindings()): SheetGroup[] {
  return (
    buildBindingSheet(overrides)
      .map(({ group, title, rows }) => ({
        group,
        title,
        rows: rows.flatMap((row) =>
          row.keys.flatMap((keys): readonly SheetRow[] => {
            const captions = row.byMode;
            // Per KEY, because a row's two slots are judged separately: one of
            // them can be shadowed while the other still fires.
            const dead = row.dead[keys] ?? null;
            const selectOnly = isSelectOnlyChord(parseChord(keys));
            if (captions === null) {
              return selectOnly
                ? [
                    {
                      keys,
                      label: `${MODE_TITLES.select} · ${row.label}`,
                      mode: 'select' as const,
                      dead,
                    },
                  ]
                : [{ keys, label: row.label, mode: null, dead }];
            }
            // BOTH AT ONCE IS ONE ROW, NOT TWO. Nothing in the shipped grammar
            // is mode-dependent AND bound to a bare digit, but an operator can
            // make it so in an afternoon — `move:down` onto `1` is a rebind the
            // settings editor accepts and should — and the honest sheet for
            // that is the Select half alone. Printing the Insert caption of a
            // key the Insert scope never receives is the lie this whole module
            // exists to prevent.
            const modes = selectOnly ? (['select'] as const) : CURSOR_MODES;
            return modes.map((mode) => ({
              keys,
              label: `${MODE_TITLES[mode]} · ${captions[mode]}`,
              mode,
              dead,
            }));
          }),
        ),
      }))
      // An operator who unbinds every action in a group leaves it with no rows,
      // and a titled empty group is a heading that advertises nothing.
      .filter((group) => group.rows.length > 0)
  );
}

/* ---------------------------------------------------------------------------
 * THE FILES TAB'S OWN KEYBOARD, ON THE SAME SHEET.
 *
 * The defect: that tab's filter has shipped since the tab did, `/` has always
 * reached it, and `?` — the one place an operator goes to ask what a key is —
 * had no Files section at all. A real feature, invisible, which is how an
 * operator came to ask for a file-search shortcut that already half existed.
 *
 * WHY THIS IS A SECOND BUILDER RATHER THAN A SIXTH GROUP IN `buildKeySheet`.
 * That one walks `BINDING_TABLES`, and the rest of this repo reads its output
 * as exactly that: `bindings.test.ts` resolves every row it emits through
 * `resolveChord` to prove the sheet names no key nothing is bound to, and
 * `binding-clashes.test.ts` derives each row's `dead` mark from what the
 * keystroke actually reaches. The Files tab's keys are deliberately NOT in
 * that table — `files-tree.ts` argues the case: they are hardcoded, which is
 * "exactly what makes writing one into a tooltip honest rather than a lie
 * waiting for the operator to rebind something" — so folding them in would
 * have asked those assertions a question with no answer, `Mod-p` first, being
 * precisely the chord the grammar leaves unbound.
 *
 * SO THE PROPERTY IS KEPT AND THE MECHANISM IS NOT. `buildKeySheet`'s contract
 * is that a row exists only because a binding does, and this holds the same
 * bargain against the other source of truth: `TREE_KEYS` and `EDITOR_KEYS` are
 * what `resolveTreeKey` and `FilesTab.tsx`'s handlers dispatch on, so a key
 * taken out of a list stops working, and one put in without a caption THROWS
 * here rather than rendering a blank line nobody notices. A key added later
 * cannot silently go undocumented, which is the whole reason it is derived.
 * ------------------------------------------------------------------------ */

/**
 * What one Files-tab key does, in the fewest words that are still true.
 *
 * Keyed by the string `normalizeKey` produces, because that is what the two
 * lists hold and what the handlers compare against — one spelling, or the
 * sheet and the code could disagree about which keystroke a row is.
 *
 * A FUNCTION OF THE PLATFORM, for one caption: the Tab row discloses the other
 * half of its key, and `Shift+Tab` is a keystroke a person has to press. The
 * `keys` column is rendered by `KeySheet.tsx`, but a chord NAMED INSIDE PROSE
 * has nothing to render it, so the table takes the flag and spends it on the
 * one row that needs it. The rest are captions with no key in them.
 */
const filesKeyLabels = (mac: boolean): Readonly<Record<string, string>> => ({
  j: 'down one row of the tree',
  k: 'up one row of the tree',
  h: 'shut this directory, or step out to the one holding it',
  l: 'open this directory, or step into it — on a file, open it in the editor',
  Enter: 'open the file and put the caret in the editor',
  '/': 'filter the tree — from the tree',
  'Mod-p': 'find a file — from anywhere in the tab, the editor included',
  'Mod-Shift-e': 'move the keyboard between the editor and the tree',
  Tab: `indent in the editor — ${chordSymbols('Shift-Tab', mac)} outdents`,
  'Mod-s': 'save the open file',
  'Mod-Shift-f': 'tidy this file’s whitespace — refuses by name where it cannot',
  'Mod-Shift-m': 'markdown: the rendered document, or its raw text',
  'Mod-z': 'undo the last format, while the file is still what it produced',
  Escape: 'hand the keyboard back to Select',
  'Mod-[': 'hand the keyboard back to Select',
});

/** What the section is called. Lower case, like every other group title. */
const FILES_GROUP_TITLE = 'in the files tab';

/**
 * The Files section: one row per key that tab answers, in the order the lists
 * declare them — the tree's keyboard, then the editor's, deduplicated because
 * `Escape` and `Mod-[` are on both and mean one thing.
 *
 * The first parameter exists so the throw is reachable from a test, exactly as
 * `buildKeySheet`'s `overrides` is; nothing in the app passes it. The second
 * is the platform the captions are written for, defaulting to this machine —
 * a parameter rather than a read for the reason `chords.ts` gives: both
 * answers have to be assertable from one test run.
 */
export function buildFilesSheet(
  keys: readonly string[] = [...TREE_KEYS, ...EDITOR_KEYS],
  mac: boolean = applePlatform(),
): readonly SheetGroup[] {
  const labels = filesKeyLabels(mac);
  const rows = [...new Set(keys)].map((key): SheetRow => {
    const label = labels[key];
    if (label === undefined || label === '') {
      throw new Error(`no caption for the Files-tab key "${key}" — add one to FILES_KEY_LABELS`);
    }
    // `mode` and `dead` are `null` rather than guessed at: these keys belong
    // to one tab rather than to a cursor mode, and nothing in the grammar can
    // shadow them — the tab answers them before the window listener is
    // reached, and claims exactly what it answers.
    return { keys: key, label, mode: null, dead: null };
  });
  return rows.length === 0 ? [] : [{ group: 'files', title: FILES_GROUP_TITLE, rows }];
}
