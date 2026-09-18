// @vitest-environment happy-dom

/**
 * A TURN'S TOOL CALLS, AS THE COLUMN DRAWS THEM.
 *
 * Operator: "show the whole progress when focus view is off." What off drew
 * was one line per turn carrying the turn's mark and the agent's name -- the
 * whole of a `Decision`'s working -- because the transcript reader parsed
 * every `tool_use` part and kept exactly one, the newest in the window, as the
 * activity line. `Decision.steps` is the list now; this file is what the pane
 * does with it.
 *
 * `test/prefs/prefs.focus-view.test.ts` holds the RULE (`drawsTurnSteps`) and
 * sweeps it. `test/sources/claude-code-transcript-steps.test.ts` holds the
 * reading. What is asserted here is rendered elements and rendered text, never
 * a class name: the failure a progress list can have is drawing a row that is
 * not a call vam read, or dropping rows without saying so, and only the drawn
 * thing catches either.
 *
 * THE CAP IS MEASURED, NOT CHOSEN. Over the 77 real session transcripts on
 * this machine, a turn that fits inside one 128 KiB window made a median of 3
 * calls, a p90 of 8, and at most 20 (387 turns). A turn that SPANS the window
 * -- the case `history.ts` widens the read for -- ran to a median of 30 and a
 * largest of 2,144 (785 turns). So a cap of 20 never truncates what a live
 * poll reads and exists for the paged reads, where 2,144 rows would bury the
 * answer under one turn's working.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session, TurnStep } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import { DEFAULT_FOCUS_VIEW, setActiveFocusView } from '../../src/renderer/prefs/progress.js';

const step = (id: string, label: string, failed = false): TurnStep => ({ id, label, failed });

function turn(id: string, over: Partial<Decision> = {}): Decision {
  return {
    id,
    label: `turn-${id}`,
    input: `ask ${id}`,
    output: `done ${id}`,
    commands: [],
    ...over,
  };
}

function draw(
  decisions: readonly Decision[],
  session: Partial<Session> = {},
  props: Partial<DetailPanelProps> = {},
) {
  const built: Session = {
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
    ...session,
  };
  const project: Project = { id: 'p1', name: 'atlas', sessions: [built] };
  const entry: SessionEntry = { project, session: built };
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

const lists = () => [...document.querySelectorAll<HTMLElement>('[data-progress-steps]')];
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-progress-step]')];
/** The NAMES of the calls, which is the row's whole content bar its mark. */
const labelsIn = (root: ParentNode = document) =>
  [...root.querySelectorAll<HTMLElement>('[data-progress-step-label]')].map(
    (el) => el.textContent ?? '',
  );
const rowText = () => labelsIn();
const failedRows = () =>
  [...document.querySelectorAll<HTMLElement>('[data-progress-step-failed]')].flatMap((el) =>
    labelsIn(el),
  );
const more = () => document.querySelector<HTMLElement>('[data-progress-steps-more]');
const unfolds = () => [...document.querySelectorAll<HTMLElement>('[data-turn-unfold]')];

function inMode(mode: 'shown' | 'collapsed', body: () => void) {
  setActiveFocusView(mode === 'collapsed');
  body();
}

afterEach(() => {
  cleanup();
  setActiveFocusView(DEFAULT_FOCUS_VIEW);
});

describe('focus view off draws the whole of a turn’s working', () => {
  it('draws one row per call, in the order they were made', () => {
    inMode('shown', () => {
      draw([
        turn('a', {
          steps: [step('a:s0', 'Read'), step('a:s1', 'Bash: run the tests'), step('a:s2', 'Edit')],
        }),
      ]);
      expect(rowText()).toEqual(['Read', 'Bash: run the tests', 'Edit']);
    });
  });

  it('keeps every turn’s calls under that turn, not pooled into one list', () => {
    inMode('shown', () => {
      // `decisions` is newest first and the column draws oldest first.
      draw([
        turn('b', { steps: [step('b:s0', 'Edit')] }),
        turn('a', { steps: [step('a:s0', 'Read')] }),
      ]);
      expect(lists()).toHaveLength(2);
      expect(lists().map((l) => labelsIn(l))).toEqual([['Read'], ['Edit']]);
    });
  });

  it('draws the list inside the turn’s own progress section', () => {
    // CONTAINMENT, and it is the reason focus view still folds ONE thing. A
    // list outside the section would survive a fold the rule believes it made.
    inMode('shown', () => {
      draw([turn('a', { steps: [step('a:s0', 'Read')] })]);
      const section = document.querySelector('[data-detail-block="progress"]');
      expect(section?.contains(lists()[0] as Node)).toBe(true);
    });
  });

  it('draws no list at all for a turn that called nothing', () => {
    // EMPTY IS A READING -- vam looked and the turn made no calls -- and an
    // empty box under every answer-only turn is noise, not information.
    inMode('shown', () => {
      draw([turn('a', { steps: [] })]);
      expect(lists()).toHaveLength(0);
    });
  });

  it('draws no list for a turn from a source that cannot report calls', () => {
    // ABSENT is the other unknown: a source with no tool calls to report at
    // all. Same paint, because there is nothing to say either way.
    inMode('shown', () => {
      draw([turn('a')]);
      expect(lists()).toHaveLength(0);
    });
  });
});

