/**
 * Candidate repositories for the Integrations picker: `gh repo list <owner>`
 * and the viewer's own organisations.
 *
 * INJECTION ATTEMPTS ARE THE POINT of the argv tests: an owner typed into the
 * search box is the least trusted string this module ever sees, and `--`
 * ahead of the positional argument is what keeps `gh repo list -- --evil`
 * from reading `--evil` as a flag rather than an owner nobody has. MEASURED
 * against a real `gh` 2.95.0: `gh repo list -- --evil` answers "the owner
 * handle "--evil" was not recognized...", never parses it as a flag.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyGithubReposFailure,
  orgsListArgv,
  parseOrgsList,
  parseReposList,
  REPOS_PAGE_LIMIT,
  reposListArgv,
} from '../../src/main/integrations/github-repos.js';

describe('reposListArgv', () => {
  it('asks for exactly nameWithOwner, capped, with `--` ahead of the owner', () => {
    expect(reposListArgv('juzser')).toEqual([
      'repo',
      'list',
      '--json',
      'nameWithOwner',
      '--limit',
      String(REPOS_PAGE_LIMIT),
      '--',
      'juzser',
    ]);
  });

  it('never reaches the caller for an owner that is not one', () => {
    expect(() => reposListArgv('--evil')).toThrow();
    expect(() => reposListArgv('../etc')).toThrow();
    expect(() => reposListArgv('')).toThrow();
  });
});

describe('orgsListArgv', () => {
  it('asks the viewer’s own orgs endpoint for logins only', () => {
    expect(orgsListArgv()).toEqual(['api', 'user/orgs', '--jq', '.[].login']);
  });
});

describe('parseReposList', () => {
  it('reads nameWithOwner rows, MEASURED against a real gh 2.95.0', () => {
    const stdout = '[{"nameWithOwner":"juzser/vam"},{"nameWithOwner":"juzser/blacksmith"}]';
    expect(parseReposList(stdout)).toEqual({
      kind: 'ok',
      repos: ['juzser/vam', 'juzser/blacksmith'],
    });
  });

  it('answers bad-response for anything that is not a list of that shape', () => {
    for (const bad of ['not json', '{}', '[1,2,3]', '[{"name":"vam"}]']) {
      const result = parseReposList(bad);
      expect(result.kind, bad).toBe('bad-response');
    }
  });

  it('fails the whole list rather than silently shortening it', () => {
    // `nameWithOwner` is the single field asked for and IS the row's whole
    // identity -- `pull-requests.ts`'s own rule for `number`/`title`/`state`.
    const stdout = '[{"nameWithOwner":"juzser/vam"},{"nope":true}]';
    expect(parseReposList(stdout).kind).toBe('bad-response');
  });
});

describe('parseOrgsList', () => {
  it('reads one login per line, MEASURED against a real gh 2.95.0', () => {
    expect(parseOrgsList('ownego\nqikify\noe-intern\n')).toEqual(['ownego', 'qikify', 'oe-intern']);
  });

  it('drops blank lines', () => {
    expect(parseOrgsList('ownego\n\nqikify\n')).toEqual(['ownego', 'qikify']);
  });

  it('answers an empty list for an operator with no orgs', () => {
    expect(parseOrgsList('')).toEqual([]);
  });
});

describe('classifyGithubReposFailure', () => {
  it('is cli-missing on ENOENT', () => {
    const result = classifyGithubReposFailure({ code: 'ENOENT' }, '', 'juzser');
    expect(result.code).toBe('cli-missing');
  });

  it('is owner-not-found for gh’s own wording, MEASURED against a real gh', () => {
    const stderr =
      'the owner handle "--evil" was not recognized as either a GitHub user or an organization';
    const result = classifyGithubReposFailure({ code: 1 }, stderr, '--evil');
    expect(result.code).toBe('owner-not-found');
    expect(result.message).toContain('--evil');
  });

  it('is not-authenticated for gh’s login sentence', () => {
    const result = classifyGithubReposFailure({ code: 1 }, 'gh auth login', 'juzser');
    expect(result.code).toBe('not-authenticated');
  });

  it('falls back to gh-failed with gh’s own words', () => {
    const result = classifyGithubReposFailure({ code: 1 }, 'a network timeout', 'juzser');
    expect(result.code).toBe('gh-failed');
    expect(result.message).toContain('a network timeout');
  });
});
