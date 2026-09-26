/**
 * Settings -> Integrations -> GitHub's six channels, wired to the readers in
 * this directory. See `channels.ts`'s own note on every one of them: DESKTOP
 * ONLY, none a member of `PreloadSourceApi`, and `remote/server.ts` registers
 * no route for any of them.
 *
 * EVERY ARGUMENT IS VALIDATED HERE, before it reaches a reader that spawns
 * `gh` -- `handlers.ts`'s own rule, restated: the renderer is the least
 * trusted process in this app. `githubConnectStart`'s `kind` is checked
 * against an allowlist of exactly two literals rather than any non-empty
 * string, for the same reason `runPrActionViaCli` allowlists a merge method
 * rather than accepting any word: a channel that trusted `kind` would be a
 * channel a compromised renderer could use to run whatever the reader
 * accepted next, and the reader accepts exactly `'login' | 'logout'`.
 */

import type {
  GithubAuthPaneKind,
  GithubAuthPaneRefusal,
  GithubAuthPaneView,
  GithubAuthStatus,
  GithubOrgsResult,
  GithubRemote,
  GithubReposResult,
} from '../../shared/github.js';
import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';
import { isText } from '../ipc/validators.js';

export type GithubReposAnswer = GithubReposResult;
export type GithubOrgsAnswer = GithubOrgsResult;

export type GithubIntegrationDeps = {
  readonly authStatus: () => Promise<GithubAuthStatus>;
  readonly connectStart: (kind: GithubAuthPaneKind) => Promise<GithubAuthPaneRefusal | null>;
  readonly connectRead: () => Promise<GithubAuthPaneView>;
  readonly reposList: (owner: string) => Promise<GithubReposAnswer>;
  readonly orgsList: () => Promise<GithubOrgsAnswer>;
  /** A project id -> its own git remotes, first-suggestion candidates for the
   *  repo picker. Resolves to the empty list for a project id vam cannot
   *  resolve to a directory -- an informational read, never a refusal. */
  readonly projectRemotes: (projectId: string) => Promise<readonly GithubRemote[]>;
};

const isConnectKind = (value: unknown): value is GithubAuthPaneKind =>
  value === 'login' || value === 'logout';

const refusal = (code: string, message: string): GithubAuthPaneRefusal => ({
  kind: 'refused',
  code,
  message,
});

export function registerGithubIntegrationIpc(
  ipcMain: IpcMainLike,
  deps: GithubIntegrationDeps,
): void {
  ipcMain.handle(CHANNELS.githubAuthStatus, async (): Promise<GithubAuthStatus> => {
    return deps.authStatus();
  });

  ipcMain.handle(
    CHANNELS.githubConnectStart,
    async (_event, ...args: unknown[]): Promise<GithubAuthPaneRefusal | null> => {
      const [kind] = args;
      if (args.length !== 1 || !isConnectKind(kind)) {
        return refusal('bad-request', 'vam does not know that kind of GitHub sign-in/out.');
      }
      return deps.connectStart(kind);
    },
  );

  ipcMain.handle(CHANNELS.githubConnectRead, async (): Promise<GithubAuthPaneView> => {
    return deps.connectRead();
  });

  ipcMain.handle(
    CHANNELS.githubReposList,
    async (_event, ...args: unknown[]): Promise<GithubReposAnswer> => {
      const [owner] = args;
      if (args.length !== 1 || !isText(owner)) {
        return {
          kind: 'error',
          code: 'bad-request',
          message: 'vam was given no GitHub owner to look up.',
        };
      }
      return deps.reposList(owner);
    },
  );

  ipcMain.handle(CHANNELS.githubOrgsList, async (): Promise<GithubOrgsAnswer> => {
    return deps.orgsList();
  });

  ipcMain.handle(
    CHANNELS.githubProjectRemotes,
    async (_event, ...args: unknown[]): Promise<readonly GithubRemote[]> => {
      const [projectId] = args;
      if (args.length !== 1 || !isText(projectId)) return [];
      return deps.projectRemotes(projectId);
    },
  );
}
