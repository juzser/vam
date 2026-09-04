/**
 * The fence tokenizer: pure, dependency-free, and deliberately small.
 *
 * `out` renders what an agent emitted, which is untrusted text. The tokenizer
 * below therefore returns DATA — an array of `{ text, kind }` — and never a
 * string of HTML. That is the property these tests pin: a highlighter that
 * builds markup is a hole in the same wall react-markdown was chosen to hold.
 */

import { describe, expect, it } from 'vitest';
import {
  diffLineKind,
  resolveLang,
  tokenizeCode,
} from '../../src/renderer/panels/highlight.js';

/** Every tokenizer must be lossless: colour may not eat a character. */
function joined(code: string, lang: 'shell' | 'ts' | 'json'): string {
  return tokenizeCode(code, lang)
    .map((t) => t.text)
    .join('');
}

function kindsOf(code: string, lang: 'shell' | 'ts' | 'json'): readonly string[] {
  return tokenizeCode(code, lang)
    .filter((t) => t.kind !== 'plain')
    .map((t) => `${t.kind}:${t.text}`);
}

describe('resolveLang names only what the tokenizer actually handles', () => {
  it('maps the aliases agents actually write', () => {
    expect(resolveLang('bash')).toBe('shell');
    expect(resolveLang('sh')).toBe('shell');
    expect(resolveLang('shell')).toBe('shell');
    expect(resolveLang('ts')).toBe('ts');
    expect(resolveLang('tsx')).toBe('ts');
    expect(resolveLang('js')).toBe('ts');
    expect(resolveLang('json')).toBe('json');
    expect(resolveLang('diff')).toBe('diff');
    expect(resolveLang('patch')).toBe('diff');
  });

  it('refuses a language it cannot tokenize, and a fence with none', () => {
    // Guessing is worse than plain: a wrong colour asserts a structure that
    // is not there. Unstyled is the correct answer for both.
    expect(resolveLang('rust')).toBeNull();
    expect(resolveLang('')).toBeNull();
    expect(resolveLang(null)).toBeNull();
  });
});

describe('shell', () => {
  it('colours a # comment', () => {
    expect(kindsOf('# build it\nls', 'shell')).toEqual(['comment:# build it']);
  });

  it('does not see a comment in a # that is inside a string', () => {
    expect(kindsOf('echo "a # b"', 'shell')).toEqual(['string:"a # b"']);
  });

  it('does not see a comment in a mid-word #', () => {
    // A number after it is fine; a COMMENT is the mistake being pinned.
    expect(kindsOf('git show HEAD#1', 'shell').filter((k) => k.startsWith('comment'))).toEqual([]);
  });

  it('keeps an unterminated string a string, to the end of the input', () => {
    expect(kindsOf('echo "oops', 'shell')).toEqual(['string:"oops']);
    expect(joined('echo "oops', 'shell')).toBe('echo "oops');
  });

  it('colours control-flow keywords and numbers', () => {
    expect(kindsOf('if 42; then', 'shell')).toEqual([
      'keyword:if',
      'number:42',
      'keyword:then',
    ]);
  });
});

describe('typescript', () => {
  it('colours line and block comments, strings, numbers, keywords', () => {
    expect(kindsOf('// note\nconst n = 3;', 'ts')).toEqual([
      'comment:// note',
      'keyword:const',
      'number:3',
    ]);
    expect(kindsOf('/* a */ x', 'ts')).toEqual(['comment:/* a */']);
    expect(kindsOf('const s = `hi`;', 'ts')).toEqual(['keyword:const', 'string:`hi`']);
  });

  it('does not see a comment inside a string', () => {
    expect(kindsOf('const s = "// not";', 'ts')).toEqual(['keyword:const', 'string:"// not"']);
  });

  it('keeps an unterminated block comment a comment', () => {
    expect(kindsOf('/* forever', 'ts')).toEqual(['comment:/* forever']);
    expect(joined('/* forever', 'ts')).toBe('/* forever');
  });
});

describe('json', () => {
  it('colours strings, numbers and literals', () => {
    expect(kindsOf('{"a": 1, "b": true, "c": null}', 'json')).toEqual([
      'string:"a"',
      'number:1',
      'string:"b"',
      'keyword:true',
      'string:"c"',
      'keyword:null',
    ]);
  });

  it('has no line comments', () => {
    expect(kindsOf('{"a": "# 1 // 2"}', 'json')).toEqual(['string:"a"', 'string:"# 1 // 2"']);
  });
});

describe('every tokenizer is lossless and pure', () => {
  const SAMPLES = [
    'echo "x" # y\nif true; then done',
    'const a = 1; // c\n/* b */ let s = "q";',
    '{"k": [1, 2.5, false], "u": "\\" }',
  ] as const;
  const LANGS = ['shell', 'ts', 'json'] as const;

  it('never loses or invents a character', () => {
    for (const lang of LANGS) {
      for (const s of SAMPLES) expect(joined(s, lang)).toBe(s);
    }
  });

  it('returns the same tokens for the same input, and mutates nothing', () => {
    const code = SAMPLES[0];
    const frozen = Object.freeze({ code });
    expect(tokenizeCode(frozen.code, 'shell')).toEqual(tokenizeCode(frozen.code, 'shell'));
    expect(frozen.code).toBe(SAMPLES[0]);
  });

  it('emits token DATA, never a string of markup', () => {
    // The one property that keeps `out` untrusted-safe.
    const toks = tokenizeCode('const x = "<script>alert(1)</script>";', 'ts');
    for (const t of toks) {
      expect(typeof t.text).toBe('string');
      expect(Object.keys(t).sort()).toEqual(['kind', 'text']);
    }
    expect(toks.map((t) => t.text).join('')).toBe('const x = "<script>alert(1)</script>";');
  });

  it('handles the empty fence', () => {
    expect(tokenizeCode('', 'ts')).toEqual([]);
  });
});

describe('diffLineKind', () => {
  it('separates the four kinds a patch is made of', () => {
    expect(diffLineKind('+added')).toBe('add');
    expect(diffLineKind('-removed')).toBe('del');
    expect(diffLineKind('@@ -1,2 +1,3 @@')).toBe('hunk');
    expect(diffLineKind('--- a/x.ts')).toBe('file');
    expect(diffLineKind('+++ b/x.ts')).toBe('file');
    expect(diffLineKind(' context')).toBe('plain');
    expect(diffLineKind('')).toBe('plain');
  });

  it('reads a file header before the +/- line it starts with', () => {
    // `---` is a `-` line by prefix and a file header by meaning.
    expect(diffLineKind('--- a/x')).not.toBe(diffLineKind('-a/x'));
  });
});
