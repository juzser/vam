/**
 * WHAT A PULL REQUEST ROW SAYS BEYOND ITS NUMBER — and what it says when `gh`
 * said nothing.
 *
 * The operator's report on the PRs tab was two sentences: "it does not show
 * line changes (+ / −)" and "it needs more information". So the field set grew
 * -- the diff size, the two branch names, the author, the review decision, the
 * labels, when it last moved, and the address of the thing itself.
 *
 * THE SHAPES HERE WERE MEASURED, NOT REASONED ABOUT. Every fixture below is
 * the shape `gh pr list --json` really emits on this machine (gh 2.95.0),
 * with invented values: `author` is an OBJECT and the login is inside it,
 * `labels` is a list of objects, `reviewDecision` is the EMPTY STRING and not
 * `null` when nobody has reviewed, and `mergeable` is `UNKNOWN` far more often
 * than it is either real answer -- including on a pull request that has
 * already merged. A parser written against a reasonable guess at that payload
 * would have drawn `[object Object]` for the author and "review required" for
 * a repository with no reviewers.
 *
 * TWO CLASSES OF FIELD, AND THEY ARE DELIBERATELY NOT TREATED ALIKE:
 *
 *  - `number`, `title`, `state` stay STRICT. A row that fails them fails the
 *    whole list as `bad-response`, because the identity of a row is what the
 *    pane is for and a silently shortened list is indistinguishable from a
 *    true one. That rule is `pull-requests.ts`'s and is untouched.
 *  - everything added here is TOLERANT, and absent means `null` rather than
 *    a zero or a guess. A missing adornment is not a shortened list: refusing
 *    the whole answer because one pull request had no reviewer would turn
 *    this file's own rule -- not knowing is a state -- against the operator.
 *    `0` is a real diff size and `null` is "gh did not say"; they must not be
 *    the same value.
 */

import { describe, expect, it } from 'vitest';
import { parsePrList, prListArgv } from '../../src/main/sources/claude-code/pull-requests.js';
import type { PullRequest, PullRequestList } from '../../src/renderer/domain/model.js';

const rows = (list: PullRequestList): readonly PullRequest[] => {
  if (list.kind !== 'ok') throw new Error(`expected a list, got ${list.code}: ${list.message}`);
  return list.prs;
};

const one = (row: Record<string, unknown>): PullRequest => {
  const [pr] = rows(parsePrList(JSON.stringify([row])));
  if (pr === undefined) throw new Error('the parser dropped the row');
  return pr;
};

/** The payload as gh really writes it, measured. Values invented. */
const FULL = {
  additions: 6269,
  author: { id: 'MDQ6VXNlcjU3MzUwNzE=', is_bot: false, login: 'juzser', name: 'Son Nguyen H.' },
  baseRefName: 'main',
  changedFiles: 76,
  deletions: 317,
  headRefName: 'smith/atlas/tab-shell',
  isDraft: false,
  labels: [
    { id: 'LA_1', name: 'enhancement', description: '', color: 'a2eeef' },
    { id: 'LA_2', name: 'needs review', description: '', color: 'd93f0b' },
  ],
  mergeable: 'MERGEABLE',
  number: 411,
  reviewDecision: 'APPROVED',
  state: 'OPEN',
  statusCheckRollup: [
    { __typename: 'CheckRun', conclusion: 'SUCCESS', name: 'check', status: 'COMPLETED' },
  ],
  title: 'The prompt row, the settings split',
  updatedAt: '2026-09-18T10:58:08Z',
  url: 'https://github.com/juzser/atlas/pull/411',
};

