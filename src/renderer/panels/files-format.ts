/**
 * VAM'S OWN FORMATTER -- and, mostly, vam's own refusals.
 *
 * The operator asked for two things: "style và format lại file cho đẹp", and
 * -- when asked whether to format with the open project's formatter or with
 * one of vam's own -- "tự format theo kiểu của mình". vam formats in its own
 * style. This is that formatter, and the whole of its design is one rule:
 *
 *   A FORMATTER THAT MANGLES A FILE IS WORSE THAN NO FORMATTER AT ALL.
 *
 * Worse, because nothing on screen says so. A reflowed `.env` looks tidier and
 * the operator finds out what it cost when the service does not boot. `.env`
 * is the file this whole tab was built for (`FilesTab.tsx`'s header), and a
 * `.env`'s meaning is in its exact bytes.
 *
 * So this module formats only where it can PROVE it changed nothing that
 * matters, and REFUSES ALOUD, BY NAME, everywhere else. "vam does not format
 * .ts files" is a good answer. Doing nothing in silence is not one, and
 * neither is a best-effort reflow -- which is why `FormatResult` has no fourth
 * case: every call comes back formatted, unchanged, or refused with a
 * sentence, and `FilesTab.tsx` draws all three.
 *
 * WHAT IT FORMATS
 *
 *   * `.json` -- `JSON.parse` then `JSON.stringify` at the operator's indent,
 *     GUARDED by a token comparison (see `jsonShape`) that fails the format if
 *     anything but whitespace moved. That guard is not decoration: the
 *     parse/stringify round-trip is lossless for the VALUE and lossy for the
 *     TEXT in at least five ways that reach real files -- a duplicate key, an
 *     integer-like key (a JS object reorders `"1"` in front of `"b"`), a
 *     64-bit id past 2^53, a re-spelled number (`1.0` -> `1`), and a `\uXXXX`
 *     escape that decodes. Each is refused with both spellings in the message.
 *
 *   * `.env`, `.env.*`, `*.env`, `.ini` -- ONLY the lines no reader reads:
 *     blank lines, and comments. See `formatIni` for the argument, which is
 *     the load-bearing decision in this file.
 *
 * WHAT IT REFUSES, AND WHY EACH ONE IS A DECISION RATHER THAN A GAP
 *
 *   * Every other extension, by name. There is no formatter for `.ts` here
 *     that could be proven correct at this size, so there is none at all.
 *   * `.jsonc`/`.json5`: `JSON.parse` does not read them, and the round-trip
 *     that makes `.json` safe would delete every comment in the file.
 *   * Any file with a CRLF in it. `JSON.stringify` emits LF, and the `.ini`
 *     path splits on LF, so formatting would silently rewrite every line's
 *     ending in the file -- a change to every line, to tidy some whitespace.
 */

import { clampEditorIndent } from '../prefs/editor.js';
import { baseName, type EditorFileKind, editorFileKind, extensionOf } from './files-editor-text.js';
import { tokenizeCode } from './highlight.js';

export type FormatResult =
  /** The formatter ran and something moved. */
  | { readonly kind: 'formatted'; readonly value: string }
  /** The formatter ran and the file was already exactly this. NOT silence:
   *  the caller says so, because "I pressed it and nothing happened" is
   *  indistinguishable from a broken button. */
  | { readonly kind: 'unchanged' }
  /** The formatter declined, in words the caller draws verbatim. */
  | { readonly kind: 'refused'; readonly message: string };

/**
 * What vam will format, said in one place so every refusal can quote it and no
 * refusal can go stale against the list.
 *
 * EXPORTED, because there is a third reader now: the Format button's own
 * tooltip (`FilesTab.tsx`). That button is never disabled -- pressing it on a
 * `.ts` puts the refusal on screen by name -- so what the tooltip owes the
 * operator is the SCOPE, and a hand-typed scope beside a button is exactly the
 * kind of copy that outlives the day the formatter learns a file type.
 */
export const FORMAT_OFFER =
  'vam formats .json (whitespace only), and the blank lines and comments in .env/.ini';

/**
 * Format `content` for `path`, or say why not.
 *
 * `indent` is the operator's own setting (`prefs/editor.ts`) and is clamped
 * here as well as there — this is the last gate before it reaches a file.
 */
export function formatFile(path: string, content: string, indent: number): FormatResult {
  const name = baseName(path);
  const formatter = editorFileKind(path);
  if (formatter === null) return { kind: 'refused', message: declineFor(name) };
  // BEFORE anything else, including the parse: a CRLF file cannot be
  // formatted by either path without rewriting every line in it, and the
  // operator asked for tidier whitespace, not a different file.
  if (content.includes('\r')) {
    return {
      kind: 'refused',
      message: `${name} has Windows line endings (CRLF) — vam left it alone rather than rewrite every line in the file to tidy some whitespace.`,
    };
  }
  const result =
    formatter === 'json' ? formatJson(name, content, indent) : formatIni(content, formatter);
  if (result.kind !== 'formatted') return result;
  return result.value === content ? { kind: 'unchanged' } : result;
}

/** The refusal for a file nothing here formats, naming what it IS. */
function declineFor(name: string): string {
  const ext = extensionOf(name);
  if (ext === '.jsonc' || ext === '.json5') {
    return `vam does not format ${ext} files — JSON.parse does not read them, and the round-trip that makes .json safe would delete every comment in the file. ${FORMAT_OFFER}.`;
  }
  const subject = ext === null ? `files named ${name}` : `${ext} files`;
  return `vam does not format ${subject} — it formats only what it can prove it has not changed. ${FORMAT_OFFER}.`;
}

/* -------------------------------------------------------------------------
 * JSON
 * ---------------------------------------------------------------------- */

