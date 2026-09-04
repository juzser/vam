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
  summarizeChecks,
} from '../../src/main/sources/claude-code/pull-requests.js';
import type { PullRequestList } from '../../src/renderer/domain/model.js';

const unavailable = (list: PullRequestList | undefined) =>
  list !== undefined && list.kind === 'unavailable' ? list : null;

describe('the argv vam hands to gh', () => {
  it('asks only about the session branch, and only for the fields the pane draws', () => {
    const argv = prListArgv('feature/panel-rework');

    expect(argv[0]).toBe('pr');
    expect(argv[1]).toBe('list');
    // The branch is ONE element and is never interpolated: execFile runs no
    // shell, so a branch name with a space or a quote in it has no meaning.
    expect(argv).toContain('--head');
    expect(argv[argv.indexOf('--head') + 1]).toBe('feature/panel-rework');
    const fields = argv[argv.indexOf('--json') + 1]?.split(',') ?? [];
    expect(fields).toEqual(['number', 'title', 'state', 'isDraft', 'statusCheckRollup']);
    // Nothing that writes, and no repository override: the working directory
    // decides which repository is asked about.
    expect(argv).not.toContain('--repo');
    expect(argv.some((a) => /^--(?:web|edit|create)/.test(a))).toBe(false);
  });

  it('caps the answer, so one branch with a long history cannot flood the pane', () => {
    const argv = prListArgv('main');
    const limit = Number(argv[argv.indexOf('--limit') + 1]);
    expect(Number.isInteger(limit)).toBe(true);
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(20);
  });
});

describe('every way asking can fail gets its own answer', () => {
  const fail = (stderr: string, extra: Record<string, unknown> = {}) =>
    classifyGhFailure({
      failure: { message: 'spawn failed', ...extra },
      stderr,
      branch: 'feature/x',
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
    expect(list.prs[0]).toEqual({
      number: 128,
      title: 'Rework the detail pane so a narrow column stays readable end to end',
      state: 'open',
      checks: 'passing',
    });
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

  it('keeps two branches in the same checkout apart', async () => {
    const h = harness(async () => OK);
    await h.read({ cwd: '/w/atlas', branch: 'topic/a' });
    await h.read({ cwd: '/w/atlas', branch: 'topic/b' });
    await h.read({ cwd: '/w/other', branch: 'topic/a' });
    expect(h.calls()).toBe(3);
  });

  it('serves every caller that arrives during a read from that one read', async () => {
    let release: (list: PullRequestList) => void = () => {};
    const h = harness(() => new Promise<PullRequestList>((r) => (release = r)));
    const both = Promise.all([
      h.read({ cwd: '/w/atlas', branch: 'topic/a' }),
      h.read({ cwd: '/w/atlas', branch: 'topic/a' }),
    ]);
    release(OK);
    expect(await both).toEqual([OK, OK]);
    expect(h.calls()).toBe(1);
  });

  it('answers about a session with no known branch without asking gh anything', async () => {
    const h = harness(async () => OK);
    const list = await h.read({ cwd: '/w/atlas', branch: null });
    expect(unavailable(list)?.code).toBe('branch-unknown');
    expect(h.calls()).toBe(0);
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
