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
 */
export const VAM_PROJECT_OPTION = '@vam-project';

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
  return ['new-session', '-d', '-s', input.name, '-c', input.cwd, ...input.command];
}

const failCommand = (why: string): never => {
  throw new Error(`vam will not build a tmux new-session argv: ${why}`);
};

/** Does this session exist? Exit status is the whole answer. */
export function hasSessionArgv(name: string): readonly string[] {
  return ['has-session', '-t', target(name)];
}

/**
 * The RENDERED screen as plain text -- what the pane looks like right now.
 *
 * `-p` prints to stdout. Escape sequences are deliberately NOT requested
 * (`-e`): vam has no terminal renderer, so raw sequences would be shown as
 * garbage. The live streaming path (`pipe-pane -o`, which does carry the
 * escapes intact) is NOT built here -- it needs a renderer vam does not have,
 * and half of it would be worse than none.
 */
export function capturePaneArgv(name: string): readonly string[] {
  return ['capture-pane', '-p', '-t', paneTarget(name)];
}

/** Type text and press Return. The keys are one element. */
export function sendKeysArgv(name: string, keys: string): readonly string[] {
  return ['send-keys', '-t', paneTarget(name), keys, 'Enter'];
}

/**
 * Every session on the server: the project vam recorded on it, a TAB, and the
 * session name. The filtering to vam's own happens after the read, in
 * `spawn.ts`: tmux's `-f` filter language is another string to get wrong, and
 * the rows are already in hand.
 *
 * A tab separates them because a session name cannot contain one -- tmux
 * rejects it -- and a project id is a digest (`project-id.ts`), so neither
 * field can swallow the other. An unset option arrives as an empty first
 * field, which is precisely the answer "vam did not start this one".
 */
export function listSessionsArgv(): readonly string[] {
  return ['list-sessions', '-F', `#{${VAM_PROJECT_OPTION}}\t#{session_name}`];
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
  return ['set-option', '-t', name, VAM_PROJECT_OPTION, projectId];
}
