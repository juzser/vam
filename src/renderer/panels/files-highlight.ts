/**
 * THE EDITOR'S OWN HIGHLIGHTER -- three formats wide, and that is the design
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
 *   * `.md`: markdown's meaning is INLINE -- emphasis, links, code spans --
 *     and a line scanner sees none of it. What a line scanner CAN see is a
 *     fenced block, and colouring one means knowing its language, which is the
 *     two scanners above. Near-empty or a lie; neither is worth drawing.
 *
 * LOSSLESS, AND NOT AS A NICETY. `FilesTab.tsx` paints these tokens on a
 * `<pre>` layer BEHIND a transparent-text textarea, so the same characters are
 * laid out twice and the operator's caret is in the copy they cannot see. Drop
 * or add a single byte here and every line after it is painted in the wrong
 * place. `test/panels/files-highlight.test.ts` sweeps that property over every
 * kind of input, garbage included, in all three languages.
 */

import { type EditorFileKind, editorFileKind } from './files-editor-text.js';
import { type Token, tokenizeCode } from './highlight.js';

export type { Token } from './highlight.js';

/** The languages the editor draws. The same three kinds the classifier names
 *  -- see `files-editor-text.ts` for why the two lists are allowed to differ
 *  later even though they agree today. */
export type EditorLang = EditorFileKind;

/** Which tokenizer -- if any -- this file gets. Null is "draw it as plain
 *  text", which is what every file vam is not confident about renders as. */
export function highlightLangFor(path: string): EditorLang | null {
  return editorFileKind(path);
}

/** A line's comment opener, by format. `.ini` takes both of the two common
 *  dialects' markers; a `;` line is a comment in the dialects that have it and
 *  is not valid in the ones that do not, so reading it as one cannot be wrong
 *  about a working file. A `.env` has only `#`. */
const COMMENT: Readonly<Record<EditorLang, RegExp | null>> = {
  json: null,
  env: /^\s*#/,
  ini: /^\s*[#;]/,
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

  const lines = content.split('\n');
  for (const [index, line] of lines.entries()) {
    scanLine(line, lang, push);
    // The separator belongs to no token's meaning, and every line but the
    // last one has one. This is the half that makes the whole thing lossless.
    if (index < lines.length - 1) push('\n', 'plain');
  }
  return out;
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
