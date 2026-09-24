/**
 * The command palette's ACTIONS half — VS Code's own idiom for one search
 * box: no prefix finds a destination (a session), `/` finds a verb.
 *
 * NOT A SECOND REGISTRY. The operator's own instruction: derive this from the
 * table the `?` sheet and `chords.ts` are already generated from, so a row
 * here can only exist because a binding exists, exactly the property
 * `buildKeySheet` already holds for the sheet (`keysheet.ts`'s own header
 * argues why that property matters — a hand-written list can promise a key
 * that is not bound, and this codebase has shipped that shape before). So
 * `buildPaletteActions` reads `effectiveBindings`/`describeAction` the same
 * two functions `ShortcutTip.tsx` and `KeySheet.tsx` already read, and a
 * rebind or an unbind in settings changes what the palette offers on the
 * next open with no second list to keep in step.
 *
 * A CURATED SUBSET, though, unlike the sheet: `PALETTE_KINDS` names which
 * action KINDS are even candidates, and it is deliberately narrower than
 * "every bound action". Excluded, and why:
 *
 *  - Pure motions and steppers relative to wherever the keyboard already is
 *    (`move`, `first`, `last`, `project`, `jump`, `searchNext`, `searchPrev`,
 *    `resizePane`, `scrollHalf`, `selectTab`, `stepTab`, `stepSplit`, `open`).
 *    A command palette runs a named THING once; these are not things, they
 *    are directions, and "move down" typed into a search box has no operator
 *    behind it.
 *  - `cancel` — closing the palette already IS this, by the mouse-down scrim
 *    and by Escape; offering it as a row would be a command whose only effect
 *    is undoing the row above it.
 *  - Focus moves with no destination of their own (`focusAction`, `focusList`,
 *    `prompt`) — running "put the caret in the box" from a palette that is
 *    about to close and hand focus elsewhere anyway is not a thing an
 *    operator searches for by name.
 *  - `newTab` and `selectTab` — their target is "the focused PANE" or "the
 *    tab at this screen position", which is exactly the shape of target this
 *    module's own contract rules out: a fact about where a keypress landed,
 *    not a fact the palette can supply on its own.
 *  - `palette` itself — opening a palette from inside one is not a command.
 *  - A theme toggle: there is no such `KeyAction` kind in `chords.ts` at all
 *    — nothing in the grammar binds one — so "theme toggle if bound" is
 *    answered by its absence rather than invented here.
 */

import {
  actionId,
  activeBindings,
  applePlatform,
  bindingChords,
  chordSymbols,
  type KeyAction,
  type KeyBindings,
} from './chords.js';
import { describeAction } from './keysheet.js';

/** VS Code's own split: no prefix is a destination, `/` is a verb. */
export type PaletteMode = 'sessions' | 'actions';

/** Which mode a query puts the palette in — the first character decides. */
export function paletteMode(query: string): PaletteMode {
  return query.startsWith('/') ? 'actions' : 'sessions';
}

/**
 * The text that actually filters the action list: the query with its leading
 * `/` removed. In session mode this is the query unchanged, so a caller that
 * always reads this rather than `query` needs no branch of its own.
 */
export function actionQueryText(query: string): string {
  return paletteMode(query) === 'actions' ? query.slice(1) : query;
}

/**
 * The one-line hint under the search box, short enough for a 390px panel.
 * Session mode names the way out (`/`); action mode names the way back
 * (Backspace to the empty box, which lands on the empty string and reads as
 * session mode again).
 */
export function paletteHint(mode: PaletteMode): string {
  return mode === 'actions'
    ? 'Actions · Backspace to go back to sessions'
    : 'Type to search sessions · / for actions';
}

/**
 * The candidate action KINDS, in the order the palette lists them absent a
 * query. Ordered create → destroy → view → layout → find → session-scoped →
 * toggles → overlays, which is roughly "what you reach for most" — not
 * alphabetical, and not the sheet's own five groups, because those group by
 * WHAT THE KEY ACTS ON for a reader walking the whole `?` table, while this
 * is a short list read top to bottom before a query narrows it at all.
 *
 * `pickView` and `splitPane` carry a fixed parameter (a digit, an
 * orientation) rather than appearing once each — same reason `chords.ts`
 * binds nine `pickView` digits and two `splitPane` orientations as distinct
 * table entries: each is its own destination, not a family the palette would
 * make the operator supply an argument for.
 */
const PALETTE_ACTIONS: readonly KeyAction[] = [
  { kind: 'newSession' },
  { kind: 'newProject' },
  { kind: 'close' },
  { kind: 'rename' },
  { kind: 'pickView', digit: 1 },
  { kind: 'pickView', digit: 2 },
  { kind: 'pickView', digit: 3 },
  { kind: 'pickView', digit: 4 },
  { kind: 'pickView', digit: 5 },
  { kind: 'splitPane', orientation: 'row' },
  { kind: 'splitPane', orientation: 'column' },
  { kind: 'closeSplit' },
  { kind: 'search' },
  { kind: 'filterMenu' },
  { kind: 'revealProject' },
  { kind: 'moveToGroup' },
  { kind: 'copy' },
  { kind: 'toggleFocusView' },
  { kind: 'resetPanes' },
  { kind: 'settings' },
  { kind: 'remote' },
  { kind: 'errorLog' },
  { kind: 'help' },
];

