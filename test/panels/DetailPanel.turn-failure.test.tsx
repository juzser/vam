// @vitest-environment happy-dom

/**
 * THE FOLD MUST NOT SWALLOW A FAILURE.
 *
 * A turn's mark was binary -- `output === null ? '◌' : '✓'` -- in both the
 * condensed `<select>` and the expanded list, so a turn whose tools blew up
 * three times still read `✓`, and the collapsed line said "12 turns read" over
 * a run that was on fire. vam and the reference agree that intermediate work
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
import { cleanup, fireEvent, render } from '@testing-library/react';
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
const failed = () => document.querySelector<HTMLElement>('[data-progress-failed]');
const options = () => [
  ...document.querySelectorAll<HTMLOptionElement>('[data-progress-jump] option'),
];
const marks = () =>
  [...document.querySelectorAll<HTMLElement>('[data-progress-turn]')].map(
    (b) => b.firstElementChild?.textContent ?? '',
  );

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
    expect(document.querySelector('[data-progress-line]')?.textContent).toContain('turns read');
  });
});

describe('a turn that errored carries its own mark', () => {
  it('marks the errored turn apart from the answered ones in the picker', () => {
    draw([turn('a', { errorCount: 2 }), turn('b', { errorCount: 0 })]);
    const [newest, older] = options().map((o) => o.textContent ?? '');
    // Oldest first in the list, so the clean turn `b` leads.
    expect(newest?.startsWith('✓')).toBe(true);
    expect(older?.startsWith('!')).toBe(true);
  });

  it('marks it in the expanded list too, where the same glyphs are drawn', () => {
    draw([turn('a', { errorCount: 1 }), turn('b')], {});
    const expand = document.querySelector<HTMLButtonElement>('[data-progress-expand]');
    if (expand === null) throw new Error('no expander to open the turn list with');
    fireEvent.click(expand);
    expect(marks()).toContain('!');
  });

  it('lets the failure outrank the still-working mark', () => {
    // A turn still in flight whose tools already failed is a turn with a
    // problem. `◌` says only "not finished", which is the one reading that
    // would let the alarm collapse away.
    draw([turn('a', { output: null, errorCount: 1 }), turn('b')]);
    expect(options().map((o) => o.textContent ?? '')).toContain(`! ${turn('a').label}`);
  });

  it('leaves a clean turn’s marks exactly as they were', () => {
    draw([turn('a', { output: null, errorCount: 0 }), turn('b', { errorCount: 0 })]);
    const text = options().map((o) => (o.textContent ?? '').slice(0, 1));
    expect(text).toEqual(['✓', '◌']);
  });
});
