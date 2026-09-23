/**
 * What the Terminal tab is given when it asks for a session's screen, and how
 * big a screen it may ask for.
 *
 * In `src/shared/` for the reason `usage.ts` is here: main
 * produces this, the preload forwards it and the renderer draws it, so it
 * cannot live in any one of the three.
 *
 * SIX ANSWERS, AND THE SPLIT IS THE POINT (`sources/tmux/spawn.ts`). `ok` is
 * a screen. `not-vam` is vam having looked and found no session of its own for
 * this one -- which includes tmux reporting no server running, since no server
 * means no sessions. `gone` is a session vam did start that has since ended.
 * `ambiguous` is more than one session vam started for this project, where
 * showing either would be a coin toss the operator could not see; it carries
 * the names so the answer can say what it found. `unavailable` is vam not
 * having found out, and it carries the reason tmux gave. Collapsing the last
 * one into an empty pane would tell the operator there is nothing to look at
 * on the strength of never having looked.
 *
 * `mispaired` is the sixth and the newest, and it exists because `not-vam` was
 * being told for it. The row PUBLISHED the pane it is running in
 * (`sources/claude-code/session-pane.ts`) and that pane is not one vam can use
 * for this project -- another project's, ended, or never vam's at all. "vam
 * did not start a session for this one" is then false in the way that costs an
 * operator time: vam did start one, it simply cannot prove that one is this
 * row's, and the two facts send a person to different places. It carries the
 * name the row published so the answer can say what it was asked to trust.
 */

import type { SourceError } from '../renderer/sources/port.js';

/**
 * WHERE TYPING WOULD LAND, and the two ways there is no answer to that.
 *
 * `at` is a cell of the captured screen, in tmux's own coordinates: `column`
 * counts CELLS from the left edge and `row` counts lines from the top of the
 * pane, so `row` indexes the captured screen directly -- measured on a real
 * 61-row pane, `capture-pane` returns exactly 61 lines and `cursor_y` never
 * leaves them.
 *
 * THE OTHER TWO ARE KEPT APART FOR THE REASON `PaneView` KEEPS ITS SIX APART,
 * and here the conflation would not merely mislead, it would fabricate a fact.
 * `hidden` is the application having turned the cursor off -- a pager, a
 * spinner, a full-screen editor -- which tmux reports (`cursor_flag`) and vam
 * must honour. `unreadable` is vam not having got an answer, and it exists
 * because of exactly what tmux does when it cannot answer: MEASURED on 3.7b,
 * `display-message -p` against a target that does not exist EXITS ZERO, says
 * nothing on stderr, and prints the format with every field EMPTY. `Number('')`
 * is 0, so the parse anyone writes first turns that silence into a confident
 * cursor in the top-left corner of somebody's screen -- "no PRs" and "vam could
 * not ask" drawn identically (`sources/claude-code/pull-requests.ts`), on a
 * surface where the wrong answer is a claim about where a keystroke goes.
 *
 * Both draw nothing today. They are two values rather than one `null` so that
 * a surface which ever wants to SAY which of them happened can, and so that
 * "vam could not tell" is something a producer must name rather than something
 * a missing field decays into.
 */
export type PaneCursor =
  /**
   * `row` IS AN INDEX INTO THE TEXT IT ARRIVED WITH, and it is worth saying
   * because tmux's own answer is not. `#{cursor_y}` counts from the top of the
   * SCREEN, and a capture that carries scrollback begins above the screen, so
   * the two numbers differ by however many history lines came back;
   * `sources/tmux/spawn.ts` adds that offset before this leaves main, and says
   * `unreadable` rather than guessing when it cannot. A consumer therefore
   * indexes the lines it was given and never re-derives anything.
   */
  | { readonly kind: 'at'; readonly column: number; readonly row: number }
  /** The program in the pane turned the cursor off. There is nothing to draw. */
  | { readonly kind: 'hidden' }
  /** vam did not find out. NEVER to be drawn as a position, least of all 0,0. */
  | { readonly kind: 'unreadable' };

