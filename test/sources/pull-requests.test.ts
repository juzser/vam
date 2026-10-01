/**
 * `gh pr list` behind vam's first outbound call made on the operator's behalf
 * with the operator's own credentials.
 *
 * THE SPAWN IS NOT TESTED HERE, and cannot be: running it would reach GitHub
 * from a test run, with whatever token the machine happens to hold. So the
 * module is split the way `deliver.ts` is -- argv construction, failure
 * classification, payload parsing and the read throttle are pure and are what
 * this file exercises; `readPullRequestsViaCli` is the thin remainder.
 *
 * Every fixture below is invented. No repository, branch or path here is real.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyGhFailure,
  createPullRequestReader,
  MIN_PR_READ_INTERVAL_MS,
  parsePrList,
  prListArgv,
  readPullRequestsViaCli,
  setPrFilters,
  summarizeChecks,
} from '../../src/main/sources/claude-code/pull-requests.js';
import type { PullRequestList } from '../../src/renderer/domain/model.js';
import { DEFAULT_PR_FILTERS, type PrFilters } from '../../src/shared/pr-filters.js';

const unavailable = (list: PullRequestList | undefined) =>
  list !== undefined && list.kind === 'unavailable' ? list : null;

const EVERYONE_ALL: PrFilters = { author: 'all', state: 'all', sort: 'updated' };

describe('the argv vam hands to gh', () => {
  it('asks the repository for the fields the pane draws, with no head and no repo', () => {
    const argv = prListArgv(EVERYONE_ALL);

    expect(argv[0]).toBe('pr');
    expect(argv[1]).toBe('list');
    expect(argv).not.toContain('--head');
    const fields = argv[argv.indexOf('--json') + 1]?.split(',') ?? [];
    // The four the ROW's identity rests on. The descriptive fields are pinned
    // in `pull-requests-detail.test.ts`, beside the shapes they arrive in.
    expect(fields.slice(0, 5)).toEqual([
      'number',
      'title',
      'state',
      'isDraft',
      'statusCheckRollup',
    ]);
    // Nothing that writes, and no repository override: the working directory
    // decides which repository is asked about.
    expect(argv).not.toContain('--repo');
    expect(argv.some((a) => /^--(?:web|edit|create)/.test(a))).toBe(false);
  });

  it('caps the answer at fifty', () => {
    const argv = prListArgv(EVERYONE_ALL);
    expect(argv[argv.indexOf('--limit') + 1]).toBe('50');
  });

  it('pins the argv for every state, author and sort', () => {
    const json = prListArgv(EVERYONE_ALL).at(-1);
    const expected: Record<string, { state: string; extra: string }> = {
      open: { state: 'open', extra: '' },
      ready: { state: 'open', extra: 'draft:false ' },
      draft: { state: 'open', extra: 'draft:true ' },
      merged: { state: 'merged', extra: '' },
      closed: { state: 'closed', extra: 'is:unmerged ' },
      all: { state: 'all', extra: '' },
    };
    for (const [state, want] of Object.entries(expected)) {
      for (const sort of ['updated', 'created'] as const) {
        for (const author of ['mine', 'all'] as const) {
          const argv = prListArgv({ author, state: state as PrFilters['state'], sort });
          expect(argv).toEqual([
            'pr',
            'list',
            '--state',
            want.state,
            ...(author === 'mine' ? ['--author', '@me'] : []),
            '--search',
            `${want.extra}sort:${sort}-desc`,
            '--limit',
            '50',
            '--json',
            json,
          ]);
        }
      }
    }
  });
});

describe('every way asking can fail gets its own answer', () => {
  // `cwd` and `overridden` travel with every classification now, so a failure
  // can name the directory it happened in -- which matters the moment the
  // operator points a project somewhere other than the session's own (see
  // `pull-requests-repo.test.ts`). Not overridden here: these cases are all
  // about the session's own directory, and the sentences they assert are the
  // ones that wording produces.
  const fail = (stderr: string, extra: Record<string, unknown> = {}) =>
    classifyGhFailure({
      failure: { message: 'spawn failed', ...extra },
      stderr,
      branch: 'feature/x',
      cwd: '/w/atlas',
      overridden: false,
    });

  it('says the gh command is missing, in deliver.ts vocabulary', () => {
    const list = fail('', { code: 'ENOENT' });
    expect(list.kind).toBe('unavailable');
    expect(unavailable(list)?.code).toBe('cli-missing');
    expect(unavailable(list)?.message).toContain('gh');
  });

  it('separates an unauthenticated gh from every other refusal', () => {
    const list = fail('gh: To get started with GitHub CLI, please run: gh auth login');
    expect(unavailable(list)?.code).toBe('not-authenticated');
    expect(unavailable(list)?.message).toContain('auth');
  });

  it('separates a directory that is not a git repository', () => {
    const list = fail('fatal: not a git repository (or any of the parent directories): .git');
    expect(unavailable(list)?.code).toBe('not-a-repo');
  });

  it('separates a repository with no GitHub remote', () => {
    const list = fail(
      'none of the git remotes configured for this repository point to a known GitHub host',
    );
    expect(unavailable(list)?.code).toBe('no-github-remote');
  });

  it('separates a timeout, which is not a refusal but an unanswered question', () => {
    const list = fail('', { killed: true });
    expect(unavailable(list)?.code).toBe('timed-out');
  });

  it('falls back to gh-failed, carrying what gh actually said', () => {
    const list = fail('HTTP 502: something went wrong at the far end');
    expect(unavailable(list)?.code).toBe('gh-failed');
    expect(unavailable(list)?.message).toContain('502');
  });

  it('gives every failure a distinct code, so the pane can never flatten two into one', () => {
    const codes = [
      fail('', { code: 'ENOENT' }),
      fail('gh auth login'),
      fail('fatal: not a git repository'),
      fail('none of the git remotes point to a known GitHub host'),
      fail('', { killed: true }),
      fail('HTTP 502'),
      parsePrList('not json at all'),
    ].map((l) => unavailable(l)?.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).not.toContain(undefined);
  });
});

/** A realistic `gh pr list --json ...` body. Invented repository, invented branch. */
const PAYLOAD = JSON.stringify([
  {
    number: 128,
    title: 'Rework the detail pane so a narrow column stays readable end to end',
    state: 'OPEN',
    isDraft: false,
    statusCheckRollup: [
      { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ],
  },
  {
    number: 121,
    title: 'Draft: spike the roster reader',
    state: 'OPEN',
    isDraft: true,
    statusCheckRollup: [],
  },
  {
    number: 97,
    title: 'Carry the branch through to the sidebar row',
    state: 'MERGED',
    isDraft: false,
    statusCheckRollup: [{ __typename: 'StatusContext', context: 'ci/lint', state: 'FAILURE' }],
  },
]);

describe('reading what gh answered', () => {
  it('turns a realistic payload into rows the pane can draw', () => {
    const list = parsePrList(PAYLOAD);
    expect(list.kind).toBe('ok');
    if (list.kind !== 'ok') throw new Error('expected ok');
    expect(list.prs).toHaveLength(3);
    // The four facts this file has always asserted. The payload above predates
    // the fields added for "it needs more information", which is the point of
    // asserting it unchanged: a row gh answered in the OLD shape still parses,
    // and the new fields report not-knowing rather than taking the list down.
    expect(list.prs[0]).toMatchObject({
      number: 128,
      title: 'Rework the detail pane so a narrow column stays readable end to end',
      state: 'open',
      checks: 'passing',
    });
    expect(list.prs[0]?.additions).toBeNull();
    expect(list.prs[0]?.author).toBeNull();
    expect(list.prs[0]?.labels).toEqual([]);
    // A draft is its own state, not an open PR: the difference is the whole
    // reason the operator would look at this pane before pinging anyone.
    expect(list.prs[1]?.state).toBe('draft');
    expect(list.prs[1]?.checks).toBe('none');
    expect(list.prs[2]?.state).toBe('merged');
    expect(list.prs[2]?.checks).toBe('failing');
  });

  it('reads an empty array as the one true empty case, never as a failure', () => {
    const list = parsePrList('[]');
    expect(list.kind).toBe('ok');
    if (list.kind !== 'ok') throw new Error('expected ok');
    expect(list.prs).toEqual([]);
  });

  it('refuses to read unparseable output as "no PRs"', () => {
    const list = parsePrList('gh: unexpected end of JSON input');
    expect(unavailable(list)?.code).toBe('bad-response');
  });

  it('refuses a row it does not understand rather than inventing a state for it', () => {
    const list = parsePrList(JSON.stringify([{ number: 4, title: 'x', state: 'ELSEWHERE' }]));
    expect(unavailable(list)?.code).toBe('bad-response');
  });

  it('refuses a body that is not an array of rows', () => {
    expect(unavailable(parsePrList('{"prs":[]}'))?.code).toBe('bad-response');
  });
});

describe('summarizing a check rollup', () => {
  it('says none when there are no checks at all, which is not the same as passing', () => {
    expect(summarizeChecks([])).toBe('none');
    expect(summarizeChecks(undefined)).toBe('none');
  });

  it('lets one failure decide the whole rollup', () => {
    expect(
      summarizeChecks([
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
        { status: 'COMPLETED', conclusion: 'FAILURE' },
      ]),
    ).toBe('failing');
  });

  it('reports pending while anything is still running, and never calls that passing', () => {
    expect(
      summarizeChecks([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }]),
    ).toBe('pending');
    expect(summarizeChecks([{ state: 'PENDING' }])).toBe('pending');
  });

  it('treats a conclusion it has never heard of as pending, not as success', () => {
    expect(summarizeChecks([{ status: 'COMPLETED', conclusion: 'WHAT' }])).toBe('pending');
  });

  it('passes when every check finished acceptably', () => {
    expect(
      summarizeChecks([
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
        { status: 'COMPLETED', conclusion: 'SKIPPED' },
        { state: 'SUCCESS' },
      ]),
    ).toBe('passing');
  });
});