describe('the fields vam asks gh for', () => {
  it('asks for the diff size, the branches, the author, the review and the address', () => {
    const fields = prListArgv('feature/x')[prListArgv('feature/x').indexOf('--json') + 1] ?? '';
    const asked = fields.split(',');
    // Every name here was checked against `gh pr list --help`'s own JSON
    // FIELDS list on this machine before it was written down. An invented
    // name is not a soft failure: gh exits non-zero and the whole pane goes
    // to `gh-failed`.
    for (const field of [
      'number',
      'title',
      'state',
      'isDraft',
      'statusCheckRollup',
      'author',
      'additions',
      'deletions',
      'changedFiles',
      'headRefName',
      'baseRefName',
      'updatedAt',
      'url',
      'reviewDecision',
      'labels',
      'mergeable',
    ]) {
      expect(asked).toContain(field);
    }
  });

  it('still names no repository and still asks for nothing that writes', () => {
    const argv = prListArgv('feature/x');
    expect(argv).not.toContain('--repo');
    expect(argv.some((a) => /^--(?:web|edit|create)/.test(a))).toBe(false);
  });
});

describe('a row gh answered in full', () => {
  it('carries the diff size as three separate numbers, zero included', () => {
    const pr = one(FULL);
    expect(pr.additions).toBe(6269);
    expect(pr.deletions).toBe(317);
    expect(pr.changedFiles).toBe(76);
    // Zero is a fact, not an absence: a pull request that only deletes has
    // `additions: 0`, and drawing that as "not said" would be a lie.
    const empty = one({ ...FULL, additions: 0, deletions: 0, changedFiles: 0 });
    expect(empty.additions).toBe(0);
    expect(empty.deletions).toBe(0);
    expect(empty.changedFiles).toBe(0);
  });

  it('carries both branch names, the author login and when it last moved', () => {
    const pr = one(FULL);
    expect(pr.headRefName).toBe('smith/atlas/tab-shell');
    expect(pr.baseRefName).toBe('main');
    // The LOGIN, out of the object gh nests it in -- not the object, and not
    // the display name, which is not what a review is attributed to.
    expect(pr.author).toBe('juzser');
    expect(pr.updatedAt).toBe('2026-09-18T10:58:08Z');
  });

  it('carries the label names in gh’s own order', () => {
    expect(one(FULL).labels).toEqual(['enhancement', 'needs review']);
  });

  it('turns the review decision into one of three words', () => {
    expect(one(FULL).review).toBe('approved');
    expect(one({ ...FULL, reviewDecision: 'CHANGES_REQUESTED' }).review).toBe('changes-requested');
    expect(one({ ...FULL, reviewDecision: 'REVIEW_REQUIRED' }).review).toBe('review-required');
  });

  it('keeps the existing four facts exactly as they were', () => {
    const pr = one(FULL);
    expect(pr.number).toBe(411);
    expect(pr.title).toBe('The prompt row, the settings split');
    expect(pr.state).toBe('open');
    expect(pr.checks).toBe('passing');
    expect(one({ ...FULL, isDraft: true }).state).toBe('draft');
  });
});

