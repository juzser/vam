// @vitest-environment happy-dom

/**
 * The column asks for more, and keeps what it already had.
 *
 * WHAT THIS FILE CAN AND CANNOT SEE, said up front because the distinction is
 * the whole reason the e2e guard exists. happy-dom has no layout: `scrollTop`
 * is a number nobody computes, `scrollHeight` is zero, and "the turn under the
 * reader's eye did not move" is not a question that can be asked here at all.
 * So the load-bearing evidence for scroll anchoring is
 * `e2e/transcript-column-shots.mjs`, in a real browser, with the numbers
 * printed. What IS asked here is the part that is data rather than paint: which
 * cursor goes out, which of `TranscriptPage`'s four answers is drawn, that one
 * gesture is one walk, and that a poll arriving mid-scroll-back neither
 * duplicates a turn nor loses one.
 */

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import type { TranscriptReader } from '../../src/renderer/sources/history-reader.js';
import { HistoryReaderProvider } from '../../src/renderer/sources/history-reader.js';
import type { TranscriptPage } from '../../src/shared/history.js';

const turn = (id: string): Decision => ({
  id,
  label: `step ${id}`,
  input: `ask ${id}`,
  output: `answer ${id}`,
  commands: [],
});

/** Newest first, the ordering `model.ts` promises. */
const TAIL: readonly Decision[] = [turn('t9'), turn('t8')];

const sessionWith = (decisions: readonly Decision[]): Session => ({
  vamControlled: true,
  id: 's1',
  title: 'A long one',
  icon: null,
  epic: null,
  branch: null,
  status: 'running',
  runningAgents: 0,
  activity: null,
  age: '12m',
  decisions,
});

const page = (over: Partial<Extract<TranscriptPage, { kind: 'page' }>>): TranscriptPage => ({
  kind: 'page',
  turns: [],
  cursor: null,
  reachedStart: true,
  ...over,
});

function draw(reader: TranscriptReader | null, over: Partial<DetailPanelProps> = {}) {
  const session = (over.entry?.session ?? sessionWith(TAIL)) as Session;
  const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
  const entry: SessionEntry = over.entry ?? { project, session };
  const view = render(
    <HistoryReaderProvider value={reader}>
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
        width={520}
        resizeHandle={null}
        delivers
        {...over}
      />
    </HistoryReaderProvider>,
  );
  return {
    rerender: (next: Session) => {
      view.rerender(
        <HistoryReaderProvider value={reader}>
          <DetailPanel
            entry={{ project: { id: 'p1', name: 'atlas', sessions: [next] }, session: next }}
            decision={next.decisions[0] ?? null}
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
            {...over}
          />
        </HistoryReaderProvider>,
      );
    },
  };
}

const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const boundary = () => q('[data-column-start]');
const more = () => q('[data-column-more] button');
const turnIds = () =>
  [...document.querySelectorAll('[data-column-turn]')].map((el) =>
    el.getAttribute('data-column-turn'),
  );

afterEach(cleanup);

describe('a source that cannot page', () => {
  it('says so, and offers no control it cannot honour', () => {
    draw(null);
    expect(boundary()?.getAttribute('data-column-start')).toBe('read-limit');
    expect(q('[data-column-more]')?.getAttribute('data-column-more')).toBe('unsupported');
    // ABSENT, NOT DIMMED -- the rule #284 shipped the block under.
    expect(more()).toBeNull();
    expect(q('[data-column-more]')?.textContent ?? '').toMatch(/cannot read further back/i);
  });
});

