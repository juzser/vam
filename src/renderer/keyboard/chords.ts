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
 * IS THE COMMAND MODIFIER Cmd RATHER THAN Ctrl? — asked of a platform string,
 * so BOTH answers are reachable in a test.
 *
 * `src/main/menu.ts` takes `process.platform` as a parameter for exactly this
 * reason and says so in one line: "the non-darwin branch is reachable in a
 * test". The renderer has no `process`, so the string is `navigator.platform`
 * ("MacIntel", "Linux x86_64", "Win32"), with the user agent behind it for a
 * runtime that reports no platform at all.
 *
 * DEPRECATED AND STILL THE RIGHT QUESTION. `navigator.platform` is frozen
 * rather than removed in every engine vam runs on — Chromium in the packaged
 * app, and whatever browser reaches the Tailscale Serve build — and what is
 * asked of it is which physical key the OPERATING SYSTEM puts the command
 * modifier on, which is the one thing it has always answered.
 *
 * IT DECIDES WHICH KEYSTROKE SPELLS `Mod-`, everywhere but the bracket pair.
 * Two separate operator decisions put it there: the digit row (`digitChord`)
 * and, on PR 361, the letters (`CTRL_GESTURES`). The brackets are what is
 * left folded — `Ctrl-[` and `Cmd+[` both leave the prompt box, on every
 * platform — and the two comments below argue each half.
 */
export function isApplePlatform(description: string): boolean {
  return /Mac|iPhone|iPad|iPod/.test(description);
}

/**
 * The answer for THIS machine, read once.
 *
 * Every platform-sensitive test passes the flag to `normalizeKey` explicitly
 * rather than reaching this: CI runs on ubuntu and the operator's machine is a
 * Mac, so a test that read the platform off its host would assert a different
 * grammar in each place while looking identical in both.
 */
const APPLE_PLATFORM = isApplePlatform(
  globalThis.navigator?.platform ?? globalThis.navigator?.userAgent ?? '',
);

/**
 * THE SAME QUESTION, ASKED AT THE MOMENT OF A PAINT — `chordSymbols`' default,
 * and the reason it is a function rather than the const above it.
 *
 * A RUNTIME ANSWER AND NEVER A BUILD-TIME ONE. `build:web` is served over
 * Tailscale to whatever machine picks it up, so the bundle that paints ⌘ for
 * the operator's Mac has to paint `Ctrl` for a PC reading the same bytes. A
 * constant folded at build time would ship one platform's keyboard to both.
 *
 * READ LIVE rather than cached, for the same reason `isApplePlatform` takes a
 * string at all: a React component has no flag to pass down, so this is the
 * only seam a test has to put the other platform in front of one. The cost is
 * one small regex per chord PAINTED, which is a keystroke's worth of work in a
 * place no keystroke is being handled.
 */
export function applePlatform(): boolean {
  return isApplePlatform(globalThis.navigator?.platform ?? globalThis.navigator?.userAgent ?? '');
}

/**
 * THE DIGIT ROW, WHERE Ctrl AND Cmd ARE NOT ONE KEY ANY MORE.
 *
 * `Mod-` folds them together everywhere else in this grammar, and the fold is
 * right wherever the two spellings mean ONE INTENT. On the digit row they
 * stopped meaning one: the operator reported that "Ctrl+number seems to be
 * conflicting between switching function and switching tab", cancelled
 * Ctrl+number outright, and asked for the view row on a three-key chord. Two
 * families that shared one string are four distinct ones now, and only an
 * unfolded spelling can write them down at all.
 *
 *   Mod-<digit>        THE COMMAND MODIFIER — Cmd on macOS, Ctrl elsewhere
 *   Ctrl-<digit>       macOS's Control, and bound to NOTHING
 *   Ctrl-Alt-<digit>   the three-key chord: a view in the focused pane
 *   Alt-<digit>        bound to nothing, since the view row left it
 *
 * `Mod-` KEEPS ITS SPELLING, deliberately. `Mod-0`..`Mod-9` and `Mod-[` are
 * written into `docs/keyboard.md` rows, into `panels/files-tree.ts`'s key
 * lists and into `DetailPanel`'s own `onKeyDown`, and none of those readers
 * has any business learning a new token because one row's MEANING narrowed.
 * What changed here is which physical key produces it, not what the string
 * is called.
 *
 * ONE RULE, COVERING EVERY PLATFORM vam SHIPS (`electron-builder.config.cjs`
 * builds dmg/zip, AppImage and nsis/zip): CONTROL SPELLS `Ctrl-` WHEN IT IS
 * NOT THE COMMAND MODIFIER — always on macOS, and elsewhere only when Alt is
 * held, because `Ctrl+Alt` is the three-key chord rather than a command chord.
 * So `Ctrl-Alt-<digit>` is ONE table entry naming the SAME physical keystroke
 * on all three, while `Mod-<digit>` is Cmd on macOS and Ctrl on Linux and
 * Windows — which is what leaves a tab row on the two platforms that have no
 * Cmd key at all. Meta is the command modifier off macOS too, so a
 * Super+<digit> that reaches the page lands on the tab row rather than losing
 * every token and arriving as a BARE digit, which is a real keystroke
 * elsewhere (`z0`, and the question card's option marks).
 *
 * AND THE COSTS, QUOTED RATHER THAN LEFT TO BE DISCOVERED:
 *
 *   IN A BROWSER TAB, macOS LOSES THE SPELLING THAT GOT THROUGH. Chrome and
 *   Safari reserve `Cmd+1`..`Cmd+9` for their own tabs and a page cannot
 *   cancel them (`test/keyboard/browser-contested-chords.test.ts` keeps that
 *   census); Ctrl+<digit> was the one spelling the browser did not want, and
 *   it is gone. The desktop app is unaffected — vam owns its application menu
 *   and nothing native holds the row.
 *
 *   ON WINDOWS AND LINUX, AltGr IS Ctrl+Alt. A layout with an AltGr key
 *   reports both modifiers for a keystroke that TYPES a character, so the view
 *   row is reachable there by accident in a way it is not on macOS, where
 *   Option composes on its own. It is the hazard `toggleFocusView`'s comment
 *   records for `Alt-<letter>`, one modifier along, and it cannot be fixed
 *   from the page: no browser tells AltGr apart from a real Ctrl+Alt.
 *
 * THE BRACKET PAIR IS NOT HERE, AND STAYS FOLDED. It sits in `POSITION_CODES`
 * for the same reason the digits do — a modifier changes the character it
 * produces — but Ctrl and Cmd still mean one intent on it, and `Ctrl-[` is
 * vim's own way out of insert mode, promised by name in `docs/keyboard.md`
 * and answered by `DetailPanel` and `FilesTab`. The fold is lifted exactly where
 * the two modifiers stopped agreeing, and nowhere else.
 */
/**
 * THE LETTERS vam KEEPS UNDER CTRL — the whole exception, as data.
 *
 * THE RULE THIS IS AN EXCEPTION TO. The operator, on PR 361: "Ctrl + a letter
 * applies only to the terminal, like the default terminal shortcuts." Four of
 * the eight `Mod-<letter>` chords vam shipped are readline's own — `Ctrl+K`
 * kill-to-end, `Ctrl+W` delete-word-back, `Ctrl+N` next-history, `Ctrl+T`
 * transpose — and a keystroke a terminal has a meaning for should not also be
 * an application command. So on macOS `Mod-<letter>` is Cmd and only Cmd, and
 * `Ctrl+<letter>` belongs to whatever is being typed into.
 *
 * AND THE TWO THAT STAY, BECAUSE THE OPERATOR DREW THE LINE HIMSELF. Asked
 * about exactly these: "Keep them in the Response view; drop them in the
 * terminal." `Mod-d` / `Mod-u` are vim's `Ctrl-D` / `Ctrl-U` — they were asked
 * for by that name — and they are gestures for READING A TRANSCRIPT, not
 * application commands. Cmd+D / Cmd+U is not where a vim user's hand goes.
 *
 * THE "DROP THEM IN THE TERMINAL" HALF IS ALREADY PAID, TWICE OVER, and is not
 * this list's job: `isSelectOnly` stands `scrollHalf` down wherever the cursor
 * is in Insert (the terminal pane carries `data-insert-scope`), and
 * `TerminalTab.tsx` claims every plain Ctrl+letter and stops it before the
 * window listener sees it. This list is only about which keystroke SPELLS the
 * binding.
 *
 * A LIST RATHER THAN A CONDITION, deliberately. "Ctrl is the command modifier
 * unless the action is one that scrolls" would put the grammar's table inside
 * its normaliser — which runs BEFORE resolution and must stay table-blind, or
 * an operator's rebind would silently move which keystrokes fold. Two letters,
 * named, with the reason above them, is the readable form of an exception that
 * is genuinely not derivable.
 *
 * KEYED ON THE LOWER-CASED LETTER, the same base a modified letter is spelled
 * with, so CapsLock cannot take an operator out of the fold.
 *
 * OFF macOS THIS LIST DOES NOTHING. Control IS the command modifier on Linux
 * and Windows, so every `Mod-<letter>` answers Ctrl there whether or not it is
 * named here — which is what keeps `palette`, `newTab`, `close`,
 * `newSession`, `focusList` and `newProject` reachable on the two platforms
 * with no Cmd key at all.
 */
