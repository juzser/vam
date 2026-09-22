/**
 * The exact argv for every tmux command vam runs. Pure -- nothing here spawns.
 *
 * WHY TMUX AT ALL. A tmux session is a real pty (its `tty` is a real device,
 * `send-keys` delivers input, `capture-pane` returns the rendered screen)
 * obtained WITHOUT a native node module: no `node-pty`, no `electron-rebuild`,
 * no per-platform prebuilds. And because a tmux session is detachable by
 * design, `ssh host tmux attach` is remote control for free.
 *
 * WHAT THIS CANNOT DO, AND IT IS THE THING MOST LIKELY TO BE MISREAD LATER:
 * vam CANNOT adopt the operator's existing sessions. Those are children of a
 * plain login shell, and no process can take over another process's
 * controlling TTY. This provider is only ever for sessions VAM ITSELF STARTS.
 * There is no flag, no permission and no tmux verb that changes that.
 *
 * As in `deliver.ts`: `execFile` with an argv ARRAY and no shell, so a session
 * name or a path the operator typed has no meaning beyond being a name or a
 * path. Nothing here needs quoting, and nothing here may ever be assembled
 * into a string.
 *
 * THAT IS NOT THE WHOLE STORY FOR A COMMAND, and the difference is the one
 * thing in this file worth reading twice. `execFile` running no shell on VAM'S
 * side does not mean no shell runs: tmux takes a `shell-command` given as ONE
 * argument and hands it to `sh -c`, and only a `shell-command` given as
 * MULTIPLE arguments is executed directly. So passing a command through as a
 * single array element -- which looks like the safe thing, and reads like it --
 * is precisely what would let `claude; anything` run both halves. The command
 * is therefore an argv array here too, spread into tmux's own argv, and each
 * element reaches the exec'd program as one word whatever it contains.
 */

import type { ControlLetter } from '../../../shared/terminal.js';

/**
 * The prefix that makes a session vam's own, AT A GLANCE.
 *
 * vam shares one tmux server with whatever the operator is running, and it
 * must never present their unrelated work as its own, nor kill it. The prefix
 * is what makes that visible to a person running `tmux ls`, and it is the
 * cheap first filter on the listing.
 *
 * It is NOT the pairing, and the note that stood here claiming session options
 * would not survive was wrong -- measured against a real tmux on a private
 * `-L` socket, a user option set on a session is reported by `list-sessions
 * -F` and survives `rename-session`. See `VAM_PROJECT_OPTION`.
 */
export const VAM_SESSION_PREFIX = 'vam-';

/**
 * WHERE THE PAIRING LIVES, and it is the one decision in this file worth
 * reading twice.
 *
 * A tmux session vam started carries the id of the project it was started for,
 * as a tmux USER OPTION set on the session at creation. The tab reads it back
 * and matches on it, exactly. Nothing is re-derived from a name.
 *
 * The scheme it replaced derived the name again from a label and matched by
 * prefix, and it was lossy in both directions. The creator was handed a
 * project NAME while the tab asked with a session TITLE -- different strings,
 * so nothing ever matched and every session was drawn as one vam had not
 * started. And the slug is truncated to 24 characters, so
 * `atlas frontend rewrite phase two` and `atlas frontend rewrite plan` share a
 * prefix: two sessions, one pane, silently.
 *
 * MEASURED, on tmux 3.7b over a private `-L` socket, because none of it may be
 * assumed: a user option round-trips through `list-sessions -F`, an option
 * nobody set formats as the EMPTY STRING rather than an error, and the value
 * survives a `rename-session`.
 *
 * VOCABULARY, and it is the reason this key is frozen by literal value in
 * `test/sources/tmux-argv.test.ts`. "project" here is the CODE's project --
 * one working directory, `projectIdOf(cwd)` -- which the UI now labels
 * "repo", because the UI's word "project" was given to the grouping layer
 * above it (see the vocabulary table in `renderer/domain/model.ts`). The
 * strings on screen moved; this identifier did not, and must not. Nothing
 * re-tags a live session, so renaming this key or repointing its value orphans
 * every session the operator has running: an option nobody set formats as the
 * empty string, `paneForRow` reads the disagreement as a corrupt pairing, and
 * Close and Enter both refuse on a session vam itself started.
 */
export const VAM_PROJECT_OPTION = '@vam-project';

/**
 * THE SECOND PAIRING, AND WHAT IT ANSWERS THAT THE FIRST CANNOT.
 *
 * `VAM_PROJECT_OPTION` names which PROJECT a tmux session belongs to; it
 * cannot name which ROW, because two sessions vam started for one project
 * read back identically -- `paneForRow` (`reply.ts`) then has nothing but a
 * COUNT to go on: exactly one live row in the project, exactly one tagged
 * session. Two live sessions in one cwd, neither of which has published a
 * `tmux` field in `~/.claude/sessions/<pid>.json` yet, fail both counts and
 * `paneForRow` answers `null` for both -- correctly, since nothing in the
 * project scheme says which row is in which pane.
 *
 * This option answers the sharper question directly, WITHOUT a count. At
 * creation, `createVamSession` (`tmux/spawn.ts`) asks tmux -- in the SAME
 * `new-session` call, via `-P -F '#{pane_pid}'` -- for the pid of the process
 * it just exec'd into the pane, and records it here. `LiveAgent.pid`
 * (`agents.ts`) is the SAME OS pid `claude agents --json` reports for that
 * exact row, so a tagged session whose recorded pid equals a row's pid is
 * that row's pane, full stop, however many other rows or tagged sessions
 * share the project -- a pid names at most one LIVE process at any moment,
 * which is exactly the sharpness `agents.ts:20-33` demands of anything that
 * stands in for a row's `key`.
 *
 * WHY THE TMUX SESSION'S LIFETIME MAKES THIS SAFE FOREVER, not merely at the
 * moment it is written. `newSessionArgv` spreads the command across tmux's own
 * argv rather than running it through a shell (see the module note), so the
 * pane holds exactly one process for its whole life: when that process exits,
 * tmux tears the pane down and, with no other window or pane left, the
 * session with it (`remain-on-exit` is off, tmux's default). MEASURED, on
 * tmux 3.7b over a private `-L` socket: a session created to run a
 * short-lived command answered `no server running` the instant that command
 * exited. So a LIVE tmux session's `@vam-pid` can never outlive the one
 * process it was recorded for, and a pid the OS later recycles onto an
 * unrelated process cannot forge a match here -- the tmux session that would
 * have to carry the stale tag is already gone.
 *
 * A session vam did not start can never carry this option at all: every name
 * this file's callers see has already passed `isVamSession`'s prefix filter
 * (`listVamSessions`, `spawn.ts`), so the operator's own sessions -- including
 * one they happen to have running `claude` in, in their own tmux, under a name
 * that is not `vam-*` -- are never in `sessions` for this to match against.
 *
 * A BONUS PROOF, NOT THE PRIMARY ONE. A session the project tag already
 * records is still findable, repliable and closeable by the older, per-project
 * fallback with or without this: `createVamSession` degrades silently, not
 * with a refusal, when the pid cannot be read or recorded (`spawn.ts`) --
 * exactly how an older Claude Code that never publishes a `tmux` field is
 * already treated, not an exception to it.
 */