describe('a source that can page', () => {
  it('offers a control, and asks for the turns before the OLDEST one on screen', async () => {
    const read = vi.fn(async () =>
      page({ turns: [turn('t7')], cursor: '@700', reachedStart: false }),
    );
    draw(read);
    expect(q('[data-column-more]')?.getAttribute('data-column-more')).toBe('available');
    const button = more();
    expect(button).not.toBeNull();
    await act(async () => {
      button?.click();
    });
    // The id of the oldest turn held -- the cursor shape #283's overlap fix is
    // keyed on. Never `null`, which main reads as "from the newest end".
    expect(read).toHaveBeenCalledExactlyOnceWith('s1', 't8');
  });

  it('PREPENDS the page above what was already drawn, oldest at the top', async () => {
    const read = vi.fn(async () =>
      page({ turns: [turn('t7'), turn('t6')], cursor: '@700', reachedStart: false }),
    );
    draw(read);
    expect(turnIds()).toEqual(['t8', 't9']);
    await act(async () => {
      more()?.click();
    });
    await waitFor(() => expect(turnIds()).toEqual(['t6', 't7', 't8', 't9']));
    // Still more to read, so the control is still offered and the boundary
    // still refuses to claim the session began there.
    expect(boundary()?.getAttribute('data-column-start')).toBe('read-limit');
    expect(more()).not.toBeNull();
  });

  it('walks on through a window that held no whole turn, and never calls it the end', async () => {
    const read = vi.fn(async (_id: string, cursor: string | null) =>
      cursor === 't8'
        ? page({ turns: [], cursor: '@600', reachedStart: false })
        : page({ turns: [turn('t7')], cursor: '@500', reachedStart: false }),
    );
    draw(read);
    await act(async () => {
      more()?.click();
    });
    await waitFor(() => expect(turnIds()).toEqual(['t7', 't8', 't9']));
    expect(read.mock.calls.map((c) => c[1])).toEqual(['t8', '@600']);
    expect(boundary()?.getAttribute('data-column-start')).toBe('read-limit');
  });

  it('draws the START as the start, once the source can prove it', async () => {
    const read = vi.fn(async () => page({ turns: [turn('t7')], cursor: null, reachedStart: true }));
    draw(read);
    await act(async () => {
      more()?.click();
    });
    await waitFor(() =>
      expect(boundary()?.getAttribute('data-column-start')).toBe('session-start'),
    );
    expect(turnIds()).toEqual(['t7', 't8', 't9']);
    // Nothing left to ask for, so there is nothing to ask WITH.
    expect(q('[data-column-more]')).toBeNull();
    expect(boundary()?.textContent ?? '').toMatch(/begins here/i);
  });

  it('a refusal keeps the source own words, and does not look like an ending', async () => {
    const read = vi.fn(async (_id: string, _cursor: string | null) => ({
      kind: 'unavailable' as const,
      error: {
        kind: 'unreachable' as const,
        code: 'transcript-unreadable',
        message: 'the transcript file went away',
      },
    }));
    draw(read);
    await act(async () => {
      more()?.click();
    });
    await waitFor(() =>
      expect(q('[data-column-more]')?.getAttribute('data-column-more')).toBe('unavailable'),
    );
    // "'No PRs' and 'vam could not ask' must never look the same."
    expect(boundary()?.getAttribute('data-column-start')).toBe('read-limit');
    const said = q('[data-column-more]')?.textContent ?? '';
    expect(said).toContain('transcript-unreadable');
    expect(said).toContain('the transcript file went away');
    // A retry IS honourable -- the cursor did not move -- so the control stays.
    expect(more()).not.toBeNull();
    await act(async () => {
      more()?.click();
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1]?.[1]).toBe('t8');
  });

  it('runs ONE walk however many times the control is pressed', async () => {
    let release: (value: TranscriptPage) => void = () => {};
    const read = vi.fn(
      () =>
        new Promise<TranscriptPage>((resolve) => {
          release = resolve;
        }),
    );
    draw(read);
    await act(async () => {
      more()?.click();
    });
    // In flight: the control is replaced by a status line, never dimmed.
    expect(q('[data-column-more]')?.getAttribute('data-column-more')).toBe('reading');
    expect(more()).toBeNull();
    const column = q('[data-detail-column]');
    if (column !== null) {
      column.scrollTop = 0;
      fireEvent.scroll(column);
      fireEvent.scroll(column);
    }
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => {
      release(page({ turns: [turn('t7')], cursor: '@700', reachedStart: false }));
    });
    await waitFor(() => expect(turnIds()).toEqual(['t7', 't8', 't9']));
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('runs ONE walk for two scrolls in the SAME task, before any render', async () => {
    /**
     * THE WINDOW A RENDERED-STATE CHECK CANNOT COVER, and it is why the guard
     * is a ref rather than `pager.phase`.
     *
     * Found by mutation: with the ref's check deleted, every other test in this
     * repo -- including the browser guard's "one page, however hard it is
     * scrolled at" -- stayed green, because they all give React a chance to
     * commit `phase: 'reading'` between one gesture and the next, and the
     * SECOND check then catches it. That makes the ref an untested guard, which
     * is exactly the shape of thing that gets deleted as redundant and takes a
     * real defect with it.
     *
     * SCROLL IS A CONTINUOUS EVENT. React flushes discrete events (click, key)
     * synchronously and continuous ones at its own convenience, so two scroll
     * events dispatched in one task both run against the state of the last
     * COMMITTED render -- in which nothing is in flight yet. Dispatched raw,
     * outside `act`, because `act` is what flushes and therefore what hides
     * this. Two requests for the same cursor is a doubled read of up to 8 MiB
     * and a page that could be prepended twice.
     */
    const read = vi.fn(async (_id: string, _cursor: string | null) => {
      await Promise.resolve();
      return page({ turns: [turn('t7')], cursor: '@700', reachedStart: false });
    });
    draw(read);
    const column = q('[data-detail-column]');
    expect(column).not.toBeNull();
    if (column === null) return;
    column.scrollTop = 0;
    column.dispatchEvent(new Event('scroll', { bubbles: false }));
    column.dispatchEvent(new Event('scroll', { bubbles: false }));
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => expect(turnIds()).toEqual(['t7', 't8', 't9']));
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('the poll keeps arriving while the operator reads back', () => {
  it('keeps every paged turn when the tail slides, and duplicates none of them', async () => {
    const read = vi.fn(async () =>
      page({ turns: [turn('t7'), turn('t6')], cursor: '@700', reachedStart: false }),
    );
    const view = draw(read);
    await act(async () => {
      more()?.click();
    });
    await waitFor(() => expect(turnIds()).toEqual(['t6', 't7', 't8', 't9']));
    // The tail is a BYTE window: a new turn arrives and the oldest falls out of
    // it. The pages the operator asked for are not the tail's to drop.
    view.rerender(sessionWith([turn('t10'), turn('t9')]));
    expect(turnIds()).toEqual(['t6', 't7', 't9', 't10']);
    expect(new Set(turnIds()).size).toBe(turnIds().length);
  });

  it('lets the POLL retract a turn it painted, rather than keeping a phantom', async () => {
    // `Canvas.tsx` paints a prompt the moment it is sent and retracts it when
    // the write is refused or when the source's own turn replaces it. The
    // column must follow that, and this is the assertion that says the pager's
    // memory does not override it: the live half of the column IS the poll.
    const read = vi.fn(async () =>
      page({ turns: [turn('t7')], cursor: '@700', reachedStart: false }),
    );
    const view = draw(read);
    await act(async () => {
      more()?.click();
    });
    await waitFor(() => expect(turnIds()).toEqual(['t7', 't8', 't9']));
    view.rerender(sessionWith([turn('vam-pending-1'), turn('t9'), turn('t8')]));
    expect(turnIds()).toEqual(['t7', 't8', 't9', 'vam-pending-1']);
    view.rerender(sessionWith([turn('t9'), turn('t8')]));
    expect(turnIds()).toEqual(['t7', 't8', 't9']);
  });

  it('does not draw a paged turn twice when the poll starts carrying it too', async () => {
    const read = vi.fn(async () =>
      page({ turns: [turn('t7')], cursor: '@700', reachedStart: false }),
    );
    const view = draw(read);
    await act(async () => {
      more()?.click();
    });
    await waitFor(() => expect(turnIds()).toEqual(['t7', 't8', 't9']));
    view.rerender(sessionWith([turn('t9'), turn('t8'), turn('t7')]));
    expect(turnIds()).toEqual(['t7', 't8', 't9']);
  });

  it('counts every turn it has read, not only the ones still in the tail', async () => {
    const read = vi.fn(async () =>
      page({ turns: [turn('t7'), turn('t6')], cursor: '@700', reachedStart: false }),
    );
    draw(read);
    expect(q('[data-progress-count]')?.textContent).toBe('2 turns read');
    await act(async () => {
      more()?.click();
    });
    await waitFor(() => expect(q('[data-progress-count]')?.textContent).toBe('4 turns read'));
  });

  it('drops everything paged when the pane moves to another session', async () => {
    const read = vi.fn(async () =>
      page({ turns: [turn('t7')], cursor: '@700', reachedStart: false }),
    );
    const view = draw(read);
    await act(async () => {
      more()?.click();
    });
    await waitFor(() => expect(turnIds()).toEqual(['t7', 't8', 't9']));
    // A new session is a new document: another session's turns must not be
    // above it, and its own boundary must be its own.
    view.rerender({ ...sessionWith([turn('u1')]), id: 's2', title: 'another' });
    expect(turnIds()).toEqual(['u1']);
  });
});
