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

import { isAbsolute, join, normalize } from 'node:path';

import { CHANNELS, type IpcResult, type SourceError } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';
import { authorize, type RealpathFn } from './authorize.js';
import { listDirectory, listFiles, type ReadDir } from './list.js';
import type { FileDirResult, FileListResult } from './types.js';

export type { FileDirResult } from './types.js';
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
    async (_event, ...args): Promise<IpcResult<FileListResult | FileDirResult>> => {
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
      const dir = args[1];
      if (dir === undefined) {
        const result = await listFiles(realCwd, readDir);
        return { ok: true, value: result };
      }
      // Renderer-supplied: containment is decided by `authorize` on the
      // realpath'd candidate, exactly as `resolve-ipc.ts` does, BEFORE any read.
      if (typeof dir !== 'string' || dir.includes('\0')) {
        return { ok: false, error: refused('invalid-payload', 'dir must be a path string') };
      }
      const clean = normalize(dir);
      const candidate = isAbsolute(clean) ? clean : join(realCwd, clean);
      // `authorize` treats the root itself as not "inside" it, so the root
      // (dir '' / '.') is admitted by exact match on the realpath'd cwd.
      const authorization =
        candidate === realCwd
          ? { authorized: true as const, realPath: realCwd, existed: true }
          : await authorize(candidate, [realCwd], realpathFn);
      if (!authorization.authorized) {
        return {
          ok: false,
          error: refused(
            'not-authorized',
            `${dir} is not inside this session's own project directory`,
          ),
        };
      }
      if (!authorization.existed) {
        return { ok: false, error: refused('not-found', `${dir} is not a directory here`) };
      }
      let entries: Awaited<ReturnType<typeof listDirectory>>;
      try {
        entries = await listDirectory(authorization.realPath, '', readDir);
      } catch {
        return { ok: false, error: refused('unreadable', `${dir} could not be read`) };
      }
      const value: FileDirResult = { root: realCwd, dir: authorization.realPath, entries };
      return { ok: true, value };
    },
  );
}