function formatJson(name: string, content: string, indent: number): FormatResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (reason) {
    // THE PARSER'S OWN POSITION, not a sentence of vam's about it: V8 says
    // "at position 7 (line 1 column 8)", which is the only part of this
    // refusal that helps anybody fix the file.
    const detail = reason instanceof Error ? reason.message : String(reason);
    return { kind: 'refused', message: `vam could not parse ${name} as JSON — ${detail}` };
  }
  const value = `${JSON.stringify(parsed, null, clampEditorIndent(indent))}\n`;
  const rewrite = firstRewrite(content, value);
  if (rewrite !== null) {
    return {
      kind: 'refused',
      message: `vam left ${name} alone — reformatting it would have changed more than whitespace: ${rewrite}. A JSON file's own bytes are the only thing vam is willing to promise here.`,
    };
  }
  return { kind: 'formatted', value };
}

/**
 * THE GUARD, AND THE WHOLE REASON THE JSON PATH IS SAFE.
 *
 * `parse(format(x))` deep-equalling `parse(x)` is the obvious guard and it is
 * too weak: it is blind to duplicate keys (both sides parse to the same
 * object), to key ORDER (a deep-equal does not compare it, and by the time
 * you can compare it the parse has already reordered the integer-like keys),
 * and — worst — to `{"id":12345678901234567890}`, where both sides parse to
 * the same WRONG number and the file has quietly lost an id.
 *
 * So the comparison is on the TEXT, reduced to its tokens: vam's promise is
 * that the only thing it changed is whitespace OUTSIDE a string. Every one of
 * those five failures is a token that moved, was dropped, or was re-spelled,
 * and each shows up here as a mismatch with both spellings in hand.
 *
 * `tokenizeCode(..., 'json')` is the tokenizer `out`'s fences already use
 * (`highlight.ts`) — lossless by contract, so concatenating its tokens
 * reproduces the input byte for byte. Only its `plain` runs can carry
 * whitespace (a string is its own token, and JSON has no whitespace inside a
 * number or a literal), which is what makes stripping whitespace from those
 * runs alone both sufficient and safe.
 *
 * Returns a sentence naming the first difference, or null when nothing but
 * whitespace moved.
 */
function firstRewrite(before: string, after: string): string | null {
  const a = jsonShape(before);
  const b = jsonShape(after);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const from = a[i];
    const to = b[i];
    if (from === to) continue;
    if (from === undefined) return `it would have added \`${to}\``;
    if (to === undefined) return `it would have dropped \`${from}\``;
    return `it would have rewritten \`${from}\` as \`${to}\``;
  }
  return null;
}

/** Every token of a JSON text except its whitespace, in order. */
function jsonShape(text: string): readonly string[] {
  const out: string[] = [];
  for (const token of tokenizeCode(text, 'json')) {
    // Only a `plain` run can hold whitespace — everything else is a single
    // lexical unit whose bytes are exactly what must not change.
    const piece = token.kind === 'plain' ? token.text.replace(/\s+/g, '') : token.text;
    if (piece !== '') out.push(piece);
  }
  return out;
}

/* -------------------------------------------------------------------------
 * `.env` and `.ini`
 * ---------------------------------------------------------------------- */

/**
 * THE SUBSET THAT IS SAFE, AND THE ARGUMENT FOR WHY IT IS ONLY A SUBSET.
 *
 * The tempting rule is "trim every line's trailing whitespace and collapse the
 * blank runs". The first half of that is not safe, and this is the decision
 * this file exists to record.
 *
 * `A=1   ` and `A="1   "` are not the same value, and what the three trailing
 * spaces in the first one MEAN is a question the readers answer differently: a
 * shell's own word splitting drops them, python-dotenv strips them from an
 * unquoted value, and a reader that takes the remainder of the line verbatim
 * keeps them. vam does not know which program will read this file — the whole
 * reason this tab exists is arbitrary services' config — so it does not get to
 * pick a reader. A trailing space on a line that carries data is data-adjacent
 * and is left exactly as the operator typed it.
 *
 * What is left is provably insignificant to every reader of this format,
 * because no reader reads these lines at all:
 *
 *   * A BLANK LINE (whitespace only) becomes empty. Nothing assigns meaning
 *     to how many spaces a blank line contains.
 *   * A COMMENT loses its TRAILING whitespace. Its leading whitespace stays:
 *     an indented comment is a shape the operator chose, and moving it is not
 *     tidying. (`#` for `.env`; `#` or `;` for `.ini`, which is the union of
 *     the two common ini dialects — a line starting with either is a comment
 *     in the dialects that have it and is not valid in the ones that do not.)
 *   * RUNS OF BLANK LINES collapse to one, and the blanks at the very top and
 *     the very bottom go, leaving exactly one final newline.
 *
 * NOT DONE, and deliberately: an inline `#` after a value is NOT treated as a
 * comment. That is the same disagreement between readers as above, one step
 * to the right, and reading it as a comment here is how a formatter takes the
 * `#` out of a password.
 */
function formatIni(content: string, formatter: EditorFileKind): FormatResult {
  const comment = formatter === 'ini' ? /^\s*[#;]/ : /^\s*#/;
  const normalized = content.split('\n').map((line) => {
    if (line.trim() === '') return '';
    if (comment.test(line)) return line.replace(/[ \t]+$/, '');
    // Everything else carries data. Untouched, byte for byte.
    return line;
  });

  const out: string[] = [];
  for (const line of normalized) {
    // Skip a blank that follows a blank, and any blank before the first real
    // line — which together handle the leading run and every interior run.
    if (line === '' && (out.length === 0 || out[out.length - 1] === '')) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();

  return { kind: 'formatted', value: out.length === 0 ? '' : `${out.join('\n')}\n` };
}
