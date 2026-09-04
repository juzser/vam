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
import { readPublishedPanes } from '../sources/claude-code/session-pane.js';
import { defaultSessionsRoot } from '../sources/claude-code/session-status.js';
import type { TmuxRun } from '../sources/tmux/spawn.js';
import { readSessionPane } from './pane.js';

/**
 * A project id is a digest (`sources/claude-code/project-id.ts`), and it
 * arrives from the least trusted process in the app. The bound is far above
 * any real id and keeps a compromised renderer from handing tmux a megabyte to
 * match against.
 */
export const MAX_PROJECT_ID_LENGTH = 500;

/**
 * `readPanes` is injected for the reason every filesystem read in main is: the
 * default enumerates the operator's own `~/.claude/sessions`, and a test must
 * never do that. It is what makes the tab's answer per SESSION rather than per
 * project -- see `terminal/pane.ts`.
 */
export function registerTerminalIpc(
  ipcMain: IpcMainLike,
  run: TmuxRun,
  readPanes: () => Promise<ReadonlyMap<string, string>> = () =>
    readPublishedPanes(defaultSessionsRoot()),
): void {
  ipcMain.handle(CHANNELS.terminalRead, async (_event, ...args: unknown[]): Promise<PaneView> => {
    const [projectId, rowId] = args;
    // The row is OPTIONAL: a caller that names only a project still gets the
    // project-wide answer. Both ids are bounded for the same reason -- they
    // arrive from the least trusted process in the app.
    if (
      args.length < 1 ||
      args.length > 2 ||
      typeof projectId !== 'string' ||
      projectId.length > MAX_PROJECT_ID_LENGTH ||
      (rowId !== undefined && (typeof rowId !== 'string' || rowId.length > MAX_PROJECT_ID_LENGTH))
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
    return readSessionPane(
      run,
      projectId,
      rowId,
      rowId === undefined ? undefined : await readPanes(),
    );
  });
}