const CTRL_GESTURES: ReadonlySet<string> = new Set(['d', 'u']);

function digitChord(event: KeyEventLike, position: string, mac: boolean): string {
  const ctrl = event.ctrlKey === true;
  const alt = event.altKey === true;
  const command = mac ? event.metaKey === true : (ctrl && !alt) || event.metaKey === true;
  const control = ctrl && (mac || alt);
  const shift = event.shiftKey === true;
  return `${command ? 'Mod-' : ''}${control ? 'Ctrl-' : ''}${alt ? 'Alt-' : ''}${shift ? 'Shift-' : ''}${position}`;
}

/**
 * A `KeyboardEvent` reduced to the one string a binding is written in, or
 * `null` when the event is not a keystroke at all.
 *
 * `Mod` IS THE PLATFORM'S COMMAND MODIFIER: Cmd on macOS, Ctrl on Linux and
 * Windows. The token itself is borrowed from orca (§4.1).
 *
 * IT USED TO FOLD THE TWO TOGETHER, on the argument that vam runs on one
 * machine at a time, both spellings mean the same intent, and keeping them
 * apart would mean declaring every binding twice. TWO OPERATOR DECISIONS ENDED
 * THAT, each because the premise stopped holding for a family:
 *
 *   THE DIGIT ROW (`digitChord`). Ctrl+number and Cmd+number were given two
 *   different fates — one cancelled, one kept — so they no longer mean one
 *   intent and one token cannot carry both.
 *
 *   THE LETTERS (`CTRL_GESTURES`). "Ctrl + a letter applies only to the
 *   terminal, like the default terminal shortcuts": four of vam's eight letter
 *   chords are readline's own, and a keystroke a terminal has a meaning for
 *   should not also be an application command. Two letters are excepted BY
 *   NAME, `d` and `u`, because they are vim's gestures for reading a
 *   transcript rather than commands.
 *
 * WHAT IS STILL FOLDED IS THE BRACKET PAIR, and only it: `Ctrl-[` is vim's own
 * way out of insert mode, `docs/keyboard.md` promises it by name, and the bracket
 * chords mean one intent under either modifier. So `Mod-[`, `Mod-Shift-[` and
 * `Mod-Alt-[` answer Ctrl and Cmd alike, everywhere.
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
 * THAT IS A FACT ABOUT CMD, AND IT DECIDED THE VIEW ROW'S CHORD. The operator
 * offered two three-key chords for the views, Ctrl+Option+number and
 * Ctrl+Shift+number. While Ctrl and Cmd were one token, the screenshot keys
 * barred the whole Shift row rather than half of it, so Ctrl+Shift+3/4/5 could
 * not be told apart here from the three gestures macOS had already eaten —
 * three dead digits in the middle of a nine-digit family. Ctrl+Option has no
 * such hole, and is what `SINGLE` binds.
 *
 * `event.code` answers all of it: `Digit1` and `BracketLeft` are POSITIONS,
 * whatever the layout put on them, so those keys keep one spelling everywhere
 * and Shift can carry a token there without giving any keystroke a second one.
 * Letters stay folded.
 *
 * Returning `null` for a bare modifier is what stops reaching for a shortcut
 * and thinking better of it from silently eating a half-typed `g`.
 *
 * `mac` IS A PARAMETER, defaulting to this machine, because the digit row's
 * answer differs by platform and both answers have to be assertable from one
 * test run — see `isApplePlatform`.
 */
