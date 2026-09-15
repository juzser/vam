/**
 * THE EDITOR'S HIGHLIGHTER, AND THE ONE PROPERTY THE OVERLAY CANNOT SURVIVE
 * WITHOUT.
 *
 * `FilesTab.tsx` draws the colours on a `<pre>` layer BEHIND a transparent
 * textarea, which means the two layers hold the same characters twice. If the
 * tokenizer ever drops, adds or reorders a single byte, the text the operator
 * sees stops being the text they are editing — every line after the
 * difference is painted in the wrong place and the caret lands somewhere the
 * glyphs are not. So losslessness is not a nicety here, it is the load-bearing
 * invariant, and it is swept over every kind of input including deliberate
 * garbage.
 *
 * The second rule is the one `FilesTab.tsx`'s own header already stated before
 * there was any colour at all: "a highlighter that mis-tokenises unfamiliar
 * syntax is a worse lie than drawing none". So the languages here are only the
 * ones a scanner this size cannot be wrong about on VALID input, and every
 * other file renders as plain text.
 */

import { describe, expect, it } from 'vitest';
import {
  type EditorLang,
  highlightEditor,
  highlightLangFor,
} from '../../src/renderer/panels/files-highlight.js';

/** The `kind` of each token, paired with its text. */
const shape = (content: string, lang: EditorLang) =>
  highlightEditor(content, lang).map((token) => `${token.kind}:${token.text}`);

/** Every token's text, re-joined. This must be the input, byte for byte. */
const rejoined = (content: string, lang: EditorLang) =>
  highlightEditor(content, lang)
    .map((token) => token.text)
    .join('');

describe('which files vam is willing to colour', () => {
  it('takes JSON, the .env family and .ini', () => {
    expect(highlightLangFor('/w/tsconfig.json')).toBe('json');
    expect(highlightLangFor('/w/.env')).toBe('env');
    expect(highlightLangFor('/w/.env.local')).toBe('env');
    expect(highlightLangFor('/w/.env.production')).toBe('env');
    expect(highlightLangFor('/w/dev.env')).toBe('env');
    expect(highlightLangFor('/w/app.ini')).toBe('ini');
  });

  /**
   * THE REFUSALS, AND THEY ARE NOT AN OVERSIGHT.
   *
   * `highlight.ts` has a `ts` grammar and a `shell` one, both shipped, both
   * tested, both drawing agent code in the transcript today. Neither is used
   * HERE, and each is left out for a construct that is VALID in its language
   * and defeats a scanner this size:
   *
   *   * `.ts`/`.js`: a regex literal. `/["']/` is ordinary TypeScript, and a
   *     scanner with no expression context reads that `"` as opening a string
   *     that then runs to the next quote — miscolouring the rest of the file
   *     from a line that is perfectly correct.
   *   * `.sh`: a heredoc. `<<EOF ... don't ... EOF` is an ordinary script, and
   *     the apostrophe inside it opens a string the same way.
   *   * `.md`: markdown's meaning is INLINE — emphasis, links, code spans —
   *     and a line-level scanner colours none of it. What is left that a line
   *     scanner CAN see is a fenced block, which can only be coloured by
   *     knowing its language, which is the two scanners above.
   *
   * A fence in the transcript is a handful of agent-written lines; a file in
   * an editor is the operator's own, open for as long as they are working.
   */
  it('refuses the file types a scanner this size would lie about', () => {
    for (const path of [
      '/w/src/index.ts',
      '/w/src/App.tsx',
      '/w/a.js',
      '/w/run.sh',
      '/w/README.md',
      '/w/a.yaml',
      '/w/a.toml',
      '/w/Makefile',
      '/w/a.jsonc',
      '/w/a.json5',
    ]) {
      expect(highlightLangFor(path), path).toBeNull();
    }
  });
});

