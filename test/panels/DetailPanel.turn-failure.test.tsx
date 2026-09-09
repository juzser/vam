// @vitest-environment happy-dom

/**
 * THE FOLD MUST NOT SWALLOW A FAILURE.
 *
 * A turn's mark was binary -- `output === null ? '◌' : '✓'` -- wherever it was
 * drawn, so a turn whose tools blew up three times still read `✓`, and the
 * collapsed line said "12 turns read" over a run that was on fire. (It was
 * drawn in the condensed `<select>` and the expanded list then; both went with
 * the column's bar, and the turn's own line is where it is drawn now.) vam and the reference agree that intermediate work
 * should collapse; collapsing may cost the operator DETAIL, never ALARM.
 *
 * WHAT IS ASSERTED HERE is rendered text, not a computed value -- the whole
 * defect being fixed is a fact vam already held and never drew.
 *
 * THE COUNT'S HONESTY IS PINNED TOO. The label is deliberately "turns read"
 * and not "turns", because only the newest `TAIL_BYTES` of the transcript is
 * ever opened. The failure count is added BESIDE that qualifier: a test below
 * fails if it is ever swapped for it.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

function turn(id: string, over: Partial<Decision> = {}): Decision {
  return { id, label: `turn-${id}`, input: 'go', output: 'done', commands: [], ...over };
}

/** `decisions` is newest first, which is the order the model hands over. */
function draw(decisions: readonly Decision[], props: Partial<DetailPanelProps> = {}) {
  const session: Session = {
    id: 's1',
    title: 'Provider survey',
    icon: null,
    epic: null,
    branch: null,
    status: 'running',
    runningAgents: 0,
    activity: null,
    age: '3m',
    decisions,
  };
  const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
  const entry: SessionEntry = { project, session };
  render(
    <DetailPanel
      entry={entry}
      decision={decisions[0] ?? null}
      draft=""
      onDraftChange={() => {}}
      onSubmit={() => {}}
      composing={false}
      onCompose={() => {}}
      onStopComposing={() => {}}
      active={false}
      actionIndex={0}
      width={408}
      resizeHandle={null}
      {...props}
    />,
  );
}

const count = () => document.querySelector<HTMLElement>('[data-progress-count]');
/**
 * THE TOTAL ACROSS THE WINDOW, which is what this block is about.
 *
 * Since the pane became a column of every turn, `[data-progress-failed]` is one
 * turn's OWN count, drawn on that turn's line -- there is one per failing turn.
 * The sum over the window sits at the boundary block that names that window,
 * beside the turns-read count it qualifies.
 */
const failed = () => document.querySelector<HTMLElement>('[data-column-failed]');
/** Every turn's own count, oldest first. */
const perTurn = () =>
  [...document.querySelectorAll<HTMLElement>('[data-progress-failed]')].map(
    (el) => el.textContent ?? '',
  );
/**
 * EACH TURN'S OWN MARK AND LABEL, OLDEST FIRST.
 *
 * These used to be read off the picker's `<option>`s and off the expanded turn
 * list's rows -- two controls printing the same glyph from the same
 * `turnMark`. Both went with the column's bar (the column draws every turn, so
 * a list of turns to jump between was a second way to reach what is on
 * screen), and the glyph is left where it always also was: on the turn's own
 * condensed line, beside the turn it is about.
 */
const turnLines = () =>
  [...document.querySelectorAll<HTMLElement>('[data-progress-turn-label]')].map((el) => ({
    mark: el.firstElementChild?.textContent ?? '',
    label: el.lastElementChild?.textContent ?? '',
    markHidden: el.firstElementChild?.getAttribute('aria-hidden') === 'true',
  }));

afterEach(cleanup);

describe('the collapsed line reports failures it would otherwise fold away', () => {
  it('appends the failure count to the turns-read line', () => {
    draw([turn('a', { errorCount: 3 }), turn('b')]);
    expect(failed()?.textContent).toBe('· 3 failed');
  });

  it('sums the failures across every turn in view', () => {
    draw([turn('a', { errorCount: 1 }), turn('b', { errorCount: 2 })]);
    expect(failed()?.textContent).toBe('· 3 failed');
  });

  it('says nothing when every turn read came back clean', () => {
    draw([turn('a', { errorCount: 0 }), turn('b', { errorCount: 0 })]);
    expect(failed()).toBeNull();
  });

  it('says nothing when the source cannot report failures at all', () => {
    // ABSENT is not zero: a source with no such surface has not looked, and a
    // confident "0 failed" over data nobody read is the same lie as a badge.
    draw([turn('a'), turn('b')]);
    expect(failed()).toBeNull();
  });

  it('adds the count beside "turns read" and never in place of it', () => {
    // The qualifier is load-bearing: only the newest TAIL_BYTES is ever read,
    // so this is a count of what vam FOUND, not the session's total. The
    // failure count is a second fact about the same window, not a
    // replacement for the caveat on it.
    draw([turn('a', { errorCount: 2 }), turn('b')]);
    expect(count()?.textContent).toBe('2 turns read');
    expect(document.querySelector('[data-column-start]')?.textContent).toContain('turns read');
  });

  it("also puts each turn's own count on that turn's own line", () => {
    // The column can say which turn went wrong, which the single folded line
    // never could: the total says three tools failed, the lines say where.
    draw([turn('a', { errorCount: 1 }), turn('b', { errorCount: 2 })]);
    // Oldest first, the order the column draws them in.
    expect(perTurn()).toEqual(['· 2 failed', '· 1 failed']);
    expect(failed()?.textContent).toBe('· 3 failed');
  });
});

describe('a turn that errored carries its own mark', () => {
  it('marks the errored turn apart from the answered ones, on its own line', () => {
    draw([turn('a', { errorCount: 2 }), turn('b', { errorCount: 0 })]);
    const [oldest, newest] = turnLines();
    // Oldest first in the column, so the clean turn `b` leads.
    expect(oldest?.mark).toBe('✓');
    expect(newest?.mark).toBe('!');
    // And each mark is beside the turn it is about -- which is the whole gain
    // of the fold moving onto the turns: `!` on a session-wide control said
    // only "something, somewhere".
    expect(oldest?.label).toBe(turn('b').label);
    expect(newest?.label).toBe(turn('a').label);
  });

  /**
   * RE-POINTED. This case read the same glyph out of the second control that
   * drew it -- the expanded turn list -- to pin that the two agreed. There is
   * one place now, so agreement is not a claim that can be made; what CAN be,
   * and could not before, is that the glyph is decoration and the label is the
   * text: a screen reader that read "exclamation mark turn-a" would be reading
   * the fold's shorthand rather than its meaning.
   */
  it('leaves the mark to the eye and the label to the screen reader', () => {
    draw([turn('a', { errorCount: 1 }), turn('b')]);
    const lines = turnLines();
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.markHidden, line.label).toBe(true);
  });

  it('lets the failure outrank the still-working mark', () => {
    // A turn still in flight whose tools already failed is a turn with a
    // problem. `◌` says only "not finished", which is the one reading that
    // would let the alarm collapse away.
    draw([turn('a', { output: null, errorCount: 1 }), turn('b')]);
    expect(turnLines()).toContainEqual({
      mark: '!',
      label: turn('a').label,
      markHidden: true,
    });
  });

  it('leaves a clean turn’s marks exactly as they were', () => {
    draw([turn('a', { output: null, errorCount: 0 }), turn('b', { errorCount: 0 })]);
    expect(turnLines().map((l) => l.mark)).toEqual(['✓', '◌']);
  });
});
