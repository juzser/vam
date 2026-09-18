/**
 * `path:line` -- the artifact agents write constantly, read back out of the
 * prose they wrote it into.
 *
 * WHAT THESE TESTS ARE REALLY ABOUT IS THE FALSE POSITIVES. Turning a real
 * reference into a control is the easy half; the half that decides whether
 * the feature is usable is everything in an answer that LOOKS like one and is
 * not -- a clock time, a `Note:` heading, a port on a URL, a ratio. Every one
 * of those below is a line a model really writes, and a scanner that made a
 * button out of any of them would turn a paragraph into a minefield.
 *
 * NOTHING HERE DECIDES WHETHER A PATH IS SAFE TO OPEN. That is
 * `src/main/files/resolve-ipc.ts`, in main, against the real filesystem --
 * which is why `../../etc/passwd:1` PARSES here rather than being filtered
 * out: a reference vam declines to draw at all is one whose refusal the
 * operator never gets to read.
 */

import { describe, expect, it } from 'vitest';
import { MAX_FILE_REF_LENGTH, parseFileRef, splitFileRefs } from '../../src/shared/file-ref.js';

describe('parseFileRef -- what counts as a reference', () => {
  it('reads the path and the line an agent wrote', () => {
    expect(parseFileRef('src/foo/bar.ts:42')).toEqual({ path: 'src/foo/bar.ts', line: 42 });
  });

  it('accepts an absolute path', () => {
    expect(parseFileRef('/work/atlas/src/index.ts:7')).toEqual({
      path: '/work/atlas/src/index.ts',
      line: 7,
    });
  });

  it('accepts a bare filename that carries an extension', () => {
    expect(parseFileRef('package.json:3')).toEqual({ path: 'package.json', line: 3 });
  });

  it('accepts a dotfile under a directory', () => {
    expect(parseFileRef('config/.env:1')).toEqual({ path: 'config/.env', line: 1 });
  });

  /** `file:line:column` is what ripgrep and every language server print. */
  it('consumes a trailing column and opens the line', () => {
    expect(parseFileRef('src/foo.ts:42:7')).toEqual({ path: 'src/foo.ts', line: 42 });
  });

  it('parses a path that escapes the project, so that main can refuse it out loud', () => {
    expect(parseFileRef('../../etc/passwd:1')).toEqual({ path: '../../etc/passwd', line: 1 });
  });

  it('requires a line -- a bare path is a word, not a reference', () => {
    expect(parseFileRef('src/foo/bar.ts')).toBeNull();
    expect(parseFileRef('package.json')).toBeNull();
  });

  it('refuses line zero and a negative line', () => {
    expect(parseFileRef('src/foo.ts:0')).toBeNull();
    expect(parseFileRef('src/foo.ts:-4')).toBeNull();
  });

  it('refuses a clock time, a ratio and a heading', () => {
    for (const token of ['10:30', '1.5:30', 'Note:42', 'TODO:1', '3/4:2']) {
      expect(parseFileRef(token), token).toBeNull();
    }
  });

  it('refuses anything carrying a scheme', () => {
    for (const token of [
      'https://example.test/a/b.ts:42',
      'file:///work/x.ts:1',
      'javascript:alert(1):1',
    ]) {
      expect(parseFileRef(token), token).toBeNull();
    }
  });

  it('refuses a token with whitespace, a NUL byte, or nothing in it', () => {
    for (const token of ['src/a b.ts:1', 'src/a.ts\0:1', '', ':1', 'src/a.ts:']) {
      expect(parseFileRef(token), token).toBeNull();
    }
  });

  it('refuses anything that is not a string -- the caller is the renderer', () => {
    for (const value of [undefined, null, 42, {}, ['src/a.ts:1']]) {
      expect(parseFileRef(value)).toBeNull();
    }
  });

  it('refuses a reference longer than main will carry', () => {
    expect(parseFileRef(`src/${'a'.repeat(MAX_FILE_REF_LENGTH)}.ts:1`)).toBeNull();
  });
});

describe('splitFileRefs -- finding them inside a sentence', () => {
  it('splits one reference out of a line of prose', () => {
    expect(splitFileRefs('The bug is in src/foo/bar.ts:42 and nowhere else.')).toEqual([
      { kind: 'text', text: 'The bug is in ' },
      {
        kind: 'ref',
        text: 'src/foo/bar.ts:42',
        ref: { path: 'src/foo/bar.ts', line: 42 },
      },
      { kind: 'text', text: ' and nowhere else.' },
    ]);
  });

  it('leaves the sentence full stop behind rather than swallowing it', () => {
    const segments = splitFileRefs('See src/foo.ts:42.');
    expect(segments[1]).toMatchObject({ text: 'src/foo.ts:42' });
    expect(segments[2]).toEqual({ kind: 'text', text: '.' });
  });

  it('finds several, in order', () => {
    const segments = splitFileRefs('src/a.ts:1 then src/b.ts:2');
    expect(segments.filter((s) => s.kind === 'ref').map((s) => s.text)).toEqual([
      'src/a.ts:1',
      'src/b.ts:2',
    ]);
  });

  /**
   * THE ONE A NAIVE SCAN GETS WRONG. `https://host:443/x.ts:9` contains the
   * substring `//host:443` -- which has a slash and a number after a colon --
   * so a scanner anchored on nothing at all makes a file reference out of the
   * middle of a URL.
   */
  it('finds nothing inside a URL', () => {
    for (const text of [
      'see https://example.test:443/src/a.ts:9 for more',
      'ws://localhost:5520/live',
    ]) {
      expect(
        splitFileRefs(text).filter((s) => s.kind === 'ref'),
        text,
      ).toEqual([]);
    }
  });

  it('returns the whole text as one segment when there is nothing to find', () => {
    expect(splitFileRefs('nothing to see here')).toEqual([
      { kind: 'text', text: 'nothing to see here' },
    ]);
  });

  it('returns nothing at all for an empty string', () => {
    expect(splitFileRefs('')).toEqual([]);
  });

  it('keeps every character: the segments rejoin to the original text', () => {
    const text = 'Fix src/a.ts:1, then (src/b.ts:22) — but not 10:30 or https://x.test:8080/y.';
    expect(
      splitFileRefs(text)
        .map((s) => s.text)
        .join(''),
    ).toBe(text);
  });
});
