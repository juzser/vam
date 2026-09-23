/**
 * Running tmux, and turning every way it can fail into a distinct answer.
 *
 * The rule this module exists to keep is `pull-requests.ts`'s rule, and it
 * bites harder here: **"no sessions" and "vam could not ask" must never look
 * the same.** tmux exits non-zero with "no server running" when nothing has
 * ever been started -- which is not a fault, it is the empty list -- and it
 * also exits non-zero when it is not installed, when the session is gone, and
 * when the command was wrong. Collapsing those into one empty array would
 * tell the operator they have no sessions at the exact moment vam has lost
 * the ability to see them.
 *
 * Every entry point RESOLVES to its error and never throws, for the reason
 * `MainSource.recordPrompt` documents: a thrown error reaches the IPC
 * catch-all and comes back as a shapeless `unreachable/source-failed`.
 *
 * The spawn itself is the one part that is not tested, exactly as `deliver.ts`
 * says of its own: a test that ran these would create and kill sessions on the
 * operator's real tmux server. So the runner is a parameter.
 *
 * WHAT IS ACTUALLY CALLED IN PRODUCTION. `createVamSession`, from
 * `claude-code/create-session.ts`, and -- since the Terminal tab was built --
 * `listVamSessions` and `readPane`, from `main/terminal/pane.ts`. The
 * `has-session` builder is still called by nothing.
 *
 * The note that stood here asked whoever wired the tab to confirm the read
 * path on a real server, because the no-server-to-EMPTY-LIST mapping in
 * `listVamSessions` was asserted by test only. That was done, against a real
 * tmux on a private `-L` socket, and it found a defect no unit test could
 * have: `capture-pane -t '=name'` answers `can't find pane` and exits 1,
 * because `=name` is a target-SESSION and those verbs want a target-PANE
 * (`tmux/argv.ts` now explains the `:` that fixes it). Both halves were being
 * reported as `no-such-session` -- a working session drawn as one that had
 * ended. The mapping itself behaves: no server resolves to the empty list, a
 * live vam session to its screen.
 */

import { execFile } from 'node:child_process';
import type { PaneCursor, PaneSize } from '../../../shared/terminal.js';
import type { SourceError } from '../../ipc/channels.js';
import {
  capturePaneArgv,
  isVamSession,
  listSessionsArgv,
  newSessionArgv,
  resizeWindowArgv,
  tagPidArgv,
  tagSessionArgv,
  tagVamSessionArgv,
  VAM_CURSOR_MARK,
} from './argv.js';

/** tmux answers in milliseconds; a slow one is a broken one. */
const TMUX_TIMEOUT_MS = 10_000;

/**
 * The signal node sends when the timeout above fires. It is node's default for
 * `killSignal`, and it is what tells a timeout apart from a kill vam did not
 * ask for -- so `createTmuxRunner` passes it explicitly rather than leaving the
 * classifier's reasoning resting on a default that could change.
 */
const TIMEOUT_SIGNAL = 'SIGTERM';

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/** Enough of what tmux said to act on. */
const MAX_TMUX_MESSAGE = 400;

/**
 * What the operator is told when the process failed with nothing on stderr.
 *
 * `failure.message` is NOT used: node builds it as `Command failed: <file>
 * <args joined>`, so it republishes the argv -- tmux session names carry the
 * project label, and the same fallback in `deliver.ts` carried the whole
 * prompt into a prefilled PUBLIC issue body. It is also unbounded, while
 * `clip` is applied to stderr only.
 */
const NO_WORDS = 'the process exited without saying why';

/** What a failed `execFile` hands back -- the shape `deliver.ts` documents. */
export type SpawnFailure = {
  readonly message: string;
  readonly code?: string | number | null | undefined;
  readonly killed?: boolean | undefined;
  /**
   * WHICH SIGNAL ENDED IT, or `null` if none did -- and `null` is the answer
   * node gives for every ordinary non-zero exit.
   *
   * MEASURED ON NODE v26.5.0, which is what this app runs:
   *
   *   exit 1            -> { code: 1,    killed: false, signal: null      }
   *   an external kill  -> { code: null, killed: false, signal: 'SIGTERM' }
   *   node's own timeout-> { code: null, killed: true,  signal: 'SIGTERM' }
   *
   * The type used to say `string | undefined`, so the reader beneath it asked
   * `signal !== undefined` -- which is TRUE for `null`. Every ordinary failure
   * was therefore classified as a kill, and the operator was told the process
   * "was killed by null, which vam did not ask for" when nothing had been
   * killed at all. Reported from use.
   */
  readonly signal?: string | null | undefined;
};

