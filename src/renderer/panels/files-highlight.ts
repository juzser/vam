/**
 * THE EDITOR'S OWN HIGHLIGHTER -- four formats wide, and that is the design
 * rather than the state of it.
 *
 * `FilesTab.tsx` shipped with NO colour at all, on a stated rule: "a
 * highlighter that mis-tokenises unfamiliar syntax is a worse lie than drawing
 * none." The operator has since asked for styling, so vam draws it -- and the
 * rule survives intact, as the list of what is NOT here.
 *
 * WHAT IS HERE
 *   * `.json` -- delegated whole to `highlight.ts`'s `tokenizeCode`, the
 *     tokenizer `out`'s fences have shipped with for releases. JSON has no
 *     construct that defeats a scanner: a string is the only place a delimiter
 *     can hide, and a string is the first thing the scanner takes.
 *   * `.env`/`.env.*`/`*.env` and `.ini` -- a LINE scanner written here,
 *     because the format is a line format: a line is a comment, a section, an
 *     assignment, or nothing, and none of those can straddle a newline.
 *   * `.md`/`.markdown` -- a LINE scanner too, and see the amendment below
 *     for why this file used to say it would never be one.
 *
 * WHAT IS NOT, AND WHY EACH IS A DECISION
 *   * `.ts`/`.js`, though `highlight.ts` HAS a grammar for them and ships it
 *     in the transcript today: a REGEX LITERAL. `/["']/` is ordinary
 *     TypeScript, and a scanner with no expression context reads that `"` as
 *     opening a string that runs to the next quote -- miscolouring the rest of
 *     the file from a line that is perfectly correct. A fence in the
 *     transcript is a few agent-written lines; a file in an editor is the
 *     operator's own and stays open.
 *   * `.sh`, same grammar shelf, same reason one step over: a HEREDOC. The
 *     apostrophe in `don't` inside `<<EOF ... EOF` opens a string, and the
 *     script is valid.
 * ── `.md`: THE EXCLUSION THAT WAS HERE, AND WHY IT IS NOT ─────────────────
 *
 * This file used to carry markdown in the list above, in these words:
 *
 *   ".md: markdown's meaning is INLINE -- emphasis, links, code spans -- and
 *    a line scanner sees none of it. What a line scanner CAN see is a fenced
 *    block, and colouring one means knowing its language, which is the two
 *    scanners above. Near-empty or a lie; neither is worth drawing."
 *
 * Every clause of that is still true, and the conclusion no longer follows.
 * What changed is that the operator asked for markdown specifically, which put
 * a THIRD option on the table the old reasoning never considered: draw the
 * line STRUCTURE, draw nothing else, and say which is which.
 *
 *   * "A line scanner sees no inline meaning" -- correct, and this scanner
 *     colours none of it. Not emphasis, not a link, not an image, not a code
 *     span, not an autolink, not a GFM table's pipes, not raw HTML. Each of
 *     those is asserted as PLAIN in `test/panels/files-highlight.test.ts`
 *     rather than left to drift, so a later hand reaching for one has to
 *     delete a test first.
 *   * "Colouring a fence means knowing its language" -- correct, and this
 *     scanner does not colour a fence's CONTENT at all. What it does with a
 *     fence is the OPPOSITE of colouring it: it TRACKS one, so that a `#` line
 *     inside a shell block is not painted as a markdown heading. The rails
 *     themselves are coloured, and a rail needs no language.
 *   * "Near-empty" -- this is the clause that was wrong, and it was wrong
 *     about markdown rather than about scanners. A markdown file's structure
 *     IS its headings, its lists, its quote rails and its fences, and those
 *     are exactly what an operator scrolls a long README looking for. Every
 *     one of them is decided by the first few characters of a line.
 *
 * AND THE SAFETY ARGUMENT, WHICH IS THE ONE THAT ACTUALLY SEPARATES THIS FROM
 * `.ts`. Those two refusals are not about how MUCH a scanner can see; they are
 * about what happens when it guesses wrong. A regex literal opens a string
 * that runs to the next quote, possibly hundreds of lines away -- one correct
 * line miscolours the whole rest of the file, and nothing on screen says
 * whether the file or the highlighter is at fault. Markdown has no construct
 * this scanner reads that can do that: every rule below is anchored to the
 * head of ONE line and ends at its newline. The single piece of state carried
 * across lines is whether a fence is open, and an unclosed fence running to
 * the end of the file is not a mis-scan -- it is precisely what CommonMark
 * says an unclosed fence does, so the worst case is AGREEMENT with the
 * renderer beside it rather than a drift away from it.
 *
 * WHERE IT IS KNOWINGLY WRONG, written down rather than left to be found. An
 * INDENTED code block (four spaces, no fence) cannot be told from a nested
 * list item's continuation without a block parser, so a `- x` four spaces deep
 * is painted as a list marker either way. That is a ONE-LINE mis-colour
 * bounded by its own newline -- the exact thing the `.ts` case is not -- and
 * it has a test of its own saying so. A setext underline (`===` or `---`
 * beneath a line of text) is read as a thematic break, which is a
 * mis-classification WITHIN markdown's own furniture rather than a claim about
 * content.
 *
 * LOSSLESS, AND NOT AS A NICETY. `FilesTab.tsx` paints these tokens on a
 * `<pre>` layer BEHIND a transparent-text textarea, so the same characters are
 * laid out twice and the operator's caret is in the copy they cannot see. Drop
 * or add a single byte here and every line after it is painted in the wrong
 * place. `test/panels/files-highlight.test.ts` sweeps that property over every
 * kind of input, garbage included, in every language `EDITOR_LANGS` names --
 * it reads that list from here rather than spelling its own, so a fifth
 * language cannot be added without being swept.
 */

