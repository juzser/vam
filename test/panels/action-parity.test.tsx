// @vitest-environment happy-dom

/**
 * The action list and the pane are one list, or the pane is lying.
 *
 * `buildActions` decides what `j`/`k` walk and what `Enter` fires; `DetailPanel`
 * decides what is on screen. Nothing used to assert the two agreed, and they
 * stopped agreeing: the governance queue was taken out of the pane while
 * `buildActions` kept contributing two stops per finding and two per lesson
 * ahead of the commands. The cursor walked stops nothing drew, and `Enter` on
 * one of them POSTed a lesson transition to the factory with a status line as
 * the only sign it had happened.
 *
 * So this file asserts the invariant whose absence allowed that: every action
 * the cursor can reach has an element on screen, in the same order, and the
 * focus ring lands on the element the cursor is actually on. An action added
 * with nothing rendered for it fails here.
 *
 * It renders the pane directly, so it cannot see the other way the invariant
 * can break now that the pane can be HIDDEN: a cursor left in a pane that was
 * unmounted rings an action nothing draws, without any action list changing.
 * That half is asserted under every layout in
 * `test/canvas/Canvas.pane-visibility.test.tsx`, against these same
 * `data-action-id` hooks.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildActions } from '../../src/renderer/canvas/actions.js';
import type { Command, Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

const COMMANDS: readonly Command[] = [
  { id: 'c-1', label: 'run the suite', command: 'vitest run' },
  { id: 'c-2', label: 'read the diff', command: 'git diff' },
];

function decision(commands: readonly Command[]): Decision {
  return {
    id: 'd1',
    label: 'step d1',
    input: 'ask d1',
    output: 'answered',
    commands: [...commands],
  };
}

function entry(commands: readonly Command[]): SessionEntry {
  const session: Session = {
    id: 's1',
    title: 'Sprint board reorder',
    icon: null,
    epic: 'board',
    branch: null,
    status: 'waiting',
    runningAgents: 1,
    activity: 'just now',
    age: '12m',
    decisions: [decision(commands)],
  };
  const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
  return { project, session };
}

function draw(commands: readonly Command[], over: Partial<DetailPanelProps> = {}) {
  const props: DetailPanelProps = {
    entry: entry(commands),
    decision: decision(commands),
    draft: '',
    onDraftChange: () => {},
    onSubmit: () => {},
    onCopyCommand: () => {},
    onCopyAllCommands: () => {},
    composing: false,
    onCompose: () => {},
    onStopComposing: () => {},
    active: false,
    actionIndex: 0,
    width: 408,
    resizeHandle: null,
    ...over,
  };
  render(<DetailPanel {...props} />);
}

/** Every action-bearing element the pane drew, in DOM order. */
const drawnIds = () =>
  [...document.querySelectorAll('[data-action-id]')].map((el) => el.getAttribute('data-action-id'));

/** The one element wearing the cursor's ring, by action id. */
const ringed = () =>
  [...document.querySelectorAll('[data-action-id]')]
    .filter((el) => el.classList.contains('border-waiting'))
    .map((el) => el.getAttribute('data-action-id'));

afterEach(cleanup);

describe('the action list contains exactly what the pane renders', () => {
  it('draws one element per action, in the order the cursor walks them', () => {
    draw(COMMANDS);
    expect(drawnIds()).toEqual(buildActions(COMMANDS).map((action) => action.id));
  });

  it('still agrees when the step proposed no commands', () => {
    // The prompt is the one action that does not depend on the factory having
    // asked anything, so `I` always has somewhere to land — and something to
    // look at when it lands.
    draw([]);
    expect(buildActions([]).map((a) => a.id)).toEqual(['prompt']);
    expect(drawnIds()).toEqual(['prompt']);
  });

  it('puts the ring on the element the cursor is on, for every index', () => {
    // The failure this catches is an off-by-N: actions the pane does not draw
    // shift every index, so the ring sits on a row the operator did not pick
    // while `Enter` fires something else.
    const actions = buildActions(COMMANDS);
    for (const [index, action] of actions.entries()) {
      draw(COMMANDS, { active: true, actionIndex: index });
      expect(ringed()).toEqual([action.id]);
      cleanup();
    }
  });

  it('rings nothing while the keyboard is elsewhere', () => {
    draw(COMMANDS, { active: false, actionIndex: 0 });
    expect(ringed()).toEqual([]);
  });
});
