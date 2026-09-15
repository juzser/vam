/**
 * The file-editor tab's two channels: read one operator-chosen path, and
 * write it back with a conflict check in the same request. Both are built on
 * `authorize.ts` -- neither ever touches a path it has not already resolved
 * and checked against a live session's own working directory -- and both
 * keep their outcomes named apart, deliberately, so a caller (and a person
 * reading a refusal) never has to guess which one happened:
 *
 *   `not-authorized`   -- the path is not inside any live session's cwd. The
 *                         SAME answer whether the path exists, is a
 *                         permissions wall, or resolves through a symlink
 *                         that escapes -- see `authorize.ts`'s own header for
 *                         why detail is withheld here on purpose.
 *   `not-found`        -- (read only) the authorized, resolved path is not on
 *                         disk. Safe to say plainly: authorisation already
 *                         proved the operator has standing to browse this
 *                         directory, so "nothing is there" leaks nothing a
 *                         directory listing would not.
 *   `is-a-directory`   -- the resolved path names a directory, not a file.
 *   `too-large`        -- over `READ_CEILING_BYTES`, on disk or in the write
 *                         request; never partially read or partially written.
 *   `changed-on-disk`  -- (write only) THE FILE CHANGED UNDER YOU: the
 *                         caller's `baseSignature` no longer matches what is
 *                         actually on disk. Never overwritten, never merged.
 *   `unreadable`       -- an I/O failure that is none of the above (a
 *                         permissions wall on the FILE itself, a full disk, a
 *                         write that failed mid-flight).
 *   `invalid-payload`  -- the renderer's own argument was the wrong shape.
 *
 * `changed-on-disk` and `not-authorized` are never the same code and never
 * read the same in the UI: one says the operator's own edit is stale, the
 * other says the path was never theirs to touch, and conflating them would
 * make a stale edit look like a security refusal or the reverse.
 *
 * NO RENAME, NO DELETE. `authorize.ts`'s header explains why acting on a
 * symlink's resolved target is the wrong verb for either -- canonicalising a
 * link before deleting or renaming it acts on whatever it points at, which
 * `orca`'s own note on this (cited in the task that produced this file) calls
 * "trash the real file". Content read and content write, on a path this
 * module has already proven is inside a live session's own directory, is the
 * whole of this surface.
 *
 * WHAT NEVER APPEARS IN A REFUSAL, A LOG LINE, OR THE ERROR LOG THE OPERATOR
 * CAN REPORT TO GITHUB: file CONTENT. Every refusal above is built from a
 * path, a size, a code, or a signature (`content.ts`'s `FileSignature`,
 * itself only a size/mtime/hash -- never bytes). `src/main/errors/log.ts`'s
 * own header already makes this argument for prompts and transcripts
 * ("PROMPT AND TRANSCRIPT TEXT is not on either list [...] there is nothing
 * here to strip"); the same argument applies to `.env` and to every other
 * file this channel can reach, and it is enforced the same way -- not by
 * scrubbing something that got in, but by never constructing a message that
 * could carry it in the first place. See this repo's `errors/scrub.ts` for
 * the reasoning this mirrors. `.env` gets NO OTHER special treatment: vam
 * does not mask it, warn about it or refuse to open it. Singling out one
 * filename would be a promise this module cannot keep -- an operator's
 * secret is exactly as likely to be sitting in `config/credentials.json` or
 * `id_rsa` copied into a project directory, and a vam that protects `.env`
 * alone teaches the wrong lesson: that the boundary is a filename rather
 * than "content never leaves this process in a message meant for a log".
 */

import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { CHANNELS, type IpcResult, type SourceError } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';
import { authorize, type RealpathFn, type ResolveRoots } from './authorize.js';
import {
  looksLikeBinary,
  READ_CEILING_BYTES,
  SNIFF_BYTES,
  sameSignature,
  signatureOf,
} from './content.js';
import type { FileReadResult, FileSignature, FileWriteResult } from './types.js';

export type { FileReadResult, FileWriteResult };

/** A path this channel accepts as a request argument, before authorisation. */
const MAX_PATH_LENGTH = 4096;

/** The slice of `fs.Stats` these handlers read. */
export type StatLike = {
  readonly size: number;
  readonly mtimeMs: number;
  readonly mode: number;
  isDirectory(): boolean;
};

