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
import { editorFileKind } from '../../src/renderer/panels/files-editor-text.js';
import { formatFile } from '../../src/renderer/panels/files-format.js';
import {
  EDITOR_LANGS,
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
  it('takes JSON, the .env family, .ini and markdown', () => {
    expect(highlightLangFor('/w/tsconfig.json')).toBe('json');
    expect(highlightLangFor('/w/.env')).toBe('env');
    expect(highlightLangFor('/w/.env.local')).toBe('env');
    expect(highlightLangFor('/w/.env.production')).toBe('env');
    expect(highlightLangFor('/w/dev.env')).toBe('env');
    expect(highlightLangFor('/w/app.ini')).toBe('ini');
    expect(highlightLangFor('/w/README.md')).toBe('md');
    expect(highlightLangFor('/w/NOTES.MARKDOWN')).toBe('md');
  });

  /**
   * MARKDOWN IS THE HIGHLIGHTER'S LIST AND NOT THE FORMATTER'S, and the two
   * are allowed to differ — `files-editor-text.ts`'s own header says so, and
   * this is the first time they actually do. `editorFileKind` still answers
   * `null` for a `.md`, which is what keeps `formatFile` on its refusal path:
   * a markdown file routed into `formatIni` would have had its blank lines
   * and its `#` lines rewritten by a `.env` formatter.
   */
  it('still tells the FORMATTER nothing about a .md — only the highlighter knows', () => {
    expect(editorFileKind('/w/README.md')).toBeNull();
    expect(formatFile('/w/README.md', '# title\n\n\ntext\n', 2)).toEqual({
      kind: 'refused',
      message: expect.stringContaining('.md'),
    });
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
   *
   * `.md` USED TO BE ON THIS LIST and is not any more. What changed is the
   * SCOPE of the claim, not the rule: the scanner added colours markdown's
   * LINE STRUCTURE only — headings, list markers, quote rails, fence rails —
   * and colours no fenced CONTENT and no inline span at all, which is exactly
   * the half the old exclusion said could not be done honestly. See
   * `files-highlight.ts`'s own header, and the `deliberately does not colour`
   * block below, which is the list of what it still declines.
   */
  it('refuses the file types a scanner this size would lie about', () => {
    for (const path of [
      '/w/src/index.ts',
      '/w/src/App.tsx',
      '/w/a.js',
      '/w/run.sh',
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

/**
 * MARKDOWN, AND THE BOUNDARY THE SCANNER DRAWS AROUND ITSELF.
 *
 * Everything asserted here is a LINE-LEVEL fact — a fact about characters at
 * the head of a line, which no construct in markdown can make mean something
 * else three lines further down. The one piece of state the scanner carries
 * is whether a fence is open, and an unclosed fence running to the end of the
 * file is what CommonMark itself says an unclosed fence does, so the worst
 * case is the renderer's own reading rather than a drift.
 */
describe('markdown — the line structure, and only the line structure', () => {
  it('colours an ATX heading whole, at every legal depth', () => {
    expect(shape('# title\n', 'md')).toEqual(['keyword:# title', 'plain:\n']);
    expect(shape('###### deep\n', 'md')).toEqual(['keyword:###### deep', 'plain:\n']);
    // Up to three spaces of indent is still a heading (CommonMark); a fourth
    // makes it an indented code block, which this scanner leaves plain.
    expect(shape('   # title\n', 'md')).toEqual(['keyword:   # title', 'plain:\n']);
    expect(shape('    # not a heading\n', 'md')).toEqual(['plain:    # not a heading\n']);
  });

  it('does NOT read a #hashtag or a seventh hash as a heading', () => {
    // CommonMark needs a space (or the end of the line) after the run of
    // hashes, and stops at six. Both of these are ordinary prose, and a
    // scanner that painted them would be asserting a structure the renderer
    // beside it does not produce.
    expect(shape('#hashtag is prose\n', 'md')).toEqual(['plain:#hashtag is prose\n']);
    expect(shape('####### seven\n', 'md')).toEqual(['plain:####### seven\n']);
    // A bare `#` with nothing after it IS an empty heading.
    expect(shape('#\n', 'md')).toEqual(['keyword:#', 'plain:\n']);
  });

  it('colours a list marker and leaves the item’s own words alone', () => {
    expect(shape('- one\n', 'md')).toEqual(['number:-', 'plain: one\n']);
    expect(shape('* one\n', 'md')).toEqual(['number:*', 'plain: one\n']);
    expect(shape('1. one\n', 'md')).toEqual(['number:1.', 'plain: one\n']);
    expect(shape('  2) nested\n', 'md')).toEqual(['plain:  ', 'number:2)', 'plain: nested\n']);
  });

  it('does not read *emphasis* at the head of a line as a bullet', () => {
    // A list marker needs whitespace after it. Without this the first word of
    // every emphasised line would be painted as a list.
    expect(shape('*emphasis* here\n', 'md')).toEqual(['plain:*emphasis* here\n']);
    expect(shape('-dash-joined\n', 'md')).toEqual(['plain:-dash-joined\n']);
  });

  it('colours a blockquote’s rail and not the words it carries', () => {
    expect(shape('> quoted\n', 'md')).toEqual(['comment:> ', 'plain:quoted\n']);
    expect(shape('>> deeper\n', 'md')).toEqual(['comment:>> ', 'plain:deeper\n']);
    expect(shape('  > indented\n', 'md')).toEqual(['plain:  ', 'comment:> ', 'plain:indented\n']);
  });

  it('colours a thematic break, in all three of its spellings', () => {
    expect(shape('---\n', 'md')).toEqual(['comment:---', 'plain:\n']);
    expect(shape('***\n', 'md')).toEqual(['comment:***', 'plain:\n']);
    expect(shape('___\n', 'md')).toEqual(['comment:___', 'plain:\n']);
    expect(shape('- - -\n', 'md')).toEqual(['comment:- - -', 'plain:\n']);
    // Two is not a break; it is a list item whose content is a dash.
    expect(shape('--\n', 'md')).toEqual(['plain:--\n']);
  });

  /**
   * THE FENCE, AND THE HALF OF IT THAT IS THE WHOLE POINT.
   *
   * The rails are coloured and the CONTENT IS NOT — colouring the content is
   * the thing the old exclusion refused, because it means knowing the fence's
   * language, which is the `.ts`/`.sh` scanners this file still declines. What
   * the scanner buys by tracking the fence is the opposite of colour: it is
   * what stops a `# comment` line inside a shell block from being painted as
   * a markdown heading.
   */
  it('colours the fence rails, never a byte of what is between them', () => {
    expect(shape('```sh\n# a shell comment\n```\n', 'md')).toEqual([
      'comment:```sh',
      'plain:\n# a shell comment\n',
      'comment:```',
      'plain:\n',
    ]);
  });

  it('suppresses every other rule while a fence is open', () => {
    // Each of these lines would be coloured outside a fence. Inside one they
    // are code, and code is what the scanner declines to read.
    expect(shape('~~~\n# h\n- list\n> quote\n---\n~~~\n', 'md')).toEqual([
      'comment:~~~',
      'plain:\n# h\n- list\n> quote\n---\n',
      'comment:~~~',
      'plain:\n',
    ]);
  });

  it('shuts a fence only on its own character, at its own length or longer', () => {
    // A `~~~` does not shut a ``` fence, and a shorter run does not shut a
    // longer one — both are CommonMark, and both are what stops one stray
    // line from ending a block early.
    expect(shape('````\n~~~\n```\n````\n', 'md')).toEqual([
      'comment:````',
      'plain:\n~~~\n```\n',
      'comment:````',
      'plain:\n',
    ]);
  });

  it('lets an unclosed fence run to the end, exactly as a renderer does', () => {
    expect(shape('```\n# not a heading\n', 'md')).toEqual([
      'comment:```',
      'plain:\n# not a heading\n',
    ]);
  });

  it('does not read a backtick-carrying info string as a fence', () => {
    // CommonMark: a backtick fence's info string may not contain a backtick,
    // because `` `x` `` on its own line is a code SPAN, not a block.
    expect(shape('``code`` span\n', 'md')).toEqual(['plain:``code`` span\n']);
  });

  /**
   * WHAT IT DELIBERATELY DOES NOT COLOUR, asserted rather than described, so
   * that adding any of it later is a decision somebody has to take here.
   *
   * Every one of these is INLINE — its meaning is decided by characters in
   * the middle of a line, which is precisely what a line scanner cannot see,
   * and precisely what `FilesTab.tsx`'s governing rule says not to guess at.
   */
  it('colours no inline span: emphasis, links, images, code spans, autolinks', () => {
    for (const line of [
      '**bold** and *italic* and ~~struck~~\n',
      'a [link](https://example.test) in prose\n',
      'an ![image](./a.png) in prose\n',
      'an `inline code span` in prose\n',
      'an <https://example.test> autolink\n',
      'a | table | row |\n',
      '<div class="html">block</div>\n',
    ]) {
      expect(shape(line, 'md'), line).toEqual([`plain:${line}`]);
    }
  });

  /**
   * AND THE ONE PLACE IT IS KNOWINGLY WRONG, written down rather than left to
   * be discovered.
   *
   * An INDENTED code block (four spaces, no fence) is indistinguishable from
   * the continuation of a list item without a block parser, so the scanner
   * does not try: a `- x` four spaces in is painted as a list marker whether
   * it is a nested item or a line of code. That is a ONE-LINE mis-colour that
   * ends at the newline — which is the whole difference from the `.ts` regex
   * literal this module still refuses, where one valid line miscolours every
   * line after it to the end of the file.
   */
  it('cannot tell a nested list item from an indented code block, and is bounded when wrong', () => {
    expect(shape('    - could be either\nplain after\n', 'md')).toEqual([
      'plain:    ',
      'number:-',
      'plain: could be either\nplain after\n',
    ]);
  });
});

/**
 * THE SWEEP, AND THE ONE THING THAT MAKES IT A SWEEP RATHER THAN A LIST.
 *
 * The languages are read from `EDITOR_LANGS` — the module's own list — and
 * never spelled here. A fourth language added to `files-highlight.ts` without
 * a thought for losslessness is then swept by this file automatically, which
 * is the opposite of what a hardcoded `['json', 'env', 'ini']` bought: markdown
 * was added to that module and every check below would have gone on passing,
 * green, having examined three languages out of four.
 *
 * The corpus is one list for all of them on purpose. Markdown's garbage is
 * `.env`'s garbage and vice versa: the property under test is that NOTHING a
 * scanner is handed can make it drop or invent a byte, and the inputs most
 * likely to do that are the ones written for a different format.
 */
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
    // ── and markdown's own worst inputs ─────────────────────────────────
    '# title\n\n- one\n- two\n\n> quoted\n\n---\n',
    '```\nunclosed fence runs to the end\n',
    '```ts\nconst a = "x";\n```\n~~~\nsecond block\n~~~\n',
    '````\n```\nstill inside\n````\n',
    '#\n##\n###\n####\n#####\n######\n#######\n',
    '   # indented heading\n    # indented code\n',
    '>>> \n> \n>\n',
    '- \n* \n+ \n1. \n99) \n',
    '*emphasis* **strong** `code` [l](u) ![i](u)\n',
    '\t- tabbed\n\t\tdeeper\n',
    '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
    '---\ntitle: front matter\n---\n\nbody\n',
    '```\n',
    '~~~~~~~~~~\n',
    '中文 # 标题\n# 中文标题\n',
  ];

  it('swept a real corpus, in every language the module declares', () => {
    // Four guards in this repo have gone green having examined nothing.
    expect(CORPUS.length).toBeGreaterThan(30);
    expect(CORPUS.some((source) => source.includes('\n'))).toBe(true);
    expect(CORPUS.some((source) => source.includes('```'))).toBe(true);
    // The list the two checks below iterate. If a language is added to the
    // module and this number is not, that is a deliberate act rather than an
    // oversight — which is the whole difference this assertion buys.
    expect([...EDITOR_LANGS]).toEqual(['json', 'env', 'ini', 'md']);
  });

  it('reproduces the input byte for byte, in every language, for every input', () => {
    for (const lang of EDITOR_LANGS) {
      for (const source of CORPUS) {
        expect(rejoined(source, lang), `${lang}: ${JSON.stringify(source)}`).toBe(source);
      }
    }
  });

  it('emits no empty token — an empty span is a DOM node that draws nothing', () => {
    for (const lang of EDITOR_LANGS) {
      for (const source of CORPUS) {
        for (const token of highlightEditor(source, lang)) {
          expect(token.text.length, `${lang}: ${JSON.stringify(source)}`).toBeGreaterThan(0);
        }
      }
    }
  });

  /**
   * AND THE SAME PROPERTY OVER GENERATED GARBAGE, because a hand-written
   * corpus only contains the cases its author thought of. The alphabet is
   * every character that means something to one of the four scanners, so the
   * strings it produces are exactly the ones most likely to leave a scanner
   * mid-construct at a line break.
   */
  it('holds losslessness over random noise built from every scanner’s own metacharacters', () => {
    const ALPHABET = [...'#`~-*_>[]{}"\'=;:,.|\\/ \t\n01aZé中'];
    // A fixed seed: a guard that fails only on some runs is a guard that gets
    // deleted. `mulberry32`-shaped, spelled inline rather than imported.
    let seed = 0x9e3779b9;
    const next = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let checked = 0;
    for (let i = 0; i < 400; i += 1) {
      const length = 1 + Math.floor(next() * 60);
      let source = '';
      for (let j = 0; j < length; j += 1) {
        source += ALPHABET[Math.floor(next() * ALPHABET.length)];
      }
      for (const lang of EDITOR_LANGS) {
        expect(rejoined(source, lang), `${lang}: ${JSON.stringify(source)}`).toBe(source);
        checked += 1;
      }
    }
    // The assertion inside the loop expression: a generator that produced
    // nothing would otherwise pass this test in silence.
    expect(checked).toBe(400 * EDITOR_LANGS.length);
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
