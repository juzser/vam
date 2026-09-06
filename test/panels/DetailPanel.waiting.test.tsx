// @vitest-environment happy-dom

/**
 * A session that is waiting on a person, and vam is not always able to answer.
 *
 * WHY THIS IS NOT THE QUESTION CARD. The card is drawn from `AskUserQuestion`
 * records in the transcript. The commonest thing a session actually waits on
 * -- a tool-approval prompt -- writes NO transcript record while it is open,
 * so `questions` is empty and the card is absent, and until now the pane drew
 * nothing whatever for a session that was stuck. This block is drawn from the
 * session's own per-process file instead, which is the only surface that says
 * so.
 *
 * THE ASYMMETRY IS THE DESIGN. vam can SEE any session waiting; it can only
 * TYPE INTO one it started. A session it cannot reach must say so and say why,
 * rather than looking identical to one it can drive.
 */

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import type { PromptView } from '../../src/shared/answer.js';

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
const text = () => note()?.textContent ?? '';
const card = () => document.querySelector<HTMLElement>('[data-question]');

const PROMPT: PromptView = {
  kind: 'prompt',
  prompt: { title: 'Do you want to run this command?', options: ['Yes', 'No'] },
};

afterEach(cleanup);

describe('the waiting note', () => {
  it('is absent for a session nothing says is waiting on a person', () => {
    // `status: waiting` is NOT this fact: it covers every session that is not
    // running, most of which are sitting idle with nobody blocked.
    draw();
    expect(note()).toBeNull();
  });

  it('is drawn for a session with no question at all -- which is the whole case', () => {
    draw({ waitingFor: 'permission prompt', questions: [] });
    expect(note()).not.toBeNull();
    expect(text()).toContain('permission prompt');
  });

  it('prints a cause it has never seen rather than dropping the session', () => {
    // Two values were observed on one machine. Anything else -- plan approval,
    // whatever the CLI adds next -- still means the operator is being waited
    // on, and the CLI's own word beats an empty pane.
    draw({ waitingFor: 'plan approval' });
    expect(text()).toContain('plan approval');
  });

  it('says the session did not name a cause, rather than inventing one', () => {
    draw({ waitingFor: null });
    expect(note()).not.toBeNull();
    expect(text()).not.toContain('null');
    expect(text().toLowerCase()).toContain('did not say');
  });

  it('offers the terminal only for a session vam started', () => {
    draw({ waitingFor: 'permission prompt', vamControlled: true });
    expect(note()?.dataset['waitingReach']).toBe('answerable');
    expect(text()).toContain('Terminal');
  });

  it('names the reason it cannot answer one vam did not start', () => {
    draw({ waitingFor: 'permission prompt', vamControlled: false });
    expect(note()?.dataset['waitingReach']).toBe('unreachable');
    // A bare "cannot" is the refusal this codebase keeps having to fix.
    expect(text()).toContain('did not start');
  });

  it('does not claim it cannot reach a session it never got to ask about', () => {
    // vamControlled ABSENT is "vam could not ask tmux", which is not "vam did
    // not start this". Collapsing the two states is how a pane starts telling
    // the operator a fact it never established.
    draw({ waitingFor: 'permission prompt' });
    expect(note()?.dataset['waitingReach']).toBe('unknown');
    expect(text()).not.toContain('did not start');
  });

  it('stands down once a card with an open step is drawn, delivering or not (approval case, pull request 211)', async () => {
    // The old pairing drew BOTH: the note's remedy line pointed at the
    // Terminal tab while the card's own `data-question-note` stated a
    // DIFFERENT route ("type your choice in the box below") inches below
    // it -- two sentences, two routes, on one ask
    // (`permission-prompt-desktop.png`). An open card IS the waiting
    // surface; it carries a route sentence of its own either way.
    draw(
      { waitingFor: 'permission prompt', vamControlled: true, questions: [] },
      {
        delivers: true,
        prompt: async () => PROMPT,
        answer: async () => ({ kind: 'sent', answer: 'Yes' }),
      },
    );
    await waitFor(() => expect(card()).not.toBeNull());
    expect(note()).toBeNull();
    expect(card()?.dataset.questionWaiting).toBe('true');
  });

  it('stands down for the very same open card when it cannot deliver -- the demo default', () => {
    // The demo fixture (`?demo=1`) never delivers, so this is the state
    // `permission-prompt-desktop.png` itself was taken from: `onAnswer` is
    // `null`, but the card is still open, still carries the ask and its own
    // route sentence ("vam cannot answer this for you ... type your choice
    // in the box below"). Suppression keys on `open`, not on `onAnswer`.
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
    expect(card()).not.toBeNull();
    expect(note()).toBeNull();
    expect(card()?.dataset.questionWaiting).toBe('true');
  });

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
