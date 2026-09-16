/**
 * The file-editor tab's cross-boundary data shapes, and ONLY those shapes.
 *
 * THIS FILE HAS NO IMPORTS, ON PURPOSE. `src/preload/api.ts` needs `FileSignature`,
 * `FileReadResult` and `FileWriteResult` to type its bridge, and `src/preload/api.ts`
 * is itself imported (for types) by `src/renderer/App.tsx` -- which is
 * typechecked under `tsconfig.web.json`, a config with NO `node` types at
 * all, because the browser build (`vite.web.config.ts`) genuinely runs
 * without them. `content.ts` and `ipc.ts` beside this file need `node:crypto`,
 * `node:path` and `Buffer` for the LOGIC that produces these shapes; if
 * their type declarations lived in either of those files, a type-only import
 * of one export would still force `tsc` to load and check the WHOLE module
 * transitively -- including its `node:*` specifiers -- and `typecheck:web`
 * would fail on a file it was never meant to compile. Splitting the pure data
 * out is what lets `content.ts`/`ipc.ts` depend on Node while this file, and
 * everything that imports only from it, does not.
 */

/**
 * A file's disk state, precise enough to answer "did this change under you"
 * without a caller falling back to trusting mtime alone. Never carries file
 * CONTENT -- only a hash of it -- see `content.ts`'s own header for the full
 * argument for why size+mtime+hash together, and `ipc.ts`'s header for why
 * that argument extends to `.env` and everything else this channel can open.
 */
export type FileSignature = {
  readonly size: number;
  readonly mtimeMs: number;
  /** SHA-256 of the file's full bytes at read/write time, hex-encoded. */
  readonly sha256: string;
};

/** What `CHANNELS.filesRead` answers with, on success. See `ipc.ts`. */
export type FileReadResult = {
  /** `''` when `isBinary` -- never a garbled decode of bytes that are not text. */
  readonly content: string;
  readonly isBinary: boolean;
  readonly signature: FileSignature;
};

/** What `CHANNELS.filesWrite` answers with, on success. See `ipc.ts`. */
export type FileWriteResult = {
  /** The signature immediately after this write -- the next edit's baseline. */
  readonly signature: FileSignature;
};

/**
 * What `CHANNELS.filesList` answers with, on success. See `list.ts` and
 * `list-ipc.ts`. `files` carries only PATHS -- no content, no per-entry
 * signature -- for the same reason `FileReadResult.content` is `''` for a
 * binary file: this shape is what the renderer draws a list from, and a list
 * row is a place to click, not a place file content ever needs to reach.
 */
export type FileListResult = {
  /** The (already `realpath`-resolved) directory this listing is rooted at. */
  readonly root: string;
  /** Every regular file found under `root`, as absolute paths, sorted. */
  readonly files: readonly string[];
  /** `true` once the walk's own cap was reached and it stopped early. */
  readonly truncated: boolean;
};

/**
 * What `CHANNELS.filesResolve` answers with, on success: one absolute path and
 * the line the agent pointed at. See `resolve-ipc.ts`.
 *
 * The path is the `realpath`-resolved one -- what an `open` would actually
 * touch -- so the Files tab keys its buffer by the same string every other
 * files channel uses, rather than by whatever the agent typed.
 */
export type FileRefTarget = {
  readonly path: string;
  /** 1-based, as every editor counts. See `src/shared/file-ref.ts`. */
  readonly line: number;
};
