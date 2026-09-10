/**
 * The vim chord layer: one key in, at most one action out.
 *
 * docs/design/canvas-layout.md §4 is the map this implements. §4.1 records why
 * it is written rather than borrowed: orca has a mature keybinding system —
 * an action registry, user overrides, conflict detection, even
 * `isDoubleTapBinding` — but **no vim mode**, so the chord grammar itself had
 * nowhere to come from.
 *
 * Deliberately a pure reducer over a one-key memory. Keeping it out of React
 * means the grammar can be tested exhaustively without a DOM, and means the
 * hook that owns the listener has no rules in it to drift from these.
 */

/**
 * `h` `j` `k` `l`, spelled out.
 *
 * Used to live in `keyboard/spatial-nav.ts` alongside the geometry that
 * turned a direction into a canvas node — the 0.2 migration deleted that
 * module with the graph, but the grammar's own `move` action still needs the
 * four-way vocabulary regardless of what interprets it, so the alias moved
 * here rather than dying with its old neighbour.
 */
export type Direction = 'left' | 'down' | 'up' | 'right';

/** A `KeyboardEvent`, narrowed to what the grammar reads. */
export type KeyEventLike = {
  readonly key: string;
  /**
   * The PHYSICAL key, when the event reports one. Read for the digit row only
   * (see `normalizeKey`), and optional because every other caller in this
   * codebase builds these by hand from a `key` alone.
   */
  readonly code?: string | undefined;
  readonly ctrlKey?: boolean | undefined;
  readonly metaKey?: boolean | undefined;
  readonly altKey?: boolean | undefined;
  readonly shiftKey?: boolean | undefined;
};

/** Pressing one of these alone is not a keystroke, it is a hand moving. */
const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift']);

/**
 * The keys whose BINDING IS A POSITION rather than a character, spelled by
 * their `event.code` and written down by the character the unmodified key
 * carries on a US layout.
 *
 * The number row, and the bracket pair beside `P`. Both are here for one
 * reason (see `normalizeKey`): a modifier CHANGES the character these keys
 * produce, and on some layouts a plain modifier already does. `Numpad1` is
 * deliberately absent: it is a different key, and under Shift it does not even
 * produce a digit.
 */
const POSITION_CODES: Readonly<Record<string, string>> = {
  Digit0: '0',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Digit7: '7',
  Digit8: '8',
  Digit9: '9',
  BracketLeft: '[',
  BracketRight: ']',
};

/**
 * What a key that reports NO code produces, folded back to its position.
 *
 * The fallback for a hand-built `KeyEventLike` — every one in this repo's
 * tests is `key`-only — and, historically, for a browser older than `code`.
 * The digits are themselves; the brackets are matched under their shifted
 * forms too, so a `{` arriving with no code answers `[`'s binding instead of
 * going dead.
 */
const POSITION_CHARS: Readonly<Record<string, string>> = {
  '[': '[',
  ']': ']',
  '{': '[',
  '}': ']',
};

function positionKey(event: KeyEventLike): string | null {
  const fromCode = POSITION_CODES[event.code ?? ''];
  if (fromCode !== undefined) {
    return fromCode;
  }
  if (/^[0-9]$/.test(event.key)) {
    return event.key;
  }
  return POSITION_CHARS[event.key] ?? null;
}

/**
 * A `KeyboardEvent` reduced to the one string a binding is written in, or
 * `null` when the event is not a keystroke at all.
 *
 * `Mod` folds Ctrl and Cmd together, borrowing orca's token (§4.1): vam runs on
 * one machine at a time, both spellings mean the same intent, and keeping them
 * apart would mean declaring every binding twice.
 *
 * Shift deliberately gets no token *for characters*. The browser already
 * applied it — `G` and `?` arrive as themselves — so adding one would give the
 * same keystroke two spellings, and only one of them would ever match.
 *
 * A POSITIONAL KEY UNDER A MODIFIER IS THE EXCEPTION, and it is an exception
 * because those bindings are about a POSITION rather than a character. A
 * character-based spelling cannot keep that promise, and failed it twice.
 *
 * On any layout whose digit row is shifted (AZERTY) a plain `Cmd+1` arrives as
 * `&`, which is how the digit bindings of the day came to be simply DEAD
 * there. And Shift alters a digit, so `Cmd+Shift+1` arrives as `!` and would
 * have to be written `Mod-!` — a spelling no key sheet can render as a
 * position, and one that would silently answer the unshifted binding.
 *
 * Both halves are about the KEY'S PLACE, not about whichever family is sitting
 * on it: the table has been rearranged five times and this reasoning has
 * outlived every arrangement.
 *
 * THE BRACKET PAIR JOINED THE DIGIT ROW HERE (`POSITION_CODES`), for the
 * identical reason and with sharper teeth. `Mod-Shift-[` / `Mod-Shift-]` is
 * the browser's own previous/next tab and `Mod-Alt-[` / `Mod-Alt-]` is the
 * pane pair one modifier up; a real `Cmd+Shift+[` keydown arrives as `{`, and
 * on macOS `Alt+[` arrives as `“`. Spelled by character, one of those is
 * unrenderable in a key sheet and the other is a different string on every
 * layout — the digit row's two failures, in a family that has both at once.
 *
 * NOTHING IS BOUND UNDER `Mod-Shift-<digit>`, and nothing can be: macOS
 * captures `Cmd+Shift+3/4/5` for screenshots. The Shift token still earns its
 * place twice over — it keeps a shifted digit from matching an unshifted
 * binding, and it is what lets the bracket pair be bound under Shift at all.
 *
 * `event.code` answers all of it: `Digit1` and `BracketLeft` are POSITIONS,
 * whatever the layout put on them, so those keys keep one spelling everywhere
 * and Shift can carry a token there without giving any keystroke a second one.
 * Letters stay folded.
 *
 * Returning `null` for a bare modifier is what stops reaching for a shortcut
 * and thinking better of it from silently eating a half-typed `g`.
 */
