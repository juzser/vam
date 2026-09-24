/**
 * THE PURE HALF of the control-mode fast path: which argv this trusts itself
 * to send as ONE line of tmux's control-mode protocol instead of spawning a
 * process for it, how it turns that argv into the line, and how it turns
 * tmux's `%begin`/`%end`/`%error` reply back into the exact `TmuxRunResult`
 * shape `spawn.ts`'s `execFile` path already produces -- so every caller of a
 * `TmuxRun` (`readPane`, `sendToPane`, `listVamSessions`, `resizeWindow`)
 * keeps working unchanged whichever path answered it.
 *
 * ── WHY A SEPARATE, PROCESS-FREE MODULE AT ALL ────────────────────────────
 * `control.ts`'s `ControlClient` is the stateful half that actually spawns
 * `tmux -C` and owns its stdin/stdout; everything THIS file decides is a pure
 * function of an argv or a chunk of text, so it is provable without a real
 * tmux -- `tmux-control-protocol.test.ts` does exactly that, the same way
 * `tmux-argv.test.ts` pins the `execFile` path's argv without ever running
 * one.
 *
 * ── WHY THE OPERATOR'S OWN TYPED TEXT NEVER BECOMES A QUOTED STRING ───────
 * tmux's control-mode input is parsed by the SAME grammar as its command
 * prompt and its config file, not merely split on whitespace -- and that
 * grammar performs SHELL-LIKE EXPANSION even inside a double-quoted
 * argument. MEASURED against a real tmux 3.7b: `send-keys -l --
 * "a $HOME b"` delivered `a /Users/ser b` to the pane, not the six characters
 * `$HOME` the operator actually typed. `execFile`'s argv array never had this
 * problem -- tmux receives each element as one exact word, with no line to
 * tokenize -- so a quoting scheme for control mode would be a NEW hazard this
 * codebase's argv-array discipline never had to defend against. `-H` sidesteps
 * the whole question: `send-keys -H 61 62` delivers the two bytes `0x61 0x62`
 * with no parsing step in between at all, so `encodeControlLine` hex-encodes
 * EVERY `send-keys -l -- <text>` call regardless of what `<text>` contains,
 * rather than trying to quote it correctly. The wheel report
 * (`sendWheelArgv`) takes the same rewrite for the same reason -- it is not
 * operator text, but it is raw bytes (an SGR escape sequence) built the same
 * shape, and `-H` handles arbitrary bytes without caring which they are.
 *
 * ── WHY EVERYTHING ELSE IS AN ALLOWLIST, NOT AN ESCAPER ───────────────────
 * A session target (`=vam-<slug>-<random>:`) is already restricted to
 * `[A-Za-z0-9_-]` by `vamSessionName`'s own `UNSAFE_NAME` filter
 * (`argv.ts`), an integer is `/^-?\d{1,6}$/`, and the two multi-word format
 * strings this file ever sends (`CURSOR_FORMAT`, the `list-sessions -F`
 * string) are FIXED CONSTANTS with no operator content in them at all --
 * `tmux-control-protocol.test.ts` asserts neither contains a character this
 * file would ever need to escape. Every other token has to be an EXACT
 * literal this file already knows about (a verb, a flag, `Enter`, one of the
 * twenty-six `C-<letter>` names, one of the eight navigation keys). Anything
 * that does not match one of these shapes makes `encodeControlLine` return
 * `null`, and the caller falls back to a real spawn for that one call -- the
 * SAME fallback the whole client degrades to when the persistent connection
 * itself is not there (`control.ts`). A token this file does not recognise is
 * therefore never a reason to guess; it is a reason to do what vam already
 * did before this file existed.
 *
 * ── WHAT NEVER RIDES THIS PATH AT ALL ──────────────────────────────────────
 * `new-session`, `set-option` and `kill-session` are not in the allowlist and
 * never will be by accident: their arguments are a cwd, a command argv and an
 * option value, none of them bounded to a safe charset the way a vam session
 * name is, and none of them on the keystroke chain this module exists to
 * speed up. They stay on `execFile`, exactly as before this file existed.
 */

