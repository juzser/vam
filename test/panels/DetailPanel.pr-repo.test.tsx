// @vitest-environment happy-dom

/**
 * THE CONTROL THAT POINTS A PROJECT SOMEWHERE ELSE.
 *
 * `test/prefs/prefs.pr-repo.test.ts` holds the stored shape and
 * `test/sources/pr-repo-crossing.test.ts` holds main's copy of it. This is the
 * half that makes the preference a FEATURE rather than a field: the operator
 * can see which directory the pane is asking from, and change it.
 *
 * THAT IS NOT A FORMALITY IN THIS REPO. `dismissedSessions` shipped with a
 * field, a reader, a migration, three helpers and its own test file, and NOT
 * ONE CALLER -- fifty commits, entirely green, describing in the present tense
 * a capability the operator did not have.
 * `test/prefs/prefs.no-write-only-field.test.ts` exists because of it.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE: what the row PAINTS. happy-dom lays
 * nothing out. What is asserted is what is in the DOM, what the buttons call,
 * and -- the part that matters most -- WHEN the directory is named at all.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { t } from '../../src/renderer/i18n/strings.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

const DIR = '/Users/someone/code/other-repo';

const DECISION: Decision = {
  id: 'd1',
  label: 'turn',
  input: 'ask',
  output: 'done',
  commands: [],
};

function draw(over: Partial<DetailPanelProps> = {}) {
  const session: Session = {
    id: 's1',
    title: 'Provider survey',
    icon: null,
    epic: null,
    branch: 'topic/rework',
    status: 'running',
    runningAgents: 0,
    activity: null,
    age: '3m',
    decisions: [DECISION],
    pullRequests: { kind: 'ok', prs: [] },
  };
  const project: Project = {
    id: 'p1',
    name: 'factory',
    source: 'claude-code',
    sessions: [session],
  };
  const entry: SessionEntry = { project, session };
  render(
    <DetailPanel
      entry={entry}
      decision={DECISION}
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
      tabRequest={{ tab: 'PRs' }}
      {...over}
    />,
  );
}

const row = () => document.querySelector<HTMLElement>('[data-prs-repo]');
const choose = () => document.querySelector<HTMLElement>('[data-prs-repo-choose]');
const clear = () => document.querySelector<HTMLElement>('[data-prs-repo-clear]');

afterEach(cleanup);

describe('the PRs pane says where it is asking from', () => {
  it('draws nothing at all where there is no directory picker', () => {
    // The browser build and the phone: `dialog` is a desktop bridge, so
    // `Canvas` hands no `prRepo` at all. A control that cannot open a picker
    // is a control that cannot act, and drawing a disabled one would be the
    // same defect wearing a grey coat.
    draw();
    expect(row()).toBeNull();
  });

  it('offers the way to change it even while nothing is overridden', () => {
    // The way IN has to be reachable before there is anything to change:
    // otherwise the operator with a factory session has a wrong answer and no
    // affordance anywhere near it.
    draw({ prRepo: { directory: null, choose: () => {}, clear: () => {} } });
    expect(row()).not.toBeNull();
    expect(choose()).not.toBeNull();
    // And nothing to clear yet -- a control that undoes nothing.
    expect(clear()).toBeNull();
  });

  it('does not name a directory nobody chose', () => {
    // A row on every session spelling out the session's own path is a sentence
    // restating the default, on a narrow pane, forever.
    draw({ prRepo: { directory: null, choose: () => {}, clear: () => {} } });
    // BOUND TO THE CATALOGUE, not to a copy of the sentence. A test carrying
    // its own literal passes while the two drift, which is the bug a catalogue
    // exists to make impossible.
    expect(row()?.textContent).toContain(t('prs.repo.own'));
    expect(row()?.getAttribute('data-prs-repo-overridden')).toBeNull();
  });

  it('names the directory once the project is pointed at one', () => {
    // FROM HERE ON THE PANE IS ANSWERING ABOUT A REPOSITORY THE SESSION IS NOT
    // IN, and that may never be silent -- it is the whole reason the answer
    // looked wrong rather than aimed wrong before this existed.
    draw({ prRepo: { directory: DIR, choose: () => {}, clear: () => {} } });
    expect(row()?.textContent).toContain(DIR);
    expect(row()?.textContent).toContain(t('prs.repo.overridden', { directory: DIR }));
    expect(row()?.getAttribute('data-prs-repo-overridden')).toBe('true');
    // The whole path stays readable even when the column truncates it.
    expect(row()?.querySelector('[title]')?.getAttribute('title')).toBe(DIR);
  });

  it('labels both acts from the catalogue, in the case they paint', () => {
    // The copy is the operator's only clue about which of the two buttons
    // undoes the override, and this surface stores its own case: no stylesheet
    // capitalises it, and -- being drawn only where a directory picker exists
    // -- no browser guard can reach it to check that one did.
    // TWO LABELS FOR ONE BUTTON, because the act is not the same act: with
    // nothing overridden it offers another directory, and once one is chosen
    // it changes the one named beside it.
    draw({ prRepo: { directory: null, choose: () => {}, clear: () => {} } });
    expect(choose()?.textContent).toBe(t('prs.repo.choose'));
    cleanup();
    draw({ prRepo: { directory: DIR, choose: () => {}, clear: () => {} } });
    expect(choose()?.textContent).toBe(t('prs.repo.change'));
    expect(clear()?.textContent).toBe(t('prs.repo.clear'));
  });

  it('asks for a directory when the operator presses it', () => {
    const pick = vi.fn();
    draw({ prRepo: { directory: null, choose: pick, clear: () => {} } });
    fireEvent.click(choose() as HTMLElement);
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it('offers the way back, and takes it once it is taken', () => {
    const back = vi.fn();
    draw({ prRepo: { directory: DIR, choose: () => {}, clear: back } });
    fireEvent.click(clear() as HTMLElement);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('is reachable by a keyboard, both of them', () => {
    // The pane is driven from the keyboard; a control only a pointer can reach
    // is a control half this app's operators do not have.
    draw({ prRepo: { directory: DIR, choose: () => {}, clear: () => {} } });
    for (const button of [choose(), clear()]) {
      expect(button?.tagName).toBe('BUTTON');
      expect(button?.getAttribute('type')).toBe('button');
      expect(button?.tabIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it('stays on screen when vam could not ask at all', () => {
    // THE STATE THIS FEATURE EXISTS FOR. A directory that is gone, or one with
    // no GitHub remote, is exactly when the operator needs the way to point it
    // elsewhere -- and a footer that only drew beside a LIST would vanish at
    // that moment.
    draw({
      prRepo: { directory: DIR, choose: () => {}, clear: () => {} },
      entry: null,
    });
    // With no entry there is no project, so `Canvas` would hand no control --
    // this renders the prop directly, which is the case the pane must handle.
    expect(screen.queryByText(t('prs.repo.overridden', { directory: DIR }))).not.toBeNull();
  });
});