export function normalizeKey(event: KeyEventLike): string | null {
  if (MODIFIER_KEYS.has(event.key)) {
    return null;
  }
  const mod = event.ctrlKey === true || event.metaKey === true;
  const alt = event.altKey === true;
  if (!mod && !alt) {
    return event.key;
  }
  const position = positionKey(event);
  if (position !== null) {
    return `${mod ? 'Mod-' : ''}${alt ? 'Alt-' : ''}${event.shiftKey === true ? 'Shift-' : ''}${position}`;
  }
  // Under a modifier the letter is lower-cased so Cmd-K and Cmd-Shift-K do not
  // become two different bindings for one gesture.
  const base = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return `${mod ? 'Mod-' : ''}${alt ? 'Alt-' : ''}${base}`;
}

/** Keys that open a chord instead of doing something on their own. */
export const PREFIXES = ['g', 'y', 'z'] as const;
type Prefix = (typeof PREFIXES)[number];

export type ChordState = {
  /** The chord key already typed, or null when nothing is half-typed. */
  readonly pending: Prefix | null;
};

export const EMPTY_CHORD: ChordState = { pending: null };

export type KeyAction =
  | { readonly kind: 'move'; readonly direction: Direction }
  | { readonly kind: 'first' }
  | { readonly kind: 'last' }
  | { readonly kind: 'project'; readonly delta: 1 | -1 }
  | { readonly kind: 'jump' }
  | { readonly kind: 'copy' }
  | { readonly kind: 'open' }
  | { readonly kind: 'search' }
  | { readonly kind: 'searchNext' }
  | { readonly kind: 'searchPrev' }
  | { readonly kind: 'palette' }
  /** `i` — put the caret in the prompt box aimed at the focused session. */
  | { readonly kind: 'prompt' }
  /** `I` — move keyboard control into the action pane on the right. */
  | { readonly kind: 'focusAction' }
  /** `H` / `Mod-0` — back to the session list on the left. `Mod-0` sits at
      the head of the digit row it belongs to: the digits pick a tab, and zero
      is the way out of the tabs entirely. */
  | { readonly kind: 'focusList' }
  /** `r` — rename the focused session in place. */
  | { readonly kind: 'rename' }
  /** `s` — pick the focused session's icon. */
  | { readonly kind: 'icon' }
  /** `x` — close the focused session. */
  | { readonly kind: 'close' }
  /** `o` / `Mod-n` — start a new session IN THE FOCUSED SESSION'S PROJECT.
      `o` the way `o` opens a new line, and `Mod-n` because that is what "new"
      is bound to everywhere else. With nothing focused there is no project to
      be born in, and it refuses aloud rather than picking one. */
  | { readonly kind: 'newSession' }
  /** `Mod-t` — the per-pane `+`, on the keyboard. The same route `newSession`
      takes (`newSessionRoute`, one way to create a session and one refusal
      when there is none), aimed at the FOCUSED PANE: the project comes from
      that pane's own front tab, else its first tab, else the project on
      screen, and the session that appears is opened as a tab THERE.

      NOT A SECOND SPELLING OF `newSession`, and the difference is a state one
      keystroke away. `zv` moves the active tab out and leaves the source pane
      empty; with the keyboard back in it (`zw`), `Mod-n` has no focused
      session and refuses, while `Mod-t` names the project on screen and
      starts one — which is precisely what the `+` in that empty pane's strip
      already does, and why it exists. `Mod-t` because "new tab in this one"
      is Cmd+T in every browser and in VSCode's own editor group. */
  | { readonly kind: 'newTab' }
  /** `F` — open or close the sidebar's filter popover. Shift-f, because
      plain `f` is already the jump-label move and this is its stronger,
      "narrow the whole list" cousin. */
  | { readonly kind: 'filterMenu' }
  /** `,` — settings, the convention most editors already use. */
  | { readonly kind: 'settings' }
  /** `.` — the Remote surface: pair a phone, approve or deny it, unpair one
      or revoke every device at once. Beside `,` on purpose — the same row,
      the same "open something" family, and the same physical relationship
      as the icon it opens (pull request 219's collision analysis records
      the free keys this drew from). */
  | { readonly kind: 'remote' }
  /** `E` — the scrubbed event log and the report vam composes from it. It
      shipped reachable only by clicking the status bar, which on a
      keyboard-first tool means the surface most wanted at the worst moment was
      the one that needed a mouse. */
  | { readonly kind: 'errorLog' }
  /** `?` — the shortcut sheet, generated from the tables below. Free on this
      layout, and a real Shift+`/` keydown normalizes to `?` itself (proven in
      test/keyboard/chords.test.ts, not assumed). */
  | { readonly kind: 'help' }
  /** `<` / `>` — narrow or widen the focused side pane by one step. */
  | { readonly kind: 'resizePane'; readonly delta: -1 | 1 }
  /** `z0` — the shipped layout back: both panes at their default width and
      both drawn again. */
  | { readonly kind: 'resetPanes' }
  /** `Mod-1` … `Mod-9` — the SESSION TAB at that position, 1-based, in the
      strip of the FOCUSED PANE. One fixed meaning in either cursor mode: the
      operator asked for the gesture every browser and editor already has, and
      `SINGLE` records the trade that was made to give it to them.

      WHICH STRIP, when the shell is split: the focused pane's own. Every
      pane draws a strip of its own (A15.5) and only one of them has the
      keyboard, so "the tab strip you are looking at" is the one the pane
      focus already names — the same pane `zc`, `zw`, the per-pane `+` and
      `pickView` all act in. Counting the project's whole tab set instead
      would let a digit reach into a pane the operator is not in, which is
      the failure the previous two arrangements shipped in another form.

      The action carries the digit and NOTHING ELSE. Which sessions that
      strip is drawing is not something a reducer over a one-key memory can
      know — `Canvas` owns the pane tree — so resolving it here would mean
      either threading React state into the grammar or keeping a second copy
      of it. */
  | { readonly kind: 'selectTab'; readonly digit: number }
  /** `Alt-1` … `Alt-9` — pick a VIEW in the focused response pane: Response,
      PRs, Terminal, Agents. A SLOT IN `TABS`, never a position in the drawn
      bar — `Alt-3` is Terminal because Terminal is `TABS[2]`, whether or not
      this source offers one, and `tabForDigit` is the one place that
      resolution happens (`panels/tabs.ts`; A5.4/A15.6, won twice after
      positional indexing shipped as a bug twice).

      Distinct from `position` on purpose. `position` means whatever the
      focused PANE counts — a session in Select, a tab in Insert — and
      changes meaning with the cursor mode; this one names the same view in
      both, which is why it carries no `byMode` caption in the key sheet.

      It shipped OUTSIDE this table, as a bare `window` listener in
      `DetailPanel.tsx`, and paid for it four ways: absent from a key sheet
      whose contract is "every binding is here", not rebindable while its
      `Mod-` cousin was, its chord hand-written into an `aria-label` a screen
      reader repeated on every focus, and an operator override free to take
      `Alt-1` — after which the override and the listener both answered one
      keystroke. Being here is the fix for all four, and the second listener
      is gone rather than guarded. */
  | { readonly kind: 'pickView'; readonly digit: number }
  /** `p` — reveal the focused session's project in the sidebar and put the
      keyboard on its fold. */
  | { readonly kind: 'revealProject' }
  /** `gm` — move the focused session's project into a folder, or out of one.
      Under `g` rather than a single key: the single-key space is thin, and
      this is a project-level act the way `gt`/`gT` already are, not a
      session-level one like `x` or `r`. `m` for "move" — a folder is
      filled by moving a project into it, never by creating one there. */
  | { readonly kind: 'moveToGroup' }
  /** `zs` / `zv` — split the focused tab. A15.1: a tab may be split
      horizontally or vertically, within one project. Under `z`, vam's own
      "adjust the view" namespace (`AFTER_Z`'s own doc comment names it as
      the home for whatever the tab shell wants next), spelled the way vim
      spells its own window split: `Ctrl-w s` for a horizontal split (panes
      stacked), `Ctrl-w v` for a vertical one (panes side by side) — the
      same two letters, one keystroke shorter because `z` is already the
      prefix rather than a chord of its own. `orientation` names the CSS
      axis the new divider draws on (`row` = side by side, `column` =
      stacked) so `Canvas.tsx` reads it straight into a flex class, never a
      second vocabulary translated at the call site. */
  | { readonly kind: 'splitPane'; readonly orientation: 'row' | 'column' }
  /** `zc` — close the focused split. Vim's `Ctrl-w c`. Leaves the SESSION
      running; only the pane goes, the same distinction `x` (close the
      session) already draws against `Mod-w` before splits existed. Refuses
      aloud when only one pane is open — closing the last one would leave
      nothing to show. */
  | { readonly kind: 'closeSplit' }
  /** `zw` / `zW` — move the keyboard to the next / previous split, wrapping
      at both ends, the same ring shape `h`/`l` already give the tab strip.
      Vim's `Ctrl-w w` and `Ctrl-w W`. Refuses aloud with only one pane. */
  | { readonly kind: 'stepSplit'; readonly delta: 1 | -1 }
  | { readonly kind: 'cancel' };