export type PaneView =
  | {
      readonly kind: 'ok';
      readonly name: string;
      readonly text: string;
      /**
       * Where the cursor is in the text above -- as much a part of `ok` as the
       * text is, and required for that reason: a producer that has not looked
       * has to say `unreadable` out loud rather than leave a field out. Its
       * `row` is an index into THAT text, scrollback and all; see `PaneCursor`.
       */
      readonly cursor: PaneCursor;
      /**
       * WHETHER THE PROGRAM IN THE PANE ASKED THE TERMINAL FOR THE MOUSE
       * (`#{mouse_any_flag}`), because that decides where a wheel over the
       * pane goes. Claude Code's fullscreen renderer draws in the alternate
       * screen -- for which tmux keeps NO scrollback, so the window read is
       * the screen and the DOM has nothing to scroll -- and asks for mouse
       * reports so that it can scroll its own viewport. A terminal that has
       * been asked delivers the wheel to the program; one that has not spends
       * it on its own history. ABSENT when tmux did not say (an older tmux, a
       * stubbed runner, every producer written before the field existed):
       * not knowing is drawn as the old behaviour, never as a program that
       * declined -- which is why this is the one field of `ok` that is
       * optional rather than spelled out like `cursor`.
       */
      readonly mouse?: boolean;
    }
  | { readonly kind: 'not-vam' }
  | { readonly kind: 'gone' }
  | { readonly kind: 'ambiguous'; readonly names: readonly string[] }
  | { readonly kind: 'mispaired'; readonly published: string }
  | { readonly kind: 'unavailable'; readonly error: SourceError };

/**
 * WHY THE TAB IS ASKING -- which is what decides how much work main does for
 * one screen. Here rather than in main because the renderer is what knows the
 * answer, and the preload carries the word across.
 *
 * FOUR ANSWERS, not four optimisation levels, and the difference between them
 * is measured. On a 200x50 pane with 1600 lines of coloured scrollback,
 * private `-L` socket, n=30, load ~8 (the numbers `echo` and `echo-scrollback`
 * were first argued from): a capture with `-S -500` is 86,260 bytes and
 * 10.30ms median, the same capture of the screen alone is 7,760 bytes and
 * 5.55ms, and the `list-sessions` in front of it is another ~5ms. Those figures
 * predate the control-mode runner (`sources/tmux/control.ts`), which removed
 * the `execFile` spawn under both; re-measured through it, on a 137x41 pane
 * with 600 lines of coloured scrollback (tmux 3.7b, private socket, n=60): a
 * window read is 35,068 bytes at a 1.88ms median, the screen alone is 2,608
 * bytes at 0.33ms. The ratio is the same story on a cheaper connection --
 * roughly 13x the bytes for roughly 6x the time -- which is what `poll-live`
 * below exists to stop paying four times a second for a tab nobody has
 * scrolled.
 *
 * `poll` -- the tab's own interval (`panels/TerminalTab.tsx`, `REFRESH_MS`),
 * asked while the operator has scrolled away from the live end, or on the
 * very first tick of a tab (nothing drawn yet, so nothing to splice a screen
 * onto). It PROVES the pairing between the row and the tmux session vam
 * started for it, and it asks for the whole window: the scrollback has to be
 * in the DOM for the operator to be able to scroll into it at all.
 *
 * `poll-live` -- THE SAME TICK, asked instead once the operator IS at the
 * live end and something has already been drawn. It proves the pairing
 * exactly as `poll` does -- this is still the interval read, so it may never
 * ride an aim someone else proved -- but it asks for the screen alone and
 * relies on the same splice `echo` does (`panels/TerminalTab.tsx`,
 * `composeScreen`) to keep the scrollback already drawn in the DOM rather
 * than re-fetching it every quarter of a second for nobody to look at.
 *
 * `echo` -- the read right after a keystroke landed, with the view stuck to
 * the live end. It rides the pairing the last `poll`/`poll-live` proved
 * (`main/terminal/ipc.ts`, `AIM_TTL_MS`) and asks for the screen only, because
 * a view at the bottom is showing no scrollback: nobody is looking at the 500
 * lines it would cost ~5ms and 78KB to fetch. The renderer keeps those lines
 * in the DOM all the same -- it splices the screen onto the history it already
 * has (`panels/TerminalTab.tsx`, `composeScreen`), because a pane holding one
 * screen has nothing to scroll, and an operator who cannot leave the live end
 * can never be asked the mode below. This is the one mode allowed to prove
 * nothing, and the poll's own proof is what bounds it.
 *
 * `echo-scrollback` -- the same read with the operator SCROLLED UP. It rides
 * the aim too, but it asks for the whole window: serving the screen alone
 * would empty the region under their cursor.
 *
 * Absent means `poll`. A caller that does not say which situation it is in
 * gets the one that assumes nothing.
 */
