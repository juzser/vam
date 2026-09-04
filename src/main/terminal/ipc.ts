/**
 * The terminal channels: one read, answered by a `PaneView`, and one resize.
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

import { type AnswerResult, isAnswerRequest } from '../../shared/answer.js';
import {
  isPaneKey,
  isPaneSize,
  type PaneSendResult,
  type PaneView,
} from '../../shared/terminal.js';
import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';
import { readPublishedPanes } from '../sources/claude-code/session-pane.js';
import { defaultSessionsRoot } from '../sources/claude-code/session-status.js';
import type { TmuxRun } from '../sources/tmux/spawn.js';
import { answerQuestion } from './answer.js';
import { readSessionPane, resizeSessionPane, sendSessionKey } from './pane.js';

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

  /**
   * The fit. The renderer measures its wrapper in pixels, turns that into
   * cells and asks for it here -- and it is asked for rather than obeyed.
   *
   * BOTH BOUNDS ARE RE-CHECKED, against the same constants the renderer used
   * (`shared/terminal.ts`), because this is the first channel that CHANGES
   * something on the operator's tmux server. A size is an allocation request
   * to a program on their machine, and the renderer is the least trusted
   * process in the app; that its own arithmetic clamps is not a reason for
   * this to take its word for the result.
   *
   * `false` covers every refusal, including a session vam did not start. There
   * is nothing on the tab to draw a reason into, and a pane that cannot be
   * resized is one whose own `PaneView` already says why.
   */
  ipcMain.handle(CHANNELS.terminalResize, async (_event, ...args: unknown[]): Promise<boolean> => {
    const [projectId, columns, rows, rowId] = args;
    if (
      args.length < 3 ||
      args.length > 4 ||
      typeof projectId !== 'string' ||
      projectId.length > MAX_PROJECT_ID_LENGTH ||
      typeof columns !== 'number' ||
      typeof rows !== 'number' ||
      !isPaneSize({ columns, rows }) ||
      (rowId !== undefined && (typeof rowId !== 'string' || rowId.length > MAX_PROJECT_ID_LENGTH))
    ) {
      return false;
    }
    // The row travels with the ask for the read's reason and one more: the
    // session being resized has to be the session whose screen is on screen,
    // and the published pane is what makes that per SESSION rather than per
    // project (`terminal/pane.ts`).
    return resizeSessionPane(
      run,
      projectId,
      { columns, rows },
      rowId,
      rowId === undefined ? undefined : await readPanes(),
    );
  });

  /**
   * The keystroke. It is the only channel in vam that types into a session
   * somebody's agent is running in, and the validation is the guard: `args`
   * is checked by shape rather than trusted, the keystroke is checked to be
   * one of the two things tmux can deliver, and its text is bounded so this
   * cannot become an unbounded paste (`shared/terminal.ts`).
   *
   * `unaimed` covers every refusal this handler makes itself, including a
   * malformed ask: nothing was sent, and nothing was aimed. The two answers
   * from below it are passed through unchanged, because the tab draws a
   * different sentence for a pairing it cannot make than for a session that
   * ended under it.
   */
  ipcMain.handle(
    CHANNELS.terminalSend,
    async (_event, ...args: unknown[]): Promise<PaneSendResult> => {
      const [projectId, key, rowId] = args;
      if (
        args.length < 2 ||
        args.length > 3 ||
        typeof projectId !== 'string' ||
        projectId.length > MAX_PROJECT_ID_LENGTH ||
        !isPaneKey(key) ||
        (rowId !== undefined && (typeof rowId !== 'string' || rowId.length > MAX_PROJECT_ID_LENGTH))
      ) {
        return 'unaimed';
      }
      return sendSessionKey(
        run,
        projectId,
        key,
        rowId,
        rowId === undefined ? undefined : await readPanes(),
      );
    },
  );

  /**
   * The answer. It ENDS a tool call in a running agent, which is one step
   * beyond typing into one, so the ask is validated by shape here and not
   * because the preload built it -- and `unaimed` is every refusal this
   * handler makes itself: nothing was read, nothing was aimed, nothing sent.
   *
   * Everything below it is passed through unchanged, because the card draws a
   * different sentence for each: a picker that is not there, one that did not
   * respond to the probe arrow, an option that is nowhere on screen, and a
   * read-back that disagreed are four different things to a person, and only
   * the last means keys went in.
   */
  ipcMain.handle(
    CHANNELS.terminalAnswer,
    async (_event, ...args: unknown[]): Promise<AnswerResult> => {
      const [projectId, request, rowId] = args;
      if (
        args.length < 2 ||
        args.length > 3 ||
        typeof projectId !== 'string' ||
        projectId.length > MAX_PROJECT_ID_LENGTH ||
        !isAnswerRequest(request) ||
        (rowId !== undefined && (typeof rowId !== 'string' || rowId.length > MAX_PROJECT_ID_LENGTH))
      ) {
        return { kind: 'unaimed' };
      }
      return answerQuestion(
        run,
        projectId,
        request,
        rowId,
        rowId === undefined ? undefined : await readPanes(),
      );
    },
  );
}
