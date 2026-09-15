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