export type PaneReadMode = 'poll' | 'poll-live' | 'echo' | 'echo-scrollback';

/**
 * Checked rather than trusted, for the reason `isPaneKey` and `isPaneSize` are
 * checked: this value arrives from the least trusted process in the app and it
 * decides how much main re-proves before it aims a read at a tmux session.
 * Anything unrecognised is a malformed ask, never a default.
 */
export function isPaneReadMode(value: unknown): value is PaneReadMode {
  return (
    value === 'poll' || value === 'poll-live' || value === 'echo' || value === 'echo-scrollback'
  );
}

/**
 * WHICH MODEL A SESSION IS RUNNING, or vam's inability to say so.
 *
 * Here for the reason `PaneView` is here: main reads it off a captured screen
 * (`main/terminal/model.ts`), the preload forwards it and the renderer paints
 * it on the model button, so it cannot live in any one of the three.
 *
 * THREE KINDS, AND `unknown` IS A COMMON ONE. The name comes off the CLI's own
 * status line, which is not always on the screen: a permission prompt, the
 * CLI's `/model` menu and the trust prompt all replace it, a narrow pane cuts
 * it, and a pane vam cannot pair to a session was never read at all. Those
 * reasons are collapsed into one kind on purpose -- `main/terminal/model.ts`
 * argues it where the collapse happens -- because the one surface that draws
 * this draws the same thing for every one of them: the label it wore before.
 *
 * `last-turn` IS A DIFFERENT FACT AND NOT A WEAKER `model`, which is why it is
 * its own kind rather than a flag on that one. `model` is what the CLI is set
 * to NOW, read off the footer it is painting. `last-turn` is what the API
 * actually SERVED on the most recent turn, read out of the session's own
 * transcript (`main/sources/claude-code/transcript-model.ts`) for the sessions
 * whose footer vam cannot read at all -- an operator may replace the CLI's
 * status line with a script of their own, and then the footer never answers
 * again. The two differ exactly where it matters most: a `/model` switch with
 * no turn since moves the first and not the second. `ModelSwitchResult` next
 * door keeps its refusals apart for the same reason -- each says a different
 * sentence to a person, and "running X" is a claim only the footer supports.
 *
 * `name` IS THE CLI'S OWN STRING, never one of vam's five aliases. It is
 * whatever the footer printed -- `Sonnet 5`, `Opus 5`, and `Sonnet 4.5` for a
 * session started on a full model id -- so a model vam has never heard of
 * still reaches the button. A `last-turn` name is derived INTO that same shape
 * from the transcript's model id, so one control does not carry two
 * vocabularies (`transcript-model.ts`'s `displayModelName` holds the rule).
 */
export type SessionModel =
  | { readonly kind: 'model'; readonly name: string }
  | { readonly kind: 'last-turn'; readonly name: string }
  | { readonly kind: 'unknown' };

/**
 * WHAT BECAME OF A MODEL SWITCH -- one success, and a refusal for every way it
 * can fail to be one.
 *
 * Beside `SessionModel` because it is the write to that read's fact, and here
 * rather than in main for the same reason: main produces it, the preload
 * forwards it and the renderer draws a different sentence for every arm.
 *
 * `sent` CARRIES NO SCOPE, AND THAT IS A DECISION RATHER THAN AN OMISSION. It
 * used to: `session` was the menu's `s` key and `default` was the argument
 * form, which vam took for a full model id while DISCLOSING that the CLI had
 * also rewritten `~/.claude/settings.json`. Offered that fallback or an
 * outright refusal, the operator chose refusal -- so one route is left, it is
 * the menu, and every switch vam performs is this session's alone. A field
 * with one possible value is a field that lies about there being a choice, and
 * a caption reading the scope off it would be reading a constant. Measured on
 * Claude Code 2.1.276: the menu's `s` answers `Set model to Haiku 4.5 for this
 * session only` and leaves that file byte-identical -- same sha256, same mtime
 * -- while `/model <alias>` + Return answers `Set model to Opus 5 and saved as
 * your default for new sessions`.
 *
 * EVERY REFUSAL IS ITS OWN KIND, for the reason `PaneView` and `AnswerResult`
 * keep theirs apart: each sends a person somewhere different. `question` is a
 * picker that already has the keyboard -- vam looked and will not type past
 * it. `not-in-menu` is a choice the CLI's own menu cannot express. `no-menu`
 * is vam having asked for the menu and having no menu to drive
 * afterwards, which means the `/model` line may have landed in the agent's
 * prompt instead. `not-live` is a menu that was there and stopped behaving
 * like one: the probe arrow moved nothing, or it left the screen mid-walk.
 * `unmatched` is a menu with no row of that name on it. `unaimed`,
 * `unavailable`, `mispaired` and `refused` are the pane channel's own four
 * words, spelled the same because they are the same states.
 */
