/**
 * The file editor's own text arithmetic -- pure, DOM-free, so it can be
 * proven without a real `<textarea>`. `FilesTab.tsx` is the only caller of the
 * Tab arithmetic; the file classifier at the foot of this file is shared with
 * `files-format.ts` and `files-highlight.ts`, and says there why.
 */

import { indentText } from '../prefs/editor.js';

/** The result of applying (or removing) one indent step. */
export type TabResult = {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
};

/**
 * Tab/Shift+Tab, TRAPPED inside the editor rather than moving focus to the
 * next element -- the browser's native meaning for Tab in ANY text box, and
 * the one meaning that makes no sense in something meant to hold code or a
 * config file's indentation. Safe to trap here specifically (unlike
 * `TerminalTab.tsx`, which leaves Tab alone as ITS only way out) because the
 * editor has two OTHER ways out already: `Escape` and `Mod-[` (see
 * `FilesTab.tsx`).
 *
 * Plain Tab with a selection collapsed to a caret: two spaces inserted at
 * the caret, same as typing any other character would. Plain Tab with a
 * real selection: the selection is REPLACED by the indent, matching what
 * typing any single character over a selection already does in every text
 * box -- Tab is not special-cased into "indent the block" the way an IDE's
 * own smart-indent is, because that needs to know about newlines this
 * function does not read for the plain case, and a config file with one
 * word selected is a far commoner target here than a whole block.
 *
 * A MULTI-LINE selection is the one case that IS special-cased, in both
 * directions: Tab prepends one `INDENT` to the start of every line the
 * selection touches, and Shift+Tab removes up to one `INDENT` worth of
 * leading whitespace from each. This is what lets a pasted block be
 * indented or outdented as a block, which a per-character replace could
 * never do (replacing a multi-line selection with two spaces would delete
 * the block, not indent it).
 */
export function applyTab(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  outdent: boolean,
  indentWidth: number,
): TabResult {
  // A WIDTH, NOT A STRING, and `indentText` is the only way to turn one into
  // characters -- so an indent of tab bytes is not a thing a caller can pass.
  // See `prefs/editor.ts`: the gutter and the text share one line box, and a
  // tab's RENDERED width is the one thing those two columns would answer
  // differently.
  const indent = indentText(indentWidth);
  const spansLines = value.slice(selectionStart, selectionEnd).includes('\n');
  if (!spansLines) {
    if (outdent) {
      // Shift+Tab with no multi-line selection: nothing to remove from a
      // single point, so this is a no-op rather than a guess at what to
      // delete.
      return { value, selectionStart, selectionEnd };
    }
    const next = value.slice(0, selectionStart) + indent + value.slice(selectionEnd);
    const caret = selectionStart + indent.length;
    return { value: next, selectionStart: caret, selectionEnd: caret };
  }

  // Widen to whole lines: a selection starting mid-line still indents that
  // WHOLE line, matching every code editor's own convention.
  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
  const lineEndIndex = value.indexOf('\n', selectionEnd);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;

  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const nextLines = lines.map((line) =>
    outdent ? outdentLine(line, indent.length) : indent + line,
  );
  const nextBlock = nextLines.join('\n');
  const next = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd);
  return {
    value: next,
    selectionStart: lineStart,
    selectionEnd: lineStart + nextBlock.length,
  };
}

/**
 * UP TO one indent step off the front of a line — never more, and never a
 * character that is not a space.
 *
 * "Up to" is what makes an outdent safe on a block whose lines are indented
 * unevenly (a pasted fragment nearly always is): a line with one space loses
 * its one space, a line with none is returned untouched, and no line ever
 * loses a character of its own text.
 */
function outdentLine(line: string, width: number): string {
  let taken = 0;
  while (taken < width && line[taken] === ' ') taken += 1;
  return line.slice(taken);
}

/* -------------------------------------------------------------------------
 * WHAT KIND OF FILE THIS IS -- asked by the formatter and by the highlighter,
 * answered once.
 *
 * ONE CLASSIFIER, TWO DECISIONS. `files-format.ts` and `files-highlight.ts`
 * both have to know that `.env.local` is a `.env` and that `.env` is a NAME
 * rather than an extension, and two copies of that rule is how one of them
 * comes to disagree with the other about the file on screen. What each module
 * DOES with the answer stays its own -- a format is a promise about bytes and
 * a colour is a claim about meaning, and there is no reason the two lists
 * should have to move together.
 * ---------------------------------------------------------------------- */