export type ChordStep = {
  readonly state: ChordState;
  readonly action: KeyAction | null;
  /**
   * The keystroke that ABANDONED a half-typed chord — the prefix already
   * typed and the key that followed it — or `null` on every other step.
   *
   * The reducer knows the difference between "nothing is bound to this key"
   * and "nothing is bound to this key AFTER `g`"; its caller could not, both
   * arriving as `action: null`, so the second was as silent as the first and
   * a mistyped chord looked exactly like a frozen application. It is a field
   * rather than a `kind` on the action because nothing happens: an action is
   * something to do, and this is a report about a keystroke that did not
   * become one.
   *
   * REQUIRED, not optional: every return below has to state it, so a step
   * added later cannot inherit `null` by being forgotten.
   */
  readonly abandoned: Chord | null;
};

/**
 * The four motions, written as actions rather than as bare directions so they
 * sit in a table shaped like every other one — which is what lets the shortcut
 * sheet be generated by walking `BINDING_TABLES` instead of special-casing
 * hjkl, the one binding family a hand-written sheet would be most likely to
 * describe wrongly.
 */
const MOVES: Readonly<Record<string, KeyAction>> = {
  h: { kind: 'move', direction: 'left' },
  j: { kind: 'move', direction: 'down' },
  k: { kind: 'move', direction: 'up' },
  l: { kind: 'move', direction: 'right' },
};

