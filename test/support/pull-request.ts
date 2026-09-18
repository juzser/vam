/**
 * A `PullRequest` fixture, built from the four facts a row cannot be without.
 *
 * WHY THIS EXISTS. `PullRequest` grew eleven descriptive fields when the
 * operator asked for "more information" on the PRs tab, and every one of them
 * is `| null` -- required in the type, so that the parser has to ANSWER for
 * each one, and `null` meaning "gh did not say" rather than a zero or a blank.
 * That is the right shape for the model and a poor shape for a fixture: a test
 * about draft state should not have to restate eleven nulls to say that a
 * pull request is a draft.
 *
 * So the defaults here are the NOT-KNOWING ones. A fixture built with no
 * overrides is exactly what the reader produces from a payload carrying only
 * the five fields it originally asked for, which is a real shape -- an older
 * gh, a cached answer -- and not an invented one.
 */

import type { PullRequest } from '../../src/renderer/domain/model.js';

export function makePullRequest(over: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 1,
    title: 'a pull request',
    state: 'open',
    checks: 'none',
    additions: null,
    deletions: null,
    changedFiles: null,
    headRefName: null,
    baseRefName: null,
    author: null,
    review: null,
    updatedAt: null,
    labels: [],
    url: null,
    mergeable: null,
    ...over,
  };
}