/**
 * The signal, or `null` for "none" -- collapsing the two ways a failure says
 * it was not signalled (absent, and `null`) into the one the readers use.
 *
 * A PREDICATE AND NOT A COMPARISON, because the comparison is what broke: the
 * type promised `string | undefined` while node sends `null`, so `!== undefined`
 * read every ordinary exit as a kill. Asking for a non-empty STRING cannot be
 * fooled by either absence, and it is the same shape check the rest of this
 * directory makes on provider data.
 */
function signalOf(failure: { readonly signal?: string | null | undefined }): string | null {
  return typeof failure.signal === 'string' && failure.signal !== '' ? failure.signal : null;
}

export type TmuxRunResult = {
  readonly failure: SpawnFailure | null;
  readonly stdout: string;
  readonly stderr: string;
};

/** How tmux is actually run. Injected so everything above it is testable. */
export type TmuxRun = (argv: readonly string[]) => Promise<TmuxRunResult>;

const clip = (text: string): string =>
  text.trim().length > MAX_TMUX_MESSAGE
    ? `${text.trim().slice(0, MAX_TMUX_MESSAGE)}...`
    : text.trim();

/**
 * tmux's own words, matched loosely enough to survive a rewording. NO_SERVER
 * is the one that must not be mistaken for a failure by a caller listing
 * sessions -- see `listVamSessions`.
 */
