/**
 * Resolves the PATH a GUI-launched app never inherits.
 *
 * A macOS/Linux app opened from Finder, the Dock or Spotlight is started by
 * launchd, not a shell, so it gets a minimal PATH (typically
 * `/usr/local/bin:/bin:/usr/bin:/usr/sbin:/sbin`), missing whatever a
 * developer's rc files add (nvm, Homebrew's `shellenv`, asdf, ...).
 * `pnpm run dev:app` never shows this: it inherits the terminal's PATH.
 *
 * The fix asks the process that reliably knows the real PATH: the operator's
 * own login shell, via `$SHELL -ilc 'echo $PATH'`.
 */

import { execFile } from 'node:child_process';

/**
 * How long the probe gets. A login shell's rc files can be slow or hang, and
 * this runs once at startup before the window shows -- it must not take the
 * app down with it. Matches this codebase's existing best-effort CLI probe
 * budget (`runTailscale` in `src/main/index.ts`).
 */
const PROBE_TIMEOUT_MS = 3_000;

/** Bounds the echoed PATH so rc-file noise on stdout (nvm banners, a motd) is never mistaken for it. */
const START_MARKER = '__VAM_PATH_START__';
const END_MARKER = '__VAM_PATH_END__';

/**
 * Directories that matter on a developer machine but are absent from a GUI
 * launch's minimal PATH, appended after the process's own and the shell
 * probe's. This is what keeps the fix working even when `$SHELL` is unset,
 * the probe times out, or it returns something unusable.
 */
export function fallbackDirs(home: string): readonly string[] {
  return [
    `${home}/.local/bin`, // Claude Code's own default install location.
    '/opt/homebrew/bin', // Homebrew on Apple Silicon.
    '/usr/local/bin', // Homebrew on Intel, and most manual installs.
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];
}

export function splitPath(value: string): string[] {
  return value.split(':').filter((entry) => entry !== '');
}

/** Preserves first-seen order, so an entry the process already had keeps its position. */
export function dedupe(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    if (!seen.has(entry)) {
      seen.add(entry);
      result.push(entry);
    }
  }
  return result;
}

/** Pulls PATH out of the probe's stdout. `null` (markers missing) is treated as a failed probe. */
export function parseProbeOutput(stdout: string): string | null {
  const start = stdout.indexOf(START_MARKER);
  const end = stdout.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) return null;
  const value = stdout.slice(start + START_MARKER.length, end);
  return value.length > 0 ? value : null;
}

/** Injectable seam: the one thing in this module that is not pure. */
export type ShellProbe = (shell: string) => Promise<string | null>;

/**
 * Runs `$SHELL -ilc 'echo ...'`, bounded to `PROBE_TIMEOUT_MS`.
 *
 * `-ilc` (interactive AND login), not `-lc`: the exports this probe exists to
 * see (nvm, Homebrew's `eval "$(brew shellenv)"`, asdf) commonly live in
 * `.zshrc`/`.bashrc`, only read on an INTERACTIVE shell (`-i`); `-l` alone
 * reads only `.zprofile`/`.bash_profile`. Some rc files also guard themselves
 * on `[[ $- == *i* ]]`, so a login-only shell can skip the exports entirely.
 *
 * Every failure -- no such shell, non-zero exit, timeout, unmarked output --
 * resolves to `null` rather than throwing.
 */
export const probeLoginShellPath: ShellProbe = (shell) =>
  new Promise((resolve) => {
    execFile(
      shell,
      // `${PATH}`, NOT `$PATH`: an unbraced `$PATH` directly followed by
      // `__VAM_PATH_END__` is parsed by a POSIX shell as ONE identifier (a
      // variable that does not exist, expanding to nothing) -- measured.
      // Braces bound the variable name explicitly.
      ['-ilc', `echo "${START_MARKER}\${PATH}${END_MARKER}"`],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        resolve(error ? null : parseProbeOutput(String(stdout)));
      },
    );
  });

export type ResolveInput = {
  /** `process.env.PATH` as this process already had it. Never dropped. */
  readonly currentPath: string | undefined;
  /** `process.env.SHELL`. Absent or empty skips the probe entirely. */
  readonly shell: string | undefined;
  readonly home: string;
  readonly probe: ShellProbe;
};

/**
 * The merged PATH this process should run every child under.
 *
 * NEVER SHRINKS what the process already had: `currentPath`'s entries come
 * first. The shell's own entries come next, and the fixed fallback list
 * last -- de-duplicated, so a repeated entry keeps only its earliest
 * position.
 */
export async function resolveLoginShellPath(input: ResolveInput): Promise<string> {
  const { currentPath, shell, home, probe } = input;
  const current = splitPath(currentPath ?? '');
  const probed = shell !== undefined && shell !== '' ? await probe(shell) : null;
  const additions = probed !== null ? splitPath(probed) : [];
  return dedupe([...current, ...additions, ...fallbackDirs(home)]).join(':');
}

/**
 * Applies the resolved PATH to `env`, once, at startup, before any child
 * process is spawned.
 *
 * WINDOWS IS LEFT ALONE: a GUI-launched Windows app inherits PATH from the
 * user/registry environment, not from a login shell's rc files -- there is
 * no analogous gap, and `-ilc` is a POSIX shell invocation.
 */
export async function applyLoginShellPath(
  env: NodeJS.ProcessEnv,
  options: { platform: NodeJS.Platform; home: string; probe: ShellProbe },
): Promise<void> {
  if (options.platform === 'win32') return;
  env.PATH = await resolveLoginShellPath({
    currentPath: env.PATH,
    shell: env.SHELL,
    home: options.home,
    probe: options.probe,
  });
}