describe('every added field tolerates gh saying nothing', () => {
  /** The oldest shape this reader ever saw: the five fields it used to ask for. */
  const BARE = {
    number: 7,
    title: 'a minimal row',
    state: 'MERGED',
    isDraft: false,
    statusCheckRollup: [],
  };

  it('parses a row carrying only the original fields, and reports the rest as unknown', () => {
    const pr = one(BARE);
    expect(pr.number).toBe(7);
    expect(pr.state).toBe('merged');
    expect(pr.additions).toBeNull();
    expect(pr.deletions).toBeNull();
    expect(pr.changedFiles).toBeNull();
    expect(pr.headRefName).toBeNull();
    expect(pr.baseRefName).toBeNull();
    expect(pr.author).toBeNull();
    expect(pr.review).toBeNull();
    expect(pr.updatedAt).toBeNull();
    expect(pr.url).toBeNull();
    expect(pr.mergeable).toBeNull();
    // A list, always -- never `null`. Nothing downstream should have to ask
    // whether it may iterate.
    expect(pr.labels).toEqual([]);
  });

  it('reads the EMPTY STRING gh writes for "nobody has reviewed" as unknown, not as required', () => {
    // MEASURED: `reviewDecision` is `""` on a repository with no review
    // rules, on every row. Mapping `""` onto `review-required` would put
    // "review required" on every pull request the operator owns.
    expect(one({ ...FULL, reviewDecision: '' }).review).toBeNull();
    expect(one({ ...FULL, reviewDecision: null }).review).toBeNull();
    expect(one({ ...FULL, reviewDecision: 'SOMETHING_NEW' }).review).toBeNull();
  });

  it('reads gh’s UNKNOWN mergeability as not knowing', () => {
    // MEASURED: `UNKNOWN` is what gh answers for most rows, including merged
    // ones -- GitHub computes mergeability lazily. It is not "conflicting".
    expect(one({ ...FULL, mergeable: 'UNKNOWN' }).mergeable).toBeNull();
    expect(one({ ...FULL, mergeable: 'CONFLICTING' }).mergeable).toBe('conflicting');
    expect(one({ ...FULL, mergeable: 'MERGEABLE' }).mergeable).toBe('mergeable');
  });

  it('survives an author that is null, an empty object, or not an object at all', () => {
    expect(one({ ...FULL, author: null }).author).toBeNull();
    expect(one({ ...FULL, author: {} }).author).toBeNull();
    expect(one({ ...FULL, author: 'juzser' }).author).toBeNull();
    expect(one({ ...FULL, author: { login: '' } }).author).toBeNull();
  });

  it('survives labels that are not a list, and drops entries with no name', () => {
    expect(one({ ...FULL, labels: null }).labels).toEqual([]);
    expect(one({ ...FULL, labels: 'enhancement' }).labels).toEqual([]);
    expect(one({ ...FULL, labels: [{ id: 'x' }, { name: 'bug' }, null] }).labels).toEqual(['bug']);
  });

  it('refuses a diff size that is not a whole count, rather than drawing it', () => {
    // `null`, a string, a fraction and a negative are all "gh did not say a
    // number of lines". None of them may reach the pane as one.
    for (const bad of [null, '6269', -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(one({ ...FULL, additions: bad }).additions).toBeNull();
    }
  });

  it('refuses a branch name or a timestamp that is empty or not a string', () => {
    expect(one({ ...FULL, headRefName: '' }).headRefName).toBeNull();
    expect(one({ ...FULL, baseRefName: 42 }).baseRefName).toBeNull();
    expect(one({ ...FULL, updatedAt: '' }).updatedAt).toBeNull();
  });

  /**
   * THE ADDRESS IS CHECKED WHERE IT IS READ, not only where it is opened.
   *
   * A row whose `url` vam would refuse to open must not draw as a link that
   * refuses on click -- absent, not dimmed. So the reader carries the address
   * only when it passes the same check main enforces at the channel, and
   * `null` otherwise. Main still checks again: this is convenience, and the
   * boundary is the guarantee.
   */
  it('carries the address only when it is one vam would actually open', () => {
    expect(one(FULL).url).toBe('https://github.com/juzser/atlas/pull/411');
    expect(one({ ...FULL, url: 'http://github.com/juzser/atlas/pull/411' }).url).toBeNull();
    expect(one({ ...FULL, url: 'https://github.evil.test/juzser/atlas/pull/411' }).url).toBeNull();
    expect(one({ ...FULL, url: 'javascript:alert(1)' }).url).toBeNull();
    expect(one({ ...FULL, url: '' }).url).toBeNull();
    expect(one({ ...FULL, url: 42 }).url).toBeNull();
  });
});

describe('the strict half is still strict', () => {
  it('fails the WHOLE list when a row has no number, whatever else it carries', () => {
    const list = parsePrList(JSON.stringify([FULL, { ...FULL, number: 'eleven' }]));
    expect(list.kind).toBe('unavailable');
    if (list.kind === 'unavailable') expect(list.code).toBe('bad-response');
  });

  it('fails the whole list for a state it has never heard of', () => {
    const list = parsePrList(JSON.stringify([{ ...FULL, state: 'QUEUED' }]));
    expect(list.kind).toBe('unavailable');
  });
});