/** The filesystem primitives this module needs, so it is testable without a real disk. */
export type FilesystemLike = {
  stat(path: string): Promise<StatLike>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: Uint8Array, options: { mode: number }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
};

const refused = (code: string, message: string): SourceError => ({
  kind: 'refused',
  code,
  message,
});

const NOT_AUTHORIZED = (path: string, verb: 'open' | 'write to'): SourceError =>
  refused(
    'not-authorized',
    `${path} is not yours to ${verb} — it is outside every live session's own working directory`,
  );

const isPathArg = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_PATH_LENGTH &&
  !value.includes('\0');

const isSignature = (value: unknown): value is FileSignature => {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.size === 'number' &&
    typeof row.mtimeMs === 'number' &&
    typeof row.sha256 === 'string' &&
    row.sha256.length > 0
  );
};

/**
 * `stat`, folded into three outcomes a caller can switch on directly: the
 * path is not there, it is a directory, or it is a regular file at a size
 * this module will actually read. NEVER throws -- every filesystem failure
 * becomes one of these, which is what lets both handlers below stay a
 * straight-line sequence of refusals rather than a `try` around each step.
 */
type Probe =
  | { readonly kind: 'missing' }
  | { readonly kind: 'directory' }
  | { readonly kind: 'too-large'; readonly size: number }
  | { readonly kind: 'file'; readonly stat: StatLike };

async function probe(fs: FilesystemLike, realPath: string): Promise<Probe> {
  let stat: StatLike;
  try {
    stat = await fs.stat(realPath);
  } catch {
    return { kind: 'missing' };
  }
  if (stat.isDirectory()) return { kind: 'directory' };
  if (stat.size > READ_CEILING_BYTES) return { kind: 'too-large', size: stat.size };
  return { kind: 'file', stat };
}

