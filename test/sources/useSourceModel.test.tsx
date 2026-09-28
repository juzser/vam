// @vitest-environment happy-dom

/**
 * The desktop's model lifecycle.
 *
 * Before this hook existed, `DesktopCanvas` loaded ONCE on mount and reloaded
 * only after a write. Nothing polled and `liveUpdates` is false, so the
 * session list froze at launch: a session going busy -> idle kept reading as
 * running, a new session never appeared, a failing one never showed as failed,
 * and every `age` stopped moving. For an app whose stated purpose is making
 * the `waiting` state impossible to miss, that is the whole purpose lost.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasModel, Project, SessionStatus } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import {
  SOURCE_POLL_INTERVAL_MS,
  useSourceModel,
} from '../../src/renderer/sources/useSourceModel.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const projects = (name: string): readonly Project[] => [
  { id: 'p1', name, source: 'claude-code', sessions: [] },
];

/**
 * A one-session project whose ONLY reason to differ between loads is
 * `cacheSourceNowMs`/`age` (the two observation clocks, affe8f37) or,
 * optionally, `status` -- a real change the stable key must still catch.
 */
const projectsWithClocks = (
  cacheSourceNowMs: number,
  age: string,
  status: SessionStatus = 'running',
): readonly Project[] => [
  {
    id: 'p1',
    name: 'alpha',
    source: 'claude-code',
    sessions: [
      {
        id: 's1',
        title: 'task',
        epic: null,
        status,
        runningAgents: 0,
        activity: null,
        age,
        branch: null,
        decisions: [],
        cacheSourceNowMs,
      },
    ],
  },
];

