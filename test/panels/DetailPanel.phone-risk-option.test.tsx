// @vitest-environment happy-dom

/**
 * Spec step 4b (docs/design/phone-core-loop.md §3.3, §3.7 PR4) — DEVIATION,
 * approved: an option whose label names a persistent-permission choice
 * ("don't ask again", "always allow", …) carries a subtle risk marker and
 * needs a SECOND real tap to mark it. Phone only, and advisory only: it
 * never blocks `answer.ts`'s write path — an armed-but-unconfirmed option
 * is simply not marked, the same as an option never tapped at all.
 *
 * The three option labels below are `fixtures/demo.ts`'s own `DEMO_PROMPT`
 * -- the exact wording `factory-sse-1` draws in the `?demo=1` fixture this
 * spec's own screenshots use, "do not ask again" included.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentQuestion, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

const PLAIN = 'Yes';
const RISKY = 'Yes, and do not ask again for scripts/rebuild-index.sh';
const OTHER = 'No, and tell the agent what to do differently';

const QUESTION: AgentQuestion = {
  id: 'toolu_1:0',
  question: 'Do you want to run this command?',
  header: null,
  multiSelect: false,
  options: [
    { label: PLAIN, description: null },
    { label: RISKY, description: null },
    { label: OTHER, description: null },
  ],
  answer: null,
};

const SESSION: Session = {
  id: 's1',
  title: 'factory-sse-1',
  epic: null,
  branch: null,
  status: 'waiting',
  runningAgents: 0,
  activity: null,
  age: '3m',
  decisions: [{ id: 'd1', label: 'plan', input: 'ask me', output: 'asked', commands: [] }],
};

function draw(
  over: Partial<DetailPanelProps> = {},
  questions: readonly AgentQuestion[] = [QUESTION],
) {
  const session: Session = { ...SESSION, questions };
  const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
  const entry: SessionEntry = { project, session };
  render(
    <DetailPanel
      entry={entry}
      decision={session.decisions[0] ?? null}
      draft=""
      onDraftChange={() => {}}
      onSubmit={() => {}}
      composing={false}
      onCompose={() => {}}
      onStopComposing={() => {}}
      active={false}
      actionIndex={0}
      width={390}
      resizeHandle={null}
      {...over}
    />,
  );
}

const options = () => [...document.querySelectorAll<HTMLElement>('[data-question-option]')];
const q = (selector: string) => document.querySelector<HTMLElement>(selector);
/** The option button whose OWN label (`[data-question-label]`, the exact
 *  text `answer.ts` matches against — never the button's whole textContent,
 *  which also carries the risk marker's own words) equals the one given. */
const optionFor = (label: string) => {
  const found = options().find(
    (el) => el.querySelector('[data-question-label]')?.textContent === label,
  );
  if (found === undefined) throw new Error(`no option labelled ${label}`);
  return found;
};
/** A click from a mouse/finger, matching `DetailPanel.question-collapse.test.tsx`'s own convention. */
const tap = (el: HTMLElement) => fireEvent.click(el, { detail: 1 });

afterEach(cleanup);

describe('the risk marker (phone only)', () => {
  it('marks the persistent-permission option, and only that one', () => {
    draw({ phone: true });
    expect(optionFor(RISKY).getAttribute('data-question-risk')).toBe('true');
    expect(optionFor(PLAIN).getAttribute('data-question-risk')).toBeNull();
    expect(optionFor(OTHER).getAttribute('data-question-risk')).toBeNull();
    expect(optionFor(RISKY).textContent).toContain("won't ask again this session");
  });

  it('draws no marker at all on desktop', () => {
    draw({ phone: false, width: 700 });
    expect(optionFor(RISKY).getAttribute('data-question-risk')).toBeNull();
    expect(optionFor(RISKY).textContent).not.toContain("won't ask again this session");
  });
});

describe('the double-tap confirm (phone only)', () => {
  it('arms, not marks, on the first tap', () => {
    draw({ phone: true });
    tap(optionFor(RISKY));
    expect(optionFor(RISKY).getAttribute('data-question-armed')).toBe('true');
    expect(optionFor(RISKY).getAttribute('data-picked')).toBeNull();
    expect(optionFor(RISKY).textContent).toContain('tap again to confirm');
  });

  // `QUESTION` is single-select, so a REAL mark also folds the list on a
  // pointer pick (`toggle`'s own `viaPointer && !multiSelect` rule,
  // `DetailPanel.question-collapse.test.tsx`) -- the marked option is no
  // longer a `[data-question-option]` afterward, only the folded summary's
  // `[data-question-marked]` text. Arming is NOT a mark, so it never folds;
  // only the CONFIRMING tap does, which is itself evidence the mark really
  // landed rather than merely re-arming.

  it('marks on the SECOND tap of the same row, and folds on it like any real pick', () => {
    draw({ phone: true });
    tap(optionFor(RISKY));
    expect(q('[data-question-collapsed]')).toBeNull(); // armed, not marked yet
    tap(optionFor(RISKY));
    expect(q('[data-question-marked]')?.textContent).toContain(RISKY);
  });

  it('does not gate a non-risky option: one tap marks (and folds) it, as always', () => {
    draw({ phone: true });
    tap(optionFor(PLAIN));
    expect(q('[data-question-marked]')?.textContent).toContain(PLAIN);
  });

  it('tapping a different option while one is armed marks THAT one, never the armed row', () => {
    draw({ phone: true });
    tap(optionFor(RISKY));
    expect(optionFor(RISKY).getAttribute('data-question-armed')).toBe('true');
    tap(optionFor(OTHER));
    expect(q('[data-question-marked]')?.textContent).toContain(OTHER);
    expect(q('[data-question-marked]')?.textContent).not.toContain(RISKY);
  });

  it('a timeout disarms: the next tap arms again rather than confirming', () => {
    vi.useFakeTimers();
    draw({ phone: true });
    tap(optionFor(RISKY));
    expect(optionFor(RISKY).getAttribute('data-question-armed')).toBe('true');
    act(() => {
      vi.advanceTimersByTime(3001);
    });
    expect(optionFor(RISKY).getAttribute('data-question-armed')).toBeNull();
    tap(optionFor(RISKY));
    expect(optionFor(RISKY).getAttribute('data-question-armed')).toBe('true');
    expect(optionFor(RISKY).getAttribute('data-picked')).toBeNull();
    vi.useRealTimers();
  });

  it('never blocks Submit: an armed-but-unconfirmed row is simply unmarked, not a stuck write', async () => {
    const asked: unknown[] = [];
    const session: Session = { ...SESSION, questions: [QUESTION], vamControlled: true };
    draw({
      phone: true,
      delivers: true,
      entry: { project: { id: 'p1', name: 'atlas', sessions: [session] }, session },
      answer: async (_projectId, request) => {
        asked.push(request);
        return { kind: 'sent', answer: 'Yes' };
      },
    });
    tap(optionFor(RISKY)); // arms only -- not marked
    tap(optionFor(PLAIN)); // marks the plain option
    const submit = q('[data-question-submit]') as HTMLButtonElement;
    await act(async () => {
      submit.click();
      await Promise.resolve();
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual({
      steps: [{ question: QUESTION.question, labels: [PLAIN], multiSelect: false }],
    });
  });
});