export function normalizeKey(event: KeyEventLike, mac: boolean = APPLE_PLATFORM): string | null {
  if (MODIFIER_KEYS.has(event.key)) {
    return null;
  }
  const mod = event.ctrlKey === true || event.metaKey === true;
  const alt = event.altKey === true;
  if (!mod && !alt) {
    // THE DIGIT ROW IS A POSITION HERE TOO — the same `event.code` read the
    // modified branch below makes, for the same reason, now that a BARE digit
    // is a binding (`SELECT_DIGITS`).
    //
    // The argument is this function's own and is not restated: those bindings
    // are about a POSITION rather than a character, and a character-based
    // spelling cannot keep that promise. It failed twice for the modified
    // digits and would fail here identically — AZERTY puts `&` on the
    // unshifted `Digit1`, so a bare `1` matched off `event.key` would be dead
    // on that layout while `Ctrl-Alt-1` beside it kept working. One row,
    // two spellings, and a key sheet that is true in one place only.
    //
    // AND SHIFT GETS ITS TOKEN, WHICH IS WHAT ANSWERS THE OPERATOR'S OTHER
    // SUGGESTION. They asked for "a number, or Shift+number": Shift ALTERS a
    // digit, so `Shift+1` is `!` on a US layout and `1` on AZERTY, and a
    // character spelling would give one keystroke two spellings with only one
    // of them ever matching. Positionally it is `Shift-1`, a keystroke of its
    // own, bound to nothing — so a shifted digit can never answer the
    // unshifted binding on any layout. That is the same thing the bracket
    // pair's `Shift-` token buys one branch down.
    //
    // ONLY DIGITS, DELIBERATELY. `positionKey` answers for the bracket pair
    // too, and folding those in here would change the spelling of bare `[`,
    // `]`, `{` and `}` — four keys nothing binds — for no behaviour at all.
    // The rule below, that a shifted CHARACTER is already itself, is untouched
    // for every key that is not on the number row.
    const digit = positionKey(event);
    if (digit !== null && /^[0-9]$/.test(digit)) {
      return event.shiftKey === true ? `Shift-${digit}` : digit;
    }
    // THE SAME HAZARD AS BELOW, UNGUARDED HERE. CapsLock upper-cases a bare
    // letter exactly the way it upper-cases a modified one, and the browser
    // hands back whatever case is currently active with `shiftKey: false` --
    // indistinguishable at the character level from a real Shift press. The
    // modified branch a few lines down already carries the fix and says so in
    // its own comment; returning `event.key` raw here is the same mistake the
    // comment argues against, just not applied. Under CapsLock every bare
    // letter arrived upper-cased and resolved against the wrong binding or
    // against none: `i` as `I` (`focusAction` instead of `prompt`), `g` as `G`
    // (`last`, so the `g` prefix could never open, taking `gg`/`gt`/`gT`/`gm`
    // down with it), and `h j k l x r s o p` matched nothing and died
    // silently -- `resolveChord` returns `action: null` for an unbound key,
    // which looks identical to a frozen application.
    //
    // `shiftKey` decides the case, not the character the browser produced --
    // the same substitution the branch below makes, for the same reason: a
    // real Shift press and a CapsLock press are not the same intent, and only
    // `shiftKey` tells them apart. This also settles CapsLock+Shift, where the
    // browser hands back a LOWERCASE letter (the two cancel): holding Shift
    // still means the operator wants the Shift binding, and `shiftKey` alone
    // gives them one.
    //
    // ONLY LETTERS. A shifted CHARACTER is already itself -- `?` arrives as
    // `?`, `<` as `<`, `>` as `>` -- and those are real bindings in this
    // grammar, so folding them by `shiftKey` too would give one keystroke two
    // spellings and only one would ever match: the exact defect this fixes,
    // reintroduced one clause wider. `Enter`, `Escape` and every other named
    // key is longer than one character and passes through untouched.
    return /^[a-zA-Z]$/.test(event.key)
      ? event.shiftKey === true
        ? event.key.toUpperCase()
        : event.key.toLowerCase()
      : event.key;
  }
  const position = positionKey(event);
  if (position !== null) {
    // THE DIGIT ROW ASKS WHICH MODIFIER, the bracket pair does not. Both are
    // positions and both read `event.code`; only the digits had their fold
    // lifted, and `digitChord` carries the whole argument for why the line
    // falls between the two halves of one table.
    return /^[0-9]$/.test(position)
      ? digitChord(event, position, mac)
      : `${mod ? 'Mod-' : ''}${alt ? 'Alt-' : ''}${event.shiftKey === true ? 'Shift-' : ''}${position}`;
  }
  // A LETTER KEEPS ITS SHIFT, AS A TOKEN, AND LOSES IT AS CASE.
  //
  // The base is still lower-cased, so one gesture still has exactly one
  // spelling; what the token adds is the distinction the lower-casing used to
  // destroy. `shiftKey` rather than the case the browser handed back, because
  // CapsLock upper-cases a letter too and nobody means Cmd+Shift+H by holding
  // CapsLock and pressing Cmd+H.
  //
  // ONLY LETTERS. A shifted CHARACTER is already itself -- `?` arrives as `?`
  // -- so a token there would give one keystroke two spellings and only one of
  // them would ever match. That is the rule the paragraph above states, and
  // this is the case it did not cover: for a letter the browser folds Shift
  // into the CASE, and a normaliser that lower-cases has thrown it away.
  const base = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const shifted = event.shiftKey === true && /^[a-z]$/.test(base);
  // AND CTRL IS NOT CMD HERE EITHER, FOR ALL BUT TWO LETTERS. `CTRL_GESTURES`
  // above carries the operator's rule, which two keep the fold and why the
  // exception is written as a list rather than as a condition.
  //
  // ONE RULE ACROSS BOTH BRANCHES: Control spells `Ctrl-` exactly when it is
  // NOT acting as the command modifier for this key — which is `digitChord`'s
  // rule with a different answer to "is it?". So an extra modifier is always a
  // different keystroke: `Cmd+Ctrl+K` is `Mod-Ctrl-k` and answers nothing,
  // rather than reaching `Mod-k` by having a token quietly dropped.
  const ctrlIsCommand = mac ? event.ctrlKey === true && CTRL_GESTURES.has(base) : true;
  const command = mac ? event.metaKey === true || ctrlIsCommand : mod;
  const control = event.ctrlKey === true && !ctrlIsCommand;
  return `${command ? 'Mod-' : ''}${control ? 'Ctrl-' : ''}${alt ? 'Alt-' : ''}${shifted ? 'Shift-' : ''}${base}`;
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
  /** `Mod-Shift-h` / `Mod-0` — back to the session list on the left. `Mod-0`
      sits at the head of the digit row it belongs to: the digits pick a tab,
      and zero is the way out of the tabs entirely. Refuses aloud rather than
      doing nothing when the keyboard is already there. */
  | { readonly kind: 'focusList' }
  /** `r` — rename the focused session in place. */
  | { readonly kind: 'rename' }
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
  /** `Mod-Shift-p` — a NEW PROJECT: choose a directory, then start a session
      in it. vam has no stored project — a project is a grouping of live
      sessions on their cwd — so that is the only thing "create a project"
      can mean, and the directory is why this is the one create path that
      opens a dialog first. It calls the same `newProject` the Projects
      header's `+` does (`Canvas.tsx`), so the key and the button cannot
      drift into two behaviours or two refusals.

      NOT `project`, WHICH IS `gt`/`gT`. That one STEPS between projects that
      already exist — and its caption had to be corrected once precisely
      because its name said less than its behaviour did. This one creates the
      conditions for a project to exist at all, and `newProject` names that
      verb in the family it belongs to: `newSession` (`o`/`Mod-n`) starts one
      in the focused session's project, `newTab` (`Mod-t`) in the focused
      pane's, and this one in a directory nothing is running in yet.

      THE OPERATOR ASKED FOR `Cmd+Shift+P`, AND `Mod-Shift-p` IS THAT
      KEYSTROKE — NOW. It used to live on `Mod-p`: `normalizeKey` folded
      Shift away for a letter under a modifier, so a real `Cmd+Shift+P`
      keydown arrived spelled `Mod-p` and a table entry written
      `Mod-Shift-p` would have been a string no keystroke produced. That fold
      is gone — lifted for `Mod-Shift-h` (see the `focusList` binding below),
      which needed the two gestures kept apart so it would not answer to
      `Cmd+H`, macOS's own Hide — and once a modified letter carries its
      Shift, `Cmd+Shift+P` has its own true spelling and the binding moved to
      it rather than going on answering to the folded one.

      AND THE COST, QUOTED, NO LONGER PAID: `Cmd+P` (`Mod-p`) used to be the
      same folded gesture and reach this same act; today it is a distinct,
      unbound spelling. Nothing native answers it either way — vam owns its
      application menu and it is appMenu/editMenu/Window, none of which
      carries a Cmd+P (`src/main/menu.ts`) — so in the browser build `Cmd+P`
      keeps reaching the browser's own print dialog, which is what the
      operator's request preserved rather than gave up.

      `p` FOR PROJECT, one modifier above the bare `p` that REVEALS the
      focused session's project: the same subject, and `normalizeKey` gives a
      modified letter its own `Mod-` spelling, so neither can answer the
      other's keystroke. Free when it was taken — nothing in any table held
      `Mod-Shift-p`, and `test/keyboard/chords.new-project.test.ts` re-derives
      that over the generated bindings rather than over this line. */
  | { readonly kind: 'newProject' }
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
  /**
   * `zf` -- FOLD, and the key is chosen rather than settled for.
   *
   * `z` IS ALREADY THE DISPLAY PREFIX here (`z0` widths, `zs`/`zv` split,
   * `zc` close, `zw`/`zW` panes) and it is vim's own fold namespace, where
   * `zf` creates one. So the mnemonic costs nothing to learn and the act lands
   * in the table it belongs to.
   *
   * NOT `Alt-f`, WHICH WAS THE OBVIOUS PICK AND FAILS TWICE. On macOS `Alt` is
   * Option and Option-F produces `ƒ`: `normalizeKey` would spell the chord
   * `Alt-ƒ` and the binding would simply never match. That is the reason
   * `POSITION_CODES` exists at all -- "a modifier CHANGES the character these
   * keys produce" -- and it covers the digit row and the brackets, not
   * letters, which is why every binding vam holds under Alt is a DIGIT
   * (`Ctrl-Alt-<digit>`, `Mod-Alt-[`) and there is not one `Alt-<letter>` in
   * this file. Worse, no guard here could have
   * caught it: Playwright's injected `Alt+f` carries `key: 'f'`, so it would
   * have gone green on a chord that is dead on the operator's own machine.
   *
   * AND NOT A `Mod-` CHORD, for the reason the census in
   * `test/keyboard/browser-contested-chords.test.ts` records: fifteen of vam's
   * twenty-one are already contested by the browser, and adding a sixteenth
   * for a brand-new binding would be choosing a known problem. A bare chord
   * after a bare prefix is contested by nothing at all.
   */
  | { readonly kind: 'toggleFocusView' }
  /** `Mod-1` … `Mod-9` — the SESSION TAB at that position, 1-based, counted
      ACROSS EVERY PANE ON SCREEN in the order the strips draw them. One fixed
      meaning in either cursor mode: the operator asked for the gesture every
      browser and editor already has, and `SINGLE` records the five
      arrangements this row has been through and what this one cost.

      WHICH STRIP, when the shell is split: ALL OF THEM, as one list, in leaf
      order — left to right, top to bottom. It was the FOCUSED pane's own
      until the operator asked for this, on the grounds that a split is one
      screen and the tab they can see should be the tab the number names.
      Selecting a tab that lives in another pane moves the keyboard there with
      it, which is what `focusSession` already does for a sidebar pick of a
      session another pane holds.

      The action carries the digit and NOTHING ELSE. Which sessions the strips
      are drawing is not something a reducer over a one-key memory can know —
      `Canvas` owns the pane tree — so resolving it here would mean either
      threading React state into the grammar or keeping a second copy of it. */
  | { readonly kind: 'selectTab'; readonly digit: number }
  /** `Mod-Shift-[` / `Mod-Shift-]` — the previous / next SESSION TAB, over the
      same across-panes list `selectTab` counts, wrapping at both ends.

      THE BROWSER'S OWN TAB GESTURE ON macOS, and app-level, which is what
      makes it safe where its digit cousin is not: nothing in
      `com.apple.symbolichotkeys` claims the brackets, while entries 28-31 and
      184 take `Cmd+Shift+3/4/5` before any Electron window sees the keydown.

      DISTINCT FROM `h`/`l` on purpose. Those cycle the ACTIVE PROJECT's tabs
      in Select and belong to the question card in Insert; this steps what is
      on screen from wherever the keyboard is — including from inside the
      prompt box, which is where the reason to look at another tab comes from.

      A RING, not a run with two ends: it steps the same closed list the digits
      address, so the last tab's next is the first. `j`/`k` walk an open-ended
      session list and stop at the ends; these walk a strip, and every tab
      strip's own arrows wrap. */
  | { readonly kind: 'stepTab'; readonly delta: 1 | -1 }
  /** `Ctrl-Alt-1` … `Ctrl-Alt-9` — pick a VIEW in the focused response pane:
      Response, PRs, Terminal, Agents. A SLOT IN `TABS`, never a position in
      the drawn bar — `Ctrl-Alt-3` is Terminal because Terminal is `TABS[2]`,
      whether or not this source offers one, and `tabForDigit` is the one
      place that resolution happens (`panels/tabs.ts`; A5.4/A15.6, won twice
      after positional indexing shipped as a bug twice).

      A THREE-KEY CHORD AT THE OPERATOR'S REQUEST. It was `Alt-<digit>` until
      they reported Ctrl+number "conflicting between switching function and
      switching tab"; the table entry below carries which of their two
      suggested chords this is and why. `Alt-<digit>` answers nothing now —
      the view row moved rather than gaining a short form.

      Distinct from `position` on purpose. `position` means whatever the
      focused PANE counts — a session in Select, a tab in Insert — and
      changes meaning with the cursor mode; this one names the same view in
      both, which is why it carries no `byMode` caption in the key sheet.

      It shipped OUTSIDE this table, as a bare `window` listener in
      `DetailPanel.tsx`, and paid for it four ways: absent from a key sheet
      whose contract is "every binding is here", not rebindable while its
      `Mod-` cousin was, its chord hand-written into an `aria-label` a screen
      reader repeated on every focus, and an operator override free to take
      the chord it listened for — after which the override and the listener
      both answered one keystroke. Being here is the fix for all four, and the
      second listener is gone rather than guarded. It is also what made THIS
      move a one-line change rather than a hunt: the chord lives in one table,
      and the tooltip, the key sheet and the settings editor all read it. */
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
  /** `Mod-d` / `Mod-u` — HALF A SCREEN down / up the FOCUSED PANE's transcript
      column, which is what `Ctrl-D` and `Ctrl-U` do in vim and what the
      operator asked for by name. The distance is half the column's own
      `clientHeight` and the arithmetic is `halfPageTarget`
      (`panels/stick-to-bottom.ts`), which reads the ends off the same two
      predicates the floating jump controls are drawn from.

      THE FOCUSED PANE, like `Mod-<digit>` and `Mod-t`: a split is one screen,
      and the column that scrolls is the one in the pane holding the keyboard.

      IT IS THE ONE BINDING IN THIS TABLE THAT STANDS DOWN IN INSERT
      (`isSelectOnly` below carries the argument). Every other `Mod-` chord is
      deliberately reachable from inside the prompt box; these two cannot be,
      because inside a text field `Ctrl-D` is delete-forward and `Ctrl-U` is
      delete-to-line-start.

      AND `Cmd+D` IS THE SAME CHORD — THE LAST PAIR IN THE TABLE OF WHICH
      THAT IS TRUE. `normalizeKey` used to fold Ctrl and Cmd into one `Mod-`
      token for every binding; these two letters are all that is left of it
      (`CTRL_GESTURES`), because the operator kept them by name when every
      other Ctrl+letter went to the terminal on PR 361: "keep them in the
      Response view; drop them in the terminal." So `Mod-d` is `Cmd+D` AND
      `Ctrl+D`, deliberately, and `test/keyboard/chords.half-page.test.ts`
      pins both spellings — losing either one reddens.

      THE OTHER SIX WENT THE OTHER WAY, and it is the same test applied twice:
      `Mod-k`, `Mod-n`, `Mod-t`, `Mod-w`, `Mod-Shift-h` and `Mod-Shift-p` are
      APPLICATION COMMANDS, four of them readline's own chords, so Control
      belongs to whatever is being typed into. These two are gestures for
      READING, so Control is where a vim user's hand goes. */
  | { readonly kind: 'scrollHalf'; readonly delta: 1 | -1 }
  | { readonly kind: 'cancel' };

type ChordStep = {
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
 * moves the whole caret into the pane where saying things happens, `o` opens
 * a new one, `r` replaces a name, `x` deletes. Only `,` (settings) is a
 * convention borrowed from elsewhere, and it is a convention rather than an
 * invention. (Bare `H`/`L` used to sit here too, as "far left"/"far right";
 * `H` moved to `Mod-Shift-h` at the operator's request and `L` is unbound —
 * neither is a single-key guess any more.)
 *
 * `s` IS FREE, AND IS LEFT FREE. It held `icon`, the session-icon picker,
 * until the operator removed that feature outright ("remove the picker", once
 * pull request 433 had taken the last surface that drew a session icon off
 * the tab). A
 * freed key is worth more empty than spent: handing `s` to something else
 * would make an operator's muscle memory do a NEW thing silently, which is a
 * worse trade than the one keystroke it saves. Whoever wants it should want it
 * on its own merits, not because it happened to be lying there.
 *
 * Orca's sidebar has the same capabilities under Cmd-chords — `workspace.rename`,
 * `workspace.delete`, `sidebar.search.toggle`, `sidebar.focusWorktreeList` — so
 * what is borrowed here is the vocabulary, not the keys (§4.1).
 */
const SINGLE: Readonly<Record<string, KeyAction>> = {
  i: { kind: 'prompt' },
  I: { kind: 'focusAction' },
  r: { kind: 'rename' },
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
  // Cmd+Shift+H -- the operator's own choice, and the modifier matters: Cmd+H
  // is macOS's Hide, claimed by `role: 'appMenu'` in `src/main/menu.ts`, and a
  // native accelerator matches before the page sees the keydown. This replaces
  // a bare `H`; `Mod-0` still answers the same act from the digit row.
  //
  // CMD+SHIFT+H, AND NOT Ctrl+Shift+H, ON macOS. No terminal distinguishes
  // `Ctrl+Shift+H` from `Ctrl+H` -- both are 0x08, backspace -- so vam answering
  // it was an application command sitting on a terminal gesture; measured on
  // the base revision, pressing it with a terminal pane focused moved the
  // keyboard to the session list while tmux received nothing. `CTRL_GESTURES`
  // carries the rule that ended it.
  'Mod-Shift-h': { kind: 'focusList' },
  'Mod-k': { kind: 'palette' },
  // THE COMMAND MODIFIER + a digit is THE SESSION TAB AT THAT POSITION,
  // counted across every pane on screen. One meaning, in both cursor modes,
  // whatever has the keyboard.
  //
  // CMD, AND ON macOS ONLY CMD. It read "Cmd/Ctrl" until the operator asked
  // for Ctrl+number to be cancelled; `digitChord` holds the unfold that made
  // the two spellings expressible apart, and what the narrowing costs. On
  // Linux and Windows this row is Ctrl, because there is no Cmd key there and
  // `Mod-` means the platform's command modifier for every digit.
  //
  // THIS IS THE FIFTH ARRANGEMENT OF THIS ROW. The history is kept because it
  // is load-bearing: an agent this week was about to "fix" `gt` by renaming
  // it, and four places documenting the intent are what stopped it.
  //
  //   1. The bare row picked SESSIONS; tabs sat on `Mod-Shift-<digit>`.
  //   2. Swapped, because Cmd+number is the TAB gesture everywhere else.
  //   3. No fixed meaning at all — the digit was CONTEXT-DEPENDENT, a session
  //      while the sidebar had the keyboard and a view while the response pane
  //      did — on the argument that any fixed meaning sends half the
  //      operator's presses to the pane they are not looking at.
  //   4. Fixed again, at the operator's request: the tab at that position in
  //      the FOCUSED PANE's own strip. The third arrangement's argument was
  //      not refuted, it was OUTWEIGHED — Cmd+number is "switch tab" in every
  //      browser and every editor, and a key whose meaning changes with the
  //      cursor is a key you have to think about before pressing. Its pane
  //      fork was gone twice over: the four VIEWS had moved off the Cmd row,
  //      and the SIDEBAR's positions were dropped rather than re-homed,
  //      because `j`/`k`, `gg`/`G`, `f` and `/` already reach any row. What
  //      that cost was jumping to sidebar row N by number.
  //   5. THIS ONE: the same fixed meaning, counted ACROSS PANES in the order
  //      the strips draw, rather than within the focused pane's strip. A split
  //      is one screen, and the operator's point is that the tab they can SEE
  //      at position 3 should be the tab `Mod-3` names — under the per-pane
  //      rule the same key meant different tabs depending on which half of the
  //      screen last had the keyboard, and half the tabs on screen could not
  //      be addressed by number at all. Picking a tab in another pane moves
  //      the keyboard there, which is what a sidebar pick of the same session
  //      already did.
  //
  // AND ITS COST, QUOTED AND CHOSEN. Positions 1-9 stop covering everything
  // once more than nine tabs are open: per-pane numbering kept every strip
  // individually reachable, so a tenth tab was still position N of ITS pane,
  // and now a tenth tab has no digit. `9` still means the LAST tab whatever
  // the count, and `Mod-Shift-[`/`]` steps the ring one at a time, so nothing
  // is unreachable — only unaddressable BY NUMBER. The operator was told this
  // and chose it anyway; it is a trade, not an oversight.
  //
  // AND THE SHIFT DIGIT ROW IS STILL NOT REACHABLE. macOS binds `Cmd+Shift+3`,
  // `4` and `5` to its screenshot commands and matches them before any
  // Electron window sees the keydown (`com.apple.symbolichotkeys` entries
  // 28-31 and 184). So `Mod-Shift-3` and `Mod-Shift-4` were dead bindings in
  // the first two arrangements — first two session positions, then Terminal
  // and Agents — and no test could have caught it, because the OS never
  // delivers the event a test synthesises. Nothing goes there, in this
  // arrangement or the next one. THE BRACKETS BESIDE THEM ARE A DIFFERENT
  // MATTER and are bound below: nothing native holds `Cmd+Shift+[`/`]`, which
  // is why the browsers themselves could take it for their tab gesture.
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
  // THE SAME LIST, STEPPED — and the reason the digit row can afford to stop
  // at nine. `Mod-Shift-[`/`]` is the previous/next tab gesture macOS
  // browsers already teach, and it is app-level: nothing native answers it,
  // unlike the `Cmd+Shift+<digit>` row three lines up.
  //
  // Spelled by POSITION, not by character. A real `Cmd+Shift+[` keydown
  // arrives as `{`, so `normalizeKey` reads `event.code` here for exactly the
  // reason it does for the digits — and that is also what lets the `Shift-`
  // token appear in a binding at all. See `POSITION_CODES`.
  'Mod-Shift-[': { kind: 'stepTab', delta: -1 },
  'Mod-Shift-]': { kind: 'stepTab', delta: 1 },
  // AND THE PANE PAIR, ONE MODIFIER UP, so the two read as a family: Shift
  // steps the TAB, Alt steps the PANE that holds tabs. A second binding on
  // the action `zw`/`zW` already carry rather than a second action — the
  // chord keeps working and the key sheet prints one row with both spellings,
  // which is what `MAX_BINDINGS = 2` is for.
  //
  // STILL FOLDED, unlike the digit row three lines down: the brackets take
  // either Ctrl or Cmd, on every platform, because the operator separated the
  // two modifiers on the DIGITS and nowhere else. `digitChord` argues where
  // that line falls; the short of it is that `Ctrl-[` is vim's own way out of
  // insert mode and `docs/keyboard.md` promises it by name.
  'Mod-Alt-[': { kind: 'stepSplit', delta: -1 },
  'Mod-Alt-]': { kind: 'stepSplit', delta: 1 },
  // The response pane's four views, by name. The same digit row under a
  // DIFFERENT modifier, which is the whole distinction: the command modifier
  // picks a SESSION TAB, and the three-key chord picks one of the focused
  // pane's VIEWS. `normalizeKey` spells them apart (`Mod-1` vs `Ctrl-Alt-1`)
  // off `event.code`, so neither can answer the other's keystroke on any
  // layout. That split is what let the digit row above take a fixed meaning at
  // all — while both families shared one modifier, one of them had to lose.
  //
  // IT IS A THREE-KEY CHORD BECAUSE THE OPERATOR ASKED FOR ONE. This row was
  // `Alt-<digit>` and the tab row answered Ctrl as well as Cmd, and the report
  // was that "Ctrl+number seems to be conflicting between switching function
  // and switching tab"; the instruction was to cancel Ctrl+number and put the
  // view row on Ctrl+Option+number or Ctrl+Shift+number. CTRL+OPTION, of those
  // two, and the reason is one row up: macOS takes `Cmd+Shift+3/4/5` for
  // screenshots before any window sees the keydown, and while Ctrl and Cmd
  // were one token that barred the whole Shift row — so Ctrl+Shift+number
  // would have been asking for three dead digits in the middle of a family.
  //
  // AND `Alt-<digit>` IS UNBOUND NOW, NOT RESERVED. The operator's second
  // decision was that the view row moves rather than gains a short form:
  // switching a view happens on the three-key chord alone. Unbinding is the
  // whole of that; reserving it (`RESERVED_KEYS`) would additionally forbid an
  // operator from ever putting something of their own there, which is a
  // stronger act than was asked for and one this table has only taken for keys
  // ANOTHER SURFACE already answers. `Ctrl-<digit>` is free for the same
  // reason and on the same terms.
  //
  // ALL NINE, though only four name a view. Digits 5-9 are what make the
  // refusal reachable: `Ctrl-Alt-5` says "no view 5" instead of falling
  // through to the browser, and the key sheet captions them as the nothing
  // they are rather than promising a fifth view. The same shape `selectTab`
  // already has for digits past the tab count.
  //
  // Free when they were taken: nothing in any table held a `Ctrl-` key
  // (`test/keyboard/pick-view-binding.test.ts` re-derives that no two
  // actions share a chord, over the generated bindings rather than over
  // these lines).
  'Ctrl-Alt-1': { kind: 'pickView', digit: 1 },
  'Ctrl-Alt-2': { kind: 'pickView', digit: 2 },
  'Ctrl-Alt-3': { kind: 'pickView', digit: 3 },
  'Ctrl-Alt-4': { kind: 'pickView', digit: 4 },
  'Ctrl-Alt-5': { kind: 'pickView', digit: 5 },
  'Ctrl-Alt-6': { kind: 'pickView', digit: 6 },
  'Ctrl-Alt-7': { kind: 'pickView', digit: 7 },
  'Ctrl-Alt-8': { kind: 'pickView', digit: 8 },
  'Ctrl-Alt-9': { kind: 'pickView', digit: 9 },
  // `p` for project. It shipped hand-wired to its own window listener in
  // SessionList.tsx, which cost it both properties this table exists to give:
  // it appeared in no key sheet, and it fired straight through an open
  // overlay. Being here is the fix for both at once.
  p: { kind: 'revealProject' },
  // The same action as `x`, under the chord a person coming from a browser or
  // a terminal already has in their fingers. It is `Mod-w` rather than a
  // second letter because "close this thing" IS Cmd-W everywhere else.
  //
  // AND CMD-W IS NOW ALL IT IS, ON macOS. This and the five other application
  // commands in this table came off Control on PR 361 (`CTRL_GESTURES`):
  // `Ctrl+W` is readline's delete-word-back, and the pane's own comment
  // already named the hazard out loud -- "a Ctrl+W that both killed a word and
  // closed the session tab it was typed into is not a bug anybody would enjoy
  // finding twice". `TerminalTab.tsx` stops that chord before this grammar
  // sees it, so the pane was never the exposed surface; the composer and every
  // other Cocoa text view were, and they have their editing key back.
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
  // AND THE THIRD CREATE, the one that needs a directory before it can name a
  // project at all. `Mod-Shift-p` is what a real `Cmd+Shift+P` — the
  // keystroke the operator asked for — normalizes to now that a modified
  // letter keeps its Shift; `Mod-p` (`Cmd+P`) is left unbound, so the
  // browser build's print dialog still answers it. The action's own doc
  // comment above argues that, the family it joins, and the history of the
  // fold that used to make `Mod-Shift-p` unreachable. Free when it was
  // taken: nothing in any table held `Mod-Shift-p`, and bare `p`
  // (`revealProject`) keeps its own spelling.
  'Mod-Shift-p': { kind: 'newProject' },
  // HALF A SCREEN OF TRANSCRIPT, vim's own `Ctrl-D` / `Ctrl-U`, which is the
  // gesture the operator asked for by name.
  //
  // FREE WHEN THEY WERE TAKEN. The whole `Mod-` set was `0`-`9`, `k`, `n`,
  // `p`, `t`, `w`, `Alt-[`, `Alt-]`, `Shift-[` and `Shift-]`; bare `d` and `u`
  // are bound nowhere either, and `normalizeKey` gives a modified letter its
  // own `Mod-` spelling, so both stay free for a plain-key meaning later.
  // Re-derived over the generated bindings in
  // `test/keyboard/chords.half-page.test.ts`, never over these two lines.
  //
  // AND THEY ARE `isSelectOnly`, the only pair in this table that is. The
  // action's doc comment above argues it: taken globally, the same two
  // keystrokes are delete-forward and delete-to-line-start in the composer.
  // Nothing native holds them in the desktop app — vam's menu is
  // appMenu/editMenu/Window (`src/main/menu.ts`) — and in the browser build
  // the handler's own `preventDefault` keeps `Cmd+D` away from bookmarking,
  // in Select. In Insert it does not prevent anything, which is exactly how
  // the box being typed in keeps the key's native meaning.
  'Mod-d': { kind: 'scrollHalf', delta: 1 },
  'Mod-u': { kind: 'scrollHalf', delta: -1 },
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

/**
 * THE VIEW ROW AGAIN, ON ONE KEY — the operator's own ask, in their words:
 * "in Select mode, is there a shortcut to switch between the function tabs of
 * the focused session faster? For example a number, or Shift+number? Only in
 * Select mode."
 *
 * A SECOND SPELLING OF `pickView`, NOT A SECOND ACT. `Ctrl-Alt-<digit>` stays
 * exactly where it is and keeps working everywhere, including from inside the
 * prompt box — which is the one thing a bare digit can never do and the reason
 * the three-key chord is not simply replaced. Same action, same `actionId`, so
 * the two land in one row of the key sheet and one row of the settings editor
 * with two slots, which is what `MAX_BINDINGS = 2` is for.
 *
 * A TABLE OF ITS OWN, AND THAT IS NOT DECORATION. `Object.entries` walks
 * INTEGER-LIKE KEYS FIRST, in ascending numeric order, whatever order they are
 * written in — so `'1'` placed inside `SINGLE` would be visited before
 * `'Ctrl-Alt-1'` no matter where the line went, `defaultBindings` would record
 * the bare digit as slot 0, and `primaryChord` — the ONE chord an inline chip
 * and a tooltip's first line print — would become `1`. A chip that names a key
 * which does nothing under the caret the operator is looking at is the caption
 * that lies. Listed after `SINGLE` in `BINDING_TABLES`, the chord leads and
 * the short spelling follows.
 *
 * SELECT ONLY, AND IT IS A PROPERTY OF THE KEYSTROKE (`isSelectOnlyChord`),
 * not of the action: `pickView` must stay live under a caret, and only its
 * bare spelling stands down. The rule is `isSelectOnly`'s own — a binding
 * stands down in Insert exactly when the keystroke ALREADY MEANS SOMETHING to
 * whatever is being typed into — and a digit means two things at once there:
 * it is a character to every text surface, and it is the question card's own
 * option mark (`question-keys.ts`).
 *
 * NINE, NOT FOUR. Digits past the last view are bound so the pane can refuse
 * them ALOUD, the same shape the chord row above already has: `5` on a source
 * with no Files bridge says so, rather than falling through to the browser.
 * It is the same handler, so there is one refusal and not two wordings — a
 * second behaviour for the short spelling would be a second rule to keep in
 * step, and the house style is that a control which can only refuse says so.
 *
 * `0` IS NOT HERE. `z0` is the zero's chord (`AFTER_Z`) and `Mod-0` is the way
 * out of the tabs entirely, so the key already reads as "back to the start"
 * twice over; a third meaning on the bare press would be the only digit in
 * this row that named no view. It stays free — unbound, not reserved, which is
 * the same terms `Alt-<digit>` was left on.
 *
 * FREE WHEN THEY WERE TAKEN. Nothing in `MOVES`, `SINGLE`, `AFTER_G`,
 * `AFTER_Y` or `AFTER_Z` held a bare digit, and there is no vim-style count
 * prefix in this grammar for one to be swallowed by. Re-derived over the
 * generated bindings in `test/keyboard/select-digits.test.ts`, never over
 * these nine lines.
 */
const SELECT_DIGITS: Readonly<Record<string, KeyAction>> = {
  1: { kind: 'pickView', digit: 1 },
  2: { kind: 'pickView', digit: 2 },
  3: { kind: 'pickView', digit: 3 },
  4: { kind: 'pickView', digit: 4 },
  5: { kind: 'pickView', digit: 5 },
  6: { kind: 'pickView', digit: 6 },
  7: { kind: 'pickView', digit: 7 },
  8: { kind: 'pickView', digit: 8 },
  9: { kind: 'pickView', digit: 9 },
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
 * canvas is gone (A12.1, epic.md decision 5) — `c`, `C` and `f` were free at
 * that point. `z0` survives as the "put it back" key. It restores the two
 * panes' default WIDTHS and nothing else — the visibility it also used to
 * restore went with the settings section that was the only way to lose it
 * (see the `resetPanes` handler in `Canvas.tsx`).
 *
 * A15.1 spent four more letters here on split panes, in vim's own window
 * spelling: `s`/`v` split (horizontal/vertical), `c` closes the focused
 * split, `w`/`W` cycle focus between splits — which took `c`, leaving `C` and
 * `f` free at THAT point. `zf` (below) then took `f` for focus view, so only
 * `C` is free today; a table that binds it belongs beside `AFTER_Z`, not a
 * new namespace, and this comment is the reason to check here before adding
 * one.
 */
const AFTER_Z: Readonly<Record<string, KeyAction>> = {
  '0': { kind: 'resetPanes' },
  s: { kind: 'splitPane', orientation: 'column' },
  v: { kind: 'splitPane', orientation: 'row' },
  c: { kind: 'closeSplit' },
  w: { kind: 'stepSplit', delta: 1 },
  W: { kind: 'stepSplit', delta: -1 },
  f: { kind: 'toggleFocusView' },
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
  // AFTER `SINGLE`, so `Ctrl-Alt-<digit>` is `pickView`'s slot 0 and the bare
  // digit its slot 1 — `SELECT_DIGITS`' own comment argues why the order is
  // load-bearing rather than tidy.
  { prefix: '', table: SELECT_DIGITS },
  { prefix: 'g', table: AFTER_G },
  { prefix: 'y', table: AFTER_Y },
  { prefix: 'z', table: AFTER_Z },
];

/**
 * ACTIONS AN INSERT SCOPE KEEPS FOR ITSELF — and the rule behind the list.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────
 *   A binding stands down in Insert exactly when the keystroke ALREADY MEANS
 *   SOMETHING to whatever is being typed into. Everything else is the
 *   grammar's in both modes.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * HOW IT RELATES TO THE TYPING GUARD, which is the same argument one step
 * further on. `Canvas.tsx` swallows a bare key for a focused INPUT or TEXTAREA
 * and lets a `Mod-` chord through, on the grounds that "a Cmd/Ctrl chord is
 * never text entry — no layout produces a character from one". That premise is
 * about CHARACTERS and it is still true. What it does not settle is EDITING
 * COMMANDS: on macOS every Cocoa text view answers `Ctrl-D` with delete-forward
 * and `Ctrl-U` with delete-to-line-start, and a shell answers `Ctrl-D` with
 * EOF. Those are not characters, so the guard lets them past — and a grammar
 * that took them would delete a scroll gesture's worth of somebody's prompt.
 *
 * SO IT IS ASKED OF THE CURSOR MODE, NOT OF THE TAG NAME, and that is the
 * second half of why it is a rule of its own rather than a wider typing guard.
 * `cursorModeAt` (`keyboard/focus-scope.ts`) reads Insert off
 * `data-insert-scope`, which marks the question card and the TERMINAL PANE as
 * well as the composer — and the terminal is a `section`, which no INPUT|
 * TEXTAREA test can see. A tag-based widening would have left exactly the
 * surface where `Ctrl-D` means most unprotected.
 *
 * A PREDICATE OVER THE ACTION rather than a list of key strings, because the
 * operator may rebind: whatever chord `scrollHalf` ends up on, it is the ACT
 * that has no business firing under a caret.
 */
export function isSelectOnly(action: KeyAction): boolean {
  return action.kind === 'scrollHalf';
}

/**
 * KEYSTROKES AN INSERT SCOPE KEEPS FOR ITSELF — the same rule as above, asked
 * of the KEY instead of the act.
 *
 * ── THE RULE, UNCHANGED ──────────────────────────────────────────────────
 *   A binding stands down in Insert exactly when the keystroke ALREADY MEANS
 *   SOMETHING to whatever is being typed into.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * WHY THERE ARE TWO PREDICATES AND NOT ONE WIDER ONE. `isSelectOnly` is about
 * the ACT because `scrollHalf` has no business firing under a caret whatever
 * chord the operator moves it to. This one is about the KEYSTROKE because
 * `pickView` is the opposite case: the act is welcome in Insert — switching a
 * view from inside the prompt box is precisely what `Ctrl-Alt-<digit>` is for,
 * and the key sheet says so — while its BARE spelling cannot be, because a
 * bare digit is not a chord, it is text.
 *
 * A DIGIT MEANS TWO THINGS UNDER A CARET, AND BOTH ARE SOMEBODY ELSE'S. It is
 * a character to every text surface — the composer, the palette filter, the
 * search line, a rename field, the Files filter, the terminal's own hidden box
 * — and it is the question card's option mark (`resolveQuestionKey`'s `mark`).
 * Taking it globally would type a view switch into somebody's prompt.
 *
 * AND THE TAG NAME COULD NOT HAVE DONE IT. `Canvas.tsx`'s typing guard reads
 * INPUT|TEXTAREA, which covers every box in the list above and MISSES the one
 * that matters most: the terminal pane is a `section` carrying
 * `data-insert-scope`, and a digit there is typed into somebody's running
 * agent. That pane claims its own printable keys when it has a bridge to send
 * them down, and hands them back when it does not — so without this predicate
 * a bridgeless build would answer a digit aimed at a terminal by switching the
 * view under it. Asked of the cursor mode, like `isSelectOnly`, for the same
 * reason and at the same call site.
 *
 * A PREFIXED KEY IS NOT A BARE ONE. `z0` is two keystrokes behind a door, the
 * card and the text boxes hear them one at a time, and neither hears `z` —
 * so `z0` keeps working and the zero keeps its chord.
 *
 * `0`–`9`, THOUGH ONLY 1-9 ARE SHIPPED. The rule is about what the keystroke
 * means to a text surface, and a zero types a zero; an operator who binds
 * something to the free bare `0` gets the same stand-down, rather than the one
 * digit in the row that quietly did not follow the rule.
 */
export function isSelectOnlyChord(chord: Chord): boolean {
  return chord.prefix === '' && /^[0-9]$/.test(chord.key);
}

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
 *
 * `Mod-[` FOR THE SAME SHAPE OF REASON AS `Escape`: another surface already
 * binds it. It is how the keyboard lets go of the prompt box, bound in
 * `DetailPanel`'s own `onKeyDown` rather than here -- the same place, and for
 * the same reason, as that box's `Shift+Tab`. A modified key DOES reach the
 * window listener from inside a textarea (`Canvas`'s typing guard lets one
 * through on purpose), so an operator who bound `Mod-[` to `close` would press
 * it to leave the box and shut a session on the way out. Only the exact token
 * is reserved: `Mod-Shift-[` and `Mod-Alt-[` are shipped bindings and stay
 * rebindable.
 */
export const RESERVED_KEYS: readonly string[] = ['Escape', 'Mod-[', ...PREFIXES];

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
    // MEASURED, not assumed: `stepTab` was added without a case here and both
    // bracket bindings collapsed onto the id `stepTab`, so `defaultBindings`
    // merged them into one entry and `buildTables` gave `Mod-Shift-]` the
    // FIRST one's action — next tab silently stepped backwards. A test that
    // only asserted "the pair walks in opposite directions" would have passed;
    // what caught it was asserting where each one LANDS.
    case 'stepTab':
      return `stepTab:${action.delta}`;
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
    case 'scrollHalf':
      return `scrollHalf:${action.delta}`;
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

type Binding = {
  readonly id: string;
  readonly action: KeyAction;
  readonly chords: readonly Chord[];
};

/** How a chord is written down — in the sheet, in a slot, and in storage. */
export function chordText(chord: Chord): string {
  return `${chord.prefix}${chord.key}`;
}

/* ---------------------------------------------------------------------------
 * HOW A CHORD IS READ BY A PERSON — the one rendering, beside the grammar it
 * renders.
 *
 * The operator, translated: "show shortcut keys in settings and in the
 * tooltips as symbols — `Mod` should show the ⌘ icon if macOS. On Windows show
 * `Ctrl`." `Mod-` is an INTERNAL spelling: it is the one token that can carry
 * two physical keys, which is exactly the fact it hides from the person who
 * has to press one of them.
 *
 * A DISPLAY FUNCTION AND NOTHING ELSE. Every table in this module is still
 * keyed by the token, `normalizeKey` still answers `Mod-p`, and storage still
 * holds what the operator's keyboard produced. Nothing that MATCHES a
 * keystroke may ever see this output: a comparison against a glyph would move
 * the grammar onto a string whose spelling depends on who is reading it.
 * `test/keyboard/chord-symbols.test.ts` holds that line.
 * ------------------------------------------------------------------------ */

/** The modifier tokens, in the order `normalizeKey` writes them. */
const MODIFIER_TOKEN = /^(Mod|Ctrl|Alt|Shift)-/;

/**
 * THE GLYPHS, AND WHY THESE ONES. Apple's own set, the one every Mac menu
 * prints: ⌘ command, ⇧ shift, ⌥ option, ⌃ control. `Mod` IS command here —
 * that is the whole ask — and `Ctrl` is NOT: `CTRL_GESTURES` lifted the fold
 * for the letters, so a Control chord on a Mac is a real Control chord and
 * rendering it ⌘ would send an operator's hand to the wrong key.
 */
const APPLE_MODIFIERS: Readonly<Record<string, string>> = {
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Mod: '⌘',
};

/** Off a Mac the command modifier IS Control, which is why two tokens map to
 *  one word — and why the renderer de-duplicates (see `chordSymbols`). */
const OTHER_MODIFIERS: Readonly<Record<string, string>> = {
  Mod: 'Ctrl',
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
};

/**
 * ⌃⌥⇧⌘ — the HIG's order, command last and nearest the key, which is the
 * order every Mac menu an operator has ever read uses. The token is built in a
 * different order (`normalizeKey`: Mod, Ctrl, Alt, Shift) and the two have no
 * reason to agree: one is a spelling, this is a convention about hands.
 */
const APPLE_ORDER: readonly string[] = ['Ctrl', 'Alt', 'Shift', 'Mod'];

/** Ctrl+Alt+Shift+Key, the order Windows and Linux write and read. */
const OTHER_ORDER: readonly string[] = ['Mod', 'Ctrl', 'Alt', 'Shift'];

/**
 * The named keys, as a Mac draws them. `⏎` rather than the HIG's `↩` because
 * vam already paints `⏎`, `⌫`, `⇧⇥` and `␣` on the phone's keystroke strip
 * (`DetailPanel.tsx`), and one app with two glyphs for Enter is the same
 * defect as one key with two spellings.
 */
const APPLE_KEYS: Readonly<Record<string, string>> = {
  Enter: '⏎',
  Escape: '⎋',
  Tab: '⇥',
  Backspace: '⌫',
  Delete: '⌦',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: '⇞',
  PageDown: '⇟',
  Home: '↖',
  End: '↘',
  CapsLock: '⇪',
  ' ': '␣',
};

/**
 * And as everything else does: words, and only where the `event.key` name is
 * not already the word a person would say. `Enter`, `Tab`, `Backspace`,
 * `Delete`, `Home` and `End` are missing from here deliberately — they fall
 * through and print themselves.
 */
const OTHER_KEYS: Readonly<Record<string, string>> = {
  Escape: 'Esc',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  ' ': 'Space',
};

/**
 * The key itself, once its modifiers have been taken off the front.
 *
 * A BARE KEY IS LEFT EXACTLY AS THE GRAMMAR SPELLS IT, which is the one place
 * this whole rendering does nothing — and it is deliberate twice over. `G` is
 * the key a vim user reads as `G`; `gt` is two keystrokes rather than a
 * modified one; and upper-casing `j` would name a key that is bound to
 * something else entirely. Case only becomes decoration once a modifier is
 * holding the letter, where ⇧ carries the shift and every Mac menu prints the
 * letter capital.
 */
/**
 * `glyph` alongside the text: true only for a key this table draws as an
 * Apple pictogram (⏎ ⎋ ⇥ ⌫ an arrow, …) — never for a plain letter or digit,
 * and never off a Mac, where the same named key is a WORD (`Esc`, `Up`), not
 * a symbol. `chordSegments` reads this to decide which segments need the
 * body sans treatment `ChordGlyphs` gives a symbol; see its own doc comment.
 */
function keyLabel(key: string, mac: boolean, modified: boolean): { text: string; glyph: boolean } {
  const named = (mac ? APPLE_KEYS : OTHER_KEYS)[key];
  if (named !== undefined) {
    return { text: named, glyph: mac };
  }
  const text = modified && /^[a-z]$/.test(key) ? key.toUpperCase() : key;
  return { text, glyph: false };
}

/**
 * ONE CHORD, AS A PERSON READS IT: `Mod-Shift-e` is `⇧⌘E` on a Mac and
 * `Ctrl+Shift+E` everywhere else.
 *
 * `mac` IS A PARAMETER, defaulting to this machine, for the reason
 * `normalizeKey` states one screen up: both answers have to be assertable from
 * one test run, or a suite asserts a different rendering on ubuntu than on the
 * operator's Mac while looking identical in both.
 *
 * TAKES THE WHOLE CHORD STRING — a token, a prefixed pair (`gt`), a bare
 * character — because that is what every surface holds. Only the modifier
 * tokens and the named keys are rewritten; everything else is returned as it
 * came in.
 *
 * THE TOKENS ARE STRIPPED BY PATTERN, NOT BY SPLITTING ON `-`: a hyphen is a
 * key an operator can bind (`Mod--`), and splitting would leave that chord
 * with no key at all. A trailing token with nothing behind it (`Mod-`) is not
 * a chord and is handed back untouched rather than painted as a naked glyph.
 */
/**
 * ONE GLYPH OR WORD OUT OF A CHORD, TAGGED with what it is: `modifier` for a
 * held key (⇧⌘⌥⌃ on a Mac, a word off one) or `key` for the letter/named key
 * it holds. `chordSegments` is `chordSymbols`' own computation, stopped one
 * step short of the join -- the operator's own finding, reading a `⇧⌘P`
 * chip: painted at one font-size, the modifiers and the letter they modify
 * read as one dense glyph, the modifiers smaller than the capital beside
 * them. A caller that wants to draw the two at different sizes (`ShortcutTip.
 * tsx`'s `InlineChord`/`Chip`, `KeySheet.tsx`, the status bar's own hint)
 * needs the tag; `chordSymbols` below still exists for every caller that
 * only ever wanted a sentence — a tooltip's `sr-only` twin, a line in
 * `FilesTab.tsx`, `keysheet.ts`'s own search haystack — and is now defined
 * IN TERMS OF this, so the two can never compute the modifier set two ways.
 *
 * `glyph` IS A SECOND TAG, orthogonal to `modifier`: whether this segment is
 * one of Apple's own pictograms (⇧⌘⌥⌃⏎⎋⇥⌫ an arrow, …) rather than a letter,
 * digit or word. Measured against the operator's own reference — the Send
 * Key option under Settings → Sessions — every one of these painted small
 * and thin next to it everywhere else in the app: `font-mono` (Geist Mono)
 * draws a noticeably narrower ⌘ than `font-sans` (Geist) does at the same
 * size, and most chips are mono. `ChordGlyphs` reaches for the sans stack on
 * exactly the segments tagged `glyph: true`; a bare letter or digit (`P`,
 * `1`) is not a pictogram and keeps the chip's own font, and off a Mac
 * nothing is tagged a glyph at all — the same key there is already a WORD
 * (`Esc`, `Ctrl`), the family the operator's ask never touched.
 */
export type ChordSegment = {
  readonly text: string;
  readonly modifier: boolean;
  readonly glyph: boolean;
};

export function chordSegments(
  chord: string,
  mac: boolean = applePlatform(),
): readonly ChordSegment[] {
  const held = new Set<string>();
  let rest = chord;
  for (;;) {
    const match = MODIFIER_TOKEN.exec(rest);
    if (match?.[1] === undefined) {
      break;
    }
    const next = rest.slice(match[0].length);
    if (next === '') {
      break;
    }
    held.add(match[1]);
    rest = next;
  }
  const table = mac ? APPLE_MODIFIERS : OTHER_MODIFIERS;
  // DE-DUPLICATED, and only off a Mac does it ever do anything: `Mod` and
  // `Ctrl` are one physical key there, and `Mod-Ctrl-k` — which
  // `normalizeKey`'s own comment writes down for Cmd+Ctrl+K, and which a
  // bindings file written on a Mac carries to a PC — would otherwise render
  // "Ctrl+Ctrl+K", a keystroke nobody can press.
  const modifiers = [
    ...new Set(
      (mac ? APPLE_ORDER : OTHER_ORDER)
        .filter((token) => held.has(token))
        .map((token) => table[token] ?? token),
    ),
  ];
  const key = keyLabel(rest, mac, held.size > 0);
  return [
    ...modifiers.map((text) => ({ text, modifier: true, glyph: mac })),
    { text: key.text, modifier: false, glyph: key.glyph },
  ];
}

/**
 * THE JOIN, AND WHY IT NOW HOLDS A SPACE ON A MAC. The operator, translated:
 * "increase the size of the Shift and Command symbols, and put one space
 * between them and the letter" — read together with the worked example
 * (`⇧ ⌘ P`, not `⇧⌘P`), that is a space between EVERY glyph, modifiers
 * included, not only before the key. Off a Mac the words already read apart
 * (`Ctrl+Shift+E`); `+` is untouched.
 */
export function chordSymbols(chord: string, mac: boolean = applePlatform()): string {
  return chordSegments(chord, mac)
    .map((segment) => segment.text)
    .join(mac ? ' ' : '+');
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

/**
 * The order the bindings are laid down in — and therefore who wins a key two
 * of them claim.
 *
 * Shipped first, overrides second: the operator's choice beats a shipped key
 * something else still holds, deterministically rather than by table order.
 * ONE spelling of that rule, because both readers of it must agree — the
 * tables that answer a keystroke, and `bindingClashes`, which tells the
 * operator which action a contested key really reaches. Two derivations of
 * "who wins" is a UI naming one action while another fires.
 */
function inPrecedenceOrder(overrides: KeyBindings): readonly Binding[] {
  const bindings = effectiveBindings(overrides);
  return [
    ...bindings.filter((binding) => overrides[binding.id] === undefined),
    ...bindings.filter((binding) => overrides[binding.id] !== undefined),
  ];
}

/** One chord two or more actions claim: who answers it, and who is left
 *  advertising a key that does nothing. */
type BindingClash = {
  /** As it is written down and shown: `r`, `gt`. */
  readonly chord: string;
  /** The action the keystroke really invokes — `buildTables`' own winner. */
  readonly winner: string;
  /** The actions whose advertised key is dead, in table order. */
  readonly shadowed: readonly string[];
};

/**
 * Every contested chord in a map, resolved the way the keystroke resolves it.
 *
 * The editor and the sheet both read this, so a dead binding is a state the
 * operator can SEE rather than one they discover by pressing a key and
 * watching something else happen — which is how F3 was found.
 *
 * An action that holds one chord in both its slots is not a clash: it wastes a
 * slot and steals nothing, and refusing it would strand the map.
 */
export function bindingClashes(overrides: KeyBindings): readonly BindingClash[] {
  const claims = new Map<string, string[]>();
  for (const binding of inPrecedenceOrder(overrides)) {
    for (const chord of binding.chords) {
      const text = chordText(chord);
      const at = claims.get(text) ?? [];
      at.push(binding.id);
      claims.set(text, at);
    }
  }
  const out: BindingClash[] = [];
  for (const [chord, ids] of claims) {
    // Last laid down is what the table kept, which is what the keystroke gets.
    const winner = ids[ids.length - 1];
    if (winner === undefined) continue;
    const shadowed = [...new Set(ids)].filter((id) => id !== winner);
    if (shadowed.length > 0) {
      out.push({ chord, winner, shadowed });
    }
  }
  return out;
}

/**
 * The clashes a write would CREATE — the whole resulting map judged, not the
 * one key that changed.
 *
 * This is F3's fix stated as a function. The capture box used to judge the key
 * it was handed and nothing else, and reset judged nothing at all, so removing
 * an override could hand a key to another action in silence. Every path that
 * writes the map now asks this question instead — and a path that cannot ask
 * about a keystroke, because reset restores a DEFAULT key that the operator
 * never typed, is the reason the question is about the map.
 *
 * Judged as a DIFFERENCE on purpose. A map can arrive already contested (a
 * hand-edited payload, or a stored override colliding with a shipped key a
 * later vam moved onto it), and refusing every write while one is in force
 * would lock the operator inside the state they are trying to leave.
 *
 * The difference is taken over WHO IS SHADOWED, not over which chord is
 * contested. "That chord was contested already" is too coarse by exactly the
 * case that matters: over a map where `close` has taken `rename`'s `r`, giving
 * `r` to a third action would newly kill `close` too, and the chord was
 * contested before and after. What comes back is each clash narrowed to the
 * bindings this write would newly leave dead, so a refusal can name them.
 */
export function newClashes(current: KeyBindings, next: KeyBindings): readonly BindingClash[] {
  const pair = (chord: string, id: string) => `${chord} ${id}`;
  const before = new Set(
    bindingClashes(current).flatMap((clash) => clash.shadowed.map((id) => pair(clash.chord, id))),
  );
  return bindingClashes(next)
    .map((clash) => ({
      ...clash,
      shadowed: clash.shadowed.filter((id) => !before.has(pair(clash.chord, id))),
    }))
    .filter((clash) => clash.shadowed.length > 0);
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
  const put = (binding: Binding) => {
    for (const chord of binding.chords) {
      const table = chord.prefix === '' ? top : chords[chord.prefix];
      if (table !== undefined) {
        table[chord.key] = binding.action;
      }
    }
  };
  // Laid down in `inPrecedenceOrder`, so the last claim on a contested key is
  // the one the table keeps: the override wins.
  //
  // WHO CAN GET HERE — corrected, because what stood here was false. This
  // comment used to say the UI refuses such a bind before it can reach this
  // function, so only a hand-edited payload could produce one. That was audit
  // finding F3: the capture box checked the key it was given and the RESET
  // button checked nothing, so `rename` onto `b`, `icon` onto the freed `r`,
  // then reset `rename` put a second claim on `r` through the ordinary
  // editor — after which `r` invoked `icon` while the sheet went on
  // advertising it for `rename`. (`icon` was the session-icon picker, removed
  // outright since; the finding is kept in its own terms because retelling it
  // with a different action would be inventing a defect nobody found.) Both write paths now judge the whole
  // resulting map (`newClashes`), so the editor cannot mint one.
  //
  // Two doors stay open and this precedence is what they land on: a payload
  // edited by hand, and a stored override that collides with a shipped key a
  // LATER vam moved onto it — no editing required, just an upgrade. Neither is
  // silent any more: `bindingClashes` reads the same order this loop lays
  // down, and the sheet and the editor mark the shadowed key dead.
  for (const binding of inPrecedenceOrder(overrides)) {
    put(binding);
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
