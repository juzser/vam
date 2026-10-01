/**
 * The provider TUI's own greyed prompt suggestion, read off a captured screen.
 *
 * Nothing else carries it: the transcript records only the ACCEPTANCE
 * (`promptSource: 'suggestion_accepted'`) and no hook payload has the text, so
 * the one place it exists is the pane -- which vam already captures with `-e`
 * (`capturePaneArgv`).
 *
 * THE RULE IS WHAT A LIVE PROBE RECORDED (`test/fixtures/prompt-suggestion-
 * screens.ts`, claude 2.1.286), not a guess:
 *
 *  - the input box is one row between two rule rows, drawn `❯` + NBSP + text;
 *  - a standing suggestion is that text painted DIM (`ESC[2m`) with nothing
 *    typed beside it; one typed character makes the row ordinary text, and
 *    mid-turn the row is empty;
 *  - THE FRESH SESSION'S EXAMPLE HINT (`Try "fix lint errors"`) IS DIM TOO, so
 *    the colour cannot tell it from a suggestion. It is not one -- nothing was
 *    suggested, nothing would be accepted -- and it is named by its own text;
 *  - an open picker has `❯` rows but no rule BELOW the cursor row's own, so it
 *    never reads as an input box.
 *
 * Anything this cannot positively read is `null`: a missed ghost costs one
 * keystroke, an invented one writes text the operator never saw into a draft.
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