import { CURSOR_FORMAT, VAM_PID_OPTION, VAM_PROJECT_OPTION, VAM_SESSION_OPTION } from './argv.js';
import type { SpawnFailure, TmuxRunResult } from './spawn.js';

/**
 * WHERE THE PERSISTENT CLIENT ATTACHES, and the one property that matters:
 * `isVamSession(CONTROL_SESSION_NAME)` must be `false` -- pinned by its own
 * test -- so this housekeeping session never appears in `list-sessions`
 * filtered to vam's own rows, never resolves as a project pane, and is never
 * offered to anything that reads or kills "vam's sessions". It carries no
 * `@vam-project` tag and nothing ever targets it with `-t`; it exists only so
 * a control-mode client has SOMETHING to attach to (`control.ts`), and its
 * own size never touches any OTHER session's, because tmux sizes a window by
 * the clients looking AT THAT WINDOW -- MEASURED against a real tmux:
 * resizing one session through a control client attached to this one left the
 * other's `#{pane_width}x#{pane_height}` exactly where it was set.
 */
export const CONTROL_SESSION_NAME = 'vamctl';

/** The `list-sessions -F` format string, mirrored from `argv.ts` so this file
 * can recognise it by exact value without importing a function that builds
 * it fresh each call (`===` on two calls' return value is not guaranteed to
 * hold for a template literal recomputed twice, even though it would in
 * practice; recognising the LITERAL keeps the check honest either way). */
const LIST_SESSIONS_FORMAT = `#{${VAM_PROJECT_OPTION}}\t#{${VAM_PID_OPTION}}\t#{session_name}\t#{pane_current_command}\t#{${VAM_SESSION_OPTION}}\t#{pane_current_path}`;

/** A vam session target, exactly as `target()`/`paneTarget()` in `argv.ts` build it. */
const SAFE_TARGET_RE = /^=vam-[A-Za-z0-9_-]+:?$/;

/** A plain bounded integer -- history depth, a column or row count. */
const SAFE_INT_RE = /^-?\d{1,6}$/;

/** Every bareword this file will ever emit UNQUOTED, because it is one of
 * this codebase's own fixed literals and never carries operator content. */
const SAFE_LITERALS: ReadonlySet<string> = new Set([
  'display-message',
  'capture-pane',
  'send-keys',
  'resize-window',
  'list-sessions',
  '-p',
  '-t',
  '-F',
  '-e',
  '-S',
  '-x',
  '-y',
  '--',
  'Enter',
  'BSpace',
  'BTab',
  'Escape',
  // The eight navigation keys (`argv.ts`'s `sendNavArgv`/`NAV_KEY_NAMES`) --
  // pressed with `--`, exactly as a control chord is, so each reaches this
  // loop as its own bareword token rather than the six-token `-l --` shape
  // above.
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  ...'abcdefghijklmnopqrstuvwxyz'.split('').map((letter) => `C-${letter}`),
]);

/**
 * Verbs this file only ever sends when the SESSION or the SERVER'S IDEA of
 * the pane is about to CHANGE -- `send-keys` (a keystroke) and `resize-
 * window` (the window's own size). Every other verb `encodeSegment`
 * recognises only ever ASKS what is already true: `capture-pane`/`display-
 * message` read the pane, `list-sessions` reads the listing.
 *
 * WHY THIS MATTERS (A2, `control.ts`'s own note). A mutating command already
 * WRITTEN to tmux's stdin may have reached the server even when THIS file
 * never sees its reply -- the reply timed out, or the connection died right
 * after the write. Re-running it through a fallback spawn cannot tell "never
 * arrived" apart from "arrived and ran", so it can REPEAT an effect: a
 * keystroke delivered twice, a window resized twice. A pure read asked twice
 * only answers the same question again, which is always safe.
 */
const MUTATING_VERBS: ReadonlySet<string> = new Set(['send-keys', 'resize-window']);

/** `Buffer.from(text, 'utf8')`, one lowercase hex pair per byte. */
function hexBytes(text: string): readonly string[] {
  const bytes = Buffer.from(text, 'utf8');
  const out: string[] = [];
  for (const byte of bytes) out.push(byte.toString(16).padStart(2, '0'));
  return out;
}

