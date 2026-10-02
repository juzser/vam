/**
 * The provider TUI's own greyed prompt suggestion, read off a captured `-e`
 * screen. Only the pane holds it (the transcript records just the acceptance).
 *
 * The rule is what a live probe recorded (`test/fixtures/prompt-suggestion-
 * screens.ts`, claude 2.1.286): the input box is one row between two rule rows,
 * drawn `❯` + NBSP + text; a standing suggestion is that text painted DIM
 * (`ESC[2m`) with nothing typed beside it. The fresh session's example hint
 * (`Try "fix lint errors"`) is dim too, so it is named by its text. An open
 * picker has no rule below its row, so it never reads as an input box.
 *
 * Anything not positively read is `null`: a missed ghost costs one keystroke,
 * an invented one writes text the operator never saw into a draft.
 */

const ESC = String.fromCharCode(27);
const SGR_OR_TEXT = new RegExp(
  `${ESC}\\[([0-9;]*)m|${ESC}\\[[0-9;:?]*[ -/]*[@-~]|([^${ESC}]+)`,
  'g',
);
const ANY_CSI = new RegExp(`${ESC}\\[[0-9;:?]*[ -/]*[@-~]`, 'g');
const RULE = /^─{10,}$/;
const PROMPT = /^❯[  ]/;
/** The example hint a fresh session draws in the same dim ink as a suggestion. */
const EXAMPLE_HINT = /^Try "/;

const bare = (row: string): string => row.replace(ANY_CSI, '');

/** The text after the prompt glyph, or null unless every visible char is dim. */
function dimTail(row: string): string | null {
  let after = false;
  let dim = false;
  let text = '';
  let skip = 2;
  for (const match of row.matchAll(SGR_OR_TEXT)) {
    const [, params, run] = match;
    if (params !== undefined) {
      for (const code of params === '' ? ['0'] : params.split(';')) {
        if (code === '2') dim = true;
        else if (code === '0' || code === '22' || code === '') dim = false;
      }
    }
    if (run === undefined) continue;
    let visible = run;
    if (!after) {
      // The glyph and its one space are the prefix; everything after is the row's own text.
      const drop = Math.min(skip, visible.length);
      visible = visible.slice(drop);
      skip -= drop;
      if (skip > 0) continue;
      after = true;
    }
    if (visible.trim() === '') {
      text += visible;
      continue;
    }
    if (!dim) return null;
    text += visible;
  }
  return text;
}

/** The suggestion standing greyed in the input box of `screen`, or `null`. */
export function readPromptSuggestion(screen: string): string | null {
  const rows = screen.split('\n');
  for (let at = rows.length - 2; at >= 1; at--) {
    const row = rows[at] ?? '';
    if (!PROMPT.test(bare(row))) continue;
    if (
      !RULE.test(bare(rows[at - 1] ?? '').trim()) ||
      !RULE.test(bare(rows[at + 1] ?? '').trim())
    ) {
      continue;
    }
    const tail = dimTail(row);
    const text = tail?.trim() ?? '';
    if (text === '' || EXAMPLE_HINT.test(text)) return null;
    return text;
  }
  return null;
}
