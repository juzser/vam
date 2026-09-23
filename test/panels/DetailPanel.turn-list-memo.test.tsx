// @vitest-environment happy-dom

/**
 * `mergedColumn`/`orderedTurns` (`DetailPanel.tsx`, right above where
 * `columnOf` is called) used to be recomputed on EVERY render -- `columnOf`
 * merges `entry.session.decisions` with the pager's older pages, and
 * `orderedTurns` then reverses that merge, and neither was behind a
 * `useMemo`. A poll ten seconds apart legitimately changes those inputs, but
 * a render an unrelated prop causes (a resize, a `width` change from the
 * split pane's own drag, `active` flipping) does not, and re-running a merge
 * plus an array-copying reverse over however many turns a session carries on
 * every one of THOSE renders is the other half of the render-storm finding
 * this task closes (`Canvas.detail-keystroke-scaling.test.tsx` closes the
 * export/props half).
 *
 * MEASURED BY WRAPPING `columnOf` ITSELF, the same technique
 * `Canvas.sidebar-keystroke-scaling.test.tsx` uses for `SessionList`, but on
 * a plain function rather than a component: the mock delegates to the REAL
 * `columnOf` (so the pane still draws correctly) while counting calls. A
 * `useMemo`'d `mergedColumn` calls it exactly once per MOUNT and never again
 * for a re-render that changes neither `entry.session.decisions` nor the
 * pager's `older` page; an unmemoized one calls it again on every re-render,
 * unrelated prop or not.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { AgentWorkReaderProvider } from '../../src/renderer/sources/agent-work-reader.js';

const calls = vi.hoisted(() => ({ columnOf: 0 }));

vi.mock('../../src/renderer/panels/transcript-history.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/renderer/panels/transcript-history.js')>();
  return {
    ...actual,
    columnOf: (...args: Parameters<typeof actual.columnOf>) => {
      calls.columnOf += 1;
      return actual.columnOf(...args);
    },
  };
});

// Imported AFTER the mock above so the module under test picks up the
// wrapped `columnOf` -- `vi.mock` is hoisted by vitest regardless of import
// order textually, but keeping the import below the mock keeps that fact
// from mattering here.
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

function decision(id: string): Decision {
  return { id, label: `step ${id}`, input: `ask ${id}`, output: `out-${id}`, commands: [] };
}

const DECISIONS: readonly Decision[] = [decision('d3'), decision('d2'), decision('d1')];

const SESSION: Session = {
  id: 's1',
  title: 'a session',
  icon: null,
  epic: null,
  branch: null,
  status: 'waiting',
  runningAgents: 0,
  activity: null,
  age: null,
  decisions: DECISIONS,
};

const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
const ENTRY: SessionEntry = { project: PROJECT, session: SESSION };

function build(over: Partial<DetailPanelProps>): DetailPanelProps {
  return {
    entry: ENTRY,
    decision: DECISIONS[0] as Decision,
    draft: '',
    onDraftChange: () => {},
    onSubmit: () => {},
    composing: false,
    onCompose: () => {},
    onStopComposing: () => {},
    active: false,
    actionIndex: 0,
    width: 408,
    resizeHandle: null,
    ...over,
  };
}

afterEach(() => {
  cleanup();
});

describe('the turn column is memoized against the inputs that build it', () => {
  it("does not re-merge or re-reverse the turn list on a re-render that changes neither the session's decisions nor the pager", () => {
    const wrap = (over: Partial<DetailPanelProps>) => (
      <AgentWorkReaderProvider value={null}>
        <DetailPanel {...build(over)} />
      </AgentWorkReaderProvider>
    );
    const view = render(wrap({}));
    // `columnOf` runs at least once to paint the mount -- reset AFTER it, so
    // only the RE-RENDER's own calls are counted.
    const afterMount = calls.columnOf;
    expect(afterMount).toBeGreaterThanOrEqual(1);

    // An unrelated prop change: `active` flips, `entry` (and therefore
    // `entry.session.decisions`) keeps the exact same reference.
    view.rerender(wrap({ active: true }));
    expect(calls.columnOf).toBe(afterMount);

    // AND a genuinely new `entry.session.decisions` reference (a poll
    // landing, or a fresh session object entirely) still recomputes --
    // otherwise a perfect-looking zero above could just as easily mean the
    // memo is wired to a constant that never changes at all.
    const newDecisions: readonly Decision[] = [decision('d4'), ...DECISIONS];
    const freshEntry: SessionEntry = {
      project: PROJECT,
      session: { ...SESSION, decisions: newDecisions },
    };
    view.rerender(wrap({ entry: freshEntry }));
    expect(calls.columnOf).toBe(afterMount + 1);
  });
});