import { type EditorFileKind, editorFileKind, isMarkdownPath } from './files-editor-text.js';
import { type Token, tokenizeCode } from './highlight.js';

export type { Token } from './highlight.js';

/** The languages the editor draws: the classifier's three kinds, plus the one
 *  this module has an opinion about and `files-format.ts` does not. See
 *  `files-editor-text.ts`'s `isMarkdownPath` for why that split is the whole
 *  reason the two lists were ever allowed to differ. */
export type EditorLang = EditorFileKind | 'md';

/**
 * Every language, as a VALUE rather than only a type.
 *
 * It exists for the sweep. `test/panels/files-highlight.test.ts` iterates
 * this, so losslessness -- the property the overlay cannot survive without --
 * is asserted over whatever this module declares rather than over whatever a
 * test file was last edited to remember. Markdown was added while that list
 * was hardcoded to three, and every check in it would have gone on passing,
 * green, having examined three languages out of four.
 */
export const EDITOR_LANGS: readonly EditorLang[] = ['json', 'env', 'ini', 'md'];

/** Which tokenizer -- if any -- this file gets. Null is "draw it as plain
 *  text", which is what every file vam is not confident about renders as. */
export function highlightLangFor(path: string): EditorLang | null {
  return isMarkdownPath(path) ? 'md' : editorFileKind(path);
}

/** A line's comment opener, by format. `.ini` takes both of the two common
 *  dialects' markers; a `;` line is a comment in the dialects that have it and
 *  is not valid in the ones that do not, so reading it as one cannot be wrong
 *  about a working file. A `.env` has only `#`. */
const COMMENT: Readonly<Record<EditorLang, RegExp | null>> = {
  json: null,
  env: /^\s*#/,
  ini: /^\s*[#;]/,
  // `#` opens a HEADING in markdown, not a comment, and markdown has no
  // comment syntax of its own at all. Null rather than absent so the record
  // stays total over `EditorLang`: a missing key would compile only by
  // widening this type, and a widened type is how a language comes to be
  // silently unhandled.
  md: null,
};

/**
 * `NAME=` at the head of a line, with `.env`'s own optional `export` prefix.
 *
 * Deliberately anchored and deliberately narrow: a line that is not this shape
 * is not an assignment and is left plain, rather than half-coloured on a
 * guess. The name charset is what every reader of this format accepts for one
 * (`.ini` additionally sees `key = value`, hence the optional spaces).
 */
const ASSIGNMENT = /^([ \t]*)(export[ \t]+)?([A-Za-z_][A-Za-z0-9_.-]*)([ \t]*=)/;

/** A whole line that is nothing but `[section]`. `.ini` only — in a `.env`
 *  that line means nothing at all, and colouring it would assert a structure
 *  the format does not have. */
const SECTION = /^\s*\[[^\]]*\]\s*$/;

/** A value that is ONE fully quoted run and nothing else. Anything less tidy
 *  stays plain: a half-quoted value is the operator mid-keystroke, and a
 *  guessed closing quote would colour the rest of the line. */