/**
 * The single-key bindings.
 *
 * Chosen so a vim user does not have to learn them so much as guess them:
 * `i` stops moving and starts saying something, `I` is its stronger form and
 * moves the whole caret into the pane where saying things happens, `H` and `L`
 * are already "far left" and "far right", `o` opens a new one, `r` replaces a
 * name, `x` deletes. Only `s` (icon) and `,` (settings) are conventions borrowed
 * from elsewhere, and both are conventions rather than inventions.
 *
 * Orca's sidebar has the same capabilities under Cmd-chords — `workspace.rename`,
 * `workspace.delete`, `sidebar.search.toggle`, `sidebar.focusWorktreeList` — so
 * what is borrowed here is the vocabulary, not the keys (§4.1).
 */
const SINGLE: Readonly<Record<string, KeyAction>> = {
  i: { kind: 'prompt' },
  I: { kind: 'focusAction' },
  H: { kind: 'focusList' },
  r: { kind: 'rename' },
  s: { kind: 'icon' },
  x: { kind: 'close' },
  o: { kind: 'newSession' },
  ',': { kind: 'settings' },
  '.': { kind: 'remote' },
  // `E` for error, and Shift-e because plain `e` is worth keeping free while
  // the single-key space is this thin. Nothing in any table holds either.
  E: { kind: 'errorLog' },
  '?': { kind: 'help' },
  f: { kind: 'jump' },
  F: { kind: 'filterMenu' },
  G: { kind: 'last' },
  '/': { kind: 'search' },
  n: { kind: 'searchNext' },
  N: { kind: 'searchPrev' },
  Enter: { kind: 'open' },
  'Mod-k': { kind: 'palette' },
  // Cmd/Ctrl + a digit is THE SESSION TAB AT THAT POSITION in the focused
  // pane's strip. One meaning, in both cursor modes, whatever has the
  // keyboard.
  //
  // THIS IS THE FOURTH ARRANGEMENT, AND IT IS A DELIBERATE REVERSAL OF THE
  // THIRD. The first gave the bare row to sessions and pushed the tabs onto
  // `Mod-Shift-<digit>`; the second swapped them, because Cmd+number is the
  // TAB gesture everywhere else. The third abandoned a fixed meaning
  // altogether and made the digit CONTEXT-DEPENDENT — a session in the
  // sidebar while the sidebar had the keyboard, a view in the response pane
  // while it did — on the argument that any fixed meaning sends half the
  // operator's presses to the pane they are not looking at.
  //
  // The operator has now asked for the fixed meaning anyway, and it is their
  // call: Cmd+number is "switch tab" in every browser and every editor, they
  // live in this app, and a key whose meaning changes with the cursor is a key
  // you have to think about before pressing. The third arrangement's argument
  // is not refuted by that, it is OUTWEIGHED — so the answer to it is written
  // into the design instead of thrown away. The pane fork it worried about is
  // gone twice over: the four VIEWS moved off this modifier entirely (see
  // `Alt-<digit>` below, promoted in the change before this one), so the two
  // families can no longer collide; and the SIDEBAR's positions, the other
  // half of the old fork, are not re-homed onto some third chord to keep them
  // — they are simply gone, because `j`/`k`, `gg`/`G`, `f` and `/` already
  // reach any row and a digit that counted sidebar rows now had nothing left
  // to disambiguate it from. What is lost is jumping to sidebar row N by
  // number; that is the price, and it was quoted.
  //
  // AND THE SHIFT ROW IS STILL NOT REACHABLE. macOS binds `Cmd+Shift+3`, `4`
  // and `5` to its screenshot commands and matches them before any Electron
  // window sees the keydown (`com.apple.symbolichotkeys` entries 28-31 and
  // 184). So `Mod-Shift-3` and `Mod-Shift-4` were dead bindings in the first
  // two arrangements — first two session positions, then Terminal and Agents
  // — and no test could have caught it, because the OS never delivers the
  // event a test synthesises. Nothing goes there, in this arrangement or the
  // next one.
  //
  // The digit is 1-BASED here, because a position is what the KEY means; the
  // handler converts to an index, and 9 is the LAST tab whatever the count,
  // which is the convention the same browsers taught.
  //
  // `Mod-0` IS BOUND NOW, and both of the reasons it was not are spent. It was
  // held back first because Electron's default View menu claims
  // `CommandOrControl+0` for Actual Size — vam owns its application menu since
  // then and that menu has no `viewMenu` at all (`src/main/menu.ts`), so
  // nothing native answers the key. And second because "`z0` owns the zero":
  // `z0` is a CHORD, `z` then a bare `0`, and `normalizeKey` spells a modified
  // digit `Mod-0` — two different strings, neither reachable from the other,
  // and `z0` is asserted still working beside this.
  'Mod-0': { kind: 'focusList' },
  'Mod-1': { kind: 'selectTab', digit: 1 },
  'Mod-2': { kind: 'selectTab', digit: 2 },
  'Mod-3': { kind: 'selectTab', digit: 3 },
  'Mod-4': { kind: 'selectTab', digit: 4 },
  'Mod-5': { kind: 'selectTab', digit: 5 },
  'Mod-6': { kind: 'selectTab', digit: 6 },
  'Mod-7': { kind: 'selectTab', digit: 7 },
  'Mod-8': { kind: 'selectTab', digit: 8 },
  'Mod-9': { kind: 'selectTab', digit: 9 },
  // The response pane's four views, by name. The same digit row under the
  // OTHER modifier, and that is the whole distinction: Cmd picks a SESSION
  // TAB in the focused pane, Alt picks one of that pane's four VIEWS.
  // `normalizeKey` spells them apart (`Mod-1` vs `Alt-1`) off `event.code`, so
  // neither can answer the other's keystroke on any layout. This split is what
  // let the digit row above take a fixed meaning at all — while both families
  // shared Cmd, one of them had to lose.
  //
  // ALL NINE, though only four name a view. Digits 5-9 are what make the
  // refusal reachable: `Alt-5` says "no view 5" instead of falling through
  // to the browser, and the key sheet captions them as the nothing they are
  // rather than promising a fifth view. The same shape `position` already
  // has for digits past the tab count.
  //
  // Free when they were taken: nothing in any table held an `Alt-` key
  // (`test/keyboard/pick-view-binding.test.ts` re-derives that no two
  // actions share a chord, over the generated bindings rather than over
  // these lines). `RESERVED_KEYS` forbids nothing here — it guards the chord
  // doors — so the guarantee is uniqueness within the grammar, not a
  // registry.
  'Alt-1': { kind: 'pickView', digit: 1 },
  'Alt-2': { kind: 'pickView', digit: 2 },
  'Alt-3': { kind: 'pickView', digit: 3 },
  'Alt-4': { kind: 'pickView', digit: 4 },
  'Alt-5': { kind: 'pickView', digit: 5 },
  'Alt-6': { kind: 'pickView', digit: 6 },
  'Alt-7': { kind: 'pickView', digit: 7 },
  'Alt-8': { kind: 'pickView', digit: 8 },
  'Alt-9': { kind: 'pickView', digit: 9 },
  // `p` for project. It shipped hand-wired to its own window listener in
  // SessionList.tsx, which cost it both properties this table exists to give:
  // it appeared in no key sheet, and it fired straight through an open
  // overlay. Being here is the fix for both at once.
  p: { kind: 'revealProject' },
  // The same action as `x`, under the chord a person coming from a browser or
  // a terminal already has in their fingers. It is `Mod-w` rather than a
  // second letter because "close this thing" IS Cmd-W everywhere else.
  //
  // IT COLLIDES WITH THE WINDOW, and the collision is resolved in main:
  // Electron's default macOS menu binds Cmd-W to Close Window, and a native
  // menu key equivalent is matched before the page ever sees the keydown. So
  // `src/main/menu.ts` releases that one item at startup; without it this
  // binding would be dead in the packaged app while passing every test here.
  'Mod-w': { kind: 'close' },
  // And the same shape for creating one: `o` is the vim gesture, `Mod-n` is
  // the chord every application on the machine already spells "new". Both, not
  // one — an operator whose hands are on the prompt box reaches for Cmd-N, and
  // an operator navigating the canvas reaches for `o`.
  //
  // Free: plain `n` is `searchNext` and stays that way, since `normalizeKey`
  // gives a modified letter its own `Mod-` spelling. Deliberately reachable
  // from inside the prompt box — the tab chords let modifier keystrokes past
  // the INPUT|TEXTAREA guard, and a Cmd chord produces no character on any layout,
  // so it cannot be a keystroke the operator meant for the text.
  'Mod-n': { kind: 'newSession' },
  // And the PER-PANE one, which is a different act with a different refusal:
  // `newTab`'s own doc comment above spells out where the two diverge and why
  // it is not a third chord on `newSession`. `Mod-t` is free — plain `t` is
  // `gt`'s second key, behind the `g` door, and `normalizeKey` gives a
  // modified letter its own `Mod-` spelling. Nothing native holds it either:
  // vam's menu (`src/main/menu.ts`) is appMenu/editMenu/Window, none of which
  // carries a Cmd+T, and Electron's default accelerators do not include it.
  'Mod-t': { kind: 'newTab' },
  // Vim's own "shift this leftwards / rightwards" — literally what moving a
  // side pane's boundary is. A real Shift+, / Shift+. keydown normalizes to
  // the browser-applied `<` / `>` here, distinct from the plain `,` above
  // (proven by test, not assumed — epic.md §4.5).
  '<': { kind: 'resizePane', delta: -1 },
  '>': { kind: 'resizePane', delta: 1 },
  // `+`, `-` and `Z` were zoom in, zoom out and fit-the-canvas. The canvas
  // view they scaled was deleted in 0.2 and the handlers had been answering
  // "nothing to zoom" ever since, under key-sheet rows that still promised
  // all three. Absent, not dimmed: the bindings are gone and the keys are
  // free for a real meaning rather than kept as captions that lie.
};

