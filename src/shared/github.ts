/**
 * The vocabulary Settings -> Integrations -> GitHub shares between main
 * (which runs `gh`) and the renderer (which draws the answer) -- renderer-safe:
 * no `electron`, no `node:` import, exactly `shared/update.ts`'s own rule.
 */

/** What `gh auth login --help` names, verbatim, as the minimum scopes a
 *  token needs -- vam's own PR reader and PR actions need at least `repo`. */
export const REQUIRED_SCOPES: readonly string[] = ['repo', 'read:org', 'gist'];

export type GithubAccount = {
  readonly host: string;
  readonly login: string;
  readonly active: boolean;
  /** `null` when gh did not say -- a token source it cannot introspect. */
  readonly tokenSource: string | null;
  /** `null` when gh did not report scopes at all -- never an empty list
   *  standing in for "none reported". */
  readonly scopes: readonly string[] | null;
  /** The subset of `REQUIRED_SCOPES` this account's token is missing. Empty
   *  when `scopes` is `null`: an unknown scope list is not evidence of a
   *  missing one. */
  readonly missingScopes: readonly string[];
};

export type GithubAuthStatus =
  | { readonly kind: 'cli-missing'; readonly message: string }
  | { readonly kind: 'logged-out' }
  | { readonly kind: 'logged-in'; readonly accounts: readonly GithubAccount[] }
  /** `gh` ran and answered something this app has never seen -- reported
   *  rather than silently drawn as logged-out. */
  | { readonly kind: 'unknown'; readonly message: string };

/**
 * The exact, fixed commands Connect/Disconnect type into a pane -- shared so
 * the renderer's "Copy command" button offers the SAME string a pane would
 * type, never a second guess at it. Both are constants: there is no
 * interpolation for an injection to reach, which is a stronger guarantee than
 * validating an argument would be -- there is no argument.
 */
export const GITHUB_LOGIN_COMMAND = 'gh auth login --web -h github.com';
export const GITHUB_LOGOUT_COMMAND = 'gh auth logout -h github.com';

export type GithubAuthPaneKind = 'login' | 'logout';

export type GithubAuthPaneView =
  | { readonly kind: 'none' }
  | { readonly kind: 'ok'; readonly text: string; readonly authKind: GithubAuthPaneKind }
  | { readonly kind: 'ended' }
  | { readonly kind: 'unavailable'; readonly message: string };

export type GithubReposResult =
  | { readonly kind: 'ok'; readonly repos: readonly string[] }
  | { readonly kind: 'error'; readonly code: string; readonly message: string };

export type GithubOrgsResult =
  | { readonly kind: 'ok'; readonly orgs: readonly string[] }
  | { readonly kind: 'error'; readonly code: string; readonly message: string };

export type GithubRemote = { readonly name: string; readonly repo: string };

/** What `githubConnectStart` answers when it refused, or `null` once the pane
 *  exists and the command has been typed into it. */
export type GithubAuthPaneRefusal = {
  readonly kind: 'refused';
  readonly code: string;
  readonly message: string;
};
