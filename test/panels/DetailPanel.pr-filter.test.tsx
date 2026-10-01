// @vitest-environment happy-dom

/**
 * THE PRs VIEW'S FILTERS, AS THE OPERATOR MEETS THEM. The argv half is
 * `test/sources/pull-requests.test.ts`; this is the half that proves the
 * renderer only DRAWS: it never filters, never re-sorts, and never shows
 * the rows of one filter set under the label of another.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel } from '../../src/renderer/panels/DetailPanel.js';
import { changePrFilters, getPrFilters } from '../../src/renderer/prefs/prefs.js';
import { DEFAULT_PR_FILTERS, prFilterKey } from '../../src/shared/pr-filters.js';
import { makePullRequest } from '../support/pull-request.js';

const DECISION: Decision = { id: 'd1', label: 'turn', input: 'ask', output: 'done', commands: [] };

function entryWith(pullRequests: Session['pullRequests']): SessionEntry {
  const session: Session = {
    id: 's1',
    title: 'Survey',
    epic: null,
    branch: 'topic/here',
    status: 'running',
    runningAgents: 0,
    activity: null,
    age: '3m',
    decisions: [DECISION],
    ...(pullRequests === undefined ? {} : { pullRequests }),
  };
  const project: Project = {
    id: 'p1',
    name: 'factory',
    source: 'claude-code',
    sessions: [session],
  };
  return { project, session };
}

function panel(pullRequests: Session['pullRequests']) {
  return (
    <DetailPanel
      entry={entryWith(pullRequests)}
      decision={DECISION}
      draft=""
      onDraftChange={() => {}}
      onSubmit={() => {}}
      composing={false}
      onCompose={() => {}}
      onStopComposing={() => {}}
      active={false}
      actionIndex={0}
      width={408}
      resizeHandle={null}
      tabRequest={{ tab: 'PRs' }}
    />
  );
}

const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const rows = (n: number, head = 'x') =>
  Array.from({ length: n }, (_, i) =>
    makePullRequest({ number: i + 1, headRefName: `${head}${i}` }),
  );
const okList = (prs: ReturnType<typeof rows>, filterKey?: string): Session['pullRequests'] => ({
  kind: 'ok',
  prs,
  ...(filterKey === undefined ? {} : { filterKey }),
});

let pushed: unknown[];
beforeEach(() => {
  localStorage.clear();
  changePrFilters(DEFAULT_PR_FILTERS, null);
  pushed = [];
  vi.stubGlobal(
    'window',
    Object.assign(window, {
      api: { prefs: { setPrFilters: async (f: unknown) => void pushed.push(f) } },
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the filter bar', () => {
  it('is drawn with Mine/Open/Updated and labelled controls', () => {
    render(panel(okList(rows(2), prFilterKey(DEFAULT_PR_FILTERS))));
    expect(q('[data-pr-filter-choice="mine"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('[data-pr-filter-choice="all"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(q<HTMLSelectElement>('[data-pr-filter-state]')?.value).toBe('open');
    expect(q<HTMLSelectElement>('[data-pr-filter-sort]')?.value).toBe('updated');
    expect(q('[data-pr-filter-author]')?.getAttribute('aria-label')).toBe('Author');
    expect(q('[data-pr-filters]')?.textContent).toContain('State');
  });

  it('is not drawn when the source reports no pull requests at all', () => {
    render(panel(undefined));
    expect(q('[data-pr-filters]')).toBeNull();
  });

  it('is drawn over an unavailable list too', () => {
    render(panel({ kind: 'unavailable', code: 'timed-out', message: 'GitHub did not answer' }));
    expect(q('[data-pr-filters]')).not.toBeNull();
  });

  it('a click flips the pressed author, pushes and stores; re-clicking is a no-op', () => {
    render(panel(okList(rows(2), prFilterKey(DEFAULT_PR_FILTERS))));
    fireEvent.click(q('[data-pr-filter-choice="all"]') as HTMLElement);
    expect(q('[data-pr-filter-choice="all"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(pushed).toEqual([{ author: 'all', state: 'open', sort: 'updated' }]);
    expect(getPrFilters().author).toBe('all');
    fireEvent.click(q('[data-pr-filter-choice="all"]') as HTMLElement);
    expect(pushed).toHaveLength(1);
  });

  it('a select change pushes the whole set', () => {
    render(panel(okList(rows(1), prFilterKey(DEFAULT_PR_FILTERS))));
    fireEvent.change(q('[data-pr-filter-state]') as HTMLElement, { target: { value: 'merged' } });
    fireEvent.change(q('[data-pr-filter-sort]') as HTMLElement, { target: { value: 'created' } });
    expect(pushed.at(-1)).toEqual({ author: 'mine', state: 'merged', sort: 'created' });
  });
});

describe('loading after a change', () => {
  it('unmounts the stale rows until a list for the new key arrives', () => {
    const { rerender } = render(panel(okList(rows(2), prFilterKey(DEFAULT_PR_FILTERS))));
    expect(document.querySelectorAll('[data-pr-row]')).toHaveLength(2);
    fireEvent.change(q('[data-pr-filter-state]') as HTMLElement, { target: { value: 'all' } });
    expect(document.querySelectorAll('[data-pr-row]')).toHaveLength(0);
    expect(q('[data-prs-loading]')?.getAttribute('role')).toBe('status');
    expect(q('[data-prs-count]')).toBeNull();
    expect(q('[data-pr-filters]')).not.toBeNull();

    const key = prFilterKey({ author: 'mine', state: 'all', sort: 'updated' });
    rerender(panel(okList(rows(3), key)));
    expect(q('[data-prs-loading]')).toBeNull();
    expect(document.querySelectorAll('[data-pr-row]')).toHaveLength(3);
  });

  it('draws a list with no filterKey as is', () => {
    render(panel(okList(rows(2))));
    expect(q('[data-prs-loading]')).toBeNull();
    expect(document.querySelectorAll('[data-pr-row]')).toHaveLength(2);
  });
});

describe('the count line', () => {
  it('says 1 pull request / n pull requests', () => {
    const key = prFilterKey(DEFAULT_PR_FILTERS);
    const { rerender } = render(panel(okList(rows(1), key)));
    expect(q('[data-prs-count]')?.textContent).toBe('1 pull request');
    expect(q('[data-prs-count]')?.getAttribute('aria-live')).toBe('polite');
    rerender(panel(okList(rows(7), key)));
    expect(q('[data-prs-count]')?.textContent).toBe('7 pull requests');
  });

  it('notes the server cap at 50, by the sort in force', () => {
    changePrFilters({ author: 'all', state: 'all', sort: 'created' }, null);
    const key = prFilterKey(getPrFilters());
    const { rerender } = render(panel(okList(rows(50), key)));
    expect(q('[data-prs-count]')?.textContent).toBe(
      '50 pull requests (the 50 most recently created)',
    );
    changePrFilters(DEFAULT_PR_FILTERS, null);
    rerender(panel(okList(rows(50), prFilterKey(DEFAULT_PR_FILTERS))));
    expect(q('[data-prs-count]')?.textContent).toBe(
      '50 pull requests (the 50 most recently updated)',
    );
  });

  it('shows every row the server sent, in the server order, past the first 50 shown by any renderer cap', () => {
    // EC-60: the match was outside the newest 50 of the repo; the server found it.
    render(
      panel(
        okList(
          [makePullRequest({ number: 4242, title: 'old match' })],
          prFilterKey(DEFAULT_PR_FILTERS),
        ),
      ),
    );
    expect(q('[data-pr-title]')?.textContent).toBe('old match');
  });
});

describe('no match', () => {
  it('names the filters and offers Clear filters when they are not the defaults', () => {
    changePrFilters({ author: 'all', state: 'draft', sort: 'updated' }, null);
    render(panel(okList([], prFilterKey(getPrFilters()))));
    const block = q('[data-prs-empty-filtered]');
    expect(block?.hasAttribute('data-prs-empty')).toBe(true);
    expect(block?.textContent).toContain('No pull requests match these filters.');
    fireEvent.click(q('[data-pr-filters-clear]') as HTMLElement);
    expect(getPrFilters()).toEqual(DEFAULT_PR_FILTERS);
    expect(pushed.at(-1)).toEqual(DEFAULT_PR_FILTERS);
    expect(q('[data-prs-loading]')).not.toBeNull();
  });

  it('omits Clear filters at the defaults', () => {
    render(panel(okList([], prFilterKey(DEFAULT_PR_FILTERS))));
    expect(q('[data-prs-empty-filtered]')).not.toBeNull();
    expect(q('[data-pr-filters-clear]')).toBeNull();
  });
});

describe('the This branch mark', () => {
  it('marks the row on the session branch and leaves order alone', () => {
    const prs = [
      makePullRequest({ number: 1, headRefName: 'other' }),
      makePullRequest({ number: 2, headRefName: 'topic/here' }),
    ];
    render(panel(okList(prs, prFilterKey(DEFAULT_PR_FILTERS))));
    const all = [...document.querySelectorAll('[data-pr-row]')];
    expect(all.map((r) => r.hasAttribute('data-prs-row-current'))).toEqual([false, true]);
    expect(all[1]?.querySelector('[data-pr-current]')?.textContent).toBe('This branch');
    expect(all[0]?.querySelector('[data-pr-current]')).toBeNull();
  });
});
