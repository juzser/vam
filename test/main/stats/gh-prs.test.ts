/**
 * "PRs created" — one `gh api graphql` call that returns a single count, on
 * `pull-requests.ts`'s own pattern: argv/parsing/classification are pure and
 * testable here; the spawn itself is not, because running it would reach
 * GitHub with whatever token this machine holds. NEVER a `gh auth` command —
 * this module has no code path that could spell one.
 *
 * WHY GRAPHQL, NOT `gh search prs`: that command paginates and is slow on an
 * account with a long PR history — measured standalone (see the PR body) at
 * multiple SECONDS for `--limit 1000` on this machine's own account, and it
 * dominated the whole warm-scan latency because `scan.ts` used to await it.
 * `search(query: ..., type: ISSUE) { issueCount }` asks GitHub for the COUNT
 * alone — no page of results to walk, no `--limit` guess to get wrong.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyGhPrsFailure,
  ghSearchPrsCountArgv,
  parseGhPrsGraphqlCount,
  toDateOnly,
} from '../../../src/main/stats/gh-prs.js';

describe('toDateOnly', () => {
  it('takes the date half of a real ISO instant', () => {
    expect(toDateOnly('2026-01-15T00:00:00.000Z')).toBe('2026-01-15');
  });

  it('is null for null — a machine with no tracking-since date yet', () => {
    expect(toDateOnly(null)).toBeNull();
  });

  // `vam` only ever BUILDS this from `new Date(...).toISOString()`, never
  // from free text -- but the regex is re-checked here anyway, defensively,
  // so a refactor that broke that guarantee fails LOUD (a query with no
  // date filter) rather than smuggling a malformed value into a shell-free
  // but still GraphQL-query-shaped argument.
  it('is null for anything that is not a strict YYYY-MM-DD prefix', () => {
    expect(toDateOnly('not-a-date')).toBeNull();
    expect(toDateOnly('2026')).toBeNull();
    expect(toDateOnly('')).toBeNull();
  });
});

describe('ghSearchPrsCountArgv', () => {
  it('builds one graphql call with the date carried in a QUERY VARIABLE, never spliced into the query text', () => {
    const argv = ghSearchPrsCountArgv('2026-01-15');
    expect(argv).toEqual([
      'api',
      'graphql',
      '-f',
      'query=query($q:String!){search(query:$q,type:ISSUE){issueCount}}',
      '-f',
      'q=is:pr author:@me created:>=2026-01-15',
    ]);
    expect(argv).not.toContain('auth');
    expect(argv).not.toContain('login');
  });

  it('omits the created filter entirely when there is no since-date yet', () => {
    const argv = ghSearchPrsCountArgv(null);
    expect(argv).toEqual([
      'api',
      'graphql',
      '-f',
      'query=query($q:String!){search(query:$q,type:ISSUE){issueCount}}',
      '-f',
      'q=is:pr author:@me',
    ]);
  });

  it('defensively ignores a since-date that is not a strict YYYY-MM-DD, rather than passing it through', () => {
    const argv = ghSearchPrsCountArgv('2026-01-15T00:00:00.000Z; rm -rf /');
    expect(argv[5]).toBe('q=is:pr author:@me');
  });
});

describe('parseGhPrsGraphqlCount', () => {
  it('counts the issueCount graphql answers', () => {
    expect(parseGhPrsGraphqlCount('{"data":{"search":{"issueCount":42}}}')).toEqual({
      kind: 'ok',
      count: 42,
    });
  });

  it('is zero for a real zero — not folded into unavailable', () => {
    expect(parseGhPrsGraphqlCount('{"data":{"search":{"issueCount":0}}}')).toEqual({
      kind: 'ok',
      count: 0,
    });
  });

  it('is unavailable (reason "error") for output this shape was not built to read', () => {
    expect(parseGhPrsGraphqlCount('not json')).toEqual({
      kind: 'unavailable',
      hint: 'connect GitHub in Settings → Integrations',
      reason: 'error',
    });
    expect(parseGhPrsGraphqlCount('{"data":{}}')).toEqual({
      kind: 'unavailable',
      hint: 'connect GitHub in Settings → Integrations',
      reason: 'error',
    });
    expect(parseGhPrsGraphqlCount('{"errors":[{"message":"bad credentials"}]}')).toEqual({
      kind: 'unavailable',
      hint: 'connect GitHub in Settings → Integrations',
      reason: 'error',
    });
  });
});

describe('classifyGhPrsFailure', () => {
  it('is "no-gh" for a missing gh binary', () => {
    const result = classifyGhPrsFailure({ code: 'ENOENT' }, '');
    expect(result).toEqual({
      kind: 'unavailable',
      hint: 'connect GitHub in Settings → Integrations',
      reason: 'no-gh',
    });
  });

  it('is "timeout" for a call this module\'s own timeout killed', () => {
    const result = classifyGhPrsFailure({ killed: true }, '');
    expect(result).toEqual({
      kind: 'unavailable',
      hint: 'connect GitHub in Settings → Integrations',
      reason: 'timeout',
    });
  });

  it('is "not-logged-in" for an unauthenticated gh', () => {
    const result = classifyGhPrsFailure(
      {},
      'gh: To use GitHub CLI in a script, gh auth login first',
    );
    expect(result).toEqual({
      kind: 'unavailable',
      hint: 'connect GitHub in Settings → Integrations',
      reason: 'not-logged-in',
    });
  });

  it('is "error" for anything else', () => {
    const result = classifyGhPrsFailure({}, 'rate limited');
    expect(result).toEqual({
      kind: 'unavailable',
      hint: 'connect GitHub in Settings → Integrations',
      reason: 'error',
    });
  });
});