export type ModelSwitchResult =
  /** It went in, on the menu's `s`: this session, and no later one. */
  | { readonly kind: 'sent' }
  /** A picker already has the keyboard. `title` is the line above its rows. */
  | { readonly kind: 'question'; readonly title: string }
  /**
   * The choice has no row on the CLI's own `/model` menu, so vam typed
   * NOTHING. `choice` is what was asked for, so a caption can name it.
   *
   * WHY THIS ARM EXISTS AT ALL. The menu is the only route that keeps a switch
   * to one session, and it carries the five aliases and nothing else -- so a
   * full model id such as `claude-opus-5-20260501` has no row to walk onto.
   * The one form the CLI offers for such an id is `/model <id>` + Return, and
   * that form ALSO saves the pick as the operator's default for new sessions:
   * a write to `~/.claude/settings.json` made from a control reached for to
   * change ONE session. vam does not make that write on somebody's behalf,
   * disclosed or not, so it refuses instead -- and the caption names the
   * remedy, because an operator who wants it can type the line themselves in
   * the Terminal tab, knowing what it costs.
   */
  | { readonly kind: 'not-in-menu'; readonly choice: string }
  /** `/model` went in and no menu came up. It may have gone in as a prompt. */
  | { readonly kind: 'no-menu' }
  /** A menu that will not take an arrow is one no key may be pressed on. */
  | { readonly kind: 'not-live' }
  /** No row of the menu carries this name. `label` is the name looked for. */
  | { readonly kind: 'unmatched'; readonly label: string }
  | { readonly kind: 'unaimed' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'mispaired' }
  /** vam could not read the screen, so it would not press a key on it. */
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'refused' };

/**
 * The longest model choice vam will carry. A CLI alias is one short word and a
 * full model id is `claude-opus-5-20260501`; the bound is far above either and
 * keeps a renderer that is no longer vam's from handing tmux a megabyte to
 * type into somebody's agent.
 */
export const MAX_MODEL_CHOICE = 100;

/**
 * Whether a value off the bridge is a model choice vam will act on.
 *
 * ONE WORD, and the two things whitespace can be are both wrong on the wire:
 * a space hands the CLI a second argument, and a newline in a literal payload
 * reaches the pane as 0x0a, which the REPL submits on (`tmux/argv.ts`) -- so
 * `/model` would go in bare, opening the menu, and the rest would be typed
 * into it. Control characters go for the reason `sendTextArgv` types with
 * `-l`: the line is text, never keys.
 *
 * CHECKED IN MAIN AS WELL AS IN THE RENDERER, and that is not a duplicate: the
 * renderer is the least trusted process in the app, and the copy there exists
 * to word the refusal, not to enforce it.
 */
export function isModelChoice(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_MODEL_CHOICE &&
    /^[^\s\p{Cc}]+$/u.test(value)
  );
}

/**
 * A terminal size, in tmux's own units.
 *
 * Here rather than beside the arithmetic that produces it (`renderer/panels/
 * terminal-size.ts`) because BOTH SIDES have to agree about it: the renderer
 * measures a size, and main has to bound the one it is handed. The renderer is
 * the least trusted process in the app, so the bounds are enforced again in
 * main -- and a bound enforced against a second copy of the numbers is a bound
 * that drifts.
 */
