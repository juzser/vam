// @vitest-environment happy-dom

/**
 * THE PIN SAYS HOW OLD IT IS.
 *
 * The In bubble sticks a turn's prompt to the top of the column, and the
 * activity line under it is live. On a long turn those two are hours apart,
 * and nothing said so -- so an hours-old prompt read as the current question.
 * Two different things looking the same, which is this pane's oldest defect.
 *
 * WHAT THE LINE CLAIMS, and it is deliberately narrow: this turn's PROMPT was
 * recorded at one time and its newest step at another. That is all vam read
 * and all it says. It does NOT say the session is stalled, that nothing has
 * been asked since, or that anything is wrong -- the first is contradicted by
 * the activity line beside it, and the other two are about things the
 * transcript does not record.
 *
 * NOT A WARNING, AND NOT AN ERROR COLOUR. A turn that runs for an hour is
 * ordinary here: measured over the corpus, the median turn takes 9.3 minutes,
 * p75 28 and p90 77. Dressing this as a fault would be its own lie, so it is
 * the same dim meta ink the branch and the age already use.
 *
 * THE THRESHOLD IS MEASURED, NOT CHOSEN. 30 minutes sits just past p75, so
 * the line stays away from three turns in four and speaks for the quarter
 * that are long enough for the pin to mislead.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel } from '../../src/renderer/panels/DetailPanel.js';

const ASKED = '2026-09-14T01:00:00.000Z';

function turn(over: Partial<Decision> = {}): Decision {
  return {
    id: 'd1',
    label: 'plan',
    input: 'ship it',
    output: null,
    commands: [],
    promptedAt: ASKED,
    latestAt: ASKED,
    ...over,
  };
}

function draw(decision: Decision) {
  const session: Session = {
    id: 's1',
    title: 'Provider survey',
    icon: null,
    epic: null,
    branch: null,
    status: 'running',
    runningAgents: 1,
    activity: null,
    age: '3m',
    decisions: [decision],
  };
  const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
  const entry: SessionEntry = { project, session };
  render(
    <DetailPanel
      entry={entry}
      decision={decision}
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
    />,
  );
}

const note = () => document.querySelector<HTMLElement>('[data-prompt-age]');

afterEach(cleanup);

describe('a turn whose work is much newer than its prompt', () => {
  /**
   * THE GAP, NOT THE AGE. Both halves are timestamps vam READ, so the line is
   * a relation between two recorded facts and does not move while you look at
   * it. "3h ago" would need a third clock -- `now` -- and would drift against
   * a transcript that has stopped being written.
   */
  it('says how much older the prompt is than the work below it', () => {
    draw(turn({ latestAt: '2026-09-14T04:20:00.000Z' }));
    const text = note()?.textContent ?? '';
    expect(text).toContain('3h');
    expect(text).toMatch(/older/i);
  });

  it('names the prompt, never the session or the operator', () => {
    draw(turn({ latestAt: '2026-09-14T04:20:00.000Z' }));
    const text = (note()?.textContent ?? '').toLowerCase();
    // The three inferences this line must never make: all of them are about
    // something vam did not read.
    expect(text).not.toContain('stall');
    expect(text).not.toContain('idle');
    expect(text).not.toContain('you ');
    expect(text).toContain('prompt');
  });

  it('is drawn in the In block, with the prompt it is about', () => {
    draw(turn({ latestAt: '2026-09-14T04:20:00.000Z' }));
    expect(note()?.closest('[data-detail-block="in"]')).not.toBeNull();
  });
});

describe('when it stays quiet', () => {
  it('says nothing about an ordinary turn', () => {
    // Ten minutes: past the median of 9.3 and nowhere near the pin misleading.
    draw(turn({ latestAt: '2026-09-14T01:10:00.000Z' }));
    expect(note()).toBeNull();
  });

  it('says nothing at the threshold itself, only past it', () => {
    draw(turn({ latestAt: '2026-09-14T01:30:00.000Z' }));
    expect(note()).toBeNull();
  });

  /**
   * THE MARKER HAS NO CLOCK. A turn whose prompt line is above the top of the
   * read window has no recorded time, and a line reading "the prompt is 0m
   * old" would be a claim vam cannot make. It says nothing instead.
   */
  it('says nothing when the source could not time the prompt', () => {
    draw(turn({ promptedAt: null, latestAt: '2026-09-14T04:20:00.000Z' }));
    expect(note()).toBeNull();
  });

  it('says nothing when the turn has not done anything yet', () => {
    draw(turn({ latestAt: null }));
    expect(note()).toBeNull();
  });

  it('says nothing for a source that carries neither, as most do', () => {
    draw(turn({ promptedAt: undefined, latestAt: undefined }));
    expect(note()).toBeNull();
  });

  /**
   * A TIMESTAMP THAT WILL NOT PARSE IS NOT A ZERO. `Date.parse` answers NaN
   * for it, and NaN arithmetic gives a gap that compares false against every
   * threshold -- which happens to be the right outcome by accident. The check
   * is explicit so it stays right on purpose, and this is what holds it there.
   */
  it('says nothing when a timestamp cannot be read', () => {
    draw(turn({ promptedAt: 'not a date', latestAt: '2026-09-14T04:20:00.000Z' }));
    expect(note()).toBeNull();
  });

  /**
   * BACKWARDS IS NOT FAR. A step stamped BEFORE the prompt it belongs to is a
   * clock disagreeing with itself, not a long turn -- and an absolute distance
   * would print "3h older" about a prompt that is in fact the newer of the
   * two. The direction is part of the claim.
   */
  it('says nothing when the newest step is older than the prompt', () => {
    draw(turn({ promptedAt: '2026-09-14T04:20:00.000Z', latestAt: '2026-09-14T01:00:00.000Z' }));
    expect(note()).toBeNull();
  });
});
