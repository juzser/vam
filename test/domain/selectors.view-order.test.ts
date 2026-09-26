/**
 * VIEW OPTIONS: orca's "Group by" and "Sort by", applied to the ALREADY
 * project-major, urgency-ranked `entries` array `orderedSessions` produces.
 *
 * WHY THIS SITS DOWNSTREAM OF `orderedSessions` RATHER THAN BESIDE IT. Two
 * things read `entries` besides the sidebar: `Canvas.tsx`'s own keyboard
 * (`j`/`k`, `gt`/`gT`, `f`) and the tab strip's membership computation
 * (`paneEligibleEntries`, wired off `allEntries`/`orderedSessions`, NEVER off
 * `entries`). `applyViewOrder` is what `Canvas.tsx` folds into `entries`
 * ITSELF, so the sidebar draws the same order the keyboard steps through --
 * a grouping the eye sees and the keyboard disagrees with is exactly the
 * defect class #475 closed for the foreign/dismissed filter, one layer up.
 * `allEntries` stays wired to plain `orderedSessions`, untouched, so tab
 * membership (and tab order) never moves because of a sidebar display
 * preference.
 *
 * WHY "PROJECT" NEVER REORDERS PROJECTS. `sortBy` only ever reorders SESSIONS
 * within whatever the current grouping already bucketed them into -- it never
 * decides which bucket, or which project, comes first. Orca draws that as a
 * SEPARATE control, "Project order" (Manual), which vam has no manual
 * ordering to back yet (`docs/design/workspace-options.md`), so project rank
 * stays exactly `orderedSessions`' own (most-urgent-session-first) whatever
 * `sortBy` says. That is also what keeps `gt`/`gT` -- which scans `entries`
 * for "the next different project id" -- from any dependency on `sortBy` at
 * all under `groupBy: 'project'`: a project's own run stays contiguous.
 */

import { describe, expect, it } from 'vitest';
import type { Project, Session } from '../../src/renderer/domain/model.js';
import {
  applyViewOrder,
  DEFAULT_VIEW_OPTIONS,
  type SessionEntry,
  statusBucketOf,
  type ViewOptions,
} from '../../src/renderer/domain/selectors.js';

function session(id: string, title: string, over: Partial<Session> = {}): Session {
  return {
    id,
    title,
    epic: null,
    branch: null,
    status: 'running',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
    ...over,
  };
}

function project(id: string, name: string): Project {
  return { id, name, sessions: [] };
}

function entry(project: Project, session: Session): SessionEntry {
  return { project, session, group: null };
}

const view = (over: Partial<ViewOptions> = {}): ViewOptions => ({
  ...DEFAULT_VIEW_OPTIONS,
  ...over,
});

describe('DEFAULT_VIEW_OPTIONS', () => {
  it('is Project grouping and needs-you-first sorting -- today’s only behaviour, unchanged', () => {
    expect(DEFAULT_VIEW_OPTIONS).toEqual({ groupBy: 'project', sortBy: 'needs-you' });
  });
});

describe('statusBucketOf', () => {
  it('buckets waiting alone as needs-you', () => {
    expect(statusBucketOf(session('a', 'a', { status: 'waiting' }))).toBe('needs-you');
  });

  it('buckets running alone as running', () => {
    expect(statusBucketOf(session('a', 'a', { status: 'running' }))).toBe('running');
  });

  it('buckets idle, unstarted and terminal together as sleeping -- orca’s own word', () => {
    for (const status of ['idle', 'unstarted', 'terminal'] as const) {
      expect(statusBucketOf(session('a', 'a', { status }))).toBe('sleeping');
    }
  });

  it('buckets done and failed together as done', () => {
    for (const status of ['done', 'failed'] as const) {
      expect(statusBucketOf(session('a', 'a', { status }))).toBe('done');
    }
  });
});

