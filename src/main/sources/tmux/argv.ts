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
 * name, a path or a command the operator typed has no meaning beyond being a
 * name, a path or a command. Nothing here needs quoting, and nothing here may
 * ever be assembled into a string.
 */

/**
 * The prefix that makes a session vam's own.
 *
 * vam shares one tmux server with whatever the operator is running, and it
 * must never present their unrelated work as its own, nor kill it. A name
 * prefix is the only marker tmux carries that survives a detach, a restart of
 * vam, and a machine the operator later attaches to over ssh -- session
 * options would not, and a side-file would go stale the moment tmux was used
 * without vam.
 */
export const VAM_SESSION_PREFIX = 'vam-';

/** Characters tmux itself dislikes in a session name (`.` and `:` are targets). */
const UNSAFE_NAME = /[^A-Za-z0-9_-]+/g;

/**
 * A session name derived from a label, always under vam's prefix.
 *
 * The random tail is not decoration: creating a second session for the same
 * project must not collide with the first, and tmux rejects a duplicate name.
 */
export function vamSessionName(label: string, suffix = randomSuffix()): string {
  const slug = label.replace(UNSAFE_NAME, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return `${VAM_SESSION_PREFIX}${slug === '' ? 'session' : slug}-${suffix}`;
}

const randomSuffix = (): string => Math.random().toString(36).slice(2, 8);

/** Whether a tmux session name is one of vam's. */
export const isVamSession = (name: string): boolean => name.startsWith(VAM_SESSION_PREFIX);

/**
 * Exact targeting. tmux resolves a bare `-t name` by prefix and then by
 * fnmatch, so `-t vam-a1` can reach `vam-a1b2c3`; the leading `=` demands an
 * exact match. On a `kill-session` that difference is the difference between
 * closing one session and closing someone else's.
 */
const target = (name: string): string => `=${name}`;

/**
 * Create a DETACHED session: vam is not a terminal and has nothing to attach
 * to. The command is the last element -- one element, never interpolated.
 */
export function newSessionArgv(input: {
  name: string;
  cwd: string;
  command: string;
}): readonly string[] {
  return ['new-session', '-d', '-s', input.name, '-c', input.cwd, input.command];
}

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
  return ['capture-pane', '-p', '-t', target(name)];
}

/** Type text and press Return. The keys are one element. */
export function sendKeysArgv(name: string, keys: string): readonly string[] {
  return ['send-keys', '-t', target(name), keys, 'Enter'];
}

export function killSessionArgv(name: string): readonly string[] {
  return ['kill-session', '-t', target(name)];
}

/**
 * Every session on the server, one name per line. The filtering to vam's own
 * happens after the read, in `spawn.ts`: tmux's `-f` filter language is
 * another string to get wrong, and the names are already in hand.
 */
export function listSessionsArgv(): readonly string[] {
  return ['list-sessions', '-F', '#{session_name}'];
}
