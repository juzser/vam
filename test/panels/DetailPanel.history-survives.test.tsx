// @vitest-environment happy-dom

/**
 * EC-66 (operator event #71): earlier prompts and responses vanish from the
 * Response view after idle or after a while.
 *
 * Two hypotheses were on the table and this file measures both:
 *  (A) the live window slides: the poll rebuilds `entry.session.decisions` from
 *      a byte window, so a turn that leaves its old end is gone from the poll;
 *  (B) the pane is re-keyed or remounted on an idle round trip.
 *
 * The result of the measurement at the base commit is recorded in the task's
 * result file; whichever variant passes there stays here as a pin.
 */

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import { DetailPanel } from '../../src/renderer/panels/DetailPanel.js';
import type { TranscriptReader } from '../../src/renderer/sources/history-reader.js';
import { HistoryReaderProvider } from '../../src/renderer/sources/history-reader.js';
import type { TranscriptPage } from '../../src/shared/history.js';

const turn = (n: number): Decision => ({
  id: `t${n}`,
  label: `step ${n}`,
  input: `ask number ${n}`,
  output: `answer number ${n}`,
  commands: [],
});

/** Turns `from`..`to` inclusive, NEWEST first, the ordering `model.ts` promises. */
const turns = (from: number, to: number): readonly Decision[] =>
  Array.from({ length: to - from + 1 }, (_, i) => turn(to - i));

const sessionWith = (decisions: readonly Decision[], over: Partial<Session> = {}): Session => ({
  vamControlled: true,
  id: 's1',
  title: 'A long one',
  epic: null,
  branch: null,
  status: 'running',
  runningAgents: 0,
  activity: null,
  age: '12m',
  decisions,
  ...over,
});

function panel(session: Session, reader: TranscriptReader | null) {
  // A NEW entry object and a NEW project object every call: the poll rebuilds
  // both wholesale, and a test that reused them would hide an identity key.
  const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
  return (
    <HistoryReaderProvider value={reader}>
      <DetailPanel
        entry={{ project, session }}
        decision={session.decisions[0] ?? null}
        draft=""
        onDraftChange={() => {}}
        onSubmit={() => {}}
        composing={false}
        onCompose={() => {}}
        onStopComposing={() => {}}
        active={false}
        actionIndex={0}
        width={520}
        resizeHandle={null}
        delivers
      />
    </HistoryReaderProvider>
  );
}

const turnEls = () => [...document.querySelectorAll('[data-column-turn]')];
const turnIds = () => turnEls().map((el) => el.getAttribute('data-column-turn'));
const ids = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `t${from + i}`);

/** Every turn's own prompt and response, found inside ITS block. */
function expectWholeHistory(from: number, to: number) {
  expect(turnIds()).toEqual(ids(from, to));
  for (const el of turnEls()) {
    const n = (el.getAttribute('data-column-turn') ?? '').slice(1);
    expect(el.textContent).toContain(`ask number ${n}`);
    expect(el.textContent).toContain(`answer number ${n}`);
  }
}

afterEach(cleanup);

describe('EC-66 history survives', () => {
  it('(A) a turn that leaves the poll window stays in the column, in order, once', () => {
    const view = render(panel(sessionWith(turns(1, 12)), null));
    expectWholeHistory(1, 12);
    // The poll's next entry: the byte window slid. t1..t4 are gone, 2 are new.
    view.rerender(panel(sessionWith(turns(5, 14)), null));
    expectWholeHistory(1, 14);
    // And a further slide keeps what it kept.
    view.rerender(panel(sessionWith(turns(8, 16)), null));
    expectWholeHistory(1, 16);
  });

  it('(B) an idle round trip with a rebuilt entry and a changed listing field', () => {
    const view = render(panel(sessionWith(turns(1, 12)), null));
    view.rerender(panel(sessionWith(turns(1, 12), { status: 'idle', age: '31m' }), null));
    expectWholeHistory(1, 12);
    view.rerender(
      panel(sessionWith(turns(1, 12), { status: 'running', age: '0m', title: 'renamed' }), null),
    );
    expectWholeHistory(1, 12);
    // Then the pane remounts over the same session.
    view.unmount();
    render(panel(sessionWith(turns(1, 12), { status: 'running' }), null));
    expectWholeHistory(1, 12);
  });

  it('a different session starts clean: nothing retained crosses over', () => {
    const view = render(panel(sessionWith(turns(1, 12)), null));
    view.rerender(panel(sessionWith(turns(5, 14)), null));
    view.rerender(panel(sessionWith(turns(20, 22), { id: 's2' }), null));
    expect(turnIds()).toEqual(ids(20, 22));
  });

  it('a paint vam made itself (unconfirmed) is never kept once it is retracted', () => {
    const paint: Decision = { ...turn(13), id: 'vam-pending-1', unconfirmed: true };
    const view = render(panel(sessionWith([paint, ...turns(1, 12)]), null));
    expect(turnIds()).toContain('vam-pending-1');
    // The write was refused: the paint is removed outright.
    view.rerender(panel(sessionWith(turns(1, 12)), null));
    expect(turnIds()).toEqual(ids(1, 12));
  });

  it('a walk after a retained slide neither duplicates nor skips a turn', async () => {
    const read = vi.fn<TranscriptReader>(
      async (): Promise<TranscriptPage> => ({
        kind: 'page',
        turns: [turn(4), turn(3)],
        cursor: '@300',
        reachedStart: false,
      }),
    );
    const view = render(panel(sessionWith(turns(5, 14)), read));
    view.rerender(panel(sessionWith(turns(8, 16)), read));
    expect(turnIds()).toEqual(ids(5, 16));
    const button = document.querySelector<HTMLElement>('[data-column-more] button');
    await act(async () => {
      fireEvent.click(button as HTMLElement);
    });
    // Asked for the turns before the OLDEST one held -- the retained t5.
    expect(read).toHaveBeenCalledExactlyOnceWith('s1', 't5');
    await waitFor(() => expect(turnIds()).toEqual(ids(3, 16)));
  });
});