const QUOTED = /^(["'])(?:(?!\1).)*\1$/s;

/**
 * `content`, as coloured runs. Concatenating `text` reproduces `content` byte
 * for byte -- see this file's header for why that is load-bearing.
 */
export function highlightEditor(content: string, lang: EditorLang): readonly Token[] {
  if (lang === 'json') return tokenizeCode(content, 'json');

  const out: Token[] = [];
  // Written as a list of pieces rather than by index arithmetic so that the
  // "every byte, once" property is visible in the code: each branch below
  // pushes exactly the slices of the line it was handed.
  const push = (text: string, kind: Token['kind']) => {
    if (text === '') return;
    const last = out[out.length - 1];
    // Merged runs keep the DOM small in a long file: a 2,000-line `.env`
    // otherwise costs one `<span>` per piece per line.
    if (last?.kind === kind) out[out.length - 1] = { text: last.text + text, kind };
    else out.push({ text, kind });
  };

  // THE ONLY STATE THAT CROSSES A LINE BOUNDARY IN THIS WHOLE MODULE, and it
  // is markdown's alone: which fence is open, if any. See this file's header
  // for why that is not the `.ts` hazard wearing a different coat -- an
  // unclosed fence running to the end of the file is what CommonMark says an
  // unclosed fence does, so a "runaway" here agrees with the renderer.
  let fence: OpenFence = null;

  const lines = content.split('\n');
  for (const [index, line] of lines.entries()) {
    if (lang === 'md') fence = scanMarkdownLine(line, fence, push);
    else scanLine(line, lang, push);
    // The separator belongs to no token's meaning, and every line but the
    // last one has one. This is the half that makes the whole thing lossless.
    if (index < lines.length - 1) push('\n', 'plain');
  }
  return out;
}

/* -------------------------------------------------------------------------
 * MARKDOWN -- the line structure, and nothing else. The header carries the
 * argument for why this exists at all and what it declines; these are the
 * rules it declines with.
 *
 * WHICH COLOUR MEANS WHAT, and it is a two-way split rather than five
 * unrelated picks:
 *
 *   `keyword`  A HEADING. The loudest thing in a markdown file and the one an
 *              operator scrolls looking for, so it takes the loudest ink.
 *   `number`   A LIST MARKER. Half of them literally are numbers (`1.`,
 *              `2)`), and putting `-`/`*`/`+` in the same ink keeps a mixed
 *              document reading as one kind of thing rather than two.
 *   `comment`  A RAIL: a fence delimiter, a blockquote's `>`, a thematic
 *              break. Furniture that bounds content without being content --
 *              the quietest ink in the palette, which is exactly the claim.
 *
 * `string` is deliberately unused. Nothing in markdown's LINE structure is a
 * string, and spending the ink on something that is not one would make the
 * editor's four languages disagree about what a colour means.
 * ---------------------------------------------------------------------- */

/** The fence currently open: its character and how long its rail was. */
type OpenFence = { readonly char: '`' | '~'; readonly length: number } | null;

/**
 * An ATX heading: up to three spaces of indent, one to six `#`, then either a
 * space/tab or the end of the line.
 *
 * Both halves of that tail are CommonMark and both earn their keep. Without
 * the space, `#hashtag` at the head of a line of prose would be painted as a
 * heading; without the "or end of line", a bare `#` -- an empty heading, and
 * what the operator has on screen for one keystroke while typing any heading
 * at all -- would not be.
 */
const MD_HEADING = /^ {0,3}#{1,6}(?:[ \t].*)?$/;

/**
 * A thematic break: three or more of `-`, `*` or `_`, optionally spaced, and
 * nothing else on the line.
 *
 * Tested BEFORE the list rule, because `- - -` and `***` are both, and the
 * break is the reading a renderer gives them. This is also what a `---` pair
 * around YAML front matter is painted as, which is the right furniture for
 * the wrong reason and is stated in the header rather than special-cased.
 */
const MD_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/** A blockquote's rail: the whole run of `>` markers, each with at most one
 *  space after it, so `>> deep` is one rail rather than two. */
const MD_QUOTE = /^([ \t]*)((?:>[ \t]?)+)/;

/**
 * A list marker: a bullet or an ordered number, followed by whitespace.
 *
 * THE TRAILING WHITESPACE IS THE WHOLE GUARD. Without it `*emphasis*` at the
 * head of a line reads as a bullet and the first word of every emphasised
 * line is painted as structure -- which is precisely the kind of inline claim
 * this scanner exists not to make. A marker with nothing after it at all is
 * still a marker (an empty list item, and what the operator has while typing
 * the next one), hence the `$` alternative.
 *
 * The indent is UNBOUNDED, unlike the rules above, because a nested item's is
 * -- and that is the one place this scanner is knowingly wrong, since a line
 * four spaces in could equally be an indented code block. See the header.
 */
const MD_LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])(?=[ \t]|$)/;

