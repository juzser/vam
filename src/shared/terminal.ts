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
    }
  | { readonly kind: 'not-vam' }
  | { readonly kind: 'gone' }
  | { readonly kind: 'ambiguous'; readonly names: readonly string[] }
  | { readonly kind: 'mispaired'; readonly published: string }
  | { readonly kind: 'unavailable'; readonly error: SourceError };

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
 */
export type PaneKey =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'enter' }
  | { readonly kind: 'backspace' }
  /** Shift-Tab, `BTab` to tmux -- the session's own cycle-the-mode chord. */
  | { readonly kind: 'back-tab' }
  /** Escape, `Escape` to tmux -- the key every TUI cancels on. */
  | { readonly kind: 'escape' }
  /** One Ctrl chord -- `C-u` to tmux, and its twenty-five siblings. */
  | { readonly kind: 'control'; readonly letter: ControlLetter };

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
  const key = value as { kind?: unknown; text?: unknown; letter?: unknown };
  if (
    key.kind === 'enter' ||
    key.kind === 'backspace' ||
    key.kind === 'back-tab' ||
    key.kind === 'escape'
  ) {
    return true;
  }
  // The only kind that carries a field main turns into a tmux KEY, and so the
  // only one whose field is checked against a closed list rather than bounded
  // in length: `letter` is looked up, never spliced.
  if (key.kind === 'control') return isControlLetter(key.letter);
  return (
    key.kind === 'text' &&
    typeof key.text === 'string' &&
    key.text.length > 0 &&
    key.text.length <= MAX_KEY_TEXT
  );
}