describe('a call that failed is marked where it happened', () => {
  it('marks the row, not merely the turn', () => {
    // `errorCount` already says "something blew up in here"; the list is what
    // answers "in WHICH call", which is the question a count cannot.
    inMode('shown', () => {
      draw([
        turn('a', {
          errorCount: 1,
          steps: [step('a:s0', 'Read'), step('a:s1', 'Bash: run the tests', true)],
        }),
      ]);
      expect(failedRows()).toEqual(['Bash: run the tests']);
    });
  });

  it('says "failed" in words, not only in a glyph and a colour', () => {
    // The mark is decorative and the colour reaches nobody using a screen
    // reader. A failure is the one thing on this surface that must be read.
    inMode('shown', () => {
      draw([turn('a', { steps: [step('a:s0', 'Bash', true)] })]);
      expect((rows()[0]?.textContent ?? '').toLowerCase()).toContain('failed');
    });
  });

  it('leaves the turn’s own count exactly where it was', () => {
    inMode('shown', () => {
      draw([turn('a', { errorCount: 3, steps: [step('a:s0', 'Bash', true)] })]);
      // Three failures read, one attributable to a call in the window. The
      // count is not derived from the list and does not shrink to match it.
      const line = document.querySelector('[data-progress-failed]');
      expect(line?.textContent ?? '').toContain('3');
    });
  });
});

describe('the cap, and saying what it left out', () => {
  const many = (n: number): TurnStep[] =>
    Array.from({ length: n }, (_, i) => step(`a:s${i}`, `Read ${i}`));

  it('draws a 20-call turn whole, because that is the most a live window holds', () => {
    inMode('shown', () => {
      draw([turn('a', { steps: many(20) })]);
      expect(rows()).toHaveLength(20);
      expect(more()).toBeNull();
    });
  });

  it('stops at 20 on a paged turn and says how many it did not draw', () => {
    inMode('shown', () => {
      draw([turn('a', { steps: many(64) })]);
      expect(rows()).toHaveLength(20);
      // A NUMBER VAM READ, never "more": the list is a count of what was read,
      // and 44 is exactly what it holds and did not draw.
      expect(more()?.textContent ?? '').toContain('44');
    });
  });

  it('keeps the calls it drew at the start of the turn, so the working reads forward', () => {
    inMode('shown', () => {
      draw([turn('a', { steps: many(64) })]);
      expect(rowText()[0]).toBe('Read 0');
      expect(rowText().at(-1)).toBe('Read 19');
    });
  });
});

describe('focus view puts the working away, and the unfold brings it back', () => {
  it('draws no calls at all under focus view', () => {
    inMode('collapsed', () => {
      draw([turn('a', { steps: [step('a:s0', 'Read')] })]);
      expect(rows()).toHaveLength(0);
    });
  });

  it('withholds them even from a turn whose line it had to keep', () => {
    // A failing turn keeps its LINE -- the fold may never cost alarm -- and
    // the alarm is the count on that line. The itemised calls are the bulk of
    // what the mode exists to put away, and the way back is one press off.
    inMode('collapsed', () => {
      draw([turn('a', { errorCount: 2, steps: [step('a:s0', 'Bash', true)] })]);
      expect(document.querySelector('[data-progress-line]')).not.toBeNull();
      expect(rows()).toHaveLength(0);
    });
  });

  it('gives the calls back to the turn the operator unfolded', () => {
    // The control's name says "show this turn's working". The working IS the
    // calls; restoring only the mark and the label would be a control that
    // does almost nothing.
    inMode('collapsed', () => {
      draw([turn('a', { steps: [step('a:s0', 'Read'), step('a:s1', 'Edit')] })]);
      expect(rows()).toHaveLength(0);
      fireEvent.click(unfolds()[0] as HTMLElement);
      expect(rowText()).toEqual(['Read', 'Edit']);
    });
  });

  it('unfolds one turn’s calls and no other turn’s', () => {
    inMode('collapsed', () => {
      draw([
        turn('b', { steps: [step('b:s0', 'Edit')] }),
        turn('a', { steps: [step('a:s0', 'Read')] }),
      ]);
      // Oldest first, so the first control belongs to turn `a`.
      fireEvent.click(unfolds()[0] as HTMLElement);
      expect(rowText()).toEqual(['Read']);
    });
  });
});
