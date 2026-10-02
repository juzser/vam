/**
 * EC-44b, operator event #33: no Vietnamese in the UI copy under `src/renderer`
 * and `src/shared`. Comments may say anything; string literals, template text
 * and JSX text may not hold a Vietnamese-only letter or a Vietnamese word that
 * is not also an English one.
 *
 * The scanner is hand-written and deliberately small: it walks the source once,
 * blanking comments (so a quote inside one cannot open a string) and pulling out
 * string and template text. JSX text is read off the blanked code with a regex;
 * that over-reports a little (a `}`..`<` stretch of plain code is a candidate
 * piece too), which costs nothing here because a piece only fails on a
 * Vietnamese letter or word.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Piece = { readonly line: number; readonly text: string };

const VIETNAMESE_LETTER = /[ĂăĐđƠơƯưẠ-ỹ]/iu;
// Words that are Vietnamese without its diacritics and are not English words.
// `them`, `nay` and `dang` stay out: they are English.
const VIETNAMESE_WORD = /\b(?:cho|khong|duoc|chon|xoa|luu)\b/iu;

function isVietnamese(text: string): boolean {
  return VIETNAMESE_LETTER.test(text) || VIETNAMESE_WORD.test(text);
}

/** 1-based line of `index`, by binary search over the line starts. */
function lineFinder(source: string): (index: number) => number {
  const starts = [0];
  for (let k = source.indexOf('\n'); k !== -1; k = source.indexOf('\n', k + 1)) starts.push(k + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] as number) <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** Every string, template text and JSX text piece outside a comment. */
function extractPieces(source: string): Piece[] {
  const pieces: Piece[] = [];
  const lineAt = lineFinder(source);
  // Same length as `source`: comments and string bodies become spaces.
  const code: string[] = [];
  const blank = (ch: string) => (ch === '\n' ? '\n' : ' ');
  // One entry per open template (`t`) or `${` expression (`e`, with brace depth).
  const stack: { kind: 't' | 'e'; depth: number; start: number; text: string }[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    const next = source[i + 1];
    const top = stack[stack.length - 1];
    if (top?.kind === 't') {
      if (ch === '\\') {
        top.text += ch + (next ?? '');
        code.push(' ', blank(next ?? ' '));
        i += 2;
      } else if (ch === '`') {
        pieces.push({ line: lineAt(top.start), text: top.text });
        stack.pop();
        code.push(' ');
        i += 1;
      } else if (ch === '$' && next === '{') {
        top.text += ' ';
        stack.push({ kind: 'e', depth: 0, start: i, text: '' });
        code.push(' ', ' ');
        i += 2;
      } else {
        top.text += ch;
        code.push(blank(ch));
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        code.push(' ');
        i += 1;
      }
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; i < stop; i += 1) code.push(blank(source[i] as string));
    } else if (ch === '`') {
      stack.push({ kind: 't', depth: 0, start: i, text: '' });
      code.push(' ');
      i += 1;
    } else if ((ch === "'" || ch === '"') && !/\w/.test(source[i - 1] ?? ' ')) {
      // An apostrophe right after a letter is JSX text ("provider's"), not a string.
      let j = i + 1;
      let text = '';
      while (j < source.length && source[j] !== ch && source[j] !== '\n') {
        if (source[j] === '\\') {
          text += (source[j] as string) + (source[j + 1] ?? '');
          j += 2;
        } else {
          text += source[j];
          j += 1;
        }
      }
      pieces.push({ line: lineAt(i), text });
      const stop = source[j] === ch ? j + 1 : j;
      for (; i < stop; i += 1) code.push(blank(source[i] as string));
    } else {
      if (top?.kind === 'e') {
        if (ch === '{') top.depth += 1;
        if (ch === '}') {
          if (top.depth === 0) {
            stack.pop();
            code.push(' ');
            i += 1;
            continue;
          }
          top.depth -= 1;
        }
      }
      code.push(ch);
      i += 1;
    }
  }
  const blanked = code.join('');
  for (const match of blanked.matchAll(/[>}]([^<>{}]*[^<>{}\s][^<>{}]*)[<{]/g)) {
    const text = (match[1] as string).trim();
    pieces.push({ line: lineAt((match.index ?? 0) + 1), text });
  }
  return pieces;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function findHits(root: string): string[] {
  return ['src/renderer', 'src/shared'].flatMap((dir) =>
    sourceFiles(join(root, dir)).flatMap((file) =>
      extractPieces(readFileSync(file, 'utf8'))
        .filter((piece) => isVietnamese(piece.text))
        .map((piece) => `${file.slice(root.length + 1)}:${piece.line} '${piece.text}'`),
    ),
  );
}

describe('the Vietnamese matcher', () => {
  it('flags Vietnamese copy', () => {
    for (const text of ['icon cho', 'ICON CHO', 'Icon Cho', 'Chọn icon']) {
      expect(isVietnamese(text), text).toBe(true);
    }
  });

  it('passes English copy', () => {
    for (const text of ['clear icon', 'them', 'café', 'naïve', 'choose']) {
      expect(isVietnamese(text), text).toBe(false);
    }
  });
});

describe('the piece extractor', () => {
  const texts = (source: string) => extractPieces(source).map((piece) => piece.text);

  it('yields nothing for comments', () => {
    expect(texts('// icon cho')).toEqual([]);
    expect(texts('/* chọn */')).toEqual([]);
    expect(texts('const a = <p>{/* cho */}</p>;')).toEqual([]);
  });

  it('does not let a quote inside a block comment swallow the next literal', () => {
    const source = "/* it's `cho` */\nconst a = 'icon cho';";
    const pieces = extractPieces(source);
    expect(pieces).toEqual([{ line: 2, text: 'icon cho' }]);
    expect(pieces.filter((piece) => isVietnamese(piece.text))).toHaveLength(1);
  });

  it('keeps // inside strings and templates', () => {
    expect(texts("const a = 'http://x.test/ icon cho';")).toEqual(['http://x.test/ icon cho']);
    const template = extractPieces('const a = `a // b ${n} cho`;');
    expect(template.map((piece) => piece.text)).toEqual(['a // b   cho']);
    expect(isVietnamese(template[0]?.text ?? '')).toBe(true);
  });

  it('reads JSX text', () => {
    expect(texts('const a = <span>icon cho</span>;')).toContain('icon cho');
  });
});

describe('the UI copy', () => {
  it('holds no Vietnamese', () => {
    expect(findHits(process.cwd())).toEqual([]);
  });
});