const AFTER_G: Readonly<Record<string, KeyAction>> = {
  g: { kind: 'first' },
  t: { kind: 'project', delta: 1 },
  T: { kind: 'project', delta: -1 },
  m: { kind: 'moveToGroup' },
};

const AFTER_Y: Readonly<Record<string, KeyAction>> = {
  y: { kind: 'copy' },
};

/**
 * `z` is vim's "adjust the view" namespace. The three named layouts that used
 * to live here (`zc`/`zC`/`zf`) hid or reordered the canvas column, and the
 * canvas is gone (A12.1, epic.md decision 5) — `c`, `C` and `f` are free.
 * `z0` survives as the "put it back" key. It restores the two panes' default
 * WIDTHS and nothing else — the visibility it also used to restore went with
 * the settings section that was the only way to lose it (see the `resetPanes`
 * handler in `Canvas.tsx`).
 *
 * A15.1 spends four more letters here on split panes, in vim's own window
 * spelling: `s`/`v` split (horizontal/vertical), `c` closes the focused
 * split, `w`/`W` cycle focus between splits. `C` and `f` stay free.
 */
const AFTER_Z: Readonly<Record<string, KeyAction>> = {
  '0': { kind: 'resetPanes' },
  s: { kind: 'splitPane', orientation: 'column' },
  v: { kind: 'splitPane', orientation: 'row' },
  c: { kind: 'closeSplit' },
  w: { kind: 'stepSplit', delta: 1 },
  W: { kind: 'stepSplit', delta: -1 },
};