/**
 * Which of the candidates need a session focused to do anything, chosen by
 * reading `Canvas.tsx`'s own switch rather than guessed: each of these either
 * opens with `if (focusedEntry === null) { setStatus('pick a session
 * first'); return; }` (`close`, `rename`, `revealProject`, `moveToGroup`), or
 * — `splitPane`, through `splitFocused` — the identical guard one call down,
 * or — `pickView` — writes nothing at all when no session is focused, which
 * this module treats as needing one too rather than letting the palette open
 * a silent no-op the keyboard itself never has to answer for (a bare
 * `Ctrl-Alt-<digit>` always lands on SOME focused pane; a palette row has no
 * keyboard-shaped guarantee that one is focused).
 *
 * `newSession` is deliberately absent: with nothing focused it falls back to
 * `newProject` rather than refusing, so it is never blocked.
 * `copy` is deliberately absent too: its refusal is about there being no
 * command to copy, which is true or false independently of whether a session
 * is focused, so "pick a session first" would be the wrong sentence for it.
 */
const REQUIRES_FOCUSED_SESSION: ReadonlySet<KeyAction['kind']> = new Set([
  'close',
  'rename',
  'revealProject',
  'moveToGroup',
  'splitPane',
  'pickView',
]);

/** The one sentence every focus-gated row is disabled with. */
export const PALETTE_DISABLED_REASON = 'pick a session first';

/** One row of the action list: what it is called, its bound chords, and
 *  whether the palette can run it right now. */
export type PaletteActionEntry = {
  readonly action: KeyAction;
  readonly id: string;
  readonly label: string;
  /** The chords this action is bound to right now — never empty; an unbound
   *  candidate is filtered out entirely, the same rule `buildKeySheet` holds
   *  for its own rows. */
  readonly chords: readonly string[];
  readonly disabled: boolean;
  /** Why it is disabled, or `null` when it is not. Shown beside the row
   *  rather than left for the operator to press and find out — the sentence
   *  every refusal in `Canvas.tsx`'s own switch already earns for itself. */
  readonly disabledReason: string | null;
};

/**
 * DISABLED, NOT HIDDEN — the operator's own choice between the two, made
 * once here. A row an operator cannot run yet still tells them the command
 * exists and what it is waiting for, which is the same "never fail
 * silently" argument `chords.ts` and `Canvas.tsx` make throughout their own
 * refusals; hiding a row that needs a session would look identical to the
 * feature not existing, on a keyboard-first tool that otherwise never lets a
 * gap look like an absence.
 *
 * Reads the SAME registry the key sheet and the tooltips do
 * (`activeBindings`/`bindingChords`/`describeAction`) — a rebind or an
 * unbind changes what this returns with no second list to maintain, and a
 * candidate `effectiveBindings` holds no chord for at all is dropped rather
 * than shown unreachable.
 */
export function buildPaletteActions(
  hasFocusedSession: boolean,
  overrides: KeyBindings = activeBindings(),
): readonly PaletteActionEntry[] {
  return PALETTE_ACTIONS.flatMap((action): readonly PaletteActionEntry[] => {
    const id = actionId(action);
    const chords = bindingChords(overrides, id);
    if (chords.length === 0) {
      return [];
    }
    const disabled = !hasFocusedSession && REQUIRES_FOCUSED_SESSION.has(action.kind);
    return [
      {
        action,
        id,
        label: describeAction(action).label,
        chords,
        disabled,
        disabledReason: disabled ? PALETTE_DISABLED_REASON : null,
      },
    ];
  });
}

/**
 * Narrowed by `query`, every term required — the same contract
 * `filterSheet` (`keysheet.ts`) already states and this deliberately
 * matches: EVERY WORD HAS TO LAND, so "close session" finds the row that
 * closes a session rather than every row mentioning either word, and the
 * search reads a row's label, its chord tokens and its painted symbols, so
 * an operator who read `⌘W` off the sheet finds the same row by typing what
 * they saw.
 *
 * `query` here is already the text AFTER a leading `/` — callers pass
 * `actionQueryText(rawQuery)`, not the raw box contents, so this function
 * itself never has to know about the mode split.
 */
export function filterPaletteActions(
  actions: readonly PaletteActionEntry[],
  query: string,
  mac: boolean = applePlatform(),
): readonly PaletteActionEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return actions;
  }
  return actions.filter((entry) => {
    const haystack = `${entry.label} ${entry.chords.join(' ')} ${entry.chords
      .map((chord) => chordSymbols(chord, mac))
      .join(' ')}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