describe('the read throttle, so a broken setup cannot spawn a process per poll', () => {
  const OK: PullRequestList = { kind: 'ok', prs: [] };
  const BROKEN: PullRequestList = {
    kind: 'unavailable',
    code: 'not-authenticated',
    message: 'gh is not authenticated',
  };

  function harness(answers: () => Promise<PullRequestList>) {
    let clock = 1_000_000;
    let calls = 0;
    const read = createPullRequestReader(
      async () => {
        calls += 1;
        return answers();
      },
      () => clock,
    );
    return {
      read,
      calls: () => calls,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  }

  it('is well clear of the ten-second source poll', () => {
    expect(MIN_PR_READ_INTERVAL_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('serves a second read inside the interval from the first answer', async () => {
    const h = harness(async () => OK);
    await h.read({ cwd: '/w/atlas', branch: 'topic/a' });
    h.advance(MIN_PR_READ_INTERVAL_MS - 1);
    await h.read({ cwd: '/w/atlas', branch: 'topic/a' });
    expect(h.calls()).toBe(1);

    h.advance(2);
    await h.read({ cwd: '/w/atlas', branch: 'topic/a' });
    expect(h.calls()).toBe(2);
  });

  it('throttles a FAILING read too, which is the hole worth closing', async () => {
    const h = harness(async () => BROKEN);
    const first = await h.read({ cwd: '/w/atlas', branch: 'topic/a' });
    h.advance(1000);
    const second = await h.read({ cwd: '/w/atlas', branch: 'topic/a' });
    expect(h.calls()).toBe(1);
    expect(second).toEqual(first);
  });

  it('keeps two checkouts apart', async () => {
    const h = harness(async () => OK);
    await h.read({ cwd: '/w/atlas', branch: 'topic/a' });
    await h.read({ cwd: '/w/other', branch: 'topic/a' });
    expect(h.calls()).toBe(2);
  });

  it('serves every caller that arrives during a read from that one read', async () => {
    let release: (list: PullRequestList) => void = () => {};
    const h = harness(() => new Promise<PullRequestList>((r) => (release = r)));
    const both = Promise.all([
      h.read({ cwd: '/w/atlas', branch: 'topic/a' }),
      h.read({ cwd: '/w/atlas', branch: 'topic/a' }),
    ]);
    release(OK);
    expect(await both).toEqual([
      { ...OK, filterKey: 'mine|open|updated' },
      { ...OK, filterKey: 'mine|open|updated' },
    ]);
    expect(h.calls()).toBe(1);
  });

  it("asks about a session with no known branch too: the list is the repository's", async () => {
    const h = harness(async () => OK);
    const list = await h.read({ cwd: '/w/atlas', branch: null });
    expect(list.kind).toBe('ok');
    expect(h.calls()).toBe(1);
  });

  it('makes one call per directory and filter set, whatever the branch', async () => {
    const h = harness(async () => OK);
    setPrFilters(DEFAULT_PR_FILTERS);
    await h.read({ cwd: '/w/atlas', branch: 'topic/a' });
    await h.read({ cwd: '/w/atlas', branch: 'topic/b' });
    expect(h.calls()).toBe(1);

    setPrFilters({ ...DEFAULT_PR_FILTERS, state: 'merged' });
    const other = await h.read({ cwd: '/w/atlas', branch: 'topic/a' });
    expect(h.calls()).toBe(2);
    expect(other.kind === 'ok' && other.filterKey).toBe('mine|merged|updated');
    setPrFilters(DEFAULT_PR_FILTERS);
  });

  it('still bounds the cache', async () => {
    const h = harness(async () => OK);
    for (let i = 0; i < 70; i += 1) await h.read({ cwd: `/w/d${i}`, branch: null });
    await h.read({ cwd: '/w/d0', branch: null });
    expect(h.calls()).toBe(71);
  });

  it('survives a reader that throws, and throttles that too', async () => {
    const h = harness(async () => {
      throw new Error('unexpected');
    });
    const list = await h.read({ cwd: '/w/atlas', branch: 'topic/a' });
    expect(unavailable(list)?.code).toBe('gh-failed');
    await h.read({ cwd: '/w/atlas', branch: 'topic/a' });
    expect(h.calls()).toBe(1);
  });
});

describe('a match outside the newest fifty overall', () => {
  const row = (number: number, author: string, updatedAt: string) => ({
    number,
    title: `Change ${number}`,
    state: 'MERGED',
    isDraft: false,
    statusCheckRollup: [],
    author: { login: author },
    updatedAt,
  });

  it('is found because the filters ride the query, not a client-side slice', async () => {
    const argvs: string[][] = [];
    const run = (
      _binary: string,
      argv: readonly string[],
      _options: unknown,
      done: (failure: null, stdout: string, stderr: string) => void,
    ) => {
      argvs.push([...argv]);
      const has = (flag: string, value: string) => argv[argv.indexOf(flag) + 1] === value;
      const rows =
        argv.includes('--author') && has('--author', '@me') && has('--state', 'merged')
          ? [row(7, 'me', '2025-10-01T00:00:00Z')]
          : argv.includes('--author') || !has('--state', 'all')
            ? []
            : Array.from({ length: 50 }, (_, i) => row(100 + i, 'other', '2026-09-30T00:00:00Z'));
      done(null, JSON.stringify(rows), '');
    };
    const read = createPullRequestReader(readPullRequestsViaCli('gh', () => true, run));

    setPrFilters({ author: 'mine', state: 'merged', sort: 'updated' });
    const list = await read({ cwd: '/w/atlas', branch: 'topic/a' });
    setPrFilters(DEFAULT_PR_FILTERS);

    expect(list.kind === 'ok' && list.prs.map((pr) => pr.number)).toEqual([7]);
    const sent = argvs[0] ?? [];
    for (const word of ['--author', '@me', '--state', 'merged']) expect(sent).toContain(word);
  });
});
