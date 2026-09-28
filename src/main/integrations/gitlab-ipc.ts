/**
 * Settings -> Integrations -> GitLab's three channels, wired to the readers
 * in this directory -- `integrations/ipc.ts`'s own rule, restated: EVERY
 * ARGUMENT IS VALIDATED HERE, before it reaches a reader that spawns `glab`.
 * `glabConnectStart`'s `kind` is checked against an allowlist of exactly two
 * literals rather than any non-empty string, `integrations/ipc.ts`'s own
 * reasoning: a channel that trusted `kind` would be a channel a compromised
 * renderer could use to run whatever the reader accepted next.
 *
 * ONLY THREE CHANNELS, not the GitHub card's six: this card is status and
 * Connect/Disconnect -- no repo picker, so there is no `reposList`/
 * `orgsList`/`projectRemotes` sibling to wire.
 */

import type {
  GitlabAuthPaneKind,
  GitlabAuthPaneRefusal,
  GitlabAuthPaneView,
  GitlabAuthStatus,
} from '../../shared/gitlab.js';
import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';

export type GitlabIntegrationDeps = {
  readonly authStatus: () => Promise<GitlabAuthStatus>;
  readonly connectStart: (kind: GitlabAuthPaneKind) => Promise<GitlabAuthPaneRefusal | null>;
  readonly connectRead: () => Promise<GitlabAuthPaneView>;
};

const isConnectKind = (value: unknown): value is GitlabAuthPaneKind =>
  value === 'login' || value === 'logout';

const refusal = (code: string, message: string): GitlabAuthPaneRefusal => ({
  kind: 'refused',
  code,
  message,
});

export function registerGitlabIntegrationIpc(
  ipcMain: IpcMainLike,
  deps: GitlabIntegrationDeps,
): void {
  ipcMain.handle(CHANNELS.glabAuthStatus, async (): Promise<GitlabAuthStatus> => {
    return deps.authStatus();
  });

  ipcMain.handle(
    CHANNELS.glabConnectStart,
    async (_event, ...args: unknown[]): Promise<GitlabAuthPaneRefusal | null> => {
      const [kind] = args;
      if (args.length !== 1 || !isConnectKind(kind)) {
        return refusal('bad-request', 'vam does not know that kind of GitLab sign-in/out.');
      }
      return deps.connectStart(kind);
    },
  );

  ipcMain.handle(CHANNELS.glabConnectRead, async (): Promise<GitlabAuthPaneView> => {
    return deps.connectRead();
  });
}