export function registerFilesIpc(
  ipcMain: IpcMainLike,
  resolveRoots: ResolveRoots,
  realpathFn: RealpathFn,
  fs: FilesystemLike,
): void {
  ipcMain.handle(
    CHANNELS.filesRead,
    async (_event, ...args): Promise<IpcResult<FileReadResult>> => {
      const path = args[0];
      if (!isPathArg(path)) {
        return { ok: false, error: refused('invalid-payload', 'filesRead takes one path') };
      }
      const roots = await resolveRoots();
      const authorization = await authorize(path, roots, realpathFn);
      if (!authorization.authorized) {
        return { ok: false, error: NOT_AUTHORIZED(path, 'open') };
      }
      const found = await probe(fs, authorization.realPath);
      if (found.kind === 'missing') {
        return { ok: false, error: refused('not-found', `${path} does not exist`) };
      }
      if (found.kind === 'directory') {
        return {
          ok: false,
          error: refused('is-a-directory', `${path} is a directory, not a file`),
        };
      }
      if (found.kind === 'too-large') {
        return {
          ok: false,
          error: refused(
            'too-large',
            `${path} is ${found.size} bytes, over the ${READ_CEILING_BYTES}-byte ceiling vam reads`,
          ),
        };
      }
      let content: Uint8Array;
      try {
        content = await fs.readFile(authorization.realPath);
      } catch (error) {
        return {
          ok: false,
          error: refused(
            'unreadable',
            `${path} could not be read: ${error instanceof Error ? error.message : String(error)}`,
          ),
        };
      }
      const isBinary = looksLikeBinary(content.subarray(0, SNIFF_BYTES));
      const signature = signatureOf(content, found.stat.mtimeMs);
      return {
        ok: true,
        value: {
          content: isBinary ? '' : Buffer.from(content).toString('utf8'),
          isBinary,
          signature,
        },
      };
    },
  );

  ipcMain.handle(
    CHANNELS.filesWrite,
    async (_event, ...args): Promise<IpcResult<FileWriteResult>> => {
      const invalidPayload = (): IpcResult<FileWriteResult> => ({
        ok: false,
        error: refused(
          'invalid-payload',
          'filesWrite takes a path, text content, and a signature or null',
        ),
      });
      const path = args[0];
      if (!isPathArg(path)) {
        return invalidPayload();
      }
      const content = args[1];
      if (typeof content !== 'string') {
        return invalidPayload();
      }
      const baseSignature = args[2];
      if (baseSignature !== null && !isSignature(baseSignature)) {
        return invalidPayload();
      }
      const roots = await resolveRoots();
      const authorization = await authorize(path, roots, realpathFn);
      if (!authorization.authorized) {
        return { ok: false, error: NOT_AUTHORIZED(path, 'write to') };
      }
      const { realPath } = authorization;
      const found = await probe(fs, realPath);
      if (found.kind === 'directory') {
        return {
          ok: false,
          error: refused('is-a-directory', `${path} is a directory, not a file`),
        };
      }
      if (found.kind === 'too-large') {
        return {
          ok: false,
          error: refused(
            'too-large',
            `${path} is already ${found.size} bytes, over the ${READ_CEILING_BYTES}-byte ` +
              'ceiling vam will read to check for a conflict — it will not overwrite a file it cannot verify',
          ),
        };
      }
      const next = Buffer.from(content, 'utf8');
      if (next.byteLength > READ_CEILING_BYTES) {
        return {
          ok: false,
          error: refused(
            'too-large',
            `this write is ${next.byteLength} bytes, over the ${READ_CEILING_BYTES}-byte ceiling`,
          ),
        };
      }
      // THE CONFLICT CHECK. `found.kind === 'missing'` means nothing is there
      // right now; any other kind means a real file is, and its signature is
      // read fresh -- never reused from an earlier request -- so a change
      // that landed between this request's authorisation and this moment is
      // still caught. See `content.ts`'s header for why size+mtime alone
      // would not be enough here.
      let current: FileSignature | null = null;
      let previousMode: number | null = null;
      if (found.kind === 'file') {
        let bytes: Uint8Array;
        try {
          bytes = await fs.readFile(realPath);
        } catch (error) {
          return {
            ok: false,
            error: refused(
              'unreadable',
              `${path} could not be read to check for a conflict: ` +
                `${error instanceof Error ? error.message : String(error)}`,
            ),
          };
        }
        current = signatureOf(bytes, found.stat.mtimeMs);
        previousMode = found.stat.mode & 0o777;
      }
      if (!sameSignature(baseSignature, current)) {
        return {
          ok: false,
          error: refused(
            'changed-on-disk',
            `${path} changed under you — reload it and reapply your edit before writing again`,
          ),
        };
      }
      // ATOMIC: a temp file beside the target, then a rename over it, the
      // same shape `remote/devices.ts` already uses for its own durable
      // writes. A crash between these two lines leaves the ORIGINAL file (or
      // nothing, for a new one) untouched and an orphaned `.tmp` file beside
      // it -- never a half-written `.env`.
      //
      // THE MODE IS PRESERVED, NOT INHERITED FROM THE TEMP FILE'S DEFAULT.
      // `rename` replaces the target's inode with the temp file's; without
      // this, overwriting an existing file through this channel would
      // silently reset its permission bits -- turning an executable script
      // vam was asked to edit into one that no longer runs. A file THIS
      // CHANNEL CREATES gets `0o600` instead of the platform's normal
      // `0o644`: the operator's own stated use for this feature is `.env`
      // and files like it, a NEW file created here has no prior mode to
      // preserve, and there is no cost to defaulting to the more private
      // choice when nothing already on disk depended on the looser one.
      const temp = join(dirname(realPath), `.vam-write-${randomUUID()}.tmp`);
      const mode = previousMode ?? 0o600;
      try {
        await fs.writeFile(temp, next, { mode });
        await fs.rename(temp, realPath);
      } catch (error) {
        return {
          ok: false,
          error: refused(
            'unreadable',
            `${path} could not be written: ${error instanceof Error ? error.message : String(error)}`,
          ),
        };
      }
      let writtenMtimeMs = current?.mtimeMs ?? Date.now();
      try {
        writtenMtimeMs = (await fs.stat(realPath)).mtimeMs;
      } catch {
        // The write and rename above already succeeded; a stat failure here
        // costs the caller a slightly stale `mtimeMs` in the signature it
        // gets back, never the write itself.
      }
      return {
        ok: true,
        value: { signature: signatureOf(next, writtenMtimeMs) },
      };
    },
  );
}
