// @vitest-environment happy-dom

/**
 * THE CAUSE REACHES THE SCREEN.
 *
 * `waitingFor` is what the session itself says it is blocked on -- the only
 * surface that can say so, because a tool-approval prompt writes no transcript
 * record. The pane computed it and then used it as a boolean gate: an operator
 * saw "this session needs you" and had to open it to learn whether it wanted a
 * `rm` approved or an answer typed.
 *
 * IT DOES NOT BRING BACK THE NOTICE. The bordered amber block above the prompt
 * input was removed at the operator's request (#264) and stays removed; these
 * assert the cause on the CONDENSED PROGRESS LINE, beside the turn count and
 * the activity, in the middot idiom that row already speaks.
 *
 * Every assertion below reads RENDERED TEXT. A test that only proved the
 * variable was computed is the exact failure this file exists to catch: the
 * value was computed correctly the whole time.
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

const cause = () => document.querySelector<HTMLElement>('[data-progress-waiting]');
const line = () => document.querySelector<HTMLElement>('[data-progress-line]');

afterEach(cleanup);

describe('the waiting cause on the progress line', () => {
  it('prints the cause the session named, as text on the line', () => {
    draw({ waitingFor: 'permission prompt' });
    expect(cause()?.textContent).toBe('permission prompt');
    expect(line()?.textContent).toContain('permission prompt');
  });

  it('prints an unfamiliar cause verbatim rather than swallowing it', () => {
    // The observed values are a sample of an open set (`session-status.ts`),
    // so this is not an enum and a value vam has never seen is still the
    // truest thing anyone can say about that session.
    draw({ waitingFor: 'ratchet inspection' });
    expect(cause()?.textContent).toBe('ratchet inspection');
  });

  it('says nothing when the session is waiting but named no cause', () => {
    // PRESENT AND NULL is "waiting, cause unnamed". An unknown cause is not a
    // cause, and a word invented here would be indistinguishable on screen
    // from one the session actually reported.
    draw({ waitingFor: null });
    expect(cause()).toBeNull();
  });

  it('says nothing when no surface reports anyone is waiting', () => {
    draw({});
    expect(cause()).toBeNull();
  });

  it('keeps the turns-read count beside the cause, not replaced by it', () => {
    draw({ waitingFor: 'permission prompt' });
    expect(document.querySelector('[data-progress-count]')?.textContent).toBe('1 turns read');
  });

  it('does not bring back the notice the operator had removed', () => {
    draw({ waitingFor: 'permission prompt', vamControlled: true, questions: [] });
    expect(document.querySelector('[data-session-waiting]')).toBeNull();
    expect(document.querySelector('[data-question-bar]')).toBeNull();
  });
});
