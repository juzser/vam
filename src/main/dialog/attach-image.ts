/**
 * The image-attach picker's main-process half.
 *
 * WHY THIS EXISTS. `state/artifacts/vam-image-attach/findings.md` measured
 * that Claude Code reads an image straight off a bare path in the prompt --
 * so vam's own job is one path string, not an upload. But two of its own
 * refusals -- a path outside the session's working directory, and content
 * that is not really an image behind an image name -- arrive only AFTER the
 * prompt has already been recorded and delivered. Both checks are cheap to
 * do here, before the draft the operator is composing ever changes, so they
 * are done here rather than left to the CLI to discover mid-turn.
 *
 * THE RENDERER DOES NOT KNOW THE SESSION'S CWD. `Session`/`Project`
 * (`renderer/domain/model.ts`) carry no `cwd` field -- only main does, read
 * fresh off the live agent list the same way `recordPrompt` and
 * `closeSession` already do. So the whole act -- open the dialog scoped to
 * that directory, then validate the answer -- happens here in one request,
 * and the renderer never learns the directory string at all.
 *
 * `dialog`, `resolveCwd`, `readHeader` and `realpathFn` are all parameters,
 * exactly as `clipboard` is for the clipboard channel and `dialog` is for the
 * directory picker (`./ipc.ts`): nothing here touches Electron directly, and
 * the one real filesystem call this makes (`realpathFn`) is injected too, so
 * every branch -- including the symlink one -- can be asserted without a
 * real disk, and the one test that DOES want a real disk (a real symlink
 * escaping a real temp directory) can pass the real `fs.promises.realpath`
 * through the same seam.
 *
 * THE SYMLINK CASE, AND WHY `isInsideDirectory` ALONE CANNOT CATCH IT.
 * `path.resolve`/`path.relative` are pure string arithmetic: a symlink
 * INSIDE `cwd` that points OUTSIDE it (`project/cute-cat.png -> ../secret/
 * whatever.png`) resolves, syntactically, to a path inside `cwd`, and a
 * containment check built only on those two functions says yes. `fs.open`/
 * `fs.read` then follow the link transparently and hand back the TARGET's
 * bytes, which is exactly what would be sniffed, attached and delivered --
 * an operator checking out an untrusted branch gets a committed symlink
 * restored with no code execution at all, and a file that LOOKS like
 * `screenshot.png` in the native dialog can point at `~/.ssh/id_rsa` and
 * still sniff as a real image if the far end of the link is a real one.
 * `registerAttachImageIpc` below resolves BOTH `cwd` and the picked path
 * through `realpathFn` before comparing, and reads the header from the
 * RESOLVED path -- so the bytes sniffed are the bytes that would actually be
 * read. There remains a TOCTOU window between that resolve and the read (and
 * a second one between the read and Claude Code's own, later read of the
 * same path): nothing here holds the file open across the gap, so a link
 * swapped in between could still slip through. That window is not closed by
 * this change; it is only narrowed to the same one every path-based file
 * check has.
 */

import { isAbsolute, relative, resolve } from 'node:path';
import { CHANNELS, type IpcResult, type SourceError } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';

/**
 * Resolves symlinks and `..` segments against the real filesystem -- the one
 * check `isInsideDirectory` below cannot do on its own. Rejects (never
 * resolves to a sentinel) when the path does not exist or cannot be
 * traversed, which the caller turns into a refusal rather than an exception.
 */
export type RealpathFn = (path: string) => Promise<string>;

/** The slice of electron's `dialog` this reads -- `openFile`, never `openDirectory`. */
export type AttachImageDialogLike = {
  showOpenDialog(options: {
    defaultPath?: string;
    properties: 'openFile'[];
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ readonly canceled: boolean; readonly filePaths: readonly string[] }>;
};

/** The session's own working directory, or `null` if nothing live answers to this id. */
export type ResolveSessionCwd = (sessionId: string) => Promise<string | null>;

/** Reads only as many leading bytes as a magic-number check needs. */
export type ReadImageHeader = (path: string) => Promise<Uint8Array>;

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];
const GIF = [0x47, 0x49, 0x46, 0x38];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

const startsWith = (bytes: Uint8Array, magic: readonly number[], at = 0): boolean =>
  magic.every((byte, index) => bytes[at + index] === byte);

/**
 * Is `bytes` the head of a PNG, JPEG, GIF or WEBP file -- by content, never
 * by extension, mirroring `attachIntoDraft`'s replacement-character guard for
 * text (`renderer/panels/DetailPanel.tsx`). SVG and other vector formats are
 * not recognised: the measured finding did not test them.
 */