function isPrefix(key: string): key is Prefix {
  return (PREFIXES as readonly string[]).includes(key);
}

/**
 * Advance the chord machine by one key.
 *
 * Escape always wins: it cancels whatever is half-typed *and* reports the
 * cancel, because the top layer may also need closing.
 *
 * An unrecognised second key **abandons the chord** rather than falling
 * through to its standalone meaning. `gj` doing nothing is a key that was
 * wasted; `gj` moving down is the cursor going somewhere nobody asked for, and
 * on a canvas you navigate by muscle that is the more expensive mistake.
 *
 * It used to abandon it SILENTLY, and that was a second decision wearing the
 * first one's clothes. Not acting is right; saying nothing left the operator
 * two keystrokes into a deliberate spelling with an unchanged screen and no
 * way to tell an unbound pair from a frozen application. So the step reports
 * the pair it dropped (`abandoned`) and the caller refuses out loud — the
 * fallback stays closed, and the house rule that a control which cannot act
 * must be withdrawn or say so is kept by a key that cannot be withdrawn.
 */
export function resolveChord(
  state: ChordState,
  key: string,
  overrides: KeyBindings = activeBindings(),
): ChordStep {
  if (key === 'Escape') {
    return { state: EMPTY_CHORD, action: { kind: 'cancel' }, abandoned: null };
  }
  const tables = tablesFor(overrides);

  if (state.pending !== null) {
    const action = tables.chords[state.pending]?.[key];
    // A completed chord clears the memory, so `ggg` is `gg` then a fresh `g`
    // rather than two jumps to the top.
    return {
      state: EMPTY_CHORD,
      action: action ?? null,
      abandoned: action === undefined ? { prefix: state.pending, key } : null,
    };
  }

  if (isPrefix(key)) {
    return { state: { pending: key }, action: null, abandoned: null };
  }

  return { state: EMPTY_CHORD, action: tables.top[key] ?? null, abandoned: null };
}