const NO_SERVER = /no server running|error connecting to .*\(no such file/i;
const NO_SESSION = /can't find (?:session|pane|window)|session not found/i;
const DUPLICATE = /duplicate session/i;

/**
 * Turn a failed tmux run into one honest reason. `action` is a phrase like
 * "creating a session", so the message says what vam was doing when it lost.
 *
 * Order matters: `ENOENT` and a kill are facts about the process and beat
 * anything stderr claims.
 */
export function classifyTmuxFailure(input: {
  failure: SpawnFailure;
  stderr: string;
  action: string;
}): SourceError {
  const { failure, stderr, action } = input;
  const said = clip(stderr);

  if (failure.code === 'ENOENT') {
    return {
      kind: 'unreachable',
      code: 'tmux-missing',
      message: `the \`tmux\` command was not found, so vam cannot manage sessions (${action})`,
    };
  }
  // A kill is TWO different facts wearing one flag. `createTmuxRunner` sets a
  // timeout, and node enforces it with SIGTERM -- that one is a hang. Any other
  // signal means something outside vam ended tmux (the OOM killer sends
  // SIGKILL), which is not a hang and must not be reported as one: the
  // operator would go looking for a slow tmux that was never slow.
  // `killed` is NOT the flag that distinguishes them: node sets it only when
  // node itself killed the child, and it only ever kills with TIMEOUT_SIGNAL.
  // An external kill arrives as `{code: null, killed: false, signal:
  // 'SIGKILL'}` -- measured on node 26 -- so the arm below was unreachable in
  // production and every real kill fell through to `refused/tmux-failed`,
  // i.e. "tmux understood and declined", for a process that was killed.
  if (failure.killed === true || signalOf(failure) !== null) {
    if (failure.killed === true && signalOf(failure) === TIMEOUT_SIGNAL) {
      return {
        kind: 'unreachable',
        code: 'timed-out',
        message: `tmux did not answer within ${Math.round(TMUX_TIMEOUT_MS / 1000)}s (${action})`,
      };
    }
    return {
      kind: 'unreachable',
      code: 'killed',
      message: `tmux was killed before it answered${
        signalOf(failure) === null ? '' : ` by ${signalOf(failure)}`
      }, which vam did not ask for (${action})`,
    };
  }
  if (NO_SERVER.test(stderr)) {
    return {
      kind: 'unreachable',
      code: 'no-server',
      message: `no tmux server is running, so there is nothing to reach (${action})`,
    };
  }
  if (NO_SESSION.test(stderr)) {
    return {
      kind: 'refused',
      code: 'no-such-session',
      message: `that tmux session no longer exists (${action}): ${said}`,
    };
  }
  if (DUPLICATE.test(stderr)) {
    return {
      kind: 'refused',
      code: 'session-exists',
      message: `a tmux session by that name already exists (${action}): ${said}`,
    };
  }
  return {
    kind: 'refused',
    code: 'tmux-failed',
    message: `tmux failed while ${action}: ${said === '' ? NO_WORDS : said}`,
  };
}

/** The real runner. Never rejects: a failed spawn is data, like everywhere else here. */
export function createTmuxRunner(binary = 'tmux'): TmuxRun {
  return (argv) =>
    new Promise((resolve) => {
      execFile(
        binary,
        [...argv],
        {
          timeout: TMUX_TIMEOUT_MS,
          killSignal: TIMEOUT_SIGNAL,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
        },
        (failure, stdout, stderr) => {
          resolve({ failure, stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
}

/**
 * One session on the server, as vam sees it: the project id vam recorded on it
 * (`''` when nothing did -- see `VAM_PROJECT_OPTION`), the pid vam recorded on
 * it, and the session name.
 */
export type TmuxSession = {
  readonly project: string;
  /**
   * A STRING, not a number: tmux options are strings, and this is compared
   * against `String(row.pid)` in `paneForRow` (`reply.ts`) rather than parsed
   * back -- one direction of conversion to get wrong, not two.
   *
   * OPTIONAL, unlike `project` -- `listVamSessions` always sets it (to `''`
   * when nothing tagged the session, the same as `project`), but a great many
   * fixtures in this test suite predate this field and construct a
   * `TmuxSession` literal directly; making it required would cost every one
   * of them an edit for a field their test does not exercise. `undefined` and
   * `''` mean the identical thing to every reader -- `paneForRow` compares
   * against a real pid string, which neither can ever equal.
   */
  readonly pid?: string;
  readonly name: string;
  /**
   * What is in the FOREGROUND of the pane, as tmux names the process
   * (`pane_current_command` -- `zsh`, `claude`, `codex`, `sleep`). OPTIONAL
   * for the reason `pid` is: the fixtures that predate it answer three
   * fields, and absence means "the listing did not say", never "a shell".
   * `tmux/shell.ts`'s `isShellCommand` is the one reader that interprets it.
   */
  readonly command?: string;
  /**
   * The native id vam wrote for whatever it started in this pane -- a Claude
   * Code session id or a Codex thread uuid -- or absent when the listing did
   * not carry it. Same optionality as `command` and `pid`, and the same rule:
   * `''` and absent mean the identical thing to every reader, because an
   * unset tmux option reads back as the empty string and a reader that
   * matched on it would pair every session vam never wrote this for.
   */
  readonly vamSessionId?: string;
  /**
   * The pane's REAL working directory, as tmux itself reports it -- never
   * vam's own `@vam-project` digest, which cannot be turned back into a
   * directory. Absent for the same reason `command` is: the fixtures that
   * predate this field answer without it, and absence means "the listing did
   * not say", never "the pane has no directory" -- every live pane has one.
   */
  readonly cwd?: string;
};

/** Either the thing, or why vam could not get it -- never one standing in for the other. */
export type TmuxSessions =
  | { readonly kind: 'ok'; readonly sessions: readonly TmuxSession[] }
  | { readonly kind: 'unavailable'; readonly error: SourceError };

export type TmuxText =
  | {
      readonly kind: 'ok';
      readonly text: string;
      readonly cursor: PaneCursor;
      /** Whether the pane's program asked for the mouse; absent when tmux did not say. */
      readonly mouse?: boolean;
    }
  | { readonly kind: 'unavailable'; readonly error: SourceError };

/**
 * The largest coordinate this will believe. Not a size policy -- the renderer
 * decides what fits, and only draws a cursor on a row the screen actually has.
 * This is the bound against a value that is not a position at all, so nothing
 * downstream is asked to pad a line to a hundred thousand cells.
 */
const MAX_CURSOR_CELL = 99_999;

/**
 * What tmux's one marker line says: where the cursor is ON THE SCREEN, and how
 * many lines of history sit above that screen.
 *
 * TWO FIELDS RATHER THAN ONE BECAUSE THEY FAIL SEPARATELY. `depth` is `null`
 * when tmux did not answer with a number -- an older tmux that does not know
 * `#{history_size}` expands it to nothing -- and that is not a reason to
 * forget where the cursor is; it is a reason not to be able to PLACE it, and
 * only when history was asked for (`readPane`).
 */
type PaneMark = {
  readonly cursor: PaneCursor;
  readonly depth: number | null;
  /** `#{mouse_any_flag}`, or `null` for a line that did not carry it. */
  readonly mouse: boolean | null;
};

/**
 * tmux's one-line answer about the cursor, or the honest absence of one.
 *
 * EXPORTED FOR ITS TEST, and it is worth testing on its own because every
 * failure mode here is SILENT. Measured on tmux 3.7b: a `display-message`
 * aimed at a target that does not exist exits 0, writes nothing to stderr,
 * and prints the format with all its fields empty -- so there is no failure
 * for `classifyTmuxFailure` to catch and nothing but this parse standing
 * between that silence and a cursor drawn in the corner of a screen.
 *
 * Every field is therefore checked rather than coerced. `Number('')` is 0 and
 * `Number(' ')` is 0; `parseInt` on a malformed value is `NaN`, which compares
 * false and would slip through a `>=` guard the wrong way round. The shape is
 * matched whole, by pattern, and anything else is `unreadable`.
 *
 * THREE FIELDS, FOUR OR FIVE. The format asks for five (`argv.ts`,
 * `CURSOR_FORMAT`): the fourth is the history depth, the fifth whether the
 * pane's program asked for the mouse. Three is still read as a cursor rather
 * than refused, because the many stubbed runners in this repo's own suite --
 * and any tmux old enough to have dropped the key entirely -- answer with
 * three, and every one of them is a screen-only read where the depth is not
 * needed; four is every stub written before the mouse was asked about. A
 * field that is not there is `null`, never `false`: "tmux did not say" and
 * "the program declined the mouse" send a wheel to different places.
 */
export function readCursorLine(line: string): PaneMark {
  const nothing: PaneMark = { cursor: { kind: 'unreadable' }, depth: null, mouse: null };
  const marked = `${VAM_CURSOR_MARK} `;
  if (!line.startsWith(marked)) return nothing;
  const fields = line.slice(marked.length).split(' ');
  const [flag, x, y, history, mouseFlag] = fields;
  if (fields.length < 3 || fields.length > 5) return nothing;
  // `#{history_size}` is a count and never negative, so anything that is not
  // a run of digits is tmux having said nothing vam can use.
  const depth = history !== undefined && /^\d+$/.test(history) ? Number(history) : null;
  // Only its two values are believed, for the reason `cursor_flag` gives.
  const mouse = mouseFlag === '1' ? true : mouseFlag === '0' ? false : null;
  // The flag can VETO, so it is read before the coordinates and only two
  // values mean anything: a `cursor_flag` that is neither 0 nor 1 is a tmux
  // this parse does not understand, not a cursor to guess about.
  if (flag === '0') return { cursor: { kind: 'hidden' }, depth, mouse };
  if (flag !== '1') return { ...nothing, depth, mouse };
  if (x === undefined || y === undefined || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return { ...nothing, depth, mouse };
  }
  const column = Number(x);
  const row = Number(y);
  return column > MAX_CURSOR_CELL || row > MAX_CURSOR_CELL
    ? { ...nothing, depth, mouse }
    : { cursor: { kind: 'at', column, row }, depth, mouse };
}

/**
 * Split tmux's one stdout into the cursor's line and the screen's lines, and
 * move the cursor onto the line it is really on.
 *
 * THE SPLIT IS BY MARKER, NEVER BY POSITION (`argv.ts`, `VAM_CURSOR_MARK`). A
 * first line taken on trust would be a line of the operator's screen deleted
 * on every read the cursor query did not answer -- and the query not answering
 * is not hypothetical: it is what an older tmux, a half-run sequence and every
 * pre-existing stubbed runner all look like.
 *
 * THE OFFSET, which is the whole reason this function grew an argument.
 * `cursor_y` is a row of the SCREEN. When `history` lines were asked for, the
 * text below the marker begins that far ABOVE the screen, so the caret's index
 * in it is `above + cursor_y` -- and `above` is what tmux GAVE, not what tmux
 * HAS: a session 900 lines deep answers a 500-line request with 500, because
 * tmux clamps the start to the oldest line it kept (measured on 3.7b: an 80x10
 * pane with 34 lines of history answers `-S -200` with 34 + 10, and the same
 * pane at 1929 lines of history answers it with 200 + 10, twenty-five times
 * out of twenty-five against a pane printing all the while).
 *
 * AND WHEN THE DEPTH IS UNREADABLE, NO CARET IS DRAWN. vam then holds a screen
 * row with no way to say where the screen begins; placing it anyway would put
 * somebody's caret somewhere in their scrollback. That is `pull-requests.ts`'s
 * rule in its original form -- "vam could not find out" is never dressed up as
 * a position -- and it costs nothing on the screen-only path, where no offset
 * is needed and none is looked for.
 */
function splitCursor(
  stdout: string,
  history: number,
): { text: string; cursor: PaneCursor; mouse?: boolean } {
  const end = stdout.indexOf('\n');
  const marked = stdout.startsWith(`${VAM_CURSOR_MARK} `);
  const line = end === -1 ? stdout : stdout.slice(0, end);
  const mark = readCursorLine(line);
  const place = (cursor: PaneCursor): PaneCursor => {
    if (cursor.kind !== 'at' || history <= 0) return cursor;
    const above = mark.depth === null ? null : Math.min(mark.depth, Math.floor(history));
    return above === null ? { kind: 'unreadable' } : { ...cursor, row: above + cursor.row };
  };
  // The flag is only SAID when tmux said it: an absent field stays absent,
  // so a consumer reading `mouse === false` is reading a program's answer.
  const said = mark.mouse === null ? {} : { mouse: mark.mouse };
  if (end === -1) return { text: stdout, cursor: place(mark.cursor), ...said };
  return mark.cursor.kind === 'unreadable' && !marked
    ? // No cursor line at all: every byte is screen.
      { text: stdout, cursor: mark.cursor }
    : { text: stdout.slice(end + 1), cursor: place(mark.cursor), ...said };
}

/**
 * vam's own sessions, and only those.
 *
 * THREE decisions, all load-bearing. First, "no server running" resolves to an
 * EMPTY LIST: no server means no sessions, which is an answer, not a failure.
 * Every other failure stays `unavailable` with its own code. Second, the names
 * are filtered by vam's prefix, so the operator's unrelated `notes` or `irc`
 * session is never presented as something vam started -- and never offered to
 * a caller that might kill it.
 *
 * THIRD, A LINE WITHOUT ITS SEPARATORS IS AN UNREADABLE LISTING, NOT A
 * SESSION TO SKIP. `listSessionsArgv` prints two tabs on EVERY line, tagged or
 * not, so a non-empty line with fewer than two is not a session in some other
 * shape: it is tmux telling us its output was rewritten. Measured on tmux
 * 3.7b: a client whose LC_CTYPE is not UTF-8 -- unset, `C`, or a locale the
 * system lacks -- prints every control character of a `-F` expansion as `_`,
 * and a GUI-launched vam has no LANG or LC_* at all. Skipping such lines, as
 * this loop once did, turned that into `ok, []`: "vam started none of these",
 * for a machine whose every vam session was in the list -- so the reply
 * refused as `no-terminal`, and Close and the Terminal tab refused with it,
 * all pointing the operator at a pane vam could not see. `env/utf8-ctype.ts`
 * repairs the environment so the tabs survive; this arm is what keeps the
 * answer honest -- "could not ask", carrying why -- if they ever do not.
 */
export async function listVamSessions(run: TmuxRun): Promise<TmuxSessions> {
  const { failure, stdout, stderr } = await run(listSessionsArgv());
  if (failure !== null) {
    const error = classifyTmuxFailure({ failure, stderr, action: 'listing sessions' });
    return error.code === 'no-server'
      ? { kind: 'ok', sessions: [] }
      : { kind: 'unavailable', error };
  }
  const sessions: TmuxSession[] = [];
  for (const line of stdout.split('\n')) {
    // The one legitimately empty line is the one after the final newline.
    if (line === '') continue;
    // Split on the FIRST TWO tabs only. The name is whatever follows the
    // second one, so a value that somehow held a tab cannot shorten the name
    // it is paired with.
    const firstTab = line.indexOf('\t');
    const secondTab = firstTab === -1 ? -1 : line.indexOf('\t', firstTab + 1);
    if (secondTab === -1) {
      return {
        kind: 'unavailable',
        error: {
          kind: 'unreachable',
          code: 'listing-unreadable',
          message:
            'tmux printed its session listing without the separators vam asked for ' +
            '(its LC_CTYPE is not a UTF-8 locale, so it rewrote them), and vam will ' +
            'not guess which sessions are its own from that (listing sessions)',
        },
      };
    }
    // The THIRD tab is optional -- what follows it is the foreground command
    // (`listSessionsArgv`), and a line without it is the older three-field
    // shape every stubbed runner in this suite still answers with. The name
    // is what sits between the second tab and the third, or to the end.
    const thirdTab = line.indexOf('\t', secondTab + 1);
    const name = (
      thirdTab === -1 ? line.slice(secondTab + 1) : line.slice(secondTab + 1, thirdTab)
    ).trim();
    if (!isVamSession(name)) continue;
    // THE FOURTH AND FIFTH TABS ARE BOTH OPTIONAL TOO, and for the same
    // reason the third is: an older tmux, or any stub in this suite that
    // predates `@vam-session` and the real cwd, still parses. Each is only
    // looked for once the one before it was found, so a line that stops
    // after the command -- the shape every existing fixture uses -- leaves
    // both trailing fields off rather than reading a foreign-directory
    // digest as if it were one of them.
    const fourthTab = thirdTab === -1 ? -1 : line.indexOf('\t', thirdTab + 1);
    const fifthTab = fourthTab === -1 ? -1 : line.indexOf('\t', fourthTab + 1);
    const command =
      thirdTab === -1
        ? ''
        : (fourthTab === -1
            ? line.slice(thirdTab + 1)
            : line.slice(thirdTab + 1, fourthTab)
          ).trim();
    const vamSessionId =
      fourthTab === -1
        ? ''
        : (fifthTab === -1
            ? line.slice(fourthTab + 1)
            : line.slice(fourthTab + 1, fifthTab)
          ).trim();
    const cwd = fifthTab === -1 ? '' : line.slice(fifthTab + 1).trim();
    sessions.push({
      project: line.slice(0, firstTab).trim(),
      pid: line.slice(firstTab + 1, secondTab).trim(),
      name,
      // Absent, not `''`, when the listing did not carry it -- see the field.
      ...(command === '' ? {} : { command }),
      ...(vamSessionId === '' ? {} : { vamSessionId }),
      ...(cwd === '' ? {} : { cwd }),
    });
  }
  return { kind: 'ok', sessions };
}

/**
 * The pid `new-session -P -F` printed on its own stdout, or `null` for
 * anything this cannot trust: empty output -- what an option a very old tmux
 * does not know expands to, measured, rather than failing (`CURSOR_FORMAT`'s
 * same note) -- or anything that is not purely digits, which a real pid
 * always is. `null` is never a reason to refuse the session that already
 * started; see the caller.
 */
function readPanePid(stdout: string): string | null {
  const trimmed = stdout.trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

/**
 * Start a detached session. Resolves to `null` when it started, and to the
 * `SourceError` otherwise.
 */
export async function createVamSession(
  run: TmuxRun,
  input: {
    name: string;
    cwd: string;
    command: readonly string[];
    projectId: string;
    /**
     * The native id a RESUME already holds -- `docs/design/vam-owns-the-
     * session.md` §2, step 1. Absent for a fresh start, which has no id to
     * give yet (§2 step 2 is Stage 2's problem). An empty string is refused
     * exactly like an absent one, never written: the same rule every other
     * option here follows, because an unset option reads back as `''` and a
     * reader that matched on it would pair every session this was never
     * written for.
     */
    sessionId?: string;
  },
): Promise<SourceError | null> {
  const { failure, stdout, stderr } = await run(newSessionArgv(input));
  if (failure !== null) {
    return classifyTmuxFailure({ failure, stderr, action: `creating session ${input.name}` });
  }
  // THE PROJECT PAIRING IS RECORDED HERE OR NOWHERE. tmux has no way to create
  // a session and set an option on it in one command, so this is a second call
  // and it can fail on its own.
  const tagged = await run(tagSessionArgv(input.name, input.projectId));
  if (tagged.failure !== null) {
    // The session IS running -- reporting a failure to start it would send the
    // operator looking for something that is not wrong. What is wrong is that
    // the Terminal tab will not find it, and that is what this says.
    const error = classifyTmuxFailure({
      failure: tagged.failure,
      stderr: tagged.stderr,
      action: `recording which project ${input.name} belongs to`,
    });
    return {
      ...error,
      code: 'session-untagged',
      message: `the session started, but vam could not record which project it belongs to, so the Terminal tab will not find it: ${error.message}`,
    };
  }
  // THE PID TAG, AND ITS FAILURE IS NOT THE PROJECT TAG'S SEVERITY. It is a
  // BONUS proof (`VAM_PID_OPTION`): a session the project tag above already
  // recorded is still findable, repliable and closeable by the older,
  // per-project fallback with or without it. So an unreadable pid, or a
  // `set-option` that itself fails, degrades SILENTLY to that older, still
  // honest behaviour rather than turning a session that DID start into a
  // reported failure over a feature that is allowed to be missing -- exactly
  // how an older Claude Code that never publishes a `tmux` field is already
  // treated, not an exception to it.
  const pid = readPanePid(stdout);
  if (pid !== null) {
    await run(tagPidArgv(input.name, pid));
  }
  // THE VAM-SESSION TAG, LAST AND AT THE SAME SEVERITY AS THE PID TAG. Only
  // written when the caller actually has an id -- a resume -- and never for
  // an empty one, which would be indistinguishable from a session nobody
  // wrote this for. A failure here degrades silently for the pid tag's own
  // reason: the project tag already recorded is what actually gates the
  // Terminal tab, and this is a bonus pairing on top of it.
  if (input.sessionId !== undefined && input.sessionId !== '') {
    await run(tagVamSessionArgv(input.name, input.sessionId));
  }
  return null;
}

/**
 * The rendered screen, as plain text -- and, when a caller asks for it, the
 * `history` lines of scrollback above it. This is the whole of the read path
 * for now, and deliberately: the LIVE path (`tmux pipe-pane -o`, which does
 * stream raw output with escape sequences intact) needs a terminal renderer
 * vam does not have and cannot add here -- no terminal emulator package is
 * available. A polled snapshot that is honest beats a stream drawn as garbage.
 *
 * THE DEFAULT IS THE SCREEN, and `capturePaneArgv`'s own note says why that is
 * a safety default rather than a conservative one: `terminal/answer.ts` reads
 * this pane to find the picker a session is waiting on, and history would put
 * every picker it ever drew in front of the parser at once.
 */
export async function readPane(run: TmuxRun, name: string, history = 0): Promise<TmuxText> {
  const { failure, stdout, stderr } = await run(capturePaneArgv(name, history));
  return failure === null
    ? { kind: 'ok', ...splitCursor(stdout, history) }
    : {
        kind: 'unavailable',
        error: classifyTmuxFailure({ failure, stderr, action: `reading session ${name}` }),
      };
}

/**
 * Give a session the size the pane can actually show. Resolves to `null` when
 * tmux did it, and to the `SourceError` otherwise.
 *
 * The CALLER decides whether this session may be touched at all
 * (`main/terminal/pane.ts` -- only a session vam recorded for this project).
 * Nothing here re-derives that from a name.
 */
export async function resizeWindow(
  run: TmuxRun,
  name: string,
  size: PaneSize,
): Promise<SourceError | null> {
  const { failure, stderr } = await run(resizeWindowArgv(name, size.columns, size.rows));
  return failure === null
    ? null
    : classifyTmuxFailure({ failure, stderr, action: `resizing session ${name}` });
}
