/**
 * One window of a transcript, and the absolute byte offset it really begins at.
 *
 * A transcript is an append-only JSONL log and vam never reads a whole one
 * (`source.ts`'s budget note). Every read is therefore a byte range, and a byte
 * range that does not begin at 0 begins in the MIDDLE of a line. `readTail`
 * used to leave that fragment in the string and let the JSON parser reject it,
 * which is fine while nothing counts bytes -- and wrong the moment something
 * does, which `transcript.ts` now does to mint a turn id that does not move
 * when the window does.
 *
 * TWO REASONS THE FRAGMENT HAS TO GO, EXPLICITLY:
 *
 *  1. A cut that lands mid-CHARACTER decodes to U+FFFD, whose UTF-8 length is
 *     not the length of the bytes it replaced. Every offset computed after it
 *     would be wrong, by a different amount in every window -- so the ids would
 *     disagree exactly where they most need to agree.
 *  2. "It fails to parse anyway" is only true by luck. A fragment can be valid
 *     JSON on its own, and then half a line would be read as a whole one.
 *
 * So a window is trimmed FORWARD to the first byte after a newline, and it
 * reports the offset of that byte. The one byte before the requested start is
 * read too, and only to answer "was the requested start already a line
 * boundary" -- without it a window that began exactly on a line would throw
 * that whole line away.
 */

import { open, stat } from 'node:fs/promises';

const NEWLINE = 0x0a;

export type TranscriptWindow = {
  /** The window's text, beginning at a whole line. Empty when none begins in it. */
  readonly text: string;
  /**
   * The absolute byte offset `text` begins at. Equal to the window's end when
   * no line begins inside it -- a range entirely inside one long line, which a
   * transcript really can produce: measured, a single tool-result line can
   * exceed 128 KiB on its own.
   */
  readonly start: number;
};

/**
 * The window inside `buffer`, where `buffer` holds the file from byte `probe`.
 *
 * Split out from the file read so the rule above is testable without a
 * filesystem, and so it can be exercised on a Buffer built in a test rather
 * than on the operator's own transcripts.
 */
export function trimToLineStart(
  buffer: Buffer,
  probe: number,
  from: number,
  to: number,
): TranscriptWindow {
  if (from <= 0) {
    return { text: buffer.toString('utf8'), start: 0 };
  }
  // `probe` is one byte before `from`, so index 0 is the byte the caller's
  // range does NOT include. A newline there means `from` already begins a line.
  const first = buffer.indexOf(NEWLINE);
  if (first === -1) {
    return { text: '', start: to };
  }
  return { text: buffer.subarray(first + 1).toString('utf8'), start: probe + first + 1 };
}

/** `trimToLineStart` over an in-memory transcript, for tests and for nothing else. */
export function readWindowOf(bytes: Buffer, from: number, to: number): TranscriptWindow {
  const end = Math.max(0, Math.min(to, bytes.length));
  const start = Math.max(0, Math.min(from, end));
  const probe = start === 0 ? 0 : start - 1;
  return trimToLineStart(bytes.subarray(probe, end), probe, start, end);
}

/**
 * Bytes `[from, to)` of a file, trimmed forward to the first whole line.
 *
 * ONE `read`, of the requested range plus at most one byte. Nothing here scans
 * the file and nothing here holds more than the window, so a 157 MB transcript
 * costs exactly what a 40 KB one costs.
 */
export async function readTranscriptWindow(
  path: string,
  from: number,
  to: number,
): Promise<TranscriptWindow> {
  const end = Math.max(0, to);
  const start = Math.max(0, Math.min(from, end));
  const probe = start === 0 ? 0 : start - 1;
  const length = end - probe;
  if (length <= 0) {
    return { text: '', start: end };
  }
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, probe);
    return trimToLineStart(buffer.subarray(0, bytesRead), probe, start, end);
  } finally {
    await handle.close();
  }
}

/**
 * What a backward read needs from one transcript: how long it is, and any
 * window of it. Injectable for the reason every filesystem read in this
 * directory is -- a test reads an invented transcript, never the operator's.
 */
export type TranscriptSource = {
  size(): Promise<number>;
  read(from: number, to: number): Promise<TranscriptWindow>;
};

export const fileTranscriptSource = (path: string): TranscriptSource => ({
  size: async () => (await stat(path)).size,
  read: (from, to) => readTranscriptWindow(path, from, to),
});