/**
 * Every binding table, each with the key that must be typed before it.
 *
 * The one enumeration of the grammar's surface. The shortcut sheet is built by
 * walking this and looking each action up, so it is structurally incapable of
 * naming a key nothing is bound to — and a chord is spelled `prefix + key`
 * (`gt`, `yy`, `z0`) because that is the keystroke, whereas its bare second
 * key is unbound and printing it would be the very defect this guards against.
 */
export const BINDING_TABLES: readonly {
  readonly prefix: string;
  readonly table: Readonly<Record<string, KeyAction>>;
}[] = [
  { prefix: '', table: MOVES },
  { prefix: '', table: SINGLE },
  { prefix: 'g', table: AFTER_G },
  { prefix: 'y', table: AFTER_Y },
  { prefix: 'z', table: AFTER_Z },
];

/* ---------------------------------------------------------------------------
 * Operator overrides.
 *
 * The tables above are the SHIPPED grammar; what is actually in force is the
 * shipped grammar with the operator's overrides laid over it. Everything below
 * derives that, and both readers of the grammar — `resolveChord` and the
 * shortcut sheet — go through it, so the sheet keeps the one property it was
 * written for: it can only name a key that is really bound.
 * ------------------------------------------------------------------------ */

/** How many keys one action may hold. Two: the shipped table already binds
 *  `close` twice (`x`, `Mod-w`), and a third is a keymap, not a preference. */
export const MAX_BINDINGS = 2;

/**
 * The keys nothing may be bound to, named HERE and nowhere else.
 *
 * `Escape` because it is how a capture box is cancelled and how every overlay
 * closes (an open overlay owns the keyboard entirely), so a binding on it
 * would be unreachable at best and a trap at worst. `g`, `y` and `z` because
 * they are not keys, they are the doors to the chord tables: bound alone, they
 * would shadow every chord behind them.
 */
export const RESERVED_KEYS: readonly string[] = ['Escape', ...PREFIXES];

export function isReserved(key: string): boolean {
  return RESERVED_KEYS.includes(key);
}

/**
 * A stable, storable name for one action.
 *
 * Parameterised actions carry their parameter, or every `move` would share one
 * id and rebinding `h` would rebind all four.
 */
export function actionId(action: KeyAction): string {
  switch (action.kind) {
    case 'move':
      return `move:${action.direction}`;
    case 'selectTab':
      return `selectTab:${action.digit}`;
    case 'pickView':
      return `pickView:${action.digit}`;
    case 'project':
      return `project:${action.delta}`;
    case 'resizePane':
      return `resizePane:${action.delta}`;
    case 'splitPane':
      return `splitPane:${action.orientation}`;
    case 'stepSplit':
      return `stepSplit:${action.delta}`;
    default:
      return action.kind;
  }
}

/** One keystroke: a top-level key, or a chord's second key behind its prefix. */
export type Chord = { readonly prefix: string; readonly key: string };

/** What the operator stored: action id → the keys it holds. An ABSENT id means
 *  "the shipped bindings"; a present one replaces them, including an empty
 *  array, which is the honest spelling of "I unbound this". */
export type KeyBindings = Readonly<Record<string, readonly string[]>>;

export const NO_BINDINGS: KeyBindings = {};

export type Binding = {
  readonly id: string;
  readonly action: KeyAction;
  readonly chords: readonly Chord[];
};

/** How a chord is written down — in the sheet, in a slot, and in storage. */
export function chordText(chord: Chord): string {
  return `${chord.prefix}${chord.key}`;
}

/** The inverse. Only a two-character string opening with a prefix is a chord:
 *  a captured keystroke is a single character or a named key (`Enter`,
 *  `Mod-k`), never `gt`, so nothing an operator can press parses as one. */
export function parseChord(text: string): Chord {
  const head = text[0] ?? '';
  return text.length === 2 && isPrefix(head)
    ? { prefix: head, key: text.slice(1) }
    : { prefix: '', key: text };
}

