// @vitest-environment happy-dom

/**
 * The phone collapse of the transcript's top block (docs/design/
 * phone-core-loop.md, the composer-row follow-up's second half).
 *
 * Operator: "N turns read / This is as far back as vam has read — not
 * necessarily where the session began. / Read earlier turns" costs ~3 lines
 * above every conversation on the screen with the least of them to spare. On
 * phone it collapses to ONE compact tappable row (`[data-column-start-compact]`)
 * carrying the SAME behaviour (`readOlder`, asserted here by the same cursor
 * this file's desktop twin, `DetailPanel.history.test.tsx`, already pins) and
 * the SAME accessibility-name semantics -- the full sentence moves into
 * `aria-label` rather than disappearing. Desktop (`phone` unset, that other
 * file) is unchanged: `[data-progress-count]`/`[data-column-start-note]`/
 * `[data-column-more]` are exactly what they were.
 */

import { act, cleanup, render, waitFor } from '@testing-library/react';
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
  render(
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
        width={390}
        resizeHandle={null}
        delivers
        phone
        {...over}
      />
    </HistoryReaderProvider>,
  );
}

const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const compact = () => q('[data-column-start-compact]');

afterEach(cleanup);

describe('the phone transcript boundary collapses to one compact row', () => {
  it('draws the compact row instead of the three-line block', () => {
    draw(null);
    expect(compact()).not.toBeNull();
    // The three lines it replaces are gone -- not merely hidden. The compact
    // row reuses `data-column-more`'s VALUE as its own attribute (parity with
    // the desktop hook, for anything that greps state rather than shape), so
    // the desktop-only child hooks are what proves the OLD markup is gone.
    expect(q('[data-progress-count]')).toBeNull();
    expect(q('[data-column-start-note]')).toBeNull();
    expect(q('[data-column-more-ask]')).toBeNull();
    expect(q('[data-column-more-note]')).toBeNull();
  });

  it('a source that cannot page: a static row, its full refusal in the accessible name', () => {
    draw(null);
    const row = compact();
    expect(row?.tagName).toBe('P');
    expect(row?.textContent).toMatch(/can't read further back/i);
    expect(row?.getAttribute('aria-label')).toMatch(
      /cannot read further back than its own window/i,
    );
    expect(row?.getAttribute('role')).toBe('status');
  });

  it('a source that can page: a real button, same cursor readOlder already asks for', async () => {
    const read = vi.fn(async () =>
      page({ turns: [turn('t7')], cursor: '@700', reachedStart: false }),
    );
    draw(read);
    const row = compact();
    expect(row?.tagName).toBe('BUTTON');
    expect(row?.textContent).toBe('Earlier turns ↑');
    expect(row?.getAttribute('aria-label')).toMatch(/2 turns read/i);
    expect(row?.getAttribute('aria-label')).toMatch(/read earlier turns/i);
    // `vam-tap`: the phone's own 44px floor, same as every other tap target.
    expect(row?.className).toContain('vam-tap');
    await act(async () => {
      (row as HTMLButtonElement | null)?.click();
    });
    // The SAME behaviour the desktop button drives (`DetailPanel.history.
    // test.tsx`'s "offers a control, and asks for the turns before the OLDEST
    // one on screen"): the oldest turn held, never `null`.
    expect(read).toHaveBeenCalledExactlyOnceWith('s1', 't8');
  });

  it('mid-flight: a status row, never a dimmed control', async () => {
    let release: (value: TranscriptPage) => void = () => {};
    const read = vi.fn(
      () =>
        new Promise<TranscriptPage>((resolve) => {
          release = resolve;
        }),
    );
    draw(read);
    await act(async () => {
      (compact() as HTMLButtonElement | null)?.click();
    });
    const row = compact();
    expect(row?.tagName).toBe('P');
    expect(row?.getAttribute('role')).toBe('status');
    expect(row?.textContent).toMatch(/reading earlier turns/i);
    await act(async () => {
      release(page({ turns: [turn('t7')], cursor: '@700', reachedStart: false }));
    });
  });

  it("a refusal: the SOURCE'S OWN WORDS survive into the accessible name, and the control stays a button", async () => {
    const read = vi.fn(async () => ({
      kind: 'unavailable' as const,
      error: {
        kind: 'unreachable' as const,
        code: 'transcript-unreadable',
        message: 'the transcript file went away',
      },
    }));
    draw(read);
    await act(async () => {
      (compact() as HTMLButtonElement | null)?.click();
    });
    await waitFor(() => expect(compact()?.textContent).toMatch(/try again/i));
    const row = compact();
    expect(row?.tagName).toBe('BUTTON');
    const said = row?.getAttribute('aria-label') ?? '';
    expect(said).toContain('transcript-unreadable');
    expect(said).toContain('the transcript file went away');
  });

  it('the start, once proven: a static row, no control, "begins here" in its name', async () => {
    const read = vi.fn(async () => page({ turns: [turn('t7')], cursor: null, reachedStart: true }));
    draw(read);
    await act(async () => {
      (compact() as HTMLButtonElement | null)?.click();
    });
    await waitFor(() => expect(compact()?.tagName).toBe('P'));
    const row = compact();
    expect(row?.textContent).toBe('Session start ↑');
    expect(row?.getAttribute('aria-label')).toMatch(/begins here/i);
  });
});