export function looksLikeImage(bytes: Uint8Array): boolean {
  if (startsWith(bytes, PNG) || startsWith(bytes, JPEG) || startsWith(bytes, GIF)) return true;
  // WEBP is `RIFF????WEBP`; the four bytes at offset 4 are a size and vary.
  return startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8);
}

/**
 * Whether `candidate` sits strictly inside `cwd`, comparing the two strings
 * as given -- PURE PATH ARITHMETIC, and it touches no filesystem. That is
 * exactly what makes it insufficient on its own: called on a symlink's own
 * path rather than on what it resolves to, a link that sits inside `cwd` and
 * points anywhere else on disk is syntactically inside `cwd` and this
 * returns `true` for it regardless. `registerAttachImageIpc` is the only
 * caller and is the one that must resolve both arguments through
 * `fs.realpath` FIRST -- see its own comment for why an argument named
 * `candidate` reads oddly if you assume this function did that already, and
 * do not assume it, because a previous version of this comment claimed a
 * symlinked path was "judged on where it actually points" here, which was
 * false: this function never opened the filesystem and could not know. The
 * directory itself does not count as inside itself -- there is nothing to
 * attach at that path.
 */
export function isInsideDirectory(cwd: string, candidate: string): boolean {
  const rel = relative(resolve(cwd), resolve(candidate));
  return rel !== '' && rel !== '.' && !rel.startsWith('..') && !isAbsolute(rel);
}

const IMAGE_FILTERS = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }];

const refused = (code: string, message: string): SourceError => ({
  kind: 'refused',
  code,
  message,
});

/**
 * Registers the picker channel. Cancelling the dialog answers `{ok: true,
 * value: null}` -- it is one of two normal answers, not a refusal -- while
 * every other non-picked outcome answers `{ok: false}` with a `SourceError`
 * naming exactly what was wrong, so the composer can show it and send
 * nothing.
 */
export function registerAttachImageIpc(
  ipcMain: IpcMainLike,
  dialog: AttachImageDialogLike,
  resolveCwd: ResolveSessionCwd,
  readHeader: ReadImageHeader,
  realpathFn: RealpathFn,
): void {
  ipcMain.handle(
    CHANNELS.pickImageAttachment,
    async (_event, ...args): Promise<IpcResult<string | null>> => {
      const sessionId = args[0];
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        return {
          ok: false,
          error: refused('invalid-payload', 'pickImageAttachment takes one session id'),
        };
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
      let result: { readonly canceled: boolean; readonly filePaths: readonly string[] };
      try {
        result = await dialog.showOpenDialog({
          defaultPath: cwd,
          properties: ['openFile'],
          filters: IMAGE_FILTERS,
        });
      } catch {
        // A dialog that threw has nothing left in it worth reporting, and a
        // thrown dialog is not the operator refusing anything -- see
        // `registerDialogIpc`'s own reasoning.
        return { ok: true, value: null };
      }
      const picked = result.canceled ? undefined : result.filePaths[0];
      if (picked === undefined) {
        return { ok: true, value: null };
      }
      // BOTH SIDES THROUGH THE REAL FILESYSTEM, before comparing. `cwd` is
      // resolved fresh here rather than cached: it is a directory, not the
      // symlink risk, but a stale resolution of it would be a second way to
      // drift from what is actually on disk. Either side throwing (missing,
      // unreadable, a broken link) is a refusal, never an exception the
      // handler's own contract forbids.
      let realCwd: string;
      let realPicked: string;
      try {
        realCwd = await realpathFn(cwd);
        realPicked = await realpathFn(picked);
      } catch {
        return {
          ok: false,
          error: refused('unreadable', `${picked} could not be resolved`),
        };
      }
      if (!isInsideDirectory(realCwd, realPicked)) {
        return {
          ok: false,
          error: refused(
            'outside-directory',
            `${picked} is outside this session's own working directory — Claude Code would refuse to read it, so vam does not send it`,
          ),
        };
      }
      // FROM THE RESOLVED PATH, not `picked`: the bytes sniffed below must be
      // the bytes a symlink would actually hand over, or the sniff proves
      // nothing about what gets read.
      let header: Uint8Array;
      try {
        header = await readHeader(realPicked);
      } catch {
        return { ok: false, error: refused('unreadable', `${picked} could not be read`) };
      }
      if (!looksLikeImage(header)) {
        return {
          ok: false,
          error: refused(
            'not-an-image',
            `${picked} is not a PNG, JPEG, GIF or WEBP file — vam checked its content, not its name`,
          ),
        };
      }
      return { ok: true, value: realPicked };
    },
  );
}