describe('applyViewOrder — groupBy: project (the default)', () => {
  const alpha = project('p-alpha', 'alpha');
  const beta = project('p-beta', 'beta');

  it('is a no-op at the shipped defaults -- byte-identical to `entries` as handed in', () => {
    const input = [
      entry(alpha, session('a1', 'Zebra', { status: 'waiting' })),
      entry(alpha, session('a2', 'Apple', { status: 'running' })),
      entry(beta, session('b1', 'Mango', { status: 'waiting' })),
    ];
    expect(applyViewOrder(input, view())).toEqual(input);
  });

  it('sorts by name WITHIN each project run, but never merges two projects’ runs', () => {
    const input = [
      entry(alpha, session('a1', 'Zebra')),
      entry(alpha, session('a2', 'Apple')),
      entry(beta, session('b1', 'Mango')),
      entry(beta, session('b2', 'Banana')),
    ];
    const out = applyViewOrder(input, view({ sortBy: 'name' }));
    expect(out.map((e) => e.session.title)).toEqual(['Apple', 'Zebra', 'Banana', 'Mango']);
    // The RUN order (alpha's run before beta's) is untouched -- only the
    // inside of each run moved.
    expect(out.map((e) => e.project.id)).toEqual(['p-alpha', 'p-alpha', 'p-beta', 'p-beta']);
  });

  it('keeps a project’s two separate runs apart even if they are not adjacent', () => {
    // `entries` is project-major from `orderedSessions`, so two runs of the
    // SAME project id never actually happen in practice -- this pins that a
    // non-contiguous input is not silently merged into one run by the name
    // sort, which would let a future caller's bug through unnoticed.
    const input = [
      entry(alpha, session('a1', 'Zebra')),
      entry(beta, session('b1', 'Mango')),
      entry(alpha, session('a2', 'Apple')),
    ];
    const out = applyViewOrder(input, view({ sortBy: 'name' }));
    expect(out.map((e) => e.session.id)).toEqual(['a1', 'b1', 'a2']);
  });
});

describe('applyViewOrder — groupBy: status', () => {
  const alpha = project('p-alpha', 'alpha');
  const beta = project('p-beta', 'beta');

  it('buckets globally by status, ignoring project boundaries entirely', () => {
    const input = [
      entry(alpha, session('a1', 'a1', { status: 'done' })),
      entry(alpha, session('a2', 'a2', { status: 'waiting' })),
      entry(beta, session('b1', 'b1', { status: 'running' })),
      entry(beta, session('b2', 'b2', { status: 'waiting' })),
    ];
    const out = applyViewOrder(input, view({ groupBy: 'status' }));
    // needs-you (a2, b2) before running (b1) before done (a1) -- and within a
    // bucket, the input's own relative order survives (a STABLE partition).
    expect(out.map((e) => e.session.id)).toEqual(['a2', 'b2', 'b1', 'a1']);
  });

  it('sorts within each status bucket by name when asked', () => {
    const input = [
      entry(alpha, session('a1', 'Zebra', { status: 'waiting' })),
      entry(beta, session('b1', 'Apple', { status: 'waiting' })),
    ];
    const out = applyViewOrder(input, view({ groupBy: 'status', sortBy: 'name' }));
    expect(out.map((e) => e.session.title)).toEqual(['Apple', 'Zebra']);
  });

  it('drops an empty bucket rather than leaving a gap', () => {
    const input = [entry(alpha, session('a1', 'a1', { status: 'running' }))];
    const out = applyViewOrder(input, view({ groupBy: 'status' }));
    expect(out.map((e) => e.session.id)).toEqual(['a1']);
  });
});

describe('applyViewOrder — groupBy: none', () => {
  const alpha = project('p-alpha', 'alpha');
  const beta = project('p-beta', 'beta');

  it('leaves the input order alone at the default sort', () => {
    const input = [entry(alpha, session('a1', 'a1')), entry(beta, session('b1', 'b1'))];
    expect(applyViewOrder(input, view({ groupBy: 'none' }))).toEqual(input);
  });

  it('sorts the WHOLE flat list by name, project boundaries and all', () => {
    const input = [entry(alpha, session('a1', 'Zebra')), entry(beta, session('b1', 'Apple'))];
    const out = applyViewOrder(input, view({ groupBy: 'none', sortBy: 'name' }));
    expect(out.map((e) => e.session.title)).toEqual(['Apple', 'Zebra']);
  });
});

describe('applyViewOrder — the empty list', () => {
  it('is empty under every combination, never throws', () => {
    for (const groupBy of ['project', 'status', 'none'] as const) {
      for (const sortBy of ['needs-you', 'name'] as const) {
        expect(applyViewOrder([], view({ groupBy, sortBy }))).toEqual([]);
      }
    }
  });
});
