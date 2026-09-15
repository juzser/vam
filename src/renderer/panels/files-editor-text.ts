/**
 * The file editor's own text arithmetic -- pure, DOM-free, so it can be
 * proven without a real `<textarea>`. `FilesTab.tsx` is the only caller.
 */

/** The result of applying (or removing) one indent step. */
export type TabResult = {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
};

/** What one indent step looks like. Spaces, not a literal tab byte, so the
 *  gutter's own column math (`FilesTab.tsx`) never has to guess a tab's
 *  rendered width -- the one thing that makes a line-number gutter drift
 *  out of sync with its own text. */
const INDENT = '  ';

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
): TabResult {
  const spansLines = value.slice(selectionStart, selectionEnd).includes('\n');
  if (!spansLines) {
    if (outdent) {
      // Shift+Tab with no multi-line selection: nothing to remove from a
      // single point, so this is a no-op rather than a guess at what to
      // delete.
      return { value, selectionStart, selectionEnd };
    }
    const next = value.slice(0, selectionStart) + INDENT + value.slice(selectionEnd);
    const caret = selectionStart + INDENT.length;
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
    outdent
      ? line.startsWith(INDENT)
        ? line.slice(INDENT.length)
        : line.replace(/^ /, '')
      : `${INDENT}${line}`,
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
