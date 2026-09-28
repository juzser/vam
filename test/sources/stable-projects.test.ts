import { describe, expect, it } from 'vitest';
import type { Project } from '../../src/renderer/domain/model.js';
import { stableProjectsKey } from '../../src/renderer/sources/stable-projects.js';

/**
 * Direct, unit-level coverage of `stableProjectsKey` itself -- affe8f37's
 * acceptance criterion that the module's key function be exercised on its
 * own, not only indirectly through `useSourceModel`'s backoff tests
 * (`useSourceModel.test.tsx`'s "affe8f37" describe blocks).
 */

const oneSessionProject = (
  overrides: Partial<{
    cacheSourceNowMs: number | null;
    age: string | null;
    status: 'running' | 'waiting' | 'idle' | 'done' | 'failed' | 'unstarted' | 'terminal';
  }>,
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
        status: overrides.status ?? 'running',
        runningAgents: 0,
        activity: null,
        age: overrides.age ?? '0s',
        branch: null,
        decisions: [],
        cacheSourceNowMs: overrides.cacheSourceNowMs ?? 1_000,
      },
    ],
  },
];

describe('stableProjectsKey', () => {
  it('reads two loads as equal when only Session.cacheSourceNowMs and Session.age differ', () => {
    const first = stableProjectsKey(oneSessionProject({ cacheSourceNowMs: 1_000, age: '0s' }));
    const second = stableProjectsKey(oneSessionProject({ cacheSourceNowMs: 41_000, age: '40s' }));
    expect(first).toBe(second);
  });

  it('reads two loads as different when a real field (status) changes, clocks aside', () => {
    const first = stableProjectsKey(
      oneSessionProject({ cacheSourceNowMs: 1_000, age: '0s', status: 'running' }),
    );
    const second = stableProjectsKey(
      oneSessionProject({ cacheSourceNowMs: 1_000, age: '0s', status: 'waiting' }),
    );
    expect(first).not.toBe(second);
  });

  it('is a pure function -- it never mutates the projects array it is handed', () => {
    const projects = oneSessionProject({ cacheSourceNowMs: 1_000, age: '0s' });
    const before = JSON.stringify(projects);
    stableProjectsKey(projects);
    expect(JSON.stringify(projects)).toBe(before);
  });

  it('produces a stable key across an empty projects list', () => {
    expect(stableProjectsKey([])).toBe(stableProjectsKey([]));
  });
});
