/**
 * The vocabulary Settings -> Integrations -> GitLab shares between main
 * (which runs `glab`) and the renderer (which draws the answer) --
 * renderer-safe: no `electron`, no `node:` import, `shared/github.ts`'s own
 * rule.
 *
 * NARROWER THAN `shared/github.ts` ON PURPOSE. The operator's own scope for
 * this card: status, Connect/Disconnect through a pane, and the CLI-missing
 * guide -- never merge requests, never a repo picker, never a scopes warning.
 * `glab` has no `--json` form for `auth status` (measured: `glab auth status
 * --help`, glab 1.119.0, lists no `--json` flag at all, unlike `gh`), so
 * there is no scopes line to parse in the first place -- `GitlabAccount`
 * carries only what every `glab auth status` line actually reports, a host
 * and a login.
 */

export type GitlabAccount = {
  readonly host: string;
  readonly login: string;
};

export type GitlabAuthStatus =
  | { readonly kind: 'cli-missing'; readonly message: string }
  | { readonly kind: 'logged-out' }
  | { readonly kind: 'logged-in'; readonly accounts: readonly GitlabAccount[] }
  /** `glab` ran and answered something this app has never seen -- reported
   *  rather than silently drawn as logged-out. */
  | { readonly kind: 'unknown'; readonly message: string };

/**
 * The exact, fixed commands Connect/Disconnect type into a pane --
 * `GITHUB_LOGIN_COMMAND`'s own reasoning, restated: shared so "Copy command"
 * offers the SAME string a pane would type, and both are constants with no
 * interpolation for an injection to reach.
 *
 * `--hostname gitlab.com`, matching `-h github.com` on the GitHub side --
 * pinned rather than left to `glab`'s own remote-detection, so the pane
 * always signs in against gitlab.com regardless of the project vam happens
 * to be showing when the operator presses Connect. `--web`: `glab auth
 * login --help`'s own words, "Skip the login type prompt and use web/OAuth
 * login" -- the same browser-driven flow `gh auth login --web` already
 * gives the GitHub card.
 */
export const GITLAB_LOGIN_COMMAND = 'glab auth login --hostname gitlab.com --web';
export const GITLAB_LOGOUT_COMMAND = 'glab auth logout --hostname gitlab.com';

export type GitlabAuthPaneKind = 'login' | 'logout';

export type GitlabAuthPaneView =
  | { readonly kind: 'none' }
  | { readonly kind: 'ok'; readonly text: string; readonly authKind: GitlabAuthPaneKind }
  | { readonly kind: 'ended' }
  | { readonly kind: 'unavailable'; readonly message: string };

/** What `glabConnectStart` answers when it refused, or `null` once the pane
 *  exists and the command has been typed into it. */
export type GitlabAuthPaneRefusal = {
  readonly kind: 'refused';
  readonly code: string;
  readonly message: string;
};