export type PaneSize = { readonly columns: number; readonly rows: number };

/**
 * The clamps. tmux accepts a resize to one column and then has nowhere to
 * draw, so a pane dragged almost shut would otherwise reflow a working agent's
 * screen into a ribbon; the floors are the smallest sizes at which a terminal
 * is still a terminal. The ceilings bound what a compromised renderer can ask
 * tmux to allocate.
 */
export const MIN_COLUMNS = 20;
export const MAX_COLUMNS = 500;
export const MIN_ROWS = 5;
export const MAX_ROWS = 300;

/** Whether a size is one vam will actually send to tmux. */
export function isPaneSize(size: PaneSize): boolean {
  return (
    Number.isInteger(size.columns) &&
    Number.isInteger(size.rows) &&
    size.columns >= MIN_COLUMNS &&
    size.columns <= MAX_COLUMNS &&
    size.rows >= MIN_ROWS &&
    size.rows <= MAX_ROWS
  );
}

/**
 * ONE KEYSTROKE, on its way to the pane -- and every kind is one of the two
 * ways tmux can deliver one (`sources/tmux/argv.ts`).
 *
 * `text` is typed LITERALLY (`send-keys -l --`), which is what stops a pane
 * being sent `^[` because the operator typed the letters of `Escape`. `enter`,
 * `backspace`, `back-tab` and `escape` have to be INTERPRETED, which `-l` forbids, so
 * each is its own kind rather than a character inside the text -- measured,
 * `send-keys -l -- 'BSpace'` types the word into the line.
 *
 * THE LIST IS DELIBERATELY THIS SHORT. It is not a key-forwarding mechanism:
 * three of these are what typing is made of -- characters, submit, correct --
 * and anything else that ever belongs here is a decision, not an addition.
 * `back-tab` is that decision made once: the chord a Claude Code session
 * binds to cycling its own mode, a KIND rather than a key name in a field --
 * a field would let the least trusted process in the app ask for `C-c`.
 * `escape` is the second, made on the operator's own words: it cancels a
 * picker, leaves vim's insert mode and dismisses half the TUIs they run, and
 * a terminal that eats it is not a terminal. It was vam's way out of the
 * surface until they said it should be the pane's, and they were right.
 *
 * `enter` CARRIES `shift`, AND IT IS A REQUIRED FIELD RATHER THAN A SIXTH
 * KIND, for the reason `wheel`'s fields are checked rather than trusted: the
 * renderer is the least trusted process in the app, and a field `isPaneKey`
 * can leave unchecked is a field a malformed ask can omit and have answered
 * as `false` by default. THE OPERATOR'S REPORT was that Shift+Enter submits
 * in the Terminal tab instead of inserting a newline -- Claude Code's own
 * TUI does the latter, in the pty it is actually driving, and vam's pane
 * dropped the modifier on the floor. MEASURED on a private `-L` socket
 * against Claude Code 2.1.278 and Codex 0.153.2, both started the way vam
 * starts them: a single literal LF byte (`send-keys -l -- '\n'`, `tmux/argv.ts`'s
 * `sendNewlineArgv`) inserts a line in the composer and submits nothing, in
 * both REPLs, from a raw keystroke indistinguishable from the one every
 * keyboard sends for Ctrl+J -- which is almost certainly what each REPL is
 * actually binding, this being far more portable than a Shift+Enter chord
 * itself is. The Kitty-protocol form (`ESC[13;2u`) and the Option/Alt-Enter
 * form (`ESC` then CR) both did the same in both REPLs, so either would have
 * worked too; LF was chosen for needing no escape-sequence parser on either
 * end and no tmux `extended-keys` negotiation, which a bare byte send
 * (`-l`, exactly as `text` already sends one) sidesteps entirely. The xterm
 * `modifyOtherKeys` form (`ESC[27;2;13~`) was tried and dropped: Codex read
 * it as nothing rather than a newline, so it is not the cross-agent answer
 * the other three are. See `sendNewlineArgv` for the full note.
 *
 * `control` IS THE THIRD, AND IT IS THE LARGEST ONE THIS TYPE WILL EVER TAKE.
 * The operator's report was that Ctrl+U would not kill the line "or any other
 * terminal shortcut", and they were exactly right: `TerminalTab.tsx` returned
 * early on every modified key from the day the pane first learned to type, so
 * not one chord had ever crossed this channel. Ctrl+U, Ctrl+C, Ctrl+A, Ctrl+E,
 * Ctrl+K, Ctrl+W, Ctrl+R, Ctrl+D and Ctrl+L are what a terminal is driven
 * with, and a surface that can type into a running agent but cannot interrupt
 * it is a worse tool than one that types nothing.
 *
 * AND IT CARRIES A LETTER, NOT A KEY NAME -- which is the sentence the
 * `back-tab` note above is defending, made to hold for twenty-six chords
 * instead of one. `sendBackspaceArgv` argues that vam must never grow a
 * builder taking a key NAME, because such a builder would take the operator's
 * TEXT just as happily, and the day something passed a reply through it a
 * message reading `C-c` would interrupt an agent instead of being typed to it.
 * That property is untouched. `letter` is one of twenty-six values checked
 * against a frozen set, and `tmux/argv.ts` turns it into a key name by LOOKING
 * IT UP in a table of twenty-six string constants -- so a value off the bridge
 * is an INDEX and never a name. It cannot reach tmux as an option, as a second
 * command, or as any key vam did not write down in advance. The twenty-six
 * named builders the letter-by-letter reading of that note would demand ARE
 * that table, written once.
 *
 * A discriminated pair rather than a string with a flag: the renderer is the
 * least trusted process in the app, and "was this literal?" must not be a
 * boolean that a missing field can make false.
 *
 * `nav` IS THE FOURTH, AND THE LIST BEING SHORT NEVER MEANT CLOSED -- `control`
 * already grew it once. The operator's report, translated: "in the terminal,
 * the arrow keys can't be used to select options." `TerminalTab.tsx` read
 * `ArrowUp`/`ArrowDown`/`PageUp`/`PageDown`/`Home`/`End` as VAM'S OWN scroll
 * keys, before a keystroke ever reached `strokeFor` -- so Claude Code's own
 * option pickers (`AskUserQuestion`, a permission prompt, `/model`, `/config`,
 * plan approval), every one of them walked with the arrows, could not be
 * driven from inside vam's pane at all. `ArrowLeft`/`ArrowRight` were not even
 * that lucky: `strokeFor` declined them outright (a named key is never one
 * printable character) and they reached neither the pane nor vam's own
 * grammar. `nav` is the eight keys a terminal is navigated with -- the four
 * arrows and Home/End/PageUp/PageDown -- PRESSED rather than typed, for the
 * same reason `control` is: `send-keys -l -- 'Up'` would type the two letters
 * into the operator's own prompt. `sources/tmux/argv.ts`'s `sendNavArgv`
 * carries the measurement of what a real pane receives for each.
 *
 * A KIND CARRYING A CLOSED VALUE, NOT EIGHT KINDS, matching `control`'s own
 * shape rather than `enter`/`escape`/`backspace`/`back-tab`'s: `nav` is one
 * FAMILY of the pane's own keys, exactly as `control` is one family of Ctrl
 * chords, and `isNavKey` checks it against a frozen eight-member set the same
 * way `isControlLetter` does its twenty-six.
 */