/** The shipped grammar as one entry per action, in table order. */
export function defaultBindings(): readonly Binding[] {
  const out: Binding[] = [];
  const at = new Map<string, number>();
  for (const { prefix, table } of BINDING_TABLES) {
    for (const [key, action] of Object.entries(table)) {
      const id = actionId(action);
      const seen = at.get(id);
      const previous = seen === undefined ? undefined : out[seen];
      if (seen === undefined || previous === undefined) {
        at.set(id, out.length);
        out.push({ id, action, chords: [{ prefix, key }] });
      } else {
        out[seen] = { ...previous, chords: [...previous.chords, { prefix, key }] };
      }
    }
  }
  return out;
}

const DEFAULTS = defaultBindings();

/** The shipped grammar with the overrides laid over it: what is in force. */
export function effectiveBindings(overrides: KeyBindings = activeBindings()): readonly Binding[] {
  return DEFAULTS.map((binding) => {
    const chosen = overrides[binding.id];
    return chosen === undefined ? binding : { ...binding, chords: chosen.map(parseChord) };
  });
}

/** The chords one action holds right now, as the operator's slots show them. */
export function bindingChords(overrides: KeyBindings, id: string): readonly string[] {
  return (
    effectiveBindings(overrides)
      .find((binding) => binding.id === id)
      ?.chords.map(chordText) ?? []
  );
}

/**
 * The action `key` already belongs to, or null when it is free.
 *
 * Read off what is IN FORCE, not off the shipped tables: a key the operator
 * freed a moment ago by moving its action elsewhere is free, and a key they
 * just took is taken.
 */
export function bindingConflict(overrides: KeyBindings, id: string, key: string): string | null {
  for (const binding of effectiveBindings(overrides)) {
    if (binding.id === id) continue;
    if (binding.chords.some((chord) => chord.prefix === '' && chord.key === key)) {
      return binding.id;
    }
  }
  return null;
}

/**
 * Put `key` in one of an action's slots.
 *
 * Seeded from what the action holds now, so editing the second slot of an
 * action whose first is a chord (`gg`, `yy`) does not silently unbind the
 * chord — it cannot be retyped into a capture box, so dropping it would be a
 * one-way door.
 */
export function bindKey(
  overrides: KeyBindings,
  id: string,
  slot: number,
  key: string,
): KeyBindings {
  const next = [...bindingChords(overrides, id)];
  const index = Math.min(Math.max(slot, 0), Math.min(next.length, MAX_BINDINGS - 1));
  next[index] = key;
  return { ...overrides, [id]: next.slice(0, MAX_BINDINGS) };
}

/** Back to the shipped bindings for one action — by REMOVING the override,
 *  never by storing today's keys, which would freeze them forever. */
export function clearBindings(overrides: KeyBindings, id: string): KeyBindings {
  const next: Record<string, readonly string[]> = {};
  for (const key of Object.keys(overrides)) {
    if (key !== id) {
      next[key] = overrides[key] as readonly string[];
    }
  }
  return next;
}

type Tables = {
  readonly top: Record<string, KeyAction>;
  readonly chords: Record<string, Record<string, KeyAction>>;
};

function buildTables(overrides: KeyBindings): Tables {
  const top: Record<string, KeyAction> = {};
  const chords: Record<string, Record<string, KeyAction>> = {};
  for (const prefix of PREFIXES) {
    chords[prefix] = {};
  }
  const bindings = effectiveBindings(overrides);
  const put = (binding: Binding) => {
    for (const chord of binding.chords) {
      const table = chord.prefix === '' ? top : chords[chord.prefix];
      if (table !== undefined) {
        table[chord.key] = binding.action;
      }
    }
  };
  // Shipped bindings first, overrides second: if the operator took a key that
  // something else still holds by default, the operator wins — deterministically
  // rather than by table order. The UI refuses that bind before it gets here;
  // this is what happens when a hand-edited payload does it anyway.
  for (const binding of bindings) {
    if (overrides[binding.id] === undefined) put(binding);
  }
  for (const binding of bindings) {
    if (overrides[binding.id] !== undefined) put(binding);
  }
  return { top, chords };
}

let active: KeyBindings = NO_BINDINGS;
let cachedFor: KeyBindings | null = null;
let cached: Tables = buildTables(NO_BINDINGS);

function tablesFor(overrides: KeyBindings): Tables {
  if (cachedFor !== overrides) {
    cached = buildTables(overrides);
    cachedFor = overrides;
  }
  return cached;
}

/**
 * Hand the grammar the operator's overrides.
 *
 * A module-level singleton on purpose: `resolveChord` is called from a window
 * listener and `buildKeySheet` from two overlays, none of which is the owner of
 * the preferences, and threading a binding map through all three would be a
 * change to files this feature has no business editing. `prefs.ts` calls this
 * on every read and every write, so "what is stored" and "what is in force"
 * cannot drift.
 */
export function setActiveBindings(overrides: KeyBindings): void {
  active = overrides;
}

export function activeBindings(): KeyBindings {
  return active;
}
