/**
 * `CHANNELS.filesList`'s main-process half: turn a live session's own id into
 * a directory, and answer with what is under it. See `./list.ts` for the
 * walk itself and `CHANNELS.filesList`'s own header for why this channel
 * exists beside `filesRead`/`filesWrite` rather than folded into either.
 *
 * KEYED BY SESSION ID, MIRRORING `attach-image.ts` EXACTLY. That module's own
 * header states the rule this one inherits rather than re-derives:
 * `renderer/domain/model.ts` carries no `cwd` field, so the only thing the
 * renderer can hand this channel is an id, and main resolves the directory
 * fresh, per request, off the live agent roster -- never a snapshot drawn
 * minutes ago, which is exactly as stale a promise here as it would be for
 * `recordPrompt` or the image picker.
 *
 * THE REALPATH, BEFORE THE WALK. `resolveCwd` answers whatever the live agent
 * roster says a session's directory is; that string is resolved through the
 * real filesystem here, the same seam `registerAttachImageIpc` and
 * `registerFilesIpc` both use, before a single `readdir` runs against it --
 * so a symlinked project directory is walked at the real location its
 * contents actually live at, not at whatever string happened to be recorded.
 */

import { CHANNELS, type IpcResult, type SourceError } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';
import type { RealpathFn } from './authorize.js';
import { listFiles, type ReadDir } from './list.js';
import type { FileListResult } from './types.js';

export type { FileListResult };

/** The session's own working directory, or `null` if nothing live answers to this id. */
export type ResolveSessionCwd = (sessionId: string) => Promise<string | null>;

const refused = (code: string, message: string): SourceError => ({
  kind: 'refused',
  code,
  message,
});

export function registerFilesListIpc(
  ipcMain: IpcMainLike,
  resolveCwd: ResolveSessionCwd,
  realpathFn: RealpathFn,
  readDir: ReadDir,
): void {
  ipcMain.handle(
    CHANNELS.filesList,
    async (_event, ...args): Promise<IpcResult<FileListResult>> => {
      const sessionId = args[0];
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        return { ok: false, error: refused('invalid-payload', 'filesList takes one session id') };
      }
      const cwd = await resolveCwd(sessionId);
      if (cwd === null) {
        return {
          ok: false,
          error: refused(
            'unknown-session',
            `vam has no live session ${sessionId}; it may have exited since the session list was drawn`,
          ),
        };
      }
      let realCwd: string;
      try {
        realCwd = await realpathFn(cwd);
      } catch {
        return {
          ok: false,
          error: refused(
            'unreadable',
            "this session's own working directory could not be resolved",
          ),
        };
      }
      const result = await listFiles(realCwd, readDir);
      return { ok: true, value: result };
    },
  );
}
