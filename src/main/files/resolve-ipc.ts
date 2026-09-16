/**
 * `CHANNELS.filesResolve`'s main-process half: an agent wrote
 * `src/foo/bar.ts:42` into its answer, and this decides whether that is a file
 * the Files tab may open -- and where it really is.
 *
 * WHY IT IS A CHANNEL AND NOT A STRING JOIN IN THE RENDERER. The renderer has
 * no working directory to resolve against: `renderer/domain/model.ts` carries
 * no `cwd` field, which is the same absence `attach-image.ts` and
 * `list-ipc.ts` are both keyed by SESSION ID for. Even if it had one, joining
 * a root to a reference is string arithmetic, and `attach-image.ts` measured
 * against a real symlink on a real disk that string arithmetic cannot answer
 * containment. So the reference crosses as TEXT and every decision about it is
 * made here.
 *
 * IT REUSES `authorize`, IT DOES NOT REPEAT IT. That module already
 * canonicalises both sides through `realpath` before comparing, already walks
 * a missing leaf up to an existing ancestor, and already refuses a root that
 * will not resolve. What is new here is only the two things it cannot know:
 *
 *  * THE ROOT SET IS ONE ROOT, not every live session's. A reference belongs
 *    to the session whose answer it was written in, and `src/index.ts` means a
 *    different file in each of the eight projects vam might be watching.
 *    `filesRead` is right to accept any live session's directory -- the
 *    operator typed that path -- and this is right not to: nobody typed this.
 *
 *  * A REFERENCE MUST EXIST. `authorize` admits a missing leaf on purpose,
 *    because that is how the Files tab creates a new file. An agent citing a
 *    path it renamed, deleted or imagined is the opposite case: opening an
 *    empty editor titled `src/ghost.ts` would look exactly like the file, so
 *    `existed: false` is refused here in words instead.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK is whether the target is a directory or
 * how big it is. `filesRead` re-authorises this path from scratch and answers
 * `is-a-directory`/`too-large` one step later, and duplicating either would be
 * a second copy of a rule that is already enforced where it bites.
 *
 * THE REFUSALS SAY WHICH IS WHICH, and that is safe for the reason
 * `files/ipc.ts` gives: `not-authorized` versus `not-found` is only ever
 * distinguished AFTER containment has already been decided, so a reference
 * outside the project learns nothing about what is out there -- every such
 * path gets the identical answer whether it exists or not.
 */

import { isAbsolute, resolve } from 'node:path';
import { parseFileRef } from '../../shared/file-ref.js';
import { CHANNELS, type IpcResult, type SourceError } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';
import { authorize, type RealpathFn } from './authorize.js';
import type { ResolveSessionCwd } from './list-ipc.js';
import type { FileRefTarget } from './types.js';

const refused = (code: string, message: string): SourceError => ({
  kind: 'refused',
  code,
  message,
});

export function registerFilesResolveIpc(
  ipcMain: IpcMainLike,
  resolveCwd: ResolveSessionCwd,
  realpathFn: RealpathFn,
): void {
  ipcMain.handle(
    CHANNELS.filesResolve,
    async (_event, ...args): Promise<IpcResult<FileRefTarget>> => {
      const [sessionId, reference] = args;
      if (args.length !== 2 || typeof sessionId !== 'string' || sessionId.length === 0) {
        return {
          ok: false,
          error: refused('invalid-payload', 'filesResolve takes a session id and a reference'),
        };
      }
      // Parsed by the SAME function the renderer drew the control with, so the
      // two cannot disagree about where the path ends and the line begins --
      // and so that a reference main cannot read is refused rather than
      // guessed at. `parseFileRef` takes `unknown` and rejects a scheme, a NUL
      // byte, whitespace and anything without a line of its own.
      const ref = parseFileRef(reference);
      if (ref === null) {
        return {
          ok: false,
          error: refused('invalid-payload', 'that is not a path:line reference vam can read'),
        };
      }
      const cwd = await resolveCwd(sessionId);
      if (cwd === null) {
        return {
          ok: false,
          error: refused(
            'unknown-session',
            `vam has no live session ${sessionId}; it may have exited since the answer was drawn`,
          ),
        };
      }
      let realRoot: string;
      try {
        realRoot = await realpathFn(cwd);
      } catch {
        return {
          ok: false,
          error: refused(
            'unreadable',
            "this session's own working directory could not be resolved",
          ),
        };
      }
      // Against the REAL root, never the recorded string: a relative reference
      // means "from where this session is actually running".
      const candidate = isAbsolute(ref.path) ? ref.path : resolve(realRoot, ref.path);
      const authorization = await authorize(candidate, [realRoot], realpathFn);
      if (!authorization.authorized) {
        return {
          ok: false,
          error: refused(
            'not-authorized',
            `${ref.path} is not inside this session's own project directory`,
          ),
        };
      }
      if (!authorization.existed) {
        return {
          ok: false,
          error: refused('not-found', `${ref.path} is not a file in this session's project`),
        };
      }
      return { ok: true, value: { path: authorization.realPath, line: ref.line } };
    },
  );
}
