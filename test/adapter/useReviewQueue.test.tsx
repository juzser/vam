// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiFinding, ApiLessons, ApiTaskDetail } from '../../src/renderer/adapter/api.js';
import type { SmithClient } from '../../src/renderer/adapter/client.js';
import { useReviewQueue } from '../../src/renderer/adapter/useReviewQueue.js';

function finding(over: Partial<ApiFinding> = {}): ApiFinding {
  return {
    findingId: 'f-1',
    taskId: 't-1',
    fingerprint: 'fp-1',
    severity: 'S3-minor',
    findingStatus: 'raised',
    summary: 's',
    foundBy: 'reviewer',
    waiverId: null,
    ...over,
  };
}

const NO_LESSONS: ApiLessons = { pending: [], approved: [], closed: [] };

function fakeClient(over: Partial<SmithClient> = {}): SmithClient {
  return {
    taskIds: async () => [],
    taskDetail: async (): Promise<ApiTaskDetail> => ({ findings: [] }),
    lessons: async () => NO_LESSONS,
    // Session-scoped, and the only thing that can tell the queue it is short:
    // pendingWaivers is counted straight off the findings table.
    overview: async () => ({ runningSessions: [], alerts: { escalations: 0, pendingWaivers: 0 } }),
    ...over,
  } as unknown as SmithClient;
}

function mount(client: SmithClient | null, sessionId: string | null) {
  const seen: { current: ReturnType<typeof useReviewQueue> | null } = { current: null };
  function Probe() {
    seen.current = useReviewQueue(client, sessionId);
    return null;
  }
  render(<Probe />);
  return seen;
}

afterEach(cleanup);

describe('useReviewQueue', () => {
  it('asks nothing at all without a live client', async () => {
    // A demo canvas has no client. Nothing should be fetched and nothing drawn.
    const seen = mount(null, 's1');
    await act(async () => {});
    expect(seen.current?.waivers).toEqual([]);
    expect(seen.current?.lessons).toEqual([]);
  });

  it('walks the session’s tasks to find its findings', async () => {
    const asked: string[] = [];
    const seen = mount(
      fakeClient({
        taskIds: async () => ['t-1', 't-2'],
        taskDetail: async (taskId: string) => {
          asked.push(taskId);
          return { findings: taskId === 't-2' ? [finding({ fingerprint: 'fp-2' })] : [] };
        },
      }),
      's1',
    );
    await act(async () => {});
    expect(asked).toEqual(['t-1', 't-2']);
    expect(seen.current?.waivers.map((f) => f.fingerprint)).toEqual(['fp-2']);
  });

  it('drops a finding no operator may waive', async () => {
    const seen = mount(
      fakeClient({
        taskIds: async () => ['t-1'],
        taskDetail: async () => ({ findings: [finding({ severity: 'S1-stop-the-line' })] }),
      }),
      's1',
    );
    await act(async () => {});
    expect(seen.current?.waivers).toEqual([]);
  });

  it('keeps only the lesson candidates this session raised', async () => {
    const seen = mount(
      fakeClient({
        lessons: async () => ({
          pending: [
            {
              lessonId: 'l-1',
              sessionId: 's1',
              lessonType: 'rule',
              lessonScope: 'stack-wide',
              lessonStatus: 'candidate',
              statement: 'a',
            },
            {
              lessonId: 'l-2',
              sessionId: 'other',
              lessonType: 'rule',
              lessonScope: 'stack-wide',
              lessonStatus: 'candidate',
              statement: 'b',
            },
          ],
          approved: [],
          closed: [],
        }),
      }),
      's1',
    );
    await act(async () => {});
    expect(seen.current?.lessons.map((l) => l.lessonId)).toEqual(['l-1']);
  });

  it('does not blank the queue when the read fails', async () => {
    // An empty list reads as "nothing to answer" — the opposite of what a
    // failed read means.
    const seen = mount(
      fakeClient({
        taskIds: async () => {
          throw new Error('HTTP 500');
        },
      }),
      's1',
    );
    await act(async () => {});
    expect(seen.current?.error).toBe('HTTP 500');
  });

  it('reloads on demand, for after an answer lands', async () => {
    let calls = 0;
    const seen = mount(
      fakeClient({
        taskIds: async () => {
          calls += 1;
          return [];
        },
      }),
      's1',
    );
    await act(async () => {});
    expect(calls).toBe(1);
    await act(async () => {
      seen.current?.reload();
    });
    expect(calls).toBe(2);
  });
});