/**
 * One `;`-separated segment of an argv, encoded to control-mode tokens, or
 * `null` when this file does not recognise its shape -- see the module note
 * on why that is a fallback and never a guess.
 */
function encodeSegment(tokens: readonly string[]): readonly string[] | null {
  // `send-keys -t <target> -l -- <text>` is the ONE shape carrying bytes this
  // file will not hand to tmux's tokenizer -- see the module note. It covers
  // both `sendTextArgv` (the operator's own text) and `sendWheelArgv` (an SGR
  // escape sequence): both build this exact six-token shape, and `-H`
  // handles either's bytes identically, content unexamined.
  if (
    tokens.length === 6 &&
    tokens[0] === 'send-keys' &&
    tokens[1] === '-t' &&
    tokens[3] === '-l' &&
    tokens[4] === '--' &&
    tokens[2] !== undefined &&
    SAFE_TARGET_RE.test(tokens[2]) &&
    tokens[5] !== undefined
  ) {
    return ['send-keys', '-t', tokens[2], '-H', ...hexBytes(tokens[5])];
  }
  const out: string[] = [];
  for (const token of tokens) {
    if (SAFE_LITERALS.has(token)) {
      out.push(token);
      continue;
    }
    if (token === CURSOR_FORMAT || token === LIST_SESSIONS_FORMAT) {
      out.push(`"${token}"`);
      continue;
    }
    if (SAFE_TARGET_RE.test(token) || SAFE_INT_RE.test(token)) {
      out.push(token);
      continue;
    }
    return null;
  }
  return out;
}

/**
 * Turn a whole `TmuxRun` argv (already stripped of any `-L`/`-S` server
 * prefix -- see `splitServerPrefix`) into one control-mode command line, or
 * `null` when any part of it falls outside what this file recognises.
 *
 * SPLIT ON THE LITERAL `';'` ELEMENT `capturePaneArgv` puts in its own argv
 * (`argv.ts`'s own note: a bare `;` is tmux's command separator in an argv
 * array exactly as it is on this line), and each segment becomes its own
 * `%begin`/`%end` block -- `blocks` counts them so the caller knows how many
 * to wait for (`control.ts`).
 */
export function encodeControlLine(
  argv: readonly string[],
): { readonly line: string; readonly blocks: number; readonly mutating: boolean } | null {
  const segments: string[][] = [[]];
  for (const token of argv) {
    if (token === ';') {
      segments.push([]);
      continue;
    }
    segments.at(-1)?.push(token);
  }
  if (segments.some((segment) => segment.length === 0)) return null;
  const encoded: string[][] = [];
  for (const segment of segments) {
    const one = encodeSegment(segment);
    if (one === null) return null;
    encoded.push([...one]);
  }
  return {
    line: encoded.map((segment) => segment.join(' ')).join(' ; '),
    blocks: encoded.length,
    // Read off the ORIGINAL (pre-encode) segments, not the encoded ones: a
    // `send-keys -l --` segment is rewritten to `-H <hex...>` by
    // `encodeSegment` above, but its first token is always still
    // `send-keys` either way -- this is simpler and exhaustive, since every
    // segment that reaches this point already matched one of
    // `SAFE_LITERALS`' five verbs (anything else made `encodeSegment`
    // return `null`, well above this line).
    mutating: segments.some((segment) => MUTATING_VERBS.has(segment[0] ?? '')),
  };
}

/**
 * Which persistent client an argv belongs to, and what is left of the argv
 * once its server-selecting prefix is taken off -- `control.ts` runs one
 * `ControlClient` per distinct key, exactly as vam runs one real tmux server
 * per distinct `-L`/default target.
 *
 * `null` FOR ANY OTHER LEADING FLAG, deliberately. This codebase's own argv
 * only ever carries `-L <socket>` (every private-socket test and this task's
 * own e2e harnesses) or nothing at all (production, `main/index.ts`); a
 * `null` here is the same fallback every unrecognised shape gets, not a
 * reason to invent a third rule.
 */
