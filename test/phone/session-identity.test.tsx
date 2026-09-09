// @vitest-environment happy-dom

/**
 * One identity block on the session screen, not two.
 *
 * VERIFIED DUPLICATION, both visible in `session-390-dark.png`: the app bar
 * prints the session title and the project name at y≈15 and y≈35, and
 * `DetailPanel`'s header card printed the same title again at y≈113 and
 * `project · epic · N agents` at y≈134. The only facts the card held that the
 * bar did not are the epic and the agent count. On an 844px screen where chrome
 * already reaches ~275px before a word of the session, that card is the
 * cheapest ~48px available (UI spec D2).
 *
 * What must NOT be lost with it is `data-prompt-target`. Its job is to name the
 * session about to be written to -- one composer serving many sessions is the
 * easiest way to send the right words to the wrong agent -- so it moves onto
 * the bar's title rather than disappearing.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Project } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel } from '../../src/renderer/panels/DetailPanel.js';
import { FIVE_STEPS, installPhoneGlobals, phoneSource, session } from './harness.js';

const SESSION = session('a1', {
  title: 'factory-sse-1',
  epic: 'ui-server-sse',
  status: 'waiting',
  runningAgents: 3,
  decisions: FIVE_STEPS,
});

const MODEL: CanvasModel = {
  projects: [{ id: 'p1', name: 'factory', source: 'claude-code', sessions: [SESSION] }],
};

beforeAll(() => installPhoneGlobals());
afterEach(() => cleanup());

function openSession() {
  render(<Canvas model={MODEL} source={phoneSource()} />);
  act(() => {
    fireEvent.click(document.querySelector('[data-session-row]') as Element);
  });
  return document.querySelector('[data-phone-shell="session"]') as HTMLElement;
}

describe('the phone session screen’s identity', () => {
  it('names the session once, in the app bar, and keeps the prompt target there', () => {
    const screen = openSession();
    const targets = [...screen.querySelectorAll('[data-prompt-target]')];
    expect(targets.length, 'one prompt target, not two and not none').toBe(1);
    expect(targets[0]?.textContent).toBe('factory-sse-1');
    expect(targets[0]?.closest('header'), 'it belongs to the app bar now').not.toBeNull();
    // The card that repeated it is gone, not restyled -- and so is the app
    // bar's own second line, which is where the project name used to be.
    expect(screen.querySelectorAll('[data-prompt-project]').length).toBe(0);
    expect(screen.querySelector('[data-pane-status]'), 'the card’s status dot').toBeNull();
  });

  it('drops the bar’s second line, keeping the count on the Agents control', () => {
    // Was: the epic and the agent count, folded out of the deleted header card
    // into a SECOND line on the app bar reading `factory · ui-server-sse ·
    // 3 agents`. The operator asked for one row, so that line is gone. The
    // count is not lost with it -- it moved to the Agents view icon, in the
    // label and beside the glyph. The epic IS lost on the phone, which is the
    // price of the row and is stated in `PhoneShell.tsx`.
    const header = openSession().querySelector('header') as HTMLElement;
    expect(header.querySelector('[data-prompt-project]')).toBeNull();
    expect(header.textContent).not.toContain('ui-server-sse');
    expect(header.querySelector('[data-prompt-target]')?.textContent).toBe('factory-sse-1');
    const agents = header.querySelector('[data-phone-view="agents"]') as HTMLElement;
    expect(agents.getAttribute('aria-label')).toBe('Agents, 3 running');
    // Three unlabelled glyphs where three labelled words were would be a real
    // loss; every one of them says what it is.
    expect(
      [...header.querySelectorAll('[data-phone-view]')].map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Response', 'PRs', 'Agents, 3 running']);
    expect(agents.textContent, 'the count, still a digit on screen').toContain('3');
  });

  it('draws no step counter, because the rail it was stuck to is gone', () => {
    // Was: the `STEP 5/5` counter is `sticky right-0` so it survives the chips
    // scrolling past it inside the rail's `overflow-x-auto`. Both the rail and
    // the counter are off the phone now; the session's identity above is what
    // is left, and it is asserted by the tests around this one.
    const screen = openSession();
    expect(screen.querySelector('[data-step-rail]')).toBeNull();
    expect(screen.textContent).not.toContain('STEP ');
  });
});

describe('the detail pane on a desktop, which shares this component', () => {
  /**
   * RETIRED: `'still draws its header card, title, project, epic and all'`.
   * At the time this file was written, the phone had already dropped its
   * copy of the identity block and the desktop had not — this test was the
   * control proving the desktop side was untouched. A12.2 removes the
   * desktop header too (`[data-prompt-target]`, `[data-prompt-project]` and
   * `[data-pane-status]` are all gone from `DetailPanel.tsx`), so the two
   * sides converge and this file's own premise — "one shares the component,
   * one does not" — is no longer true for the header.
   *
   * REWRITTEN AGAIN: its replacement pinned project and epic onto the
   * column's identity line, and the operator has now asked for both to go
   * ("remove the branch and repo information above the In section") — the
   * sidebar already files the session under its project heading and prints
   * its branch on the row. So neither the header card NOR the identity line
   * carries them, and that is what this asserts: the header stays gone, and
   * the line that briefly inherited it does not quietly grow it back.
   */
  it('carries neither project nor epic once the header card is gone', () => {
    const project: Project = { id: 'p1', name: 'factory', sessions: [SESSION] };
    const entry: SessionEntry = { project, session: SESSION };
    render(
      <DetailPanel
        entry={entry}
        decision={SESSION.decisions[0] ?? null}
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
        delivers
        answer={async () => ({ kind: 'sent', answer: 'x' })}
      />,
    );
    expect(document.querySelector('[data-prompt-target]')).toBeNull();
    expect(document.querySelector('[data-pane-status]')).toBeNull();
    const identity = document.querySelector('[data-detail-identity]')?.textContent ?? '';
    expect(identity).not.toContain('factory');
    expect(identity).not.toContain('ui-server-sse');
    // The line itself stays: it is the turn's own meta slot, and `you` is
    // the part of it that has nowhere else to live.
    expect(identity).toContain('you');
  });

  it('keeps the view icon row, which only the phone lost', () => {
    const project: Project = { id: 'p1', name: 'factory', sessions: [SESSION] };
    const entry: SessionEntry = { project, session: SESSION };
    render(
      <DetailPanel
        entry={entry}
        decision={SESSION.decisions[0] ?? null}
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
        delivers
        answer={async () => ({ kind: 'sent', answer: 'x' })}
      />,
    );
    // The removal is `phone`-gated, not a deletion: PRs and Agents are still
    // one press away wherever there is room for it.
    expect(document.querySelector('[data-view-tabs]')).not.toBeNull();
    expect(
      [...document.querySelectorAll('[data-view]')].map((t) => t.getAttribute('data-view')),
    ).toContain('prs');
  });
});
