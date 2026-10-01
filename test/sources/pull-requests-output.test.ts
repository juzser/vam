/**
 * The size of a repository-wide list and what an oversize answer is called.
 * Every fixture is invented.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyGhFailure,
  type GhRunner,
  readPullRequestsViaCli,
} from '../../src/main/sources/claude-code/pull-requests.js';

const FOUR_MIB = 4 * 1024 * 1024;
const ONE_MIB = 1024 * 1024;

const heavyPr = (number: number) => ({
  number,
  title: `Change ${number}`,
  state: 'OPEN',
  isDraft: false,
  statusCheckRollup: Array.from({ length: 40 }, (_, i) => ({
    __typename: 'CheckRun',
    name: `matrix-job-${number}-${i}-with-a-long-descriptive-name`,
    status: 'COMPLETED',
    conclusion: 'SUCCESS',
    workflowName: 'continuous-integration',
    detailsUrl: `https://example.invalid/runs/${number}/jobs/${i}`,
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T00:05:00Z',
    checkSuite: {
      workflowRun: { event: 'pull_request', workflow: { name: 'continuous-integration' } },
    },
    title: `Run the ${i}th shard of the integration matrix for change ${number} on every platform`,
    text: 'x'.repeat(380),
  })),
  author: { login: 'someone' },
  additions: 10,
  deletions: 2,
  changedFiles: 3,
  headRefName: `branch-${number}`,
  baseRefName: 'main',
  updatedAt: '2026-01-01T00:00:00Z',
  url: `https://github.com/example/repo/pull/${number}`,
  reviewDecision: '',
  labels: Array.from({ length: 6 }, (_, i) => ({
    id: `L${i}`,
    name: `label-${i}`,
    description: 'an invented label',
    color: 'ededed',
  })),
  mergeable: 'MERGEABLE',
});

const BIG = JSON.stringify(Array.from({ length: 50 }, (_, i) => heavyPr(i + 1)));

/** Fails the way execFile does when stdout passes `maxBuffer`. */
const maxBufferError = (): Error =>
  Object.assign(new Error('stdout maxBuffer length exceeded'), {
    code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
    killed: true,
    signal: 'SIGTERM',
  });

const enforcingRunner: GhRunner = (_file, _args, options, callback) => {
  if (Buffer.byteLength(BIG) > options.maxBuffer) callback(maxBufferError(), '', '');
  else callback(null, BIG, '');
  return undefined;
};

const OVERSIZE =
  'The pull request list is larger than vam reads (4 MiB). Narrow the filter or the search.';

describe('a repository-wide list with heavy CI data', () => {
  it('serialises between 1 MiB and 4 MiB and reads whole through an enforcing runner', async () => {
    const bytes = Buffer.byteLength(BIG);
    expect(bytes).toBeGreaterThan(ONE_MIB);
    expect(bytes).toBeLessThan(FOUR_MIB);

    const list = await readPullRequestsViaCli(
      'gh',
      () => true,
      enforcingRunner,
    )({
      cwd: '/somewhere',
      branch: 'main',
    });
    expect(list.kind).toBe('ok');
    if (list.kind === 'ok') expect(list.prs).toHaveLength(50);
  });
});

describe('an answer past the list cap', () => {
  const input = (failure: Error) => ({
    failure,
    stderr: '',
    branch: 'main',
    cwd: '/somewhere',
    overridden: false,
  });

  it('is too-large with its own sentence, never timed-out', () => {
    expect(classifyGhFailure(input(maxBufferError()))).toEqual({
      kind: 'unavailable',
      code: 'too-large',
      message: OVERSIZE,
    });
  });

  it('still calls a real timeout timed-out', () => {
    const timeout = Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' });
    const list = classifyGhFailure(input(timeout));
    expect(list).toMatchObject({ kind: 'unavailable', code: 'timed-out' });
  });
});
