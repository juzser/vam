/**
 * "PRs created" — `gh search prs --author @me --created >=<tracking-since>`,
 * counted. Pure argv/parsing/classification here, on `pull-requests.ts`'s own
 * pattern: the one thing that cannot be unit-tested is the spawn itself,
 * because running it would reach GitHub with whatever token this machine
 * holds. NEVER a `gh auth` command — this module has no code path that could
 * spell one.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyGhPrsFailure,
  ghSearchPrsArgv,
  parseGhPrsCount,
} from '../../../src/main/stats/gh-prs.js';

describe('ghSearchPrsArgv', () => {
  it('searches by the operator and a created-since date, JSON output, never gh auth', () => {
    const argv = ghSearchPrsArgv('2026-01-15T00:00:00.000Z');
    expect(argv).toEqual([
      'search',
      'prs',
      '--author',
      '@me',
      '--created',
      '>=2026-01-15',
      '--json',
      'number',
      '--limit',
      '1000',
    ]);
    expect(argv).not.toContain('auth');
    expect(argv).not.toContain('login');
  });

  it('omits --created entirely when there is no tracking-since date yet', () => {
    const argv = ghSearchPrsArgv(null);
    expect(argv).toEqual([
      'search',
      'prs',
      '--author',
      '@me',
      '--json',
      'number',
      '--limit',
      '1000',
    ]);
  });
});

describe('parseGhPrsCount', () => {
  it('counts the JSON array gh prints', () => {
    expect(parseGhPrsCount('[{"number":1},{"number":2},{"number":3}]')).toEqual({
      kind: 'ok',
      count: 3,
    });
  });

  it('is zero for an empty array — a real "none", not an unavailable reading', () => {
    expect(parseGhPrsCount('[]')).toEqual({ kind: 'ok', count: 0 });
  });

  it('is unavailable for output that is not a JSON array', () => {
    expect(parseGhPrsCount('not json')).toEqual({
      kind: 'unavailable',
      hint: 'connect GitHub in Settings → Integrations',
    });
    expect(parseGhPrsCount('{"not":"an array"}')).toEqual({
      kind: 'unavailable',
      hint: 'connect GitHub in Settings → Integrations',
    });
  });
});

describe('classifyGhPrsFailure', () => {
  it('is unavailable, with the connect-GitHub hint, for a missing gh binary', () => {
    const result = classifyGhPrsFailure({ code: 'ENOENT' }, '');
    expect(result).toEqual({
      kind: 'unavailable',
      hint: 'connect GitHub in Settings → Integrations',
    });
  });

  it('is unavailable, with the same hint, for an unauthenticated gh', () => {
    const result = classifyGhPrsFailure(
      {},
      'gh: To use GitHub CLI in a script, gh auth login first',
    );
    expect(result).toEqual({
      kind: 'unavailable',
      hint: 'connect GitHub in Settings → Integrations',
    });
  });

  it('is unavailable, with the same hint, for any other failure — one honest sentence, not a taxonomy', () => {
    const result = classifyGhPrsFailure({}, 'rate limited');
    expect(result).toEqual({
      kind: 'unavailable',
      hint: 'connect GitHub in Settings → Integrations',
    });
  });
});