export function splitServerPrefix(argv: readonly string[]): {
  readonly key: string;
  readonly prefix: readonly string[];
  readonly rest: readonly string[];
} | null {
  const [first, second] = argv;
  if (first === '-L' && second !== undefined) {
    return { key: `L:${second}`, prefix: [first, second], rest: argv.slice(2) };
  }
  if (first === '-S' && second !== undefined) {
    return { key: `S:${second}`, prefix: [first, second], rest: argv.slice(2) };
  }
  if (first?.startsWith('-')) return null;
  return { key: 'default', prefix: [], rest: argv };
}

/**
 * One `%begin`…`%end`/`%error` reply, its body the lines between them.
 *
 * `reply` -- A1's own fix, see `isReplyHeader` below -- is `true` when this
 * block answers a command THIS control connection actually wrote, and
 * `false` for a block tmux generated on its own initiative (the unsolicited
 * block it emits on every `-C` connect). `control.ts`'s `#onData` drops
 * every block this is `false` for, unconditionally, rather than only
 * special-casing the first block it ever sees on a connection: tmux's own
 * flag names the distinction directly, so there is no need to special-case
 * a POSITION when the block itself already says what it is.
 */
export type ControlBlock = { readonly ok: boolean; readonly body: string; readonly reply: boolean };

/**
 * The bit that marks a `%begin`/`%end`/`%error` header as a reply to a
 * command THIS client actually wrote (A1). MEASURED against a real tmux
 * 3.7b, on a private `-L` socket (this task's own report, reproduced by its
 * own cross-review): the block tmux emits unsolicited on EVERY `-C`
 * connect -- a brand-new session and a reconnect to an existing one alike --
 * carries flags `0`; every block answering `list-sessions`, `capture-pane`
 * or a chained multi-command line this file's own client wrote carried
 * flags `1`, command numbers incrementing normally. The man page calls this
 * field "currently not used" -- stale against 3.7b's observed behaviour,
 * which this file trusts because it was reproduced, not merely read.
 */
const REPLY_FLAG = 1;

/** `<time> <command-number> <flags>` -- the text after `%begin `/`%end `/
 * `%error `, unparsed -- to whether flags' bit 0 is set. An unparsable or
 * missing flags field reads as `false` (not a reply): the safe default,
 * since treating a block this file does not understand AS a reply is the
 * direction A1's bug ran in. */
function isReplyHeader(header: string): boolean {
  const flags = header.split(' ').at(-1);
  const parsed = flags === undefined ? Number.NaN : Number(flags);
  return Number.isInteger(parsed) && (parsed & REPLY_FLAG) === REPLY_FLAG;
}

/**
 * Incremental parser for tmux's control-mode stdout: `%begin <time> <n>
 * <flags>\n`…lines…`%end`/`%error <time> <n> <flags>\n`, with unsolicited
 * notifications (`%output`, `%session-changed`, …) appearing OUTSIDE a block
 * and simply dropped -- this file has nothing to do with them, and
 * `control.ts` never asks for the streaming path they would otherwise imply
 * (the operator's own decision to keep poll/capture; see the module's
 * caller).
 *
 * FEEDS ARE NOT LINES. A `child_process` `'data'` event lands wherever the
 * pipe buffer happened to fill, so this buffers a possibly-partial trailing
 * line across calls to `feed` rather than assuming one chunk is one line --
 * `tmux-control-protocol.test.ts` drives it split mid-line and split mid-
 * keyword to pin exactly that.
 *
 * A BLOCK CLOSES ONLY ON ITS OWN HEADER (A3), not on any line merely SHAPED
 * like a close. Pane text is not escaped by this grammar the way a
 * command's ARGUMENTS are (`encodeSegment`'s own note on why `send-keys`
 * text is hex-encoded instead of quoted) -- a pane printing a line that
 * itself starts `%end ` or `%begin ` used to truncate the block early, or be
 * read as starting a nested one, either way corrupting every reply after it
 * for the life of the connection. `%begin <time> <n> <flags>` and its
 * matching `%end`/`%error` always share the IDENTICAL header text (tmux's
 * own pairing, not this file's invention), so this holds that text from the
 * opening line and requires an EXACT match to close -- a same-shaped-but-
 * different line, or pane text that merely starts with the right word, is
 * content. Ported from the terminal-streaming spike's own `StreamFramer`
 * (`vam/terminal-stream-spike`, `src/main/terminal/stream/protocol.ts`),
 * proven there against the identical grammar; kept here, in
 * `src/main/sources/tmux/`, as the ONE shared block-framer so that work can
 * import this instead of maintaining its own duplicate once it lands.
 *
 * ONE FRAMER, ONE CONNECTION, said plainly because it is what keeps a REPLY
 * from ever crossing between them. `control.ts` builds a fresh `ControlFramer`
 * for every child it spawns and never reuses one across a reconnect; a block
 * this file cannot yet close (a `%begin` with no matching `%end`/`%error`
 * before the connection died) is simply lost with the connection that owned
 * it, rather than answered against whatever the NEXT connection's first reply
 * happens to be.
 */
