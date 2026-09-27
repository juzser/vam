/**
 * Streaming, line-at-a-time reads for the Stats scan's full-file pass.
 *
 * WHY NOT `tail.ts`'s BOUNDED WINDOW. That module reads a fixed-size window
 * from the END of a file backwards, because the canvas only ever needs the
 * newest few turns of a transcript that may be 157 MB. This scan needs the
 * OPPOSITE: everything, forwards, from a byte offset the incremental cache
 * names. Reusing a backwards, bounded reader for a full forwards pass would
 * be the wrong tool wearing the right module's name.
 *
 * WHY STREAMED RATHER THAN READ WHOLE. The first scan of that same 157 MB
 * file has no cached offset to resume from, so it reads from byte 0 — and a
 * single `readFile` there would hold the whole file as one JS string (roughly
 * double its byte size once decoded to UTF-16) for the length of one scan.
 * This reads in bounded chunks instead (`highWaterMark`, default 1 MiB) and
 * hands each COMPLETE line to the caller as it is found, so memory stays
 * proportional to one chunk plus the longest single line — not to the file.
 *
 * A TRAILING LINE WITH NO NEWLINE IS NEVER CONSUMED. The file being scanned
 * is the same live, append-only JSONL every other reader in this tree
 * tolerates a partial last line from — `parseTranscriptLines`'s own header
 * says why. `bytesConsumed` only ever counts bytes up to and including the
 * last `\n` this read found, so the incremental cache's next scan resumes
 * exactly where a complete line ended, never mid-line.
 */

import { createReadStream } from 'node:fs';

export type LineStreamResult = {
  /** Bytes consumed from `fromByte`, counting only whole lines (each
   *  including its trailing `\n`) — the amount `incremental-cache.ts`'s
   *  cache entry should advance its `offset` by. */
  readonly bytesConsumed: number;
};

export type ReadLinesOptions = {
  readonly highWaterMark?: number;
};

/**
 * Reads `path` from `fromByte` to EOF, calling `onLine` once per complete
 * line (the trailing `\n` stripped, exactly like `String#split('\n')`
 * everywhere else in this tree). Rejects on a real stream error (including
 * ENOENT) — a low-level primitive; `scan.ts` decides what a file that
 * vanished between `readdir` and this read means for the scan as a whole.
 */
export function readLinesFrom(
  path: string,
  fromByte: number,
  onLine: (line: string) => void,
  options: ReadLinesOptions = {},
): Promise<LineStreamResult> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(path, {
      start: fromByte,
      encoding: 'utf8',
      highWaterMark: options.highWaterMark ?? 1024 * 1024,
    });
    // `encoding: 'utf8'` on the stream itself, not decoded by hand: Node's
    // own `StringDecoder` underneath a stream already holds back an
    // incomplete multi-byte sequence at a chunk boundary until the next
    // chunk completes it, so `pending` below only ever has to worry about a
    // line split across chunks, never a CHARACTER split across them.
    let pending = '';
    let consumed = 0;
    stream.on('data', (chunk: string) => {
      pending += chunk;
      let at = pending.indexOf('\n');
      while (at !== -1) {
        const line = pending.slice(0, at);
        pending = pending.slice(at + 1);
        consumed += Buffer.byteLength(line, 'utf8') + 1;
        onLine(line);
        at = pending.indexOf('\n');
      }
    });
    stream.on('end', () => resolve({ bytesConsumed: consumed }));
    stream.on('error', reject);
  });
}
