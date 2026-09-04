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

import { BINDING_TABLES, type KeyAction } from './chords.js';

/**
 * Five groups, argued rather than assumed.
 *
 * The split is by WHAT THE KEY ACTS ON, because that is the question an
 * operator has when they open the sheet ("how do I get to…", "how do I do
 * something to this session…"), not by which table the binding lives in:
 *
 * - `navigation` — moves the cursor and nothing else. Search is here: `/`, `n`
 *   and `N` end with the cursor somewhere new, which is what they are for.
 * - `session` — acts on the focused session (rename, close, open, prompt).
 * - `panes` — the frame around the work: which pane holds the keyboard, and
 *   how wide the side panes are.
 * - `review` — taking something out of a session, which today is `yy`. Kept
 *   distinct from `session` because copying reads and never changes anything.
 * - `view` — surfaces that overlay the whole app: palette, filter, settings,
 *   this sheet.
 */
export type ActionGroup = 'navigation' | 'session' | 'panes' | 'review' | 'view';

export const GROUP_ORDER = ['navigation', 'session', 'panes', 'review', 'view'] as const;

export const GROUP_TITLES: Readonly<Record<ActionGroup, string>> = {
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
};

/**
 * The one table of labels, keyed by action kind. The mapped type makes the
 * compiler demand an entry for every kind in the union — the day a binding is
 * added, this file is where the build stops.
 */
export const ACTION_LABELS: { readonly [K in KeyAction['kind']]: Meta<K> } = {
  move: { group: 'navigation', label: (a) => `move ${a.direction}` },
  // Derived from the action's own `name`, so a third layout added to the
  // table gets a row here without anyone editing this file — and one added
  // with a name this switch does not cover fails to compile.
  layout: {
    group: 'panes',
    label: (a) => (a.name === 'noCanvas' ? 'hide the canvas' : 'response pane only'),
  },
  first: { group: 'navigation', label: () => 'first session' },
  last: { group: 'navigation', label: () => 'last session' },
  project: {
    group: 'navigation',
    label: (a) => (a.delta === 1 ? 'next project' : 'previous project'),
  },
  jump: { group: 'navigation', label: () => 'jump to a labelled node' },
  sessionAt: { group: 'navigation', label: (a) => `session ${a.index + 1} in the sidebar` },
  search: { group: 'navigation', label: () => 'search sessions' },
  searchNext: { group: 'navigation', label: () => 'next match' },
  searchPrev: { group: 'navigation', label: () => 'previous match' },
  prompt: { group: 'session', label: () => 'write a prompt to this session' },
  rename: { group: 'session', label: () => 'rename this session' },
  icon: { group: 'session', label: () => 'pick this session’s icon' },
  close: { group: 'session', label: () => 'close this session' },
  newSession: { group: 'session', label: () => 'start a new session' },
  open: { group: 'session', label: () => 'open the focused step' },
  focusAction: { group: 'panes', label: () => 'keyboard to the action pane' },
  focusList: { group: 'panes', label: () => 'keyboard back to the session list' },
  resizePane: {
    group: 'panes',
    label: (a) => (a.delta === 1 ? 'widen the pane' : 'narrow the pane'),
  },
  resetPanes: { group: 'panes', label: () => 'reset both side panes' },
  copy: { group: 'review', label: () => 'copy this step’s commands' },
  palette: { group: 'view', label: () => 'command palette' },
  filterMenu: { group: 'view', label: () => 'filter the session list' },
  settings: { group: 'view', label: () => 'settings' },
  help: { group: 'view', label: () => 'this sheet' },
  // Escape is handled ahead of every table in `resolveChord`, so it is in no
  // table and gets no row: the sheet lists what the tables hold, and a row with
  // no binding behind it is the defect this module exists to make impossible.
  cancel: { group: 'view', label: () => 'close / cancel' },
};

export type SheetRow = { readonly keys: string; readonly label: string };
export type SheetGroup = {
  readonly group: ActionGroup;
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
export function describeAction(action: KeyAction): { group: ActionGroup; label: string } {
  // `never` in the parameter position is what makes every `Meta<K>` assignable
  // to one type here; the kind that produced it is checked at the table above.
  const meta: { group: ActionGroup; label: (action: never) => string } | undefined =
    ACTION_LABELS[action.kind];
  if (meta === undefined) {
    throw new Error(`no label for key action "${action.kind}" — add one to ACTION_LABELS`);
  }
  const label = (meta.label as (a: KeyAction) => string)(action);
  if (label === '') {
    throw new Error(`empty label for key action "${action.kind}"`);
  }
  return { group: meta.group, label };
}

/** The sheet: every binding, grouped, in the declared group order. */
export function buildKeySheet(): SheetGroup[] {
  const byGroup = new Map<ActionGroup, SheetRow[]>();
  for (const { prefix, table } of BINDING_TABLES) {
    for (const [key, action] of Object.entries(table)) {
      const { group, label } = describeAction(action);
      const rows = byGroup.get(group) ?? [];
      rows.push({ keys: `${prefix}${key}`, label });
      byGroup.set(group, rows);
    }
  }
  return GROUP_ORDER.flatMap((group) => {
    const rows = byGroup.get(group);
    return rows === undefined ? [] : [{ group, title: GROUP_TITLES[group], rows }];
  });
}
