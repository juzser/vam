/**
 * The terminal channel: one read, answered by a `PaneView`.
 *
 * Bare, never an `IpcResult`, for the reason `usage/ipc.ts` and
 * `clipboard/ipc.ts` answer bare: `PaneView` already carries its own failure
 * branch with the `SourceError` tmux produced, so wrapping it would give the
 * caller two different ways to be told the same thing and one of them would
 * eventually be left undrawn.
 *
 * Nothing here is pushed. The renderer asks only while the Terminal tab is
 * open, so a closed tab spawns no tmux at all -- which is the operator's
 * requirement for this tab, and the reason main holds no timer of its own.
 */

import type { PaneView } from '../../shared/terminal.js';
import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';
import type { TmuxRun } from '../sources/tmux/spawn.js';
import { readSessionPane } from './pane.js';

/**
 * A project id is a digest (`sources/claude-code/project-id.ts`), and it
 * arrives from the least trusted process in the app. The bound is far above
 * any real id and keeps a compromised renderer from handing tmux a megabyte to
 * match against.
 */
export const MAX_PROJECT_ID_LENGTH = 500;

export function registerTerminalIpc(ipcMain: IpcMainLike, run: TmuxRun): void {
  ipcMain.handle(CHANNELS.terminalRead, async (_event, ...args: unknown[]): Promise<PaneView> => {
    const [projectId] = args;
    if (
      args.length !== 1 ||
      typeof projectId !== 'string' ||
      projectId.length > MAX_PROJECT_ID_LENGTH
    ) {
      // A refusal is data here like everywhere else on this bridge, and it is
      // deliberately NOT an empty pane: vam did not look, so it may not say
      // there is nothing to see.
      return {
        kind: 'unavailable',
        error: {
          kind: 'refused',
          code: 'bad-request',
          message: 'vam asked for a terminal pane without a usable project id',
        },
      };
    }
    return readSessionPane(run, projectId);
  });
}
