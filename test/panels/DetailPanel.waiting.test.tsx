// @vitest-environment happy-dom

/**
 * A session that is waiting on a person — and what the pane says about it now
 * that the notice above the prompt input is gone.
 *
 * THE NOTICE WAS REMOVED at the operator's request: `WaitingNote`, the amber
 * `waiting on you — <cause>` block with its reachability line, drew above the
 * composer on every waiting session and is deleted, component included.
 *
 * RETIRED WITH IT (each asserted the removed element, and would now pass by
 * asserting nothing):
 *   - 'is absent for a session nothing says is waiting on a person'
 *   - 'is drawn for a session with no question at all -- which is the whole case'
 *   - 'prints a cause it has never seen rather than dropping the session'
 *   - 'says the session did not name a cause, rather than inventing one'
 *   - 'offers the terminal only for a session vam started'
 *   - 'names the reason it cannot answer one vam did not start'
 *   - 'does not claim it cannot reach a session it never got to ask about'
 *   - 'stands down once a card with an open step is drawn, delivering or not'
 *   - 'stands down for the very same open card when it cannot deliver'
 * The last two pinned the note STANDING DOWN under an open card; with no note
 * to stand down they are true of an empty document.
 *
 * WHAT IS LEFT, and is still this pane's own: the QuestionCard's amber, which
 * is the pane's remaining "somebody is blocked on you" colour, and the rule
 * that a waiting session with no question draws no empty bar where the notice
 * used to be. Outside this pane a waiting session is still visible in the
 * sidebar row (`data-row-needs-you`), its group count, the command palette and
 * the phone list — what is gone with the notice is the CAUSE and the
 * reachability sentence, which nothing else has ever drawn.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

const SESSION: Session = {
  id: 's1',
  title: 'Provider survey',
  icon: null,
  epic: null,
  branch: null,
  status: 'waiting',
  runningAgents: 0,
  activity: null,
  age: '3m',
  decisions: [{ id: 'd1', label: 'plan', input: 'ask me', output: 'asked', commands: [] }],
};

function draw(over: Partial<Session> = {}, props: Partial<DetailPanelProps> = {}) {
  const session: Session = { ...SESSION, ...over };
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
      width={408}
      resizeHandle={null}
      {...props}
    />,
  );
}

const note = () => document.querySelector<HTMLElement>('[data-session-waiting]');
const card = () => document.querySelector<HTMLElement>('[data-question]');

afterEach(cleanup);

describe('the removed waiting notice', () => {
  it('draws no waiting note for a session that is waiting on a person', () => {
    draw({ waitingFor: 'permission prompt', vamControlled: true, questions: [] });
    expect(note()).toBeNull();
  });

  it('leaves no empty bar where the notice used to be', () => {
    // The block around the notice was drawn on `waitingFor !== undefined`
    // too. Removing only the notice would have left 25px of bordered nothing
    // on every waiting session -- the seam without the thing it seams.
    draw({ waitingFor: 'permission prompt', vamControlled: true, questions: [] });
    expect(document.querySelector('[data-question-bar]')).toBeNull();
  });

  it('still draws the bar when there is a question to put in it', () => {
    draw({
      waitingFor: 'permission prompt',
      vamControlled: true,
      questions: [
        {
          id: 'tool-1:0',
          header: null,
          question: 'Which colour do you prefer?',
          multiSelect: false,
          options: [{ label: 'Crimson', description: null }],
          answer: null,
        },
      ],
    });
    expect(document.querySelector('[data-question-bar]')).not.toBeNull();
    expect(card()).not.toBeNull();
  });
});

describe('the question card keeps the pane’s remaining waiting colour', () => {
  it('does not spend the amber on a fully-resolved set nothing is blocked on', () => {
    // `onAnswer !== null` alone is not "live" -- a resolved set keeps a
    // delivering, vam-controlled card long after its last step settled, and
    // `--color-waiting` is reserved for a session actually waiting on you.
    draw(
      {
        waitingFor: 'permission prompt',
        vamControlled: true,
        questions: [
          {
            id: 'tool-1:0',
            header: null,
            question: 'Which colour do you prefer?',
            multiSelect: false,
            options: [{ label: 'Crimson', description: null }],
            answer: 'Crimson',
          },
        ],
      },
      { delivers: true, answer: async () => ({ kind: 'sent', answer: 'Crimson' }) },
    );
    expect(card()).not.toBeNull();
    expect(card()?.dataset.questionWaiting).toBeUndefined();
    expect(card()?.className).toContain('border-line-strong');
    expect(card()?.className).not.toContain('border-waiting');
  });

  it('spends the amber on the same fixture once a step is still open', () => {
    draw(
      {
        waitingFor: 'permission prompt',
        vamControlled: true,
        questions: [
          {
            id: 'tool-1:0',
            header: null,
            question: 'Which colour do you prefer?',
            multiSelect: false,
            options: [{ label: 'Crimson', description: null }],
            answer: null,
          },
        ],
      },
      { delivers: true, answer: async () => ({ kind: 'sent', answer: 'Crimson' }) },
    );
    expect(card()).not.toBeNull();
    expect(card()?.dataset.questionWaiting).toBe('true');
    expect(card()?.className).toContain('border-waiting');
  });
});
