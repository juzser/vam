/**
 * Pins `docs/design/terminal-streaming.md` to the current no-strip rule: the
 * one-row status strip under the terminal pane was removed, and the doc must
 * not describe it as current again.
 *
 * THE DEFECT, NAMED: finding f-vam-ux-3/followup-7e0eb946-7e0eb946. The doc
 * kept describing the removed one-row status rule (and its
 * `[data-terminal-stream-status]` hook) after the code dropped it. Fix commit
 * 05b3e1f9 ("drop stale status-rule docs") rewrote the text; nothing pinned
 * it, so it could drift back unseen. The DOM side, no strip under either
 * renderer's pane, is `terminal-no-status-strip.test.tsx` (EC-21); this file
 * is its doc-side sibling.
 *
 * THE BARGAIN, as `files-tab.keyboard-doc.test.ts` keeps it: the doc is read
 * from the working tree, passages are found by their own text and never by
 * line number, and no git subprocess runs, because CI clones one commit deep.
 * The removed wording lives here as fixtures so the matcher is proven to bite
 * without history.
 *
 * WHAT IS NOT PINNED: the `same labels` phrase in the ON cell.
 * `TerminalStreamTab.tsx` carries no aria-label, so this guard must not hold
 * that phrase in place. Only `no strip under the pane` is pinned for ON.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DOC = fileURLToPath(new URL('../../docs/design/terminal-streaming.md', import.meta.url));
const lines = readFileSync(DOC, 'utf8').split('\n');

const REMOVED_RULE = /status rule|\[data-terminal-stream-status\]|one-row status/i;

/** Every line the removed rule would show up on, with its 1-based number. */
const offending = (ls: string[]): string[] =>
  ls.flatMap((l, i) => (REMOVED_RULE.test(l) ? [`${i + 1}: ${l}`] : []));

const REMOVED_ROW =
  '| branch / session name | drawn on a one-row status rule under the pane | same rule, same order, same classes (`[data-terminal-stream-status]`) |';
const REMOVED_SENTENCE =
  'type and drawn on the new status rule; `null` until the stream actually opens';

describe('terminal-streaming.md states the no-strip rule', () => {
  it('does not describe the removed status rule', () => {
    expect(offending(lines), `offending lines:\n${offending(lines).join('\n')}`).toEqual([]);
  });

  it('the matcher flags each removed passage', () => {
    expect(offending([REMOVED_ROW])).toHaveLength(1);
    expect(offending([REMOVED_SENTENCE])).toHaveLength(1);
  });

  it('the branch / session name row says the strip was removed', () => {
    const rows = lines.filter((l) => l.startsWith('| branch / session name |'));
    expect(rows).toHaveLength(1);
    const cells = (rows[0] ?? '')
      .replace(/^\|\s*/, '')
      .replace(/\s*\|\s*$/, '')
      .split(' | ');
    expect(cells).toHaveLength(3);
    const [name, off, on] = cells as [string, string, string];
    expect(name).toBe('branch / session name');
    expect(off).toContain('removed');
    expect(off).toContain('terminal of <name>');
    expect(off).toContain('type into <name>');
    expect(on).toContain('no strip under the pane');
    expect(off).not.toContain('status rule');
    expect(on).not.toContain('status rule');
  });

  it('the tmux session name paragraph says nothing on screen shows the name', () => {
    const start = lines.findIndex((l) => l.startsWith('**The tmux session name,'));
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = lines.slice(start);
    const end = rest.findIndex((l) => l.trim() === '');
    const para = (end === -1 ? rest : rest.slice(0, end)).join(' ');
    expect(para).toContain('was removed');
    expect(para).toContain('nothing on screen shows the name');
  });
});
