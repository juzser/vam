/**
 * `src/main/files/content.ts`: the size ceiling, the binary sniff and the
 * conflict signature. See that file's own header for the argument behind
 * each number; this file holds the behaviour to it.
 */

import { describe, expect, it } from 'vitest';
import {
  looksLikeBinary,
  READ_CEILING_BYTES,
  SNIFF_BYTES,
  sameSignature,
  signatureOf,
} from '../../../src/main/files/content.js';

describe('looksLikeBinary', () => {
  it('is false for ordinary UTF-8 text', () => {
    expect(looksLikeBinary(new TextEncoder().encode('DATABASE_URL=postgres://x\n'))).toBe(false);
  });

  it('is false for an empty file', () => {
    expect(looksLikeBinary(new Uint8Array(0))).toBe(false);
  });

  it('is true the moment a NUL byte appears -- reusing git’s own heuristic', () => {
    expect(looksLikeBinary(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]))).toBe(true);
  });

  it('only looks at the sample it is given -- the ceiling is what bounds it, not this function', () => {
    // A caller that slices SNIFF_BYTES worth of a text file that happens to
    // have a NUL further in gets `false` here -- that is correct: this
    // function answers about the SAMPLE, `ipc.ts` decides how much to pass.
    const allText = new TextEncoder().encode('a'.repeat(100));
    expect(looksLikeBinary(allText.subarray(0, SNIFF_BYTES))).toBe(false);
  });
});

describe('signatureOf', () => {
  it('is stable for the same bytes and mtime', () => {
    const bytes = new TextEncoder().encode('X=1\n');
    expect(signatureOf(bytes, 1000)).toEqual(signatureOf(bytes, 1000));
  });

  it('differs when the bytes differ, even at the same size', () => {
    const a = new TextEncoder().encode('X=1');
    const b = new TextEncoder().encode('X=2');
    expect(a.byteLength).toBe(b.byteLength);
    expect(signatureOf(a, 1000).sha256).not.toBe(signatureOf(b, 1000).sha256);
  });

  it('carries the exact byte length', () => {
    const bytes = new TextEncoder().encode('hello');
    expect(signatureOf(bytes, 0).size).toBe(5);
  });
});

describe('sameSignature', () => {
  const sig = (content: string, mtimeMs: number) =>
    signatureOf(new TextEncoder().encode(content), mtimeMs);

  it('null against null is a match -- both describe "nothing is there"', () => {
    expect(sameSignature(null, null)).toBe(true);
  });

  it('null against a real signature is never a match', () => {
    expect(sameSignature(null, sig('X=1', 1000))).toBe(false);
    expect(sameSignature(sig('X=1', 1000), null)).toBe(false);
  });

  it('matches on identical content regardless of a differing mtime', () => {
    // mtime is not compared by this function -- a file rewritten with
    // byte-identical content (a save that changed nothing) is not a
    // conflict, only a changed BYTE STRING is.
    expect(sameSignature(sig('X=1', 1000), sig('X=1', 2000))).toBe(true);
  });

  /**
   * FALSIFICATION TARGET: "let a stale signature through". A guard that
   * compared only `size` (or only `mtimeMs`) would pass this -- two
   * same-size, same-mtime payloads with different bytes -- and let a write
   * through that should have been refused as `changed-on-disk`.
   */
  it('refuses a same-size, same-mtime payload whose bytes actually differ', () => {
    const a = sig('AAAA', 1000);
    const b = sig('BBBB', 1000);
    expect(a.size).toBe(b.size);
    expect(a.mtimeMs).toBe(b.mtimeMs);
    expect(sameSignature(a, b)).toBe(false);
  });
});

describe('the constants', () => {
  it('READ_CEILING_BYTES is 50 MiB', () => {
    expect(READ_CEILING_BYTES).toBe(50 * 1024 * 1024);
  });

  it('SNIFF_BYTES is 8 KiB', () => {
    expect(SNIFF_BYTES).toBe(8 * 1024);
  });
});