export type PaneKey =
  | { readonly kind: 'text'; readonly text: string }
  /**
   * Return, plain or Shift-held -- `shift: false` presses the interpreted
   * Enter (`sendEnterArgv`, tmux's own `Enter`, CR); `shift: true` sends a
   * literal LF (`sendNewlineArgv`), which Claude Code and Codex both read as
   * an inserted line rather than a submit. See the type doc above for the
   * measurement.
   */
  | { readonly kind: 'enter'; readonly shift: boolean }
  | { readonly kind: 'backspace' }
  /** Shift-Tab, `BTab` to tmux -- the session's own cycle-the-mode chord. */
  | { readonly kind: 'back-tab' }
  /** Escape, `Escape` to tmux -- the key every TUI cancels on. */
  | { readonly kind: 'escape' }
  /** One Ctrl chord -- `C-u` to tmux, and its twenty-five siblings. */
  | { readonly kind: 'control'; readonly letter: ControlLetter }
  /**
   * One of the terminal's own navigation keys -- an arrow, Home, End,
   * PageUp or PageDown -- pressed in the pane rather than scrolled in vam's
   * own view. See the type doc above for the report this answers and
   * `sendNavArgv` for the measured escape sequence each one delivers.
   */
  | { readonly kind: 'nav'; readonly nav: NavKey }
  /**
   * The wheel, for a pane whose program asked for the mouse (`PaneView.mouse`).
   * Delivered as `ticks` SGR mouse reports at the cell under the pointer,
   * 1-based as the protocol counts (`tmux/argv.ts`, `sendWheelArgv`). Main
   * spells the report; the renderer only says which way and where.
   */
  | {
      readonly kind: 'wheel';
      readonly direction: 'up' | 'down';
      readonly ticks: number;
      readonly column: number;
      readonly row: number;
    };