describe('losslessness — the overlay holds the same bytes as the textarea', () => {
  const CORPUS: readonly string[] = [
    '',
    '\n',
    '\n\n\n',
    'A=1\n',
    'A=1',
    '# just a comment',
    '#\n#\n#',
    'A="quoted"\nB=\'single\'\nC=bare\n',
    'A=\nB=   \n',
    'export A=1\n',
    '[section]\nkey = value\n; note\n',
    '{"a":1,"b":[2,3],"c":null}',
    '{"broken": ',
    '{"unterminated": "string',
    'not json at all, not env either',
    'A=1\tB=2',
    'KEY=value with spaces and = signs = everywhere',
    'MULTI="line one\nline two"\n',
    'é中文=1\n',
    'A=1\n\n\n# c   \n\n[x]\ny=z',
    '   \n  A = 1  \n',
    '="no key"\n',
    'A==2\n',
  ];

  it('swept a real corpus', () => {
    // Four guards in this repo have gone green having examined nothing.
    expect(CORPUS.length).toBeGreaterThan(20);
    expect(CORPUS.some((source) => source.includes('\n'))).toBe(true);
  });

  it('reproduces the input byte for byte, in every language, for every input', () => {
    for (const lang of ['json', 'env', 'ini'] as const) {
      for (const source of CORPUS) {
        expect(rejoined(source, lang), `${lang}: ${JSON.stringify(source)}`).toBe(source);
      }
    }
  });

  it('emits no empty token — an empty span is a DOM node that draws nothing', () => {
    for (const lang of ['json', 'env', 'ini'] as const) {
      for (const source of CORPUS) {
        for (const token of highlightEditor(source, lang)) {
          expect(token.text.length, `${lang}: ${JSON.stringify(source)}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('.env — what it colours, and the one thing it deliberately does not', () => {
  it('colours a comment line whole', () => {
    expect(shape('# the api key\n', 'env')).toEqual(['comment:# the api key', 'plain:\n']);
  });

  it('colours the name of a variable, and leaves its value plain', () => {
    expect(shape('API_URL=http://x\n', 'env')).toEqual(['keyword:API_URL', 'plain:=http://x\n']);
  });

  it('colours a fully quoted value as a string, both quote characters', () => {
    expect(shape('A="one"\n', 'env')).toEqual(['keyword:A', 'plain:=', 'string:"one"', 'plain:\n']);
    expect(shape("A='one'\n", 'env')).toEqual(['keyword:A', 'plain:=', "string:'one'", 'plain:\n']);
  });

  it('keeps `export` — the prefix a sourced .env really carries — as a keyword', () => {
    expect(shape('export A=1\n', 'env')).toEqual([
      'keyword:export',
      'plain: ',
      'keyword:A',
      'plain:=1\n',
    ]);
  });

  /**
   * THE DELIBERATE OMISSION, and it is the same disagreement `files-format.ts`
   * refuses to arbitrate: whether `#` after a value opens a comment is a
   * question the readers answer differently. Colouring it grey would tell the
   * operator that half their password is a comment.
   */
  it('does NOT read a `#` after a value as a comment', () => {
    expect(shape('A=1 # not a comment\n', 'env')).toEqual([
      'keyword:A',
      'plain:=1 # not a comment\n',
    ]);
  });

  it('does not invent a section in a .env — `[x]` means nothing there', () => {
    expect(shape('[core]\n', 'env')).toEqual(['plain:[core]\n']);
    expect(shape('[core]\n', 'ini')).toEqual(['keyword:[core]', 'plain:\n']);
  });

  it('leaves a line that is not an assignment entirely alone', () => {
    expect(shape('just some words\n', 'env')).toEqual(['plain:just some words\n']);
    expect(shape('="no name"\n', 'env')).toEqual(['plain:="no name"\n']);
  });

  it('reads `;` as a comment in .ini and as nothing in .env', () => {
    expect(shape('; a note\n', 'ini')).toEqual(['comment:; a note', 'plain:\n']);
    expect(shape('; a note\n', 'env')).toEqual(['plain:; a note\n']);
  });
});

describe('JSON — the tokenizer the transcript already ships', () => {
  it('colours strings, numbers and the three literals', () => {
    expect(shape('{"a":1,"b":true,"c":null}', 'json')).toEqual([
      'plain:{',
      'string:"a"',
      'plain::',
      'number:1',
      'plain:,',
      'string:"b"',
      'plain::',
      'keyword:true',
      'plain:,',
      'string:"c"',
      'plain::',
      'keyword:null',
      'plain:}',
    ]);
  });

  it('keeps an unterminated string a string, rather than reclassifying the typo away', () => {
    expect(shape('{"a": "oops', 'json')).toEqual([
      'plain:{',
      'string:"a"',
      'plain:: ',
      'string:"oops',
    ]);
  });
});