/** A source whose `load` resolves when the test says so, in the order it says. */
function gatedSource() {
  const pending: { resolve: (p: readonly Project[]) => void; reject: (e: unknown) => void }[] = [];
  const source = {
    id: 'claude-code',
    label: 'Claude Code',
    capabilities: {},
    declines: {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: () =>
      new Promise<readonly Project[]>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  } as unknown as SessionSource;
  return { source, pending };
}

/** Renders the hook and exposes its latest return value. */
function mount(source: SessionSource | null) {
  const seen: {
    model: CanvasModel;
    error: string | null;
    loading: boolean;
    reload: () => void;
  }[] = [];
  function Probe() {
    seen.push(useSourceModel(source));
    return null;
  }
  render(<Probe />);
  return { seen, latest: () => seen[seen.length - 1] };
}

describe('useSourceModel', () => {
  it('loads once on mount', async () => {
    const { source, pending } = gatedSource();
    const { latest } = mount(source);
    expect(pending).toHaveLength(1);
    await act(async () => pending[0]?.resolve(projects('alpha')));
    expect(latest()?.model.projects[0]?.name).toBe('alpha');
  });

  it('polls on the interval, so a status change reaches the screen unasked', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { source, pending } = gatedSource();
    const { latest } = mount(source);
    await act(async () => pending[0]?.resolve(projects('first')));

    await act(async () => {
      vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS);
    });
    expect(pending).toHaveLength(2);
    await act(async () => pending[1]?.resolve(projects('second')));
    expect(latest()?.model.projects[0]?.name).toBe('second');
  });

  it('does not stack polls while one is still in flight', async () => {
    // A slow `claude agents` call must not queue a subprocess per tick.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { source, pending } = gatedSource();
    mount(source);
    expect(pending).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS * 4);
    });
    expect(pending).toHaveLength(1);
  });

  it('does not drop a write’s reload when a background poll is already in flight -- it runs once that one clears', async () => {
    // The close race: `Canvas.tsx`'s `closeSession` awaits the write (which
    // kills the pane), then calls `source.onWrote()` -- literally this
    // hook's own `reload`, the same function the periodic timer calls. If a
    // periodic poll is ALREADY in flight at that moment (reading a tmux
    // listing from BEFORE the kill), the old code dropped the reload outright
    // (the `inFlight` guard's early return) and the operator was left staring
    // at the in-flight poll's stale, pre-kill answer -- with nothing to
    // correct it before the next scheduled tick, up to 40s away while
    // hidden. The fix: a reload that arrives while one is in flight is
    // QUEUED, not dropped, and runs the instant the in-flight one clears --
    // still never two in flight at once, which the test above still pins.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { source, pending } = gatedSource();
    const { latest } = mount(source);
    await act(async () => pending[0]?.resolve(projects('first')));

    // The periodic tick issues the poll that will answer STALE.
    await act(async () => {
      vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS);
    });
    expect(pending).toHaveLength(2);

    // The write's own reload lands while that poll is still in flight --
    // queued, not a third concurrent request.
    await act(async () => {
      latest()?.reload();
    });
    expect(pending).toHaveLength(2);

    // The in-flight poll answers with data read BEFORE the write (a real
    // close, or create, resolves only once its own effect has happened, but
    // an overlapping background poll may have started its OWN read earlier
    // still). The queued reload fires the moment this one clears.
    await act(async () => pending[1]?.resolve(projects('stale')));
    expect(latest()?.model.projects[0]?.name).toBe('stale');
    expect(pending).toHaveLength(3);

    // The queued reload corrects it, with no further click and no 10s wait.
    await act(async () => pending[2]?.resolve(projects('fresh')));
    expect(latest()?.model.projects[0]?.name).toBe('fresh');
  });

  it('lets the newest load win when an older one answers late', async () => {
    // The same defect the usage poll had: whichever resolved last used to win.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { source, pending } = gatedSource();
    const { latest } = mount(source);
    await act(async () => pending[0]?.resolve(projects('first')));
    await act(async () => {
      vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS);
    });
    // Second issued; resolve it, THEN let the first-issued one answer late.
    await act(async () => pending[1]?.resolve(projects('newest')));
    expect(latest()?.model.projects[0]?.name).toBe('newest');
    await act(async () => pending[0]?.resolve(projects('stale')));
    expect(latest()?.model.projects[0]?.name).toBe('newest');
  });

  it('keeps the last good model when a poll fails, and says why', async () => {
    // A transient CLI failure must not blank a list the operator is reading.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { source, pending } = gatedSource();
    const { latest } = mount(source);
    await act(async () => pending[0]?.resolve(projects('alpha')));
    await act(async () => {
      vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS);
    });
    await act(async () => pending[1]?.reject(new Error('claude went away')));
    expect(latest()?.model.projects[0]?.name).toBe('alpha');
    expect(latest()?.error).toMatch(/claude went away/);
  });

  it('clears the error once a later poll succeeds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { source, pending } = gatedSource();
    const { latest } = mount(source);
    await act(async () => pending[0]?.reject(new Error('gone')));
    expect(latest()?.error).toMatch(/gone/);
    await act(async () => {
      vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS);
    });
    await act(async () => pending[1]?.resolve(projects('back')));
    expect(latest()?.error).toBeNull();
  });

  it('reloads when the window regains focus', async () => {
    // Coming back to vam is exactly when its numbers matter and are stalest.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { source, pending } = gatedSource();
    mount(source);
    await act(async () => pending[0]?.resolve(projects('alpha')));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(pending).toHaveLength(2);
  });

  /**
   * C10: `window`'s `focus` and `document`'s `visibilitychange` are two
   * separate listeners in this file, each calling `load` directly -- and a
   * real "come back to vam" (alt-tab, a minimised window restored) fires
   * BOTH, one DOM event apart. Before this fix each one called `load`
   * independently: the first set `inFlight`, the second saw it and queued a
   * SECOND read behind it (`reloadQueued`) -- two source reads for one
   * return, on a source (`claude agents --json --all`) this file's own
   * header prices at up to 0.41s. They are the same real-world event, not
   * two reasons to ask twice, so returning must cost exactly one read --
   * whether the two events land in the same tick or a few milliseconds
   * apart, never two truly concurrent reads and never a queued second one
   * for this pair specifically.
   */
  it('returning to vam costs exactly one read, focus and visibilitychange together', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { source, pending } = gatedSource();
    mount(source);
    await act(async () => pending[0]?.resolve(projects('alpha')));
    expect(pending).toHaveLength(1);

    // Same tick: both listeners fire before either promise settles.
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      fireEvent(document, new Event('visibilitychange'));
    });
    expect(pending).toHaveLength(2);
    // Let the one read settle, and give any queued follow-up a chance to
    // start -- the bug this closes is a SECOND read queued behind the
    // first, which would show up here as a third `pending` entry.
    await act(async () => pending[1]?.resolve(projects('back')));
    expect(pending).toHaveLength(2);
  });

  it('returning to vam costs exactly one read, focus and visibilitychange a few ms apart', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { source, pending } = gatedSource();
    mount(source);
    await act(async () => pending[0]?.resolve(projects('alpha')));
    expect(pending).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(pending).toHaveLength(2);
    await act(async () => {
      vi.advanceTimersByTime(3);
      fireEvent(document, new Event('visibilitychange'));
    });
    // Still one read for the pair: the second signal landed while the
    // first was still in flight, close enough behind it to be the same
    // "came back to vam" moment rather than a change to ask about again.
    expect(pending).toHaveLength(2);
    await act(async () => pending[1]?.resolve(projects('back')));
    expect(pending).toHaveLength(2);
  });

  it('a periodic poll in flight does not swallow a return signal -- the poll is not the operator coming back', async () => {
    // S2: the coalescing window above must only ever absorb the SECOND half
    // of a focus/visibilitychange pair -- never a genuinely separate reason
    // to read again that happens to land inside it. A periodic tick is not a
    // return signal; if the operator alt-tabs back in while that tick's own
    // read is still in flight, `focus` must be QUEUED behind it (this file's
    // ordinary "does not drop a write's reload" rule), not dropped as if it
    // were the poll's own echo.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { source, pending } = gatedSource();
    const { latest } = mount(source);
    await act(async () => pending[0]?.resolve(projects('first')));
    expect(pending).toHaveLength(1);

    // The periodic tick issues a poll that is NOT a return signal.
    await act(async () => {
      vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS);
    });
    expect(pending).toHaveLength(2);

    // 150ms later -- well inside COALESCE_WINDOW_MS -- the operator returns.
    // The in-flight load was the periodic tick, not a return signal, so this
    // one must not be mistaken for its own echo.
    await act(async () => {
      vi.advanceTimersByTime(150);
      window.dispatchEvent(new Event('focus'));
    });
    expect(pending).toHaveLength(2);

    // The periodic poll's stale answer lands; the queued return-signal
    // reload must fire right behind it, not wait for the next 10s tick.
    await act(async () => pending[1]?.resolve(projects('stale')));
    expect(pending).toHaveLength(3);
    await act(async () => pending[2]?.resolve(projects('fresh')));
    expect(latest()?.model.projects[0]?.name).toBe('fresh');
  });

  it('does not touch state after unmount', async () => {
    const { source, pending } = gatedSource();
    const { seen } = mount(source);
    cleanup();
    const before = seen.length;
    await act(async () => pending[0]?.resolve(projects('late')));
    expect(seen.length).toBe(before);
  });

  it('does nothing at all without a source', () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { latest } = mount(null);
    act(() => {
      vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS * 3);
    });
    expect(latest()?.model.projects).toEqual([]);
    expect(latest()?.error).toBeNull();
  });

  describe('loading: distinct from an empty model and from a failed one', () => {
    it('starts loading, and stays loading with no source at all — there is no answer yet', () => {
      const { latest } = mount(null);
      expect(latest()?.loading).toBe(true);
    });

    it('clears once the first load answers, empty or not, and never returns on a later poll', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      const { source, pending } = gatedSource();
      const { latest } = mount(source);
      expect(latest()?.loading).toBe(true);
      await act(async () => pending[0]?.resolve([]));
      expect(latest()?.loading).toBe(false);
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS);
      });
      expect(latest()?.loading).toBe(false);
      await act(async () => pending[1]?.resolve(projects('later')));
      expect(latest()?.loading).toBe(false);
    });

    it('clears on a first load that FAILS too — a stuck spinner is its own lie', async () => {
      const { source, pending } = gatedSource();
      const { latest } = mount(source);
      await act(async () => pending[0]?.reject(new Error('claude went away')));
      expect(latest()?.loading).toBe(false);
      expect(latest()?.error).toMatch(/claude went away/);
    });
  });

  /**
   * VISIBILITY GATING AND THE UNCHANGED-STREAK BACKOFF -- this poller is
   * `notify/waiting.ts`'s only source of a `waiting` transition, so it may
   * slow down while hidden but never stop outright (`useVisibilityInterval`,
   * wired with `{ slowBy: 4 }`, never `'pause'`). See this file's own header
   * for the full argument, including why hidden must never STACK with the
   * backoff below.
   */
  describe('while hidden, and the unchanged-streak backoff', () => {
    /** Visible by default; the test flips it with `.mockReturnValue`. */
    const visibilitySpy = () =>
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

    const changeVisibility = async () => {
      await act(async () => {
        fireEvent(document, new Event('visibilitychange'));
      });
    };

    it('slows to 40s while hidden, and never fully stops', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      const visibility = visibilitySpy();
      const { source, pending } = gatedSource();
      mount(source);
      expect(pending).toHaveLength(1); // the immediate load on mount
      // Resolved so the in-flight guard does not itself block the next poll
      // -- a SEPARATE, already-covered behaviour ("does not stack polls
      // while one is still in flight", above) that this test is not about.
      await act(async () => pending[0]?.resolve(projects('zero prior loads')));

      visibility.mockReturnValue('hidden');
      await changeVisibility();

      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS * 4 - 1); // 39_999ms
      });
      expect(pending).toHaveLength(1); // nothing at the old 10s cadence

      await act(async () => {
        vi.advanceTimersByTime(1); // reaches 40_000ms
      });
      expect(pending).toHaveLength(2); // still alive, just four times slower
    });

    it('reloads immediately the moment the window is visible again', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      const visibility = visibilitySpy();
      const { source, pending } = gatedSource();
      mount(source);
      expect(pending).toHaveLength(1);
      await act(async () => pending[0]?.resolve(projects('first'))); // release the in-flight guard

      visibility.mockReturnValue('hidden');
      await changeVisibility();

      visibility.mockReturnValue('visible');
      await changeVisibility();
      expect(pending).toHaveLength(2); // the immediate reload, unasked
    });

    it('slows the visible cadence to 20s after three identical loads in a row', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      visibilitySpy();
      const { source, pending } = gatedSource();
      mount(source);
      await act(async () => pending[0]?.resolve(projects('same'))); // load #1
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS); // -> load #2, t=10s
      });
      await act(async () => pending[1]?.resolve(projects('same'))); // unchanged, streak 2
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS); // -> load #3, t=20s
      });
      await act(async () => pending[2]?.resolve(projects('same'))); // unchanged, streak 3 -> backs off NOW

      // The NEXT tick moves from t=30s (the old cadence) to t=40s.
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS); // t=30s
      });
      expect(pending).toHaveLength(3); // nothing yet -- the old schedule would have fired here
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS); // t=40s
      });
      expect(pending).toHaveLength(4); // arrives at the backed-off cadence
    });

    it('resets to the 10s base the instant a load reads differently', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      visibilitySpy();
      const { source, pending } = gatedSource();
      mount(source);
      // Back off to 20s first, the same three-load dance as above.
      await act(async () => pending[0]?.resolve(projects('same')));
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS);
      });
      await act(async () => pending[1]?.resolve(projects('same')));
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS);
      });
      await act(async () => pending[2]?.resolve(projects('same')));
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS * 2); // t=40s, backed-off tick, load #4
      });
      expect(pending).toHaveLength(4);

      // A DIFFERENT answer resets the streak and the cadence immediately.
      await act(async () => pending[3]?.resolve(projects('different')));
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS - 1);
      });
      expect(pending).toHaveLength(4); // not yet -- back at the 10s base, not 20s
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(pending).toHaveLength(5); // arrives at 10s, the reset cadence
    });

    it('lets hidden override a standing backoff -- the next tick is +40s, not +20s or +80s', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      const visibility = visibilitySpy();
      const { source, pending } = gatedSource();
      mount(source);
      await act(async () => pending[0]?.resolve(projects('same')));
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS);
      });
      await act(async () => pending[1]?.resolve(projects('same')));
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS);
      });
      await act(async () => pending[2]?.resolve(projects('same'))); // backed off to 20s as of now

      visibility.mockReturnValue('hidden');
      await changeVisibility(); // the hide moment

      // NOT the standing 20s backoff:
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS * 2); // +20s from the hide moment
      });
      expect(pending).toHaveLength(3); // nothing yet -- 20s alone is not the rate

      // NOT 20s stacked with the 4x hidden multiplier (80s) either -- lands
      // at exactly +40s from the hide moment.
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS * 2); // +40s from the hide moment
      });
      expect(pending).toHaveLength(4);
    });
  });

  /**
   * affe8f37: `JSON.stringify(projects)` alone never reads two loads as
   * "unchanged" for a session with cache activity, because main stamps
   * `cacheSourceNowMs` with the current poll time on every such load
   * (`main/sources/claude-code/source.ts`) and `age` is a display string
   * recomputed from that same clock. The comparison must ignore exactly
   * those two fields, and nothing else.
   */
  describe('affe8f37: the unchanged-streak backoff ignores the observation clocks', () => {
    it('the clocks alone do not reset the streak -- the gap between loads #4 and #5 is 20s, not 10s', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      const { source, pending } = gatedSource();
      mount(source);
      expect(pending).toHaveLength(1);
      await act(async () => pending[0]?.resolve(projectsWithClocks(1_000, '0s'))); // load #1

      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS); // -> load #2, t=10s
      });
      await act(async () => pending[1]?.resolve(projectsWithClocks(2_000, '10s'))); // streak 2, clocks only differ

      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS); // -> load #3, t=20s
      });
      await act(async () => pending[2]?.resolve(projectsWithClocks(3_000, '20s'))); // streak 3, backs off to 20s

      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS * 2); // -> load #4, t=40s (backed-off gap)
      });
      expect(pending).toHaveLength(4);
      await act(async () => pending[3]?.resolve(projectsWithClocks(4_000, '30s'))); // clocks only differ again

      // The interval under test: load #4 to load #5.
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS - 1); // 9_999ms since load #4
      });
      expect(pending).toHaveLength(4);
      await act(async () => {
        vi.advanceTimersByTime(1); // 10_000ms since load #4
      });
      // HEAD (whole-object JSON.stringify) fails here: the clocks alone made
      // load #4 read as different from load #3, resetting the streak and
      // the cadence to the 10s base, so load #5 would already be pending.
      // The fix's stable key reads them as unchanged, so nothing has
      // arrived yet -- the backed-off 20s cadence holds.
      expect(pending).toHaveLength(4);
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS); // 20_000ms since load #4
      });
      expect(pending).toHaveLength(5); // load #5 arrives at the 20s gap the backoff earned
    });

    it('is not blind: a real status change on load #4 still resets the streak to the 10s base', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      const { source, pending } = gatedSource();
      mount(source);
      await act(async () => pending[0]?.resolve(projectsWithClocks(1_000, '0s')));
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS);
      });
      await act(async () => pending[1]?.resolve(projectsWithClocks(2_000, '10s')));
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS);
      });
      await act(async () => pending[2]?.resolve(projectsWithClocks(3_000, '20s'))); // streak 3, backs off to 20s

      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS * 2); // -> load #4, t=40s
      });
      expect(pending).toHaveLength(4);
      // The 4th load's session status differs too -- a real change, not an
      // observation clock.
      await act(async () => pending[3]?.resolve(projectsWithClocks(4_000, '30s', 'waiting')));

      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS - 1); // 9_999ms since load #4
      });
      expect(pending).toHaveLength(4);
      await act(async () => {
        vi.advanceTimersByTime(1); // 10_000ms since load #4
      });
      expect(pending).toHaveLength(5); // the status change alone restores the 10s base
    });

    it('the rendered model still carries the newest load’s own observation clocks', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      const { source, pending } = gatedSource();
      const { latest } = mount(source);
      await act(async () => pending[0]?.resolve(projectsWithClocks(1_000, '0s')));
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS);
      });
      await act(async () => pending[1]?.resolve(projectsWithClocks(2_000, '10s')));
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS);
      });
      await act(async () => pending[2]?.resolve(projectsWithClocks(3_000, '20s')));
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS * 2); // load #4, backed off
      });
      await act(async () => pending[3]?.resolve(projectsWithClocks(4_000, '30s')));
      await act(async () => {
        vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS * 2); // load #5, still backed off
      });
      await act(async () => pending[4]?.resolve(projectsWithClocks(5_000, '40s')));

      // The comparison ignores the clocks; the DISPLAYED model does not.
      const session = latest()?.model.projects[0]?.sessions[0];
      expect(session?.cacheSourceNowMs).toBe(5_000);
      expect(session?.age).toBe('40s');
    });
  });

  /**
   * OPERATOR DECISION 2026-09-28 (event #70): the hidden-window finding is
   * deferred and the 40s hidden `waiting`-notification latency is required.
   * This is a regression guard, not a new behaviour -- it passes at HEAD and
   * must still pass after affe8f37's fix. Its discriminating power is proven
   * by mutation (see this file's own report), not by a HEAD failure: a
   * source that differs ONLY in the observation clocks now reads as
   * unchanged past a streak of 3, which must never let hidden's cadence
   * compose with the visible backoff -- every gap while hidden stays 40s.
   */
  describe('affe8f37 regression guard: the 40s hidden bound holds and never composes', () => {
    it('every gap between hidden loads is exactly 40s across six loads, even once the streak backs off under the hood', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      const { source, pending } = gatedSource();
      mount(source);
      expect(pending).toHaveLength(1);
      await act(async () => pending[0]?.resolve(projectsWithClocks(1_000, '0s')));

      visibility.mockReturnValue('hidden');
      await act(async () => {
        fireEvent(document, new Event('visibilitychange'));
      });

      for (let i = 1; i <= 6; i += 1) {
        await act(async () => {
          vi.advanceTimersByTime(SOURCE_POLL_INTERVAL_MS * 4 - 1); // 39_999ms since the previous load
        });
        expect(pending).toHaveLength(i);
        await act(async () => {
          vi.advanceTimersByTime(1); // reaches exactly 40_000ms
        });
        expect(pending).toHaveLength(i + 1);
        await act(async () =>
          pending[i]?.resolve(projectsWithClocks(1_000 + i * 1_000, `${i * 10}s`)),
        );
      }
    });
  });
});
