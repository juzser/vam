// @vitest-environment happy-dom

/**
 * The polling feed, and the two things it must never do: blank the canvas when
 * one tick fails, and let an older answer overwrite a newer one.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiOverview, ApiTimelineEntry } from '../../src/adapter/api.js';
import type { SmithClient } from '../../src/adapter/client.js';
import { SmithUnreachableError } from '../../src/adapter/client.js';
import { POLL_MS, useCanvas } from '../../src/adapter/useCanvas.js';

function overviewWith(ids: readonly string[]): ApiOverview {
  return {
    runningSessions: ids.map((sessionId) => ({
      sessionId,
      startedAt: '2026-08-01T00:00:00Z',
      lastEventAt: '2026-08-01T00:00:00Z',
      eventCount: 1,
      liveAgentCount: 0,
      lastEventType: 'session-start',
      projects: ['p'],
    })),
    alerts: { escalations: 0, pendingWaivers: 0 },
  };
}

/** Renders the hook and exposes its latest value. */
function mount(client: SmithClient) {
  const seen: { current: ReturnType<typeof useCanvas> | null } = { current: null };
  function Probe() {
    seen.current = useCanvas(client);
    return null;
  }
  render(<Probe />);
  return seen;
}

function fakeClient(over: Partial<SmithClient>): SmithClient {
  return {
    overview: async () => overviewWith([]),
    timeline: async (): Promise<ApiTimelineEntry[]> => [],
    ...over,
  } as unknown as SmithClient;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('useCanvas', () => {
  it('starts empty and loading, before anything has answered', () => {
    const seen = mount(fakeClient({ overview: () => new Promise(() => {}) }));
    expect(seen.current?.status).toBe('loading');
    expect(seen.current?.model.projects).toEqual([]);
  });

  it('builds the model from the overview and the timelines', async () => {
    const seen = mount(
      fakeClient({
        overview: async () => overviewWith(['s1']),
        timeline: async () => [
          {
            eventId: 'e1',
            ts: '2026-08-01T00:00:01Z',
            eventType: 'user_prompt',
            taskId: null,
            planVersion: 1,
            causalParent: null,
            payload: { prompt: 'chào' },
            project: 'p',
            actor: 'user',
          },
        ],
      }),
    );
    await act(async () => {});
    expect(seen.current?.status).toBe('live');
    expect(seen.current?.model.projects[0]?.sessions[0]?.decisions[0]?.input).toBe('chào');
  });

  it('asks for one timeline per session', async () => {
    const asked: string[] = [];
    mount(
      fakeClient({
        overview: async () => overviewWith(['s1', 's2']),
        timeline: async (id: string) => {
          asked.push(id);
          return [];
        },
      }),
    );
    await act(async () => {});
    expect(asked.sort()).toEqual(['s1', 's2']);
  });

  it('keeps the last good model when a later tick fails', async () => {
    // A dashboard that blanked on one dropped request would be unreadable next
    // to a server that is restarting.
    let fail = false;
    const seen = mount(
      fakeClient({
        overview: async () => {
          if (fail) {
            throw new SmithUnreachableError('http://x', new Error('down'));
          }
          return overviewWith(['s1']);
        },
      }),
    );
    await act(async () => {});
    expect(seen.current?.model.projects).toHaveLength(1);

    fail = true;
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS);
    });
    expect(seen.current?.status).toBe('error');
    expect(seen.current?.model.projects).toHaveLength(1);
  });

  it('reports a dead server in words a person can act on', async () => {
    const seen = mount(
      fakeClient({
        overview: async () => {
          throw new SmithUnreachableError('http://127.0.0.1:4680', new Error('down'));
        },
      }),
    );
    await act(async () => {});
    expect(seen.current?.error).toContain('cannot reach black-smith');
  });

  it('keeps polling on its own', async () => {
    let calls = 0;
    mount(
      fakeClient({
        overview: async () => {
          calls += 1;
          return overviewWith([]);
        },
      }),
    );
    await act(async () => {});
    expect(calls).toBe(1);
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS);
    });
    expect(calls).toBe(2);
  });

  it('refresh fetches now instead of waiting for the next tick', async () => {
    let calls = 0;
    const seen = mount(
      fakeClient({
        overview: async () => {
          calls += 1;
          return overviewWith([]);
        },
      }),
    );
    await act(async () => {});
    await act(async () => {
      seen.current?.refresh();
    });
    expect(calls).toBe(2);
  });
});