/** A fence rail: up to three spaces, then three or more backticks or tildes,
 *  then whatever info string the author wrote. */
const MD_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * One markdown line, pushed as runs. Answers the fence state that the NEXT
 * line should be read under, which is the only thing this scanner remembers.
 */
function scanMarkdownLine(
  line: string,
  fence: OpenFence,
  push: (text: string, kind: Token['kind']) => void,
): OpenFence {
  const rail = MD_FENCE.exec(line);
  const railChars = rail?.[1] ?? '';
  const railInfo = rail?.[2] ?? '';
  const railChar = railChars[0] === '~' ? ('~' as const) : ('`' as const);

  if (fence !== null) {
    // INSIDE A FENCE. A closing rail is the same character, at least as long
    // as the opening one, and carries no info string -- all three are
    // CommonMark, and all three are what stops one stray line from ending a
    // block early. Everything else in here is CODE, and code is what this
    // module declines to read: it is pushed plain, byte for byte.
    const closes =
      rail !== null &&
      railChar === fence.char &&
      railChars.length >= fence.length &&
      railInfo.trim() === '';
    if (closes) {
      push(line, 'comment');
      return null;
    }
    push(line, 'plain');
    return fence;
  }

  // An opening rail. A BACKTICK fence's info string may not itself contain a
  // backtick (CommonMark): `` `x` `` alone on a line is a code SPAN, and
  // reading it as a block would swallow every line after it.
  if (rail !== null && !(railChar === '`' && railInfo.includes('`'))) {
    push(line, 'comment');
    return { char: railChar, length: railChars.length };
  }

  if (MD_HEADING.test(line)) {
    // THE WHOLE LINE, not just the hashes. A heading's words are the heading
    // -- they are what the operator is scanning for -- and splitting the ink
    // between the marker and the text would put the quiet half on the part
    // that carries the meaning.
    push(line, 'keyword');
    return null;
  }

  // Before the list rule: `- - -` and `***` are both, and a renderer reads
  // them as the break.
  if (MD_BREAK.test(line)) {
    push(line, 'comment');
    return null;
  }

  const quote = MD_QUOTE.exec(line);
  if (quote !== null) {
    const [whole, lead = '', markers = ''] = quote;
    push(lead, 'plain');
    push(markers, 'comment');
    // THE REST IS LEFT PLAIN, deliberately: a `> # heading` really is a
    // heading inside a quote, and reading it would mean running every rule in
    // this function again at an offset -- one more place for the byte count
    // to go wrong, to colour a construct nobody writes twice in a README.
    push(line.slice(whole.length), 'plain');
    return null;
  }

  const list = MD_LIST.exec(line);
  if (list !== null) {
    const [whole, lead = '', marker = ''] = list;
    push(lead, 'plain');
    push(marker, 'number');
    push(line.slice(whole.length), 'plain');
    return null;
  }

  push(line, 'plain');
  return null;
}

/** One line, pushed as runs. */
function scanLine(
  line: string,
  lang: EditorLang,
  push: (text: string, kind: Token['kind']) => void,
) {
  const comment = COMMENT[lang];
  if (comment?.test(line) === true) {
    push(line, 'comment');
    return;
  }
  if (lang === 'ini' && SECTION.test(line)) {
    push(line, 'keyword');
    return;
  }
  const match = ASSIGNMENT.exec(line);
  if (match === null) {
    push(line, 'plain');
    return;
  }
  const [whole, lead = '', exported, name = '', equals = ''] = match;
  push(lead, 'plain');
  if (exported !== undefined) {
    // `export` is the shell keyword a sourced `.env` really carries, and the
    // one word in this format that IS one.
    push(exported.trimEnd(), 'keyword');
    push(exported.slice(exported.trimEnd().length), 'plain');
  }
  push(name, 'keyword');
  push(equals, 'plain');

  const value = line.slice(whole.length);
  // A fully quoted value is a string. An unquoted one is NOT given a colour of
  // its own, and neither is a `#` inside it: whether that `#` opens a comment
  // is a question this format's readers answer differently (`files-format.ts`
  // refuses to arbitrate the same disagreement), and grey text is how a
  // formatter tells an operator that half their password is a comment.
  push(value, QUOTED.test(value.trim()) && value.trim() === value ? 'string' : 'plain');
}
