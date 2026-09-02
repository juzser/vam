// @vitest-environment happy-dom

/**
 * The push feed, and the things it must never do: blank the canvas when one
 * load fails, let an older answer overwrite a newer one, or refetch off a
 * stream `error` (§3.3) — the browser's own reconnect, and the `hello` that
 * follows it, cover that.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiOverview, ApiTimelineEntry } from '../../src/renderer/adapter/api.js';
import type { SmithClient } from '../../src/renderer/adapter/client.js';
import { SmithUnreachableError } from '../../src/renderer/adapter/client.js';
import type { CanvasFeed, UseCanvasOptions } from '../../src/renderer/adapter/useCanvas.js';
import { useCanvas } from '../../src/renderer/adapter/useCanvas.js';

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

type Listener = (event: { data?: string }) => void;

// A fake `EventSource`: happy-dom has no global one (§9), so this is injected.
class FakeEventSource {
  readyState = 0;
  closeCalls = 0;
  private readonly listeners = new Map<string, Listener[]>();
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(): void {}
  close(): void {
    this.closeCalls += 1;
  }
  emit(type: string, data?: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

/** Renders the hook and exposes its latest value, an unmount fn, and every built `EventSource`. */
function mount(client: SmithClient, options?: UseCanvasOptions) {
  const instances: FakeEventSource[] = [];
  const createEventSource = (url: string): EventSource => {
    const source = new FakeEventSource(url);
    instances.push(source);
    return source as unknown as EventSource;
  };
  const seen: {
    current: CanvasFeed | null;
    unmount: () => void;
    instances: FakeEventSource[];
  } = { current: null, unmount: () => {}, instances };
  function Probe() {
    seen.current = useCanvas(client, options ?? { createEventSource });
    return null;
  }
  const rendered = render(<Probe />);
  seen.unmount = rendered.unmount;
  return seen;
}

function fakeClient(over: Partial<SmithClient>): SmithClient {
  return {
    overview: async () => overviewWith([]),
    timeline: async (): Promise<ApiTimelineEntry[]> => [],
    ...over,
  } as unknown as SmithClient;
}

const HELLO = JSON.stringify({ heartbeatMs: 15000, floorMs: 10000 });
const change = (sessions: readonly string[]) =>
  JSON.stringify({ sessions, at: '2026-08-01T00:00:00Z' });

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
            payload: { prompt: 'hi' },
            project: 'p',
            actor: 'user',
          },
        ],
      }),
    );
    await act(async () => {});
    expect(seen.current?.status).toBe('live');
    expect(seen.current?.model.projects[0]?.sessions[0]?.decisions[0]?.input).toBe('hi');
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

  it('keeps the last good model when a later load fails', async () => {
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
      seen.current?.refresh();
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

  it('the 4-second timer is gone: a change frame refetches once, and a malformed one is ignored', async () => {
    let calls = 0;
    const seen = mount(
      fakeClient({
        overview: async () => {
          calls += 1;
          return overviewWith(calls === 1 ? ['s1'] : ['s1', 's2']);
        },
      }),
    );
    await act(async () => {});
    expect(calls).toBe(1); // the initial load does not wait for the stream
    expect(seen.current?.status).toBe('live');

    await act(async () => {
      seen.instances[0]?.emit('change', 'not-json');
      seen.instances[0]?.emit('change', JSON.stringify({ sessions: 's1' }));
      seen.instances[0]?.emit('change', change(['s1']));
    });
    expect(calls).toBe(2); // exactly one refetch, from the one well-formed frame
    expect(seen.current?.model.projects[0]?.sessions).toHaveLength(2); // the refetch's answer, not the first
  });

  it('every hello triggers exactly one load, and nothing is built on heartbeatMs/floorMs', async () => {
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
    expect(calls).toBe(1);
    await act(async () => {
      seen.instances[0]?.emit('hello', HELLO);
    });
    expect(calls).toBe(2);
    await act(async () => {
      vi.advanceTimersByTime(120000); // no timeout was armed off either number
    });
    expect(calls).toBe(2);
    expect(seen.current?.status).toBe('live');
    expect(seen.instances[0]?.closeCalls).toBe(0);
  });

  it('a stream error is not an outage, and a later well-formed change still refetches — nothing was torn down', async () => {
    let ids: readonly string[] = ['s1'];
    let calls = 0;
    const seen = mount(
      fakeClient({
        overview: async () => {
          calls += 1;
          return overviewWith(ids);
        },
      }),
    );
    await act(async () => {});
    await act(async () => {
      seen.instances[0]?.emit('hello', HELLO);
    });
    expect(calls).toBe(2);

    if (seen.instances[0]) seen.instances[0].readyState = 0;
    await act(async () => {
      seen.instances[0]?.emit('error');
    });
    expect(seen.current?.status).toBe('live'); // error alone is not an outage
    expect(calls).toBe(2); // and triggers no load
    expect(seen.instances[0]?.closeCalls).toBe(0); // not torn down
    expect(seen.instances).toHaveLength(1); // no second, racing EventSource
    ids = ['s1', 's2']; // the frame naming this is gone for good — §3.2

    await act(async () => {
      seen.instances[0]?.emit('change', change(ids)); // the change listener, not hello, must survive the error
    });
    expect(calls).toBe(3);
    expect(seen.current?.model.projects.some((p) => p.sessions.some((s) => s.id === 's2'))).toBe(
      true,
    );

    ids = ['s1', 's2', 's3']; // a later hello — the browser's own reconnect — must still recover
    await act(async () => {
      seen.instances[0]?.emit('hello', HELLO);
    });
    expect(calls).toBe(4);
    expect(seen.current?.model.projects.some((p) => p.sessions.some((s) => s.id === 's3'))).toBe(
      true,
    );
  });

  it('unmount closes the stream exactly once, and nothing fetches afterwards', async () => {
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
    seen.unmount();
    expect(seen.instances[0]?.closeCalls).toBe(1);

    const before = calls;
    await act(async () => {
      seen.instances[0]?.emit('hello', HELLO);
      vi.advanceTimersByTime(60000);
    });
    expect(calls).toBe(before);
  });

  it('refresh fetches now, exactly one call', async () => {
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

  it('a slow load never overwrites a faster one started after it', async () => {
    const resolvers: Array<(o: ApiOverview) => void> = [];
    const seen = mount(fakeClient({ overview: () => new Promise((r) => resolvers.push(r)) }));
    await act(async () => {
      seen.current?.refresh();
    });
    resolvers[1]?.(overviewWith(['fast']));
    await act(async () => {});
    resolvers[0]?.(overviewWith(['slow']));
    await act(async () => {});
    expect(seen.current?.model.projects[0]?.sessions[0]?.id).toBe('fast');
  });

  it('a slow error never downgrades status set by a faster success', async () => {
    const c: Array<{ a: (o: ApiOverview) => void; b: (e: unknown) => void }> = [];
    const seen = mount(fakeClient({ overview: () => new Promise((a, b) => c.push({ a, b })) }));
    await act(async () => {
      seen.current?.refresh();
    });
    c[1]?.a(overviewWith(['fast']));
    await act(async () => {});
    c[0]?.b(new Error('late'));
    await act(async () => {});
    expect(seen.current?.status).toBe('live');
  });
});