export class ControlFramer {
  #buffer = '';
  #open: string[] | null = null;
  /** The `<time> <n> <flags>` text after `%begin ` for the block currently
   * open -- the ONLY thing an `%end`/`%error` line may be matched against to
   * close it (A3). Meaningless while `#open` is `null`. */
  #openHeader = '';

  feed(chunk: string): ControlBlock[] {
    this.#buffer += chunk;
    const blocks: ControlBlock[] = [];
    for (;;) {
      const newline = this.#buffer.indexOf('\n');
      if (newline === -1) break;
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (this.#open === null) {
        if (line.startsWith('%begin ')) {
          this.#open = [];
          this.#openHeader = line.slice('%begin '.length);
        }
        // Every other line outside a block is a notification this file has
        // no use for -- dropped, not buffered, so it can never be mistaken
        // for the body of a block that has not started yet.
        continue;
      }
      if (line === `%end ${this.#openHeader}` || line === `%error ${this.#openHeader}`) {
        blocks.push({
          ok: line.startsWith('%end '),
          body: this.#open.map((l) => `${l}\n`).join(''),
          reply: isReplyHeader(this.#openHeader),
        });
        this.#open = null;
        this.#openHeader = '';
        continue;
      }
      this.#open.push(line);
    }
    return blocks;
  }
}

/**
 * Turn the `ControlBlock`s ONE control-mode line produced back into the
 * `TmuxRunResult` shape every `TmuxRun` caller already handles.
 *
 * THE POLICY, MEASURED rather than guessed: a `;`-chained command's overall
 * outcome, on the `execFile` path, follows its LAST sub-command -- the
 * capture-pane compound's own doc note records tmux exiting zero with "an
 * empty cursor line and the whole screen behind it" when the `display-
 * message` half's target was bad and `capture-pane`'s was not. Reproducing
 * that means: `stdout` is every OK block's body, in order, with a failed
 * block contributing NOTHING to it (its text would have reached the real
 * process's STDERR, not stdout, in the `execFile` world); `stderr` is every
 * FAILED block's body, whether or not the whole result ends up a failure, so
 * `classifyTmuxFailure`'s own regexes still have the same text to read
 * against when it does; and the overall `failure` is `null` unless the LAST
 * block itself failed.
 *
 * THE SYNTHETIC `SpawnFailure`, when there is one, is `{code: 1, killed:
 * false, signal: null}` -- `spawn.ts`'s own `SpawnFailure` doc names this
 * exact shape as what node hands back for "an ordinary non-zero exit", which
 * is the only fact `classifyTmuxFailure` actually reads off `failure` before
 * it falls to matching `stderr` by pattern.
 */
export function reconstructResult(blocks: readonly ControlBlock[]): TmuxRunResult {
  const stdout = blocks
    .filter((block) => block.ok)
    .map((block) => block.body)
    .join('');
  const stderr = blocks
    .filter((block) => !block.ok)
    .map((block) => block.body)
    .join('');
  const last = blocks.at(-1);
  const failure: SpawnFailure | null =
    last === undefined || last.ok
      ? null
      : { message: 'tmux control-mode command failed', code: 1, killed: false, signal: null };
  return { failure, stdout, stderr };
}