/** The three kinds the editor has an opinion about. */
export type EditorFileKind = 'json' | 'env' | 'ini';

/** The last path segment — the only part of a path either module reads. */
export function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut === -1 ? path : path.slice(cut + 1);
}

/**
 * The extension, lower-cased, WITH its dot — or null for a name that has
 * none. A LEADING dot does not start an extension: `.env` is a name, and that
 * is the case this tab cares most about (`FilesTab.tsx`'s own header — a
 * dotfile is never hidden here, because `.env` is why browsing exists at all).
 */
export function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? null : name.slice(dot).toLowerCase();
}

/** Which of the three kinds `path` is, or null for everything else. */
export function editorFileKind(path: string): EditorFileKind | null {
  const name = baseName(path);
  // `.env`, `.env.local`, `.env.production` — a name, not an extension.
  if (name === '.env' || name.startsWith('.env.')) return 'env';
  switch (extensionOf(name)) {
    case '.json':
      return 'json';
    // `dev.env`, `staging.env` — the same format, named the other way round.
    case '.env':
      return 'env';
    case '.ini':
      return 'ini';
    default:
      return null;
  }
}

/**
 * IS THIS MARKDOWN? — and why it is a SEPARATE question from `editorFileKind`
 * rather than a fourth case inside it.
 *
 * This is the place the header above predicted: the formatter's list and the
 * highlighter's list have come apart, and markdown is what came apart. Three
 * modules now want three different things from a `.md`:
 *
 *   * `files-format.ts` must keep answering "not mine". It routes anything
 *     `editorFileKind` names and is not `json` straight into `formatIni` —
 *     so a fourth case there would have handed a markdown file to a `.env`
 *     formatter, which strips blank lines and rewrites `#` lines. In a
 *     markdown file those are paragraph breaks and headings.
 *   * `files-highlight.ts` DOES have an opinion now (see its own header for
 *     the argument, which is about line structure rather than meaning).
 *   * `FilesTab.tsx` asks it a third question again — "can this file be
 *     PREVIEWED?" — and the answer has to be the same one the highlighter
 *     uses, or the toggle would appear on a file the colours disagree about.
 *
 * `.markdown` as well as `.md`, because both are ordinary on disk, and both
 * are what every renderer this file could be compared against accepts.
 */
export function isMarkdownPath(path: string): boolean {
  const ext = extensionOf(baseName(path));
  return ext === '.md' || ext === '.markdown';
}

/**
 * What a list row shows for an absolute path: relative to the session's own
 * root, which is the fact worth reading (the root itself is implied by which
 * session's tab this is) rather than noise repeated on every single row.
 *
 * Falls back to the absolute path when `path` is not actually under `root`
 * -- defensive only, since `listFiles` never walks outside its own root, but
 * a silently wrong label would be the harder version of this bug to notice.
 */
export function relativeLabel(root: string, path: string): string {
  const base = root.endsWith('/') ? root.slice(0, -1) : root;
  const prefix = `${base}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * WHERE LINE `line` BEGINS, as a character offset into `text` -- what the
 * caret is set to when an agent's `src/foo.ts:42` is pressed.
 *
 * 1-BASED, because every editor, every compiler and every agent counts that
 * way, and the one place a 0 could come from (a model writing `:0`) is refused
 * before it ever reaches here (`src/shared/file-ref.ts`). It is still clamped
 * rather than trusted: this takes a number out of somebody else's text, and a
 * caret set past the end of a `<textarea>` is a silent scroll to nowhere.
 *
 * `\r\n` NEEDS NO SPECIAL CASE and that is worth stating rather than
 * rediscovering: splitting on `\n` leaves the `\r` at the END of the previous
 * line, so the offset after it is still the first character of the next one.
 */
export function lineStartOffset(text: string, line: number): number {
  const lines = text.split('\n');
  const wanted = Math.min(Math.max(Math.trunc(line), 1), lines.length);
  let at = 0;
  for (let i = 0; i < wanted - 1; i += 1) {
    at += (lines[i] ?? '').length + 1;
  }
  return at;
}
