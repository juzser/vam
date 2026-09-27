/**
 * Parsing `gh auth status`, in every shape it answers.
 *
 * "NOT KNOWING IS A STATE" -- `pull-requests.ts`'s own rule, restated for the
 * Integrations section: `gh` missing, not logged in, and logged in each get a
 * distinct answer, and "logged in" carries every account `gh` reported rather
 * than only the active one, because a paused review through a second host is
 * still a fact worth showing.
 *
 * FIXTURES ARE MEASURED, not imagined: the JSON and text blocks below are
 * captured from a real `gh auth status`/`gh auth status --json hosts` (gh
 * 2.95.0), with the login redacted to `octocat` and the token already masked
 * by gh itself.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyGhAuthFailure,
  ghAuthStatusArgv,
  ghAuthStatusTextArgv,
  parseGhAuthStatusJson,
  parseGhAuthStatusText,
  REQUIRED_SCOPES,
} from '../../src/main/integrations/github-status.js';

describe('ghAuthStatusArgv / ghAuthStatusTextArgv', () => {
  it('asks for JSON, scoped to hosts, first', () => {
    expect(ghAuthStatusArgv()).toEqual(['auth', 'status', '--json', 'hosts']);
  });

  it('falls back to the plain text form for an older gh', () => {
    expect(ghAuthStatusTextArgv()).toEqual(['auth', 'status']);
  });
});

describe('classifyGhAuthFailure', () => {
  it('is cli-missing on ENOENT', () => {
    expect(classifyGhAuthFailure({ code: 'ENOENT' }, '')).toBe('cli-missing');
  });

  it('is old-gh when the installed gh does not know --json', () => {
    expect(classifyGhAuthFailure({ code: 1 }, 'unknown flag: --json')).toBe('old-gh');
  });

  it('is other for anything else', () => {
    expect(classifyGhAuthFailure({ code: 1 }, 'some network error')).toBe('other');
  });
});

describe('parseGhAuthStatusJson', () => {
  it('reads the logged-in shape, MEASURED against a real gh 2.95.0', () => {
    const stdout =
      '{"hosts":{"github.com":[{"state":"success","active":true,"host":"github.com","login":"octocat","tokenSource":"keyring","scopes":"gist, read:org, repo, user, workflow","gitProtocol":"https"}]}}';
    const status = parseGhAuthStatusJson(stdout);
    expect(status?.kind).toBe('logged-in');
    if (status?.kind !== 'logged-in') return;
    expect(status.accounts).toEqual([
      {
        host: 'github.com',
        login: 'octocat',
        active: true,
        tokenSource: 'keyring',
        scopes: ['gist', 'read:org', 'repo', 'user', 'workflow'],
        missingScopes: [],
      },
    ]);
  });

  it('reads the logged-out shape, MEASURED: `{"hosts":{}}`, exit 0', () => {
    const status = parseGhAuthStatusJson('{"hosts":{}}');
    expect(status).toEqual({ kind: 'logged-out' });
  });

  it('flags a scope this app’s PR features need but the token lacks', () => {
    // `gh auth login --help`'s own words: "the minimum required scopes for
    // the token are: repo, read:org, and gist" -- so a token missing `repo`
    // cannot do what vam's PR reader and PR actions both need.
    const stdout =
      '{"hosts":{"github.com":[{"state":"success","active":true,"host":"github.com","login":"octocat","tokenSource":"keyring","scopes":"gist, read:org","gitProtocol":"https"}]}}';
    const status = parseGhAuthStatusJson(stdout);
    if (status?.kind !== 'logged-in') throw new Error('expected logged-in');
    expect(status.accounts[0]?.missingScopes).toEqual(['repo']);
  });

  it('never warns about a scope it was not told about', () => {
    // `scopes` absent entirely -- a token source that cannot introspect scopes
    // (measured: `gh auth status` omits the line rather than printing empty).
    const stdout =
      '{"hosts":{"github.com":[{"state":"success","active":true,"host":"github.com","login":"octocat","tokenSource":"env","gitProtocol":"https"}]}}';
    const status = parseGhAuthStatusJson(stdout);
    if (status?.kind !== 'logged-in') throw new Error('expected logged-in');
    expect(status.accounts[0]?.scopes).toBeNull();
    expect(status.accounts[0]?.missingScopes).toEqual([]);
  });

  it('reads two accounts on two hosts, the active one and the other', () => {
    const stdout = JSON.stringify({
      hosts: {
        'github.com': [
          {
            state: 'success',
            active: true,
            login: 'octocat',
            tokenSource: 'keyring',
            scopes: 'repo',
          },
        ],
        'ghe.example.com': [
          {
            state: 'success',
            active: false,
            login: 'octocat-work',
            tokenSource: 'keyring',
            scopes: 'repo',
          },
        ],
      },
    });
    const status = parseGhAuthStatusJson(stdout);
    if (status?.kind !== 'logged-in') throw new Error('expected logged-in');
    expect(status.accounts.map((a) => `${a.host}:${a.login}:${a.active}`)).toEqual([
      'github.com:octocat:true',
      'ghe.example.com:octocat-work:false',
    ]);
  });

  it('answers null for anything that is not this shape, so the caller falls back', () => {
    expect(parseGhAuthStatusJson('not json')).toBeNull();
    expect(parseGhAuthStatusJson('{"nope":true}')).toBeNull();
    expect(parseGhAuthStatusJson('[]')).toBeNull();
    expect(parseGhAuthStatusJson('{"hosts":"not an object"}')).toBeNull();
  });

  it('drops an entry with no login rather than drawing a blank account', () => {
    const stdout = '{"hosts":{"github.com":[{"state":"success","active":true}]}}';
    const status = parseGhAuthStatusJson(stdout);
    if (status?.kind !== 'logged-in') throw new Error('expected logged-in');
    expect(status.accounts).toEqual([]);
  });
});

describe('parseGhAuthStatusText', () => {
  it('reads "not logged in", MEASURED against a real gh with an empty config', () => {
    const stderr = 'You are not logged into any GitHub hosts. To log in, run: gh auth login';
    expect(parseGhAuthStatusText('', stderr, true)).toEqual({ kind: 'logged-out' });
  });

  it('reads the logged-in text block, MEASURED against a real gh 2.95.0', () => {
    const stdout = [
      'github.com',
      '  ✓ Logged in to github.com account octocat (keyring)',
      '  - Active account: true',
      '  - Git operations protocol: https',
      "  - Token scopes: 'gist', 'read:org', 'repo', 'user', 'workflow'",
      '',
    ].join('\n');
    const status = parseGhAuthStatusText(stdout, '', false);
    expect(status.kind).toBe('logged-in');
    if (status.kind !== 'logged-in') return;
    expect(status.accounts).toEqual([
      {
        host: 'github.com',
        login: 'octocat',
        active: true,
        tokenSource: 'keyring',
        scopes: ['gist', 'read:org', 'repo', 'user', 'workflow'],
        missingScopes: [],
      },
    ]);
  });

  it('answers unknown for output it does not recognise, never a silent empty list', () => {
    const status = parseGhAuthStatusText('', 'some future gh output nobody has seen', true);
    expect(status.kind).toBe('unknown');
  });
});

describe('REQUIRED_SCOPES', () => {
  it('is exactly what `gh auth login --help` names as the minimum', () => {
    expect(REQUIRED_SCOPES).toEqual(['repo', 'read:org', 'gist']);
  });
});