export const VAM_PID_OPTION = '@vam-pid';

/** Characters tmux itself dislikes in a session name (`.` and `:` are targets). */
const UNSAFE_NAME = /[^A-Za-z0-9_-]+/g;

/**
 * A session name derived from a label, always under vam's prefix.
 *
 * The random tail is not decoration: creating a second session for the same
 * project must not collide with the first, and tmux rejects a duplicate name.
 */
export function vamSessionName(label: string, suffix = randomSuffix()): string {
  const slug = label
    .replace(UNSAFE_NAME, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `${VAM_SESSION_PREFIX}${slug === '' ? 'session' : slug}-${suffix}`;
}

const randomSuffix = (): string => Math.random().toString(36).slice(2, 8);

/** Whether a tmux session name is one of vam's. */
export const isVamSession = (name: string): boolean => name.startsWith(VAM_SESSION_PREFIX);

/**
 * Exact targeting. tmux resolves a bare `-t name` by prefix and then by
 * fnmatch, so `-t vam-a1` can reach `vam-a1b2c3`; the leading `=` demands an
 * exact match. On anything that acts ON a session -- `send-keys` above all --
 * that difference is the difference between reaching the session vam meant
 * and reaching someone else's.
 */
const target = (name: string): string => `=${name}`;

/**
 * The same exactness, for the verbs that want a TARGET-PANE rather than a
 * target-session -- `capture-pane` and `send-keys`.
 *
 * The trailing `:` is not decoration. A target-pane is `session:window.pane`,
 * and without the colon tmux does not read the string as naming a session at
 * all: measured against a real tmux, `capture-pane -t '=vam-x'` answers
 * `can't find pane: =vam-x` and exits 1, which the failure classifier then
 * reports as a session that no longer exists. Both halves of the string
 * matter, and for opposite reasons -- the `=` keeps tmux from resolving the
 * name by prefix and fnmatch onto a session vam did not mean, and the `:`
 * keeps tmux reading the name as a session. Omitting the window and pane
 * leaves tmux to use the session's current ones, which for a vam session is
 * the only pane it has.
 */
const paneTarget = (name: string): string => `=${name}:`;

/**
 * Create a DETACHED session: vam is not a terminal and has nothing to attach
 * to. The command is SPREAD across the trailing elements, so tmux execs it
 * directly instead of running it through `sh -c` (see the module note).
 *
 * The two refusals are the price of that shape. An empty command would leave
 * tmux to start the operator's login shell, which is not what any caller here
 * means. And a first word beginning with `-` would be read by tmux as one of
 * `new-session`'s own options: there is no `--` terminator in this argv,
 * because whether tmux consumes one before a `shell-command` is not something
 * vam can verify without creating a real session on the operator's server, and
 * a guess there would break every session vam starts.
 *
 * `-P -F PANE_PID_FORMAT` COSTS NOTHING EXTRA, and answers a question
 * `createVamSession` would otherwise have no cheap way to ask: the pid of the
 * process tmux just exec'd into the pane, printed on the SAME call that
 * creates it. See `VAM_PID_OPTION` for why that pid is what closes the
 * "two live sessions, one project" defect, and `PANE_PID_FORMAT` for the
 * measurement behind it.
 */
export function newSessionArgv(input: {
  name: string;
  cwd: string;
  command: readonly string[];
}): readonly string[] {
  const [program] = input.command;
  if (program === undefined) {
    return failCommand('the command is empty, and tmux would start a login shell instead');
  }
  if (program.startsWith('-')) {
    return failCommand(`tmux would read \`${program}\` as an option, not as the program to run`);
  }
  return [
    'new-session',
    '-d',
    '-P',
    '-F',
    PANE_PID_FORMAT,
    '-s',
    input.name,
    '-c',
    input.cwd,
    ...input.command,
  ];
}

/**
 * What `-P -F` prints about the pane `new-session` just created: the pid of
 * the process tmux exec'd into it.
 *
 * WHY AT CREATION, AND NOT LOOKED UP LATER. `create-session.ts`'s own header
 * says vam does not know the Claude session id at this point -- `claude`
 * mints it after it starts, well after this call returns. This format needs
 * none of that: tmux knows the pid of the child it just forked before that
 * child has done anything at all, so there is no window to wait out and
 * nothing to guess in the meantime.
 *
 * MEASURED, on tmux 3.7b over a private `-L` socket: `new-session -d -P -F
 * '#{pane_pid}' -s name -c dir sleep 100` printed exactly the pid `ps`
 * reported for the `sleep` process the trailing argv spread into the pane --
 * the SAME identity `agents.ts` names `pid` on a `LiveAgent`, since both name
 * the OS process the command line handed to `exec`, and this file's own
 * `newSessionArgv` note already establishes that the command reaches tmux
 * unwrapped, spread across argv rather than run through a shell, so there is
 * no intervening shell pid to be confused with. The same socket confirmed the
 * OTHER half of the safety argument: once that process exited, the whole
 * session -- and with it, any `@vam-pid` recorded on it -- was gone; `list-
 * sessions` answered "no server running" (see `VAM_PID_OPTION`).
 */
const PANE_PID_FORMAT = '#{pane_pid}';

const failCommand = (why: string): never => {
  throw new Error(`vam will not build a tmux new-session argv: ${why}`);
};

/** Does this session exist? Exit status is the whole answer. */
export function hasSessionArgv(name: string): readonly string[] {
  return ['has-session', '-t', target(name)];
}

/**
 * The word that marks tmux's answer about the cursor, so that the answer is
 * RECOGNISED rather than assumed.
 *
 * `readPane` strips this line off the front of stdout, and a strip made on
 * POSITION alone would eat the first line of somebody's screen the moment the
 * cursor query did not run -- an old tmux with no `cursor_flag`, a runner
 * stubbed by a test that predates this, a sequence that ran only half. With
 * the marker, "there is no cursor line" is a state this file can spell and the
 * screen survives whole (`spawn.ts`, `readCursorLine`).
 *
 * `@vam-` for the reason `VAM_PROJECT_OPTION` uses it: it is vam's namespace
 * on this server, and it is legible to a person running the command by hand.
 */
export const VAM_CURSOR_MARK = '@vam-cursor';

/**
 * WHAT VAM ASKS ABOUT THE CURSOR, and the four fields are the whole of it.
 *
 * `cursor_flag` first because it can veto the other two: it is 0 when a
 * program in the pane turned the cursor off (DECTCEM), and a caret drawn over
 * a pager or a spinner is vam inventing one the application deliberately
 * removed. `cursor_x` and `cursor_y` are CELLS from the left and lines from
 * the top of the pane.
 *
 * `cursor_character` is deliberately NOT asked for. The captured screen
 * already carries that cell, so it would be a second copy of one character of
 * a stranger's session for no gain -- and the fewer bytes of somebody's
 * terminal that cross this boundary for decoration, the better.
 *
 * `history_size` IS THE FOURTH, AND IT IS NOT ABOUT THE CURSOR -- it is what
 * makes `cursor_y` usable once the capture below carries scrollback. That row
 * counts from the top of the SCREEN, and a capture that begins `n` lines above
 * the screen makes it `n` rows out; `spawn.ts` adds the offset back. It rides
 * this line rather than taking a command of its own because a second
 * `display-message` would be a second answer to reconcile with the first, and
 * this one is already read, already marked, and already free.
 *
 * `mouse_any_flag` IS THE FIFTH, and it is not about the cursor either: it
 * is 1 while the program in the pane has asked the terminal for mouse
 * reports, and it decides where a wheel over the Terminal tab goes
 * (`shared/terminal.ts`, `PaneView.mouse`; `sendWheelArgv` below). Claude
 * Code's fullscreen renderer sets it, draws in the alternate screen, and
 * scrolls its own viewport on the reports -- a screen tmux keeps no history
 * for, so the tab's own scrollback is empty and the wheel has to reach the
 * program or reach nothing. Measured on tmux 3.7b, a vam-shaped session
 * (straight into `claude`, `"tui": "fullscreen"`): `alternate_on=1
 * history_size=0 mouse_any_flag=1`, steady from three seconds on.
 *
 * MEASURED on tmux 3.7b: all five keys exist and expand, and a key tmux does
 * not know expands to the EMPTY STRING rather than failing -- which is what
 * makes an older tmux read as `unreadable` instead of as a crash.
 *
 * Exported for the test that pins the fifth field is asked for.
 */
export const CURSOR_FORMAT = `${VAM_CURSOR_MARK} #{cursor_flag} #{cursor_x} #{cursor_y} #{history_size} #{mouse_any_flag}`;

/**
 * HOW FAR BACK THE TERMINAL TAB CAN SCROLL: five hundred lines above the
 * screen, and the number is a budget rather than a preference.
 *
 * WHY THERE IS A NUMBER AT ALL. `capture-pane` with no `-S` returns the
 * visible screen and NOTHING else (measured, 3.7b: an 80x10 pane with 40
 * lines of output answers with 10 lines; `-S -200` answers with 85, which is
 * all the history there was -- tmux clamps, it does not pad). Since
 * `resizeWindowArgv` sizes the window to exactly the rows the pane can show,
 * "the screen" and "the box" were the same height and the tab had nothing to
 * scroll. That was the operator's report, and `-S` is the whole of the fix.
 *
 * WHY NOT ALL OF IT. tmux's own default `history-limit` is 2000 (measured on
 * the same socket), and the cost of asking is paid on every read that ASKS --
 * the tab polls four times a second (`panels/TerminalTab.tsx`, `REFRESH_MS`).
 * The reads in between, up to thirty a second while the operator is typing,
 * ask for `history = 0` whenever the view is at the live end, which is what
 * makes that rate affordable at all: nothing above the screen is on screen,
 * so nothing above the screen is fetched (`shared/terminal.ts`,
 * `PaneReadMode`). Both halves were measured on a
 * 137x41 pane of densely coloured output, through the real bundle in
 * Chromium:
 *
 *            bytes per read     renderer cost per changed read
 *   screen         6,349                 0.9 ms
 *   -S -200       37,549                 2.7 ms
 *   -S -500       84,349                 5.7 ms
 *   -S -1000     162,349                11.3 ms
 *   -S -2000     297,985                21.9 ms
 *
 * At 2000 a single update outruns a 60Hz frame, so typing into a pane would
 * stutter on its own scrollback; at 500 the whole update fits inside one
 * frame with room to spare, and twelve screenfuls is a long way back through
 * an agent's work. The idle cost of even that is zero rather than 5.7ms a
 * second, because the tab drops a capture identical to the one it is already
 * showing before React sees it (`TerminalTab.tsx`, `sameScreen`).
 *
 * THE OTHER CEILING, named so it is not discovered: `createTmuxRunner` gives
 * execFile a 4MB buffer. Five hundred lines of vam's widest legal pane (500
 * columns) are well under it for any screen a program actually draws, and a
 * read that did exceed it would arrive as a classified failure rather than as
 * a truncated screen.
 */
export const PANE_HISTORY_LINES = 500;

/**
 * The RENDERED screen as plain text -- what the pane looks like right now --
 * AND where the cursor is on it, in ONE tmux invocation.
 *
 * `-p` prints to stdout. `-e` asks tmux to keep the SGR sequences, which it
 * did not used to: the operator's report was "tmux chua co color", and a
 * transcript where the error line is the same grey as everything else is a
 * transcript you have to read instead of scan.
 *
 * THE FLAG IS SAFE ONLY BECAUSE SOMETHING PARSES IT. The note that stood here
 * was right for its time -- raw sequences shown as text are garbage -- so `-e`
 * arrives together with `panels/terminal-ansi.ts`, which turns them into
 * styled spans and drops everything it does not model, including a sequence
 * the capture boundary cut in half. What is still NOT built is the live
 * streaming path (`pipe-pane -o`): that needs a real emulator, and half of one
 * is worse than none. Asking where the cursor is does not change that: the tab
 * draws a SNAPSHOT with the cursor marked on it, not a terminal.
 *
 * TWO COMMANDS, ONE PROCESS, and that is why the cursor costs the Terminal tab
 * nothing. A bare `;` element is tmux's command separator in an argv array
 * exactly as it is in a shell string -- MEASURED through `execFile` with an
 * array and no shell, on tmux 3.7b: both answers arrive in order on one
 * stdout. The tab already spawns one short-lived tmux per second; a second
 * spawn for a caret would have doubled that for the life of every open tab.
 *
 * THE ORDER IS LOAD-BEARING. The cursor query is FIRST because its answer is
 * exactly one line while the screen's length is not known in advance, so the
 * front is the only place a reader can find the short answer. `-t` on BOTH:
 * measured, a `display-message` with no target answers about whatever pane
 * tmux calls current, which is somebody else's session as easily as this one.
 *
 * The separator cannot be confused with an argument. Every name reaching here
 * came off `list-sessions` filtered by `isVamSession` and was minted by
 * `vamSessionName`, which admits only `[A-Za-z0-9_-]`, so no argument in this
 * argv can end in a `;` for tmux to read as a second separator.
 *
 * WHAT A HALF-FAILURE DOES, measured rather than assumed: with a bad target on
 * the `display-message` and a good one on the `capture-pane`, tmux exits ZERO
 * with an empty cursor line and the whole screen behind it -- so a cursor vam
 * cannot read never costs the operator the screen. The other way round, tmux
 * exits 1 and the existing classifier reports it exactly as it did before this
 * line existed.
 *
 * `history` IS OPT-IN, AND THE DEFAULT IS THE OLD SHAPE ON PURPOSE. Only the
 * Terminal tab wants the scrollback (`terminal/pane.ts`). `terminal/answer.ts`
 * reads this same pane to find the picker a session is waiting on, and it
 * identifies one by there being EXACTLY ONE `❯` on the screen -- hand it five
 * hundred lines of history and every picker the session has ever drawn is in
 * the text, so `readPicker` finds several cursors, refuses, and vam stops
 * being able to answer a question at all. A default of "the screen" is what
 * keeps that from being a thing a later caller can walk into.
 */
export function capturePaneArgv(name: string, history = 0): readonly string[] {
  return [
    'display-message',
    '-p',
    '-t',
    paneTarget(name),
    '-F',
    CURSOR_FORMAT,
    ';',
    'capture-pane',
    '-p',
    '-e',
    // `-S -n` is n lines ABOVE the top of the screen; the end stays the
    // screen's bottom, so this is history AND screen in one answer, with no
    // seam between two captures for a line to be lost in or counted twice.
    ...(history > 0 ? ['-S', `-${Math.floor(history)}`] : []),
    '-t',
    paneTarget(name),
  ];
}

/**
 * Set the size of the session's window, in cells.
 *
 * WHY THIS EXISTS AT ALL. `capture-pane` returns the screen tmux has ALREADY
 * composed, at the size the session was created with -- 80x24 for a detached
 * session nobody sized. Every line longer than that was wrapped by tmux before
 * vam saw it, so no styling of the wrapper can make the screen fit it. Telling
 * tmux the size is the only thing that does.
 *
 * A TARGET-WINDOW, so the string is the `capture-pane` form and not the
 * `kill-session` one: `=name:` names the session exactly (the `=` stops tmux
 * resolving `vam-a1` onto `vam-a1b2c3` by prefix and then by fnmatch) and the
 * colon is what keeps tmux reading the name as a session rather than as a
 * window of the current one. Omitting the window index leaves tmux with the
 * session's current window, which for a vam session is the only one it has.
 *
 * The numbers are formatted here and bounded by the caller
 * (`shared/terminal.ts`): they originate in the renderer, and a resize is the
 * first thing vam does that CHANGES a session on the operator's server.
 *
 * MEASURED, on a real tmux over a private `-L` socket, because none of it may
 * be assumed: a detached session nobody sized reports `80x24` -- which is the
 * premise of this whole file, since that is the width every captured line was
 * already wrapped at -- and `resize-window -t '=name:' -x 137 -y 41` exits 0
 * and moves the window to exactly that, with no client attached.
 */
export function resizeWindowArgv(name: string, columns: number, rows: number): readonly string[] {
  return ['resize-window', '-t', paneTarget(name), '-x', String(columns), '-y', String(rows)];
}

/**
 * Type the operator's text into the pane, LITERALLY.
 *
 * `-l` is the whole of this function's correctness and it is not obvious.
 * Without it tmux looks each argument up as a KEY NAME first, so a reply that
 * happens to read `Escape` or `C-c` is not typed at all -- it is pressed.
 * Measured on tmux 3.7b over a private `-L` socket: `send-keys 'Escape'`
 * delivered `^[` to the pane, while `send-keys -l -- 'Escape'` delivered the
 * six characters. The same probe confirmed `--` is honoured here, so text
 * beginning with `-` reaches the pane instead of being read as an option.
 *
 * ONE LINE ONLY, AND THAT IS WHY THIS IS NOT THE PROMPT BUILDER. A raw newline
 * in `text` reaches the pane as a single 0x0a byte (measured: `send-keys -l --
 * $'a<LF>b'` delivered `0x61 0x0a 0x62`), and Claude Code's REPL -- reading a
 * raw-mode pty -- treats that byte as a submit, so a multi-line prompt sent
 * through here alone would submit its first line and drop the rest. A whole
 * prompt goes through `promptKeystrokes`, which breaks each newline the way the
 * REPL actually accepts one. This stays the single-line primitive it always
 * was, and the callers that press one key at a time (answering a picker) still
 * want exactly it.
 */
export function sendTextArgv(name: string, text: string): readonly string[] {
  return ['send-keys', '-t', paneTarget(name), '-l', '--', text];
}

/**
 * Press Return -- a SEPARATE call, because it is the one key that must be
 * interpreted rather than typed, and `-l` above forbids exactly that.
 *
 * MEASURED, on tmux 3.7b over a private `-L` socket into a RAW-MODE pty (the
 * mode Claude Code's input runs in): this delivered 0x0d (CR), which the REPL
 * reads as submit. That is the byte a bare newline is NOT (a bare newline is
 * 0x0a), and the whole reason `promptKeystrokes` exists to keep the two apart.
 */
export function sendEnterArgv(name: string): readonly string[] {
  return ['send-keys', '-t', paneTarget(name), 'Enter'];
}

/**
 * Shift+Enter in the Terminal tab: a newline INSIDE THE PANE'S OWN PROGRAM,
 * never a submit. `sendTextArgv`'s builder, not a new primitive -- a single
 * `\n` typed `-l` is exactly what this needs to be, and giving it a name of
 * its own is the whole of the change (`shared/terminal.ts`'s `PaneKey.enter`
 * carries `shift` for the reason this function exists).
 *
 * THE OPERATOR'S REPORT: Shift+Enter did nothing distinguishable from a bare
 * Enter, because `TerminalTab.tsx` dropped Shift on the floor before this
 * file ever saw a keystroke -- a real terminal only manages the trick with a
 * protocol tmux was never asked to negotiate (Kitty's CSI-u, or a
 * `/terminal-setup` iTerm2/VS Code profile), neither of which vam's pane had.
 *
 * MEASURED on a private `-L` socket, tmux 3.7b, both REPLs started the way
 * vam starts one (`createVamSession`, straight into the CLI, no shell in
 * front of it): a single literal LF byte (`send-keys -l -- '\n'`, delivered
 * as one 0x0a to the pty) landed as an inserted line and submitted nothing,
 * in BOTH Claude Code 2.1.278 and Codex 0.153.2. Two escape-sequence forms
 * did the same in both -- Kitty's `CSI 13;2u` and the Option/Alt-Enter
 * spelling `ESC` then CR -- so LF was not the only candidate that worked; it
 * was chosen because
 * it needs no escape parser on either end and no tmux `extended-keys`
 * negotiation (`show -g extended-keys`, off by default and irrelevant here
 * regardless -- this sends a raw byte via `-l`, never a tmux KEY NAME, so
 * tmux's own translation of `S-Enter` is never asked to run). A fourth form,
 * xterm's `modifyOtherKeys` (`CSI 27;2;13~`), was tried and DROPPED: Codex
 * read it as nothing at all rather than a newline, so it is not the answer
 * that holds for both agents vam ships a Terminal tab for.
 *
 * THE OTHER DIRECTION WAS CHECKED TOO, because this repo already trusted an
 * adjacent claim that turned out stale: `promptKeystrokes`'s own note above
 * says CR and a bare LF both submit, measured against an EARLIER Claude Code.
 * Re-measured here against 2.1.278, a bare LF no longer does -- which reads
 * as the REPL having grown an explicit newline binding on the byte every
 * keyboard sends for Ctrl+J, since Ctrl+J is reachable from every terminal
 * where Shift+Enter and Option+Enter are not. That drift is `reply.ts`'s
 * business, not this function's: `promptKeystrokes` answers a different
 * question (a WHOLE multi-line prompt, typed and self-escaping) and touching
 * it is out of scope for a Terminal-tab keystroke fix.
 *
 * NOT `sendTextArgv(name, '\n')` inline at the call site, and NOT reused for
 * `promptKeystrokes`'s internal newlines either -- a named builder is what
 * lets `sendToPane`'s switch (`main/terminal/pane.ts`) read as a table of
 * keys rather than a table of keys plus one special case, matching
 * `sendEnterArgv`, `sendEscapeArgv` and the rest.
 */
export function sendNewlineArgv(name: string): readonly string[] {
  return sendTextArgv(name, '\n');
}

/**
 * Type a WHOLE prompt into the pane, with its internal newlines intact -- the
 * ordered keystrokes to enter the text, but NOT the submit that follows it.
 *
 * THE NEWLINE IS THE ONLY HARD PART, and it is a fact about Claude Code's REPL
 * rather than about tmux. Measured on tmux 3.7b over a private `-L` socket into
 * a raw-mode pty: `send-keys Enter` delivers 0x0d (CR), a raw newline in a
 * literal payload delivers 0x0a (LF), and a lone backslash delivers 0x5c. The
 * REPL reads a raw pty, so both CR and a bare LF submit; there is no byte that,
 * sent on its own, inserts a newline without submitting. What the REPL DOES
 * accept -- and advertises in its own footer (`\` + Return, the universal
 * newline that needs no `/terminal-setup`, unlike Shift+Enter or Option+Enter)
 * -- is a trailing backslash followed by Return: it consumes the `\` and
 * inserts a newline instead of submitting. So each internal line break becomes
 * a literal backslash appended to the line, then an interpreted Enter.
 *
 * THIS IS INFERENCE FROM THE FOOTER AND THE BYTES, NOT A MEASUREMENT OF THE
 * REPL, and it is flagged for the reason the control-chord table is: measuring
 * what the REPL does with a keystroke means typing into a running Claude Code,
 * which no test here may do (`deliver`'s retirement note, and reply.ts). The
 * footer string and the byte deliveries are the evidence; that the REPL builds
 * a two-line buffer from `line\` + Enter + `next` is what follows from them.
 *
 * THE ONE INPUT THIS CANNOT ROUND-TRIP is a line whose own text ends in a
 * backslash: vam's escape is itself a trailing backslash, so the operator's
 * `\` and vam's `\` arrive as a pair, which the REPL may read as one escaped
 * backslash and a submit rather than a newline. Bracketed paste would frame
 * the whole prompt and avoid this, but it was rejected upstream for a reason
 * that still holds (`renderer/domain/optimistic.ts`): a pasted burst is echoed
 * back by a booting TUI differently than typed keys, which broke the optimistic
 * paint's exact-match reconciliation. A rare mangled line beats that.
 *
 * The submit is deliberately NOT here. The caller presses Return once, after
 * the whole prompt has landed, so that a keystroke that fails midway leaves the
 * text sitting in the pane UNSENT rather than half-submitted (`reply.ts`).
 */
export function promptKeystrokes(name: string, prompt: string): readonly (readonly string[])[] {
  const lines = prompt.split('\n');
  const steps: (readonly string[])[] = [];
  lines.forEach((line, index) => {
    const last = index === lines.length - 1;
    // Every line but the last carries the escape backslash the REPL turns,
    // together with the Enter that follows, into an inserted newline.
    steps.push(sendTextArgv(name, last ? line : `${line}\\`));
    if (!last) steps.push(sendEnterArgv(name));
  });
  return steps;
}

/**
 * Press Backspace -- the SECOND key that is pressed rather than typed, and it
 * is a builder of its own rather than an argument to one.
 *
 * WHY NOT A GENERAL `sendKeyArgv(name, keyName)`. Because the whole safety
 * property of this file is that literal text and interpreted key names can
 * never meet on one code path: a builder taking a key NAME would take the
 * operator's text just as happily, and the day something passed a reply
 * through it, a message reading `C-c` would interrupt the agent instead of
 * being typed to it. One named builder per key that vam actually presses
 * keeps that impossible, and there are now exactly five of them.
 *
 * MEASURED, on tmux 3.7b over a private `-L` socket, because the choice
 * between the key name and a literal `0x7f` may not be guessed: typing `abX`,
 * then `send-keys 'BSpace'`, then `c` left the pane reading `abc`, and the
 * same sequence with `send-keys -l -- 'BSpace'` left it reading `abBSpace`.
 * The literal DEL byte happened to work too, through the shell's own line
 * discipline -- which is exactly why it is not used: it relies on whatever is
 * reading the line, where the key name goes through tmux's own key
 * translation and is what a real keypress produces for any program in the
 * pane, TUI or shell.
 *
 * WHY IT EXISTS AT ALL: a terminal that can be typed into but not corrected
 * strands the operator on their first typo, with a wrong line and no way to
 * fix it from vam.
 */
export function sendBackspaceArgv(name: string): readonly string[] {
  return ['send-keys', '-t', paneTarget(name), 'BSpace'];
}

/**
 * Move the picker's cursor down one row -- the THIRD named key, and the one
 * that makes answering a question possible at all.
 *
 * It is a cursor move and nothing else, which is why it is safe to press
 * before anything has been verified: it commits nothing. The caller
 * (`main/terminal/answer.ts`) re-reads the screen after every one of these
 * and asserts the cursor went where it was sent, because a burst of arrows
 * pressed blind is indistinguishable, from vam's side, from a picker that
 * stopped listening.
 *
 * Down only, and no `sendUpArgv` beside it: a list wraps, so every row is
 * reachable by stepping down, and one direction is one thing to get wrong.
 */
export function sendDownArgv(name: string): readonly string[] {
  return ['send-keys', '-t', paneTarget(name), 'Down'];
}

/**
 * Move to the picker's next PANEL -- the fourth, and it exists for exactly one
 * step of the multi-select flow.
 *
 * A multi-select picker ticks its rows with Return and then needs Right to
 * reach the CLI's own review screen, which names the whole answer in prose
 * before anything is committed. That screen is a verification surface vam gets
 * for free, and this is the key that reaches it.
 */
export function sendRightArgv(name: string): readonly string[] {
  return ['send-keys', '-t', paneTarget(name), 'Right'];
}

/**
 * Press Shift-Tab -- the FIFTH named key, and the one that cycles a session's
 * mode. Claude Code's footer reads `auto mode on (shift+tab to cycle)`: the
 * mode lives in the agent and the chord is its binding, so the honest control
 * is the key itself, pressed in the pane vam started.
 *
 * `BTab`, AND THE SPELLING IS THE WHOLE OF IT. Measured on tmux 3.7b over a
 * private `-L` socket against `cat -v` in the pane: `send-keys BTab` put
 * `^[[Z` on the screen -- the escape sequence Shift-Tab is -- while
 * `send-keys S-Tab` EXITED 0 and delivered a plain tab, and `send-keys -l --
 * 'BTab'` typed the four letters. `S-Tab` is the worst of the three: the
 * spelling a person reaches for, reporting success, and arriving as a
 * completion or an indent in a running agent.
 */
export function sendBackTabArgv(name: string): readonly string[] {
  return ['send-keys', '-t', paneTarget(name), 'BTab'];
}

/**
 * Press Escape -- the third key that is pressed rather than typed.
 *
 * IT IS LOAD-BEARING INSIDE THE PANE, which is why it is here at all. Escape
 * cancels Claude Code's own pickers, leaves insert mode in vim, and dismisses
 * half the TUIs an operator runs; a terminal that swallows it is not a
 * terminal. It was vam's way out of the surface until the operator said
 * plainly that it should do what it normally does, and they were right.
 *
 * The literal/interpreted split is the same one as everywhere in this file,
 * and this key is the reason the split was documented in the first place:
 * measured on tmux 3.7b over a private `-L` socket, `send-keys 'Escape'`
 * delivers `^[` to the pane while `send-keys -l -- 'Escape'` types the six
 * letters. Only the first of those is the key the operator pressed.
 */
export function sendEscapeArgv(name: string): readonly string[] {
  return ['send-keys', '-t', paneTarget(name), 'Escape'];
}

/**
 * The wheel, as the SGR mouse report the pane's program asked for.
 *
 * `ESC [ < button ; column ; row M` -- button 64 is a notch up and 65 a
 * notch down, the cell is 1-based -- is what any terminal in SGR mouse mode
 * (DECSET 1006, the mode tmux reports as `mouse_sgr_flag`) writes to the
 * program for one wheel notch, and it is typed LITERALLY with `-l` because
 * these bytes are for the program, not for tmux: tmux's own mouse path
 * (`send-keys -M`) only exists inside a mouse binding. MEASURED on tmux 3.7b
 * against Claude Code 2.1.278's fullscreen renderer: three reports of 64
 * moved its viewport three lines up, three of 65 moved it back.
 *
 * `ticks` reports in ONE argument, so a fling is one spawn and not forty;
 * `isPaneKey` bounds every number before it gets here (`MAX_WHEEL_TICKS`),
 * so nothing is clamped or repaired in the formatting.
 */
export function sendWheelArgv(
  name: string,
  wheel: { direction: 'up' | 'down'; ticks: number; column: number; row: number },
): readonly string[] {
  const button = wheel.direction === 'up' ? 64 : 65;
  const report = `\u001b[<${button};${wheel.column};${wheel.row}M`;
  return ['send-keys', '-t', paneTarget(name), '-l', '--', report.repeat(wheel.ticks)];
}

/**
 * THE TWENTY-SIX CONTROL CHORDS, one constant each, keyed by the letter.
 *
 * THIS TABLE IS THE ANSWER TO `sendBackspaceArgv`'S QUESTION RATHER THAN AN
 * EXCEPTION TO IT. That note forbids a general `sendKeyArgv(name, keyName)` on
 * the grounds that a builder taking a key NAME would take the operator's TEXT
 * just as happily, and the day something passed a reply through it, a message
 * reading `C-c` would interrupt the agent instead of being typed to it.
 * Nothing here takes a name. `sendControlArgv` takes a `ControlLetter`, which
 * is a twenty-six-member union at compile time and a frozen set at runtime
 * (`shared/terminal.ts`), and the name it sends is one of the constants below.
 * The property that note protects -- literal text and interpreted key names
 * never meeting on one code path -- is untouched: there is still no path by
 * which the operator's text becomes a key name.
 *
 * WRITTEN OUT RATHER THAN BUILT AS a `C-` template, and that IS the point: a
 * template is precisely a place where a value becomes a key name. Twenty-six
 * literals cannot be made to produce a twenty-seventh string.
 *
 * THE SPELLING IS TMUX'S OWN, READ OFF TMUX. `tmux list-keys` on 3.7b -- a
 * read-only query, run against the server this machine already had -- prints
 * twenty-one of these names verbatim in its default key tables (`C-a C-b C-c
 * C-d C-e C-f C-g C-h C-j C-k C-l C-n C-o C-p C-r C-s C-u C-v C-w C-y C-z`),
 * in the same key-name grammar `send-keys` parses. The five that do not appear
 * (`C-i`, `C-m`, `C-q`, `C-t`, `C-x`) are absent only because tmux binds
 * nothing to them by default, not because they are spelled differently.
 *
 * WHAT IS NOT MEASURED, said plainly because everything else in this file is.
 * `BSpace` and `BTab` each carry a measurement of what the PANE RECEIVED, made
 * against `cat -v` in a real session. No such measurement stands behind these:
 * taking one means creating a tmux session, and the change that added them was
 * made on a machine whose tmux server holds somebody's live agents. The
 * spelling and the parser are evidence; that `send-keys C-u` puts 0x15 into
 * the pane rather than something else is inference from them.
 */
const CONTROL_KEY_NAMES: Readonly<Record<ControlLetter, string>> = {
  a: 'C-a',
  b: 'C-b',
  c: 'C-c',
  d: 'C-d',
  e: 'C-e',
  f: 'C-f',
  g: 'C-g',
  h: 'C-h',
  i: 'C-i',
  j: 'C-j',
  k: 'C-k',
  l: 'C-l',
  m: 'C-m',
  n: 'C-n',
  o: 'C-o',
  p: 'C-p',
  q: 'C-q',
  r: 'C-r',
  s: 'C-s',
  t: 'C-t',
  u: 'C-u',
  v: 'C-v',
  w: 'C-w',
  x: 'C-x',
  y: 'C-y',
  z: 'C-z',
};

/**
 * Press one Ctrl chord -- the SIXTH interpreted key, and the first that is a
 * family rather than a single key.
 *
 * INTERPRETED, WHICH IS THE WHOLE OF IT, and it is the opposite case to
 * `sendTextArgv` above. `-l` is what makes tmux type an argument instead of
 * pressing it, so `send-keys -l -- 'C-u'` would put the three characters `C`,
 * `-` and `u` on the operator's line. A chord has to go through tmux's own key
 * translation, exactly as `Enter` and `BSpace` do -- which is why `control` is
 * a `PaneKey` kind and not a character inside a `text` one.
 *
 * `--` IS HERE WHERE THE OTHER FIVE INTERPRETED BUILDERS HAVE NONE, and the
 * difference is deliberate rather than drift. Those five pass a compile-time
 * constant with no data path into it at all; this one passes a constant
 * SELECTED BY a value that came off the bridge. The terminator makes "no
 * argument can be read as an option" a property of the argv's SHAPE instead of
 * a property of what happens to be in the table above -- and it costs nothing,
 * because the same probe that established `-l` also confirmed tmux honours
 * `--` on `send-keys` (see `sendTextArgv`).
 *
 * THE LOOKUP REFUSES RATHER THAN SPLICING. A letter with no constant is
 * unreachable twice over -- `isPaneKey` turns it away at the bridge and the
 * parameter's type turns it away at compile time -- but the alternative to a
 * refusal is an argv with a hole in it, which reaches `execFile` as the string
 * `undefined` and tmux as a key name it does not know. Throwing is what
 * `newSessionArgv` already does for an argv that must never be built.
 */
export function sendControlArgv(name: string, letter: ControlLetter): readonly string[] {
  const keyName = CONTROL_KEY_NAMES[letter];
  if (keyName === undefined) {
    // Its own sentence rather than `failCommand`'s, which names `new-session`
    // and would send the next reader to the wrong builder entirely.
    throw new Error(
      `vam will not build a tmux send-keys argv: \`${String(letter)}\` is not one of the twenty-six control chords`,
    );
  }
  return ['send-keys', '-t', paneTarget(name), '--', keyName];
}

/**
 * Every session on the server: the project vam recorded on it, a TAB, the pid
 * vam recorded on it, a second TAB, the session name, a third TAB, and the
 * name of the process in the FOREGROUND of the pane. The filtering to vam's
 * own happens after the read, in `spawn.ts`: tmux's `-f` filter language is
 * another string to get wrong, and the rows are already in hand.
 *
 * THE FOURTH FIELD IS WHAT A SHELL-FIRST PANE MADE NECESSARY. Since Stage 2
 * of `docs/design/vam-owns-the-session.md` a vam pane starts as a shell, and
 * an agent is in it only once one has been typed there -- so "is anything
 * running in this pane" became a question with two answers, and
 * `pane_current_command` is tmux's own: measured on 3.7b over a private
 * socket, `zsh` on a fresh pane and `sleep` two seconds after `sleep 30` was
 * typed into it. `paneForRow` (`claude-code/reply.ts`) reads it to refuse
 * handing a pane that holds only a shell to an agent that published nothing,
 * and `pane-row.ts` reads it to tell an empty pane from an occupied one. It
 * comes LAST so the three fields before it keep their positions for every
 * reader and every stub, and a line without it still parses.
 *
 * Tabs separate them because a session name cannot contain one -- tmux rejects
 * it (measured, 3.7b: `invalid session name`; a space or a `:` it accepts) --
 * a project id is a digest (`project-id.ts`), a pid is digits only
 * (`PANE_PID_FORMAT`), and a process name is a `comm`, which the kernel
 * bounds and never puts whitespace of that kind in; so no field can swallow
 * another. An unset option
 * arrives as an empty field, which is precisely the answer "vam did not
 * record this" -- "did not start this one" for the project field, "an older
 * vam, or the tag call itself failed" for the pid field (`createVamSession`
 * degrades silently rather than refusing when that happens; see
 * `VAM_PID_OPTION`).
 *
 * THE TABS ONLY SURVIVE A UTF-8 CLIENT. Measured on the same tmux: when the
 * client's LC_CTYPE is not a UTF-8 locale -- and a GUI launch sets none --
 * every control character in a `-F` expansion is printed as `_`, so this
 * listing comes back with no tab on any line. `env/utf8-ctype.ts` gives the
 * process a UTF-8 LC_CTYPE at startup so that never happens from vam; and
 * `listVamSessions` refuses a line without its two tabs rather than skipping
 * it, so if it ever does the answer is "could not ask", not "no sessions".
 * This is the ONE format here that leans on a control character, and the
 * argv test counts it.
 */
export function listSessionsArgv(): readonly string[] {
  return [
    'list-sessions',
    '-F',
    `#{${VAM_PROJECT_OPTION}}\t#{${VAM_PID_OPTION}}\t#{session_name}\t#{pane_current_command}`,
  ];
}

/**
 * Record which project a session belongs to, on the session itself.
 *
 * `-t` IS BARE HERE, and it is the one place in this file that does not get an
 * `=`. Measured against a real tmux: `set-option -t '=vam-x'` answers
 * `no such session: =vam-x` and exits 1, where every other verb accepts it.
 * The bare target is safe for exactly this call and no other -- tmux resolves
 * a bare `-t` by exact match FIRST, and this runs immediately after
 * `new-session` created that exact name, so there is nothing for a prefix or
 * an fnmatch to fall through to.
 */
export function tagSessionArgv(name: string, projectId: string): readonly string[] {
  return setOptionArgv(name, VAM_PROJECT_OPTION, projectId);
}

/**
 * Record which pid `new-session -P -F` printed for this session's pane, on
 * the session itself -- `tagSessionArgv`'s twin, and the same bare-target
 * argument applies: nothing vam runs between the two `set-option` calls this
 * file's callers make at creation could rename or replace the exact name they
 * both target, so there is still nothing for a prefix or an fnmatch to fall
 * through to by the time this one runs.
 */
export function tagPidArgv(name: string, pid: string): readonly string[] {
  return setOptionArgv(name, VAM_PID_OPTION, pid);
}

/** The one shape both tag calls share -- a bare-target `set-option`, see `tagSessionArgv`. */
function setOptionArgv(name: string, key: string, value: string): readonly string[] {
  return ['set-option', '-t', name, key, value];
}

/**
 * End a session vam started.
 *
 * THIS BUILDER WAS HERE BEFORE AND WAS DELETED, in PR 123's review fixes, as a
 * session-destroying argv with no caller on a branch whose scope excluded the
 * Terminal tab. That was right by the rule it applied, and it left an
 * asymmetry: the same branch shipped `o`, so vam started sessions it had no
 * way to end. It has a caller now (`claude-code/stop.ts`), and only ever for a
 * session vam can PROVE it started -- the `@vam-project` pairing above.
 *
 * TARGET SYNTAX, and it differs from the two verbs directly above it.
 * `kill-session` takes a target-SESSION, so it wants `=name` and NOT the
 * trailing `:` that `capture-pane` and `send-keys` need -- those take a
 * target-PANE, and the colon is what keeps tmux reading the name as a session
 * there. The `=` is non-negotiable in either form: a bare `-t vam-a1` is
 * resolved by prefix and then by fnmatch, and killing the wrong session is not
 * recoverable.
 */
export function killSessionArgv(name: string): readonly string[] {
  return ['kill-session', '-t', target(name)];
}