/**
 * The most notches one wheel key may carry. A trackpad fling accumulates
 * many rows between two frames; a bound keeps one bridge call from turning
 * into an unbounded run of reports into a program vam does not control.
 */
export const MAX_WHEEL_TICKS = 40;

/**
 * THE WHOLE ALLOWLIST OF CHORDS, written out rather than derived.
 *
 * Twenty-six, and it is the letters exactly: Ctrl with a letter is the only
 * shape that produces a C0 control character on every keyboard there is --
 * `C-a` through `C-z` are 0x01 through 0x1a -- which is what makes this list
 * CLOSED rather than a first instalment. `Ctrl+1` produces no control
 * character in any terminal, so it is deliberately left to vam, where it still
 * picks a session tab from inside the pane (`TerminalTab.tsx` carries that
 * argument and the trade it makes).
 *
 * The punctuation chords a C0 table also holds -- `C-[`, `C-\`, `C-]`, `C-^`,
 * `C-_` -- are NOT here, and their absence is a decision rather than an
 * oversight. `C-[` IS Escape, which already has a kind of its own above; the
 * other four sit on a different physical key on every layout, so each would be
 * its own argument about what `event.key` means rather than a member of this
 * family.
 *
 * SPELLED AS LITERALS so the union is twenty-six string types and the compiler
 * can refuse a twenty-seventh. A `string` narrowed by a regular expression
 * would be one `as` away from being a key name again.
 */
export const CONTROL_LETTERS = [
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
  'u',
  'v',
  'w',
  'x',
  'y',
  'z',
] as const;

/** One of the twenty-six above, and nothing else is assignable to it. */
export type ControlLetter = (typeof CONTROL_LETTERS)[number];

const CONTROL_LETTER_SET: ReadonlySet<string> = new Set<string>(CONTROL_LETTERS);

/**
 * Whether a value off the bridge names one of the twenty-six chords.
 *
 * A `Set` built FROM the list rather than a regular expression beside it: a
 * regex is a second spelling of the same fact and can drift from it silently
 * (`/^[a-z]$/` and a list of twenty-five would disagree and neither would
 * complain), and membership of the array IS the definition.
 *
 * Exported because the renderer decides with it too. One list asked by both
 * sides is what stops the pane building a stroke main then refuses as
 * malformed -- a refusal the tab draws as a sentence about session PAIRING,
 * which would send the operator after a problem that was never there.
 */
export function isControlLetter(value: unknown): value is ControlLetter {
  return typeof value === 'string' && CONTROL_LETTER_SET.has(value);
}

/**
 * THE WHOLE ALLOWLIST OF NAVIGATION KEYS -- the four arrows and Home, End,
 * PageUp, PageDown, written out exactly as `CONTROL_LETTERS` is.
 *
 * EIGHT, AND CLOSED FOR THE SAME REASON THAT LIST IS: these are the keys a
 * terminal is navigated with (`PaneKey`'s own `nav` doc has the report), and
 * anything else a keyboard sends is either a character `strokeFor` already
 * carries or a browser/vam chord this file has no business claiming.
 * `Insert` and `Delete` are deliberately NOT here -- the operator's report was
 * about the arrows and the pickers they walk, `Delete` already means
 * something to a browser (and nothing measured yet to a pane), and a list
 * grown on a guess is a list this file would have to defend twice.
 *
 * SPELLED AS LITERALS, so a `string` narrowed by a regular expression can
 * never stand in for it -- the same defence `CONTROL_LETTERS` makes.
 */
