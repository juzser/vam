/**
 * The file-editor tab's size ceiling, binary sniff and conflict signature --
 * the three decisions `ipc.ts`'s read and write channels both need and
 * neither should make twice.
 *
 * THE SIZE CEILING: 50 MiB, on disk, checked from `stat` BEFORE a single byte
 * is read. This is the number orca -- a sibling ADE doing the same job on the
 * same population of files -- already shipped and measured against real
 * repositories; there is no evidence vam's own population (an operator's
 * `.env` and "a few other files") needs a different one, and inventing a
 * smaller number here would be a guess with nothing behind it where orca's is
 * a reused, already-defended constant. It exists to bound MEMORY, not
 * politeness: main is a single process shared with the terminal poller, the
 * change stream and every other IPC handler, and a multi-hundred-megabyte
 * `Buffer` held across an `await` is a stall every one of them pays for. A
 * file over the ceiling is refused with its actual size in the message
 * (`ipc.ts`) and never partially read -- see `looksLikeText`'s own note on
 * why silent truncation is worse than a refusal.
 *
 * THE BINARY SNIFF: the first 8 KiB of whatever was read, tested for a single
 * NUL byte. This is git's own heuristic for the same question (`buffer_is_
 * binary_data` in git's `xdiff-interface.c`, unchanged since git 1.x): a NUL
 * byte in the first ~8000 bytes of a real text file is vanishingly rare,
 * because every text encoding vam is asked to open (UTF-8, ASCII, Latin-1)
 * uses it as a terminator or simply never emits it, while it appears
 * constantly in the first few kilobytes of almost anything else (an image
 * header, a compiled binary, a `.sqlite` file). Reusing git's own rule beats
 * inventing a new one for the same question. A file that sniffs binary is
 * answered `{content: '', isBinary: true}`, never a `Buffer` decoded as UTF-8
 * and handed to the renderer as if it were text -- an image or an archive
 * decoded that way is not "wrong text", it is thousands of U+FFFD replacement
 * characters and the illusion of a file vam actually understood.
 *
 * THE CONFLICT SIGNATURE: size, mtime AND a content hash, together, not size
 * and mtime alone. An agent is actively editing these files while the
 * operator might be too, and mtime's resolution is coarser than "two writes a
 * second apart" on some filesystems, while `sed -i`-style tools and some
 * editors are known to preserve a file's mtime across a rewrite entirely --
 * either one turns a same-size, same-mtime, DIFFERENT-content overwrite into
 * a conflict this guard would otherwise wave through. The hash is what closes
 * that gap: it is computed over content this module already has in memory
 * (the read the ceiling above already bounded), so it costs nothing extra to
 * fetch and, at up to 50 MiB, costs low-single-digit milliseconds of CPU to
 * compute. `size`/`mtimeMs` are kept alongside it rather than dropped now
 * that the hash exists, because they are what let `ipc.ts` name WHICH kind of
 * change happened (its own size differs vs. its bytes changed within the same
 * size) rather than only THAT one did.
 *
 * `FileSignature` ITSELF LIVES IN `./types.ts`, NOT HERE, even though every
 * function below is what produces and compares it. See that file's header:
 * this module needs `node:crypto`, and a type-only import of `FileSignature`
 * from a file that also needs `node:crypto` would drag this whole module
 * (transitively) into `tsconfig.web.json`'s typecheck, which has no `node`
 * types at all.
 */

import { createHash } from 'node:crypto';
import type { FileSignature } from './types.js';

export type { FileSignature };

/** 50 MiB. See this file's header for why this number and not a smaller one. */
export const READ_CEILING_BYTES = 50 * 1024 * 1024;

/** How much of a file's own bytes the binary sniff looks at. See header. */
export const SNIFF_BYTES = 8 * 1024;

/** `true` when `sample` -- the leading `SNIFF_BYTES` of a file -- looks binary. */
export function looksLikeBinary(sample: Uint8Array): boolean {
  return sample.includes(0);
}

/** The signature of `content` as it sits on disk right now, at `mtimeMs`. */
export function signatureOf(content: Uint8Array, mtimeMs: number): FileSignature {
  return {
    size: content.byteLength,
    mtimeMs,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

/**
 * Do two signatures describe the same on-disk bytes? Used by `ipc.ts`'s write
 * channel to decide whether the caller's baseline still matches reality --
 * `null` on either side means "no file was there", so `null`/`null` is a
 * match (a genuinely new file) and `null` against a real signature is not.
 */
export function sameSignature(a: FileSignature | null, b: FileSignature | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  // `sha256` alone is sufficient -- two different byte strings sharing a
  // SHA-256 digest is not a threat model this guard needs to defend against
  // -- but `size` is compared too because it is what lets a mismatch be
  // reported as "the file grew from N to M bytes" rather than only "changed".
  return a.sha256 === b.sha256 && a.size === b.size;
}
