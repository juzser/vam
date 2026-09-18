/**
 * The character locale a GUI-launched app never inherits.
 *
 * A macOS/Linux app opened from Finder, the Dock or Spotlight is started by
 * launchd, not a shell, so it has no `LANG` and no `LC_*` at all: every child
 * it spawns runs in the C locale. `pnpm run dev:app` never shows this, for the
 * reason `resolve-path.ts` gives for PATH -- a terminal sets `LANG` for the
 * shell it opens, and the app inherits it from there.
 *
 * WHAT IT COST. Measured on tmux 3.7b: a tmux CLIENT whose LC_CTYPE is not a
 * UTF-8 locale prints every control character of a `-F` expansion as `_`. The
 * two tabs `listSessionsArgv` separates its fields with came back as
 * underscores, `listVamSessions` found no tab on any line and answered "vam
 * started none of these", and from that one wrong answer the reply refused as
 * `no-terminal`, Close refused, and the Terminal tab drew nothing -- for
 * sessions vam had itself started a minute earlier, in a packaged build, on
 * every launch from the Dock. (Keystrokes and captures are unaffected: only
 * the format expansion is rewritten. `listVamSessions` now refuses a listing
 * whose separators did not survive, so the failure is at least honest if this
 * repair is ever bypassed.)
 *
 * THE REPAIR IS THE SMALLEST THAT WORKS: when nothing sets a locale, set
 * `LC_CTYPE` -- the one category tmux consults -- to a UTF-8 one. It is
 * applied to the process's own environment, like the PATH repair and for the
 * same reason: the tmux SERVER vam starts inherits the environment of the
 * client that starts it, and the `claude` in each pane inherits the server's,
 * so repairing only the client would leave the pane's agent in the C locale
 * a Terminal-launched one never has.
 *
 * AN OPERATOR'S OWN SETTING IS LEFT ALONE, EVEN A WRONG ONE. `LC_ALL=C` in the
 * environment vam was launched from is a choice, and a tool that silently
 * overrides it is a tool that cannot be configured. The listing's own refusal
 * names LC_CTYPE, so that case diagnoses itself.
 */

/**
 * `C.UTF-8` over `en_US.UTF-8`: it is what tmux itself falls back to first,
 * it is built into glibc and present on every current Linux, and macOS ships
 * it (measured: `locale -a` on macOS 26). Where it is somehow missing,
 * `setlocale` fails and the child stays in the C locale it was in anyway.
 */
export const UTF8_CTYPE = 'C.UTF-8';

const LOCALE_VARIABLES = ['LC_ALL', 'LC_CTYPE', 'LANG'] as const;

/** Whether the environment already says anything about its character locale. */
export function hasLocale(env: NodeJS.ProcessEnv): boolean {
  // An empty value is unset to `setlocale`, so it is unset here.
  return LOCALE_VARIABLES.some((name) => (env[name] ?? '') !== '');
}

/**
 * Give `env` a UTF-8 `LC_CTYPE` if it has no character locale at all. No-op on
 * Windows, where locale is not an environment variable.
 */
export function applyUtf8Ctype(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): void {
  if (platform === 'win32') return;
  if (hasLocale(env)) return;
  env.LC_CTYPE = UTF8_CTYPE;
}