export const NAV_KEYS = [
  'up',
  'down',
  'left',
  'right',
  'home',
  'end',
  'page-up',
  'page-down',
] as const;

/** One of the eight above, and nothing else is assignable to it. */
export type NavKey = (typeof NAV_KEYS)[number];

const NAV_KEY_SET: ReadonlySet<string> = new Set<string>(NAV_KEYS);

/**
 * Whether a value off the bridge names one of the eight navigation keys --
 * `isControlLetter`'s own reasoning, unchanged: a `Set` built FROM the list
 * so membership of the array IS the definition, and exported because the
 * renderer decides with it too (`TerminalTab.tsx`).
 */
export function isNavKey(value: unknown): value is NavKey {
  return typeof value === 'string' && NAV_KEY_SET.has(value);
}

/**
 * The longest text one keystroke may carry. A `KeyboardEvent.key` for a
 * printable key is one character, and a composed one (an IME, a dead key) is
 * a very few. The bound is what keeps this channel from becoming an unbounded
 * paste into a running agent by a renderer that is no longer vam's.
 */
export const MAX_KEY_TEXT = 16;

/**
 * What became of one keystroke. FIVE ANSWERS, and the split exists because a
 * boolean made the tab lie.
 *
 * `unaimed` is vam declining to guess: no session of its own answers for this
 * project, or two do. `refused` is tmux having rejected the delivery to a
 * session vam DID name -- overwhelmingly the session ending between the
 * listing and the send, which the tab's own next read will show as `gone`.
 * They are different sentences to a person: one sends them looking for a
 * pairing problem, the other tells them their agent exited. A single `false`
 * said the first for both.
 *
 * `unavailable` and `mispaired` ARE THE READ PATH'S OWN WORDS, and they are
 * here because `unaimed` was being said for both of them -- the same
 * conflation `PaneView` was given a `mispaired` arm to end. `unavailable` is
 * the listing itself failing: vam did not look, so it cannot claim a pairing
 * problem either. `mispaired` is a row that published its pane and had it
 * rejected: vam named a session and refused the one it named, which is the
 * opposite of not being able to name one. Two surfaces describing one state
 * in different words is its own defect, so the write path spells them as the
 * read path does.
 */
export type PaneSendResult = 'sent' | 'unaimed' | 'unavailable' | 'mispaired' | 'refused';

/** Whether a value off the bridge is a keystroke vam will send. */
export function isPaneKey(value: unknown): value is PaneKey {
  if (typeof value !== 'object' || value === null) return false;
  const key = value as {
    kind?: unknown;
    text?: unknown;
    letter?: unknown;
    nav?: unknown;
    direction?: unknown;
    ticks?: unknown;
    column?: unknown;
    row?: unknown;
    shift?: unknown;
  };
  if (key.kind === 'backspace' || key.kind === 'back-tab' || key.kind === 'escape') {
    return true;
  }
  // `shift` REQUIRED AND CHECKED, not read with a `?? false`: a malformed ask
  // that left it out must be refused rather than answered as a plain Return,
  // for the same reason `wheel`'s numbers are bounded here rather than
  // trusted -- the renderer is the least trusted process in the app.
  if (key.kind === 'enter') return key.shift === true || key.shift === false;
  // The only two kinds that carry a field main turns into a tmux KEY, and so
  // the only two whose field is checked against a closed list rather than
  // bounded in length: `letter` and `nav` are looked up, never spliced.
  if (key.kind === 'control') return isControlLetter(key.letter);
  if (key.kind === 'nav') return isNavKey(key.nav);
  // Every number a report carries is bounded here and only here, so main can
  // format them without a clamp of its own: a clamp is a value invented for
  // a caller that sent one main would not have.
  if (key.kind === 'wheel') {
    const within = (value: unknown, min: number, max: number): boolean =>
      typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
    return (
      (key.direction === 'up' || key.direction === 'down') &&
      within(key.ticks, 1, MAX_WHEEL_TICKS) &&
      within(key.column, 1, MAX_COLUMNS) &&
      within(key.row, 1, MAX_ROWS)
    );
  }
  return (
    key.kind === 'text' &&
    typeof key.text === 'string' &&
    key.text.length > 0 &&
    key.text.length <= MAX_KEY_TEXT
  );
}
