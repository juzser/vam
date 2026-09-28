/**
 * Parsing `glab auth status`, in every shape it answers.
 *
 * "NOT KNOWING IS A STATE" -- `github-status.test.ts`'s own rule, restated
 * for GitLab: `glab` missing, not logged in, and logged in each get a
 * distinct answer, and "logged in" carries every account `glab` reported.
 *
 * FIXTURES:
 *
 *  - The "not logged in" block is MEASURED against a real `glab auth status`
 *    (glab 1.119.0, installed via `brew install glab` for this work, never
 *    logged in): a totally fresh run, no `~/.config/glab-cli` on disk at
 *    all, still resolves an implicit `gitlab.com` instance and prints to
 *    STDERR with exit code 1 -- captured verbatim below, byte for byte.
 *  - The "logged in" block could not be measured the same way (this task
 *    was told not to sign in), so it is built from `glab`'s own source --
 *    `internal/commands/auth/status/status.go` on `gitlab-org/cli`'s `main`
 *    (fetched 2026-09-28, same repo the `--hostname`/`--all` flags below
 *    were read from): `addMsg("%s Logged in to %s as %s (%s)",
 *    c.GreenCheck(), instance, c.Bold(user.Username), tokenSource)`.
 *    `c.GreenCheck()` renders as the bare "✓" and `c.Bold()` as plain text
 *    in a non-tty spawn -- MEASURED on the very same binary in the
 *    logged-out fixture below, where every other check-mark line in that
 *    capture is un-styled plain text.
 *  - The never-authenticated-anywhere message
 *    ("no GitLab instances have been authenticated with glab") is `glab`'s
 *    own source text for `cfg.Hosts()` answering empty -- a path this
 *    binary would not enter for a real spawn (a fresh `glab` always
 *    resolves an implicit gitlab.com instance, see the fixture above), kept
 *    here only so the parser degrades to `logged-out` rather than `unknown`
 *    if some future/older `glab` build ever does take it.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyGlabAuthFailure,
  glabAuthStatusArgv,
  parseGlabAuthStatusText,
} from '../../src/main/integrations/gitlab-status.js';

describe('glabAuthStatusArgv', () => {
  it('asks for plain auth status -- glab has no --json form for it', () => {
    // Measured: `glab auth status --help` (1.119.0) lists no `--json` flag,
    // unlike `gh auth status --json hosts`.
    expect(glabAuthStatusArgv()).toEqual(['auth', 'status']);
  });
});

describe('classifyGlabAuthFailure', () => {
  it('is cli-missing on ENOENT', () => {
    expect(classifyGlabAuthFailure({ code: 'ENOENT' })).toBe('cli-missing');
  });

  it('is other for anything else', () => {
    expect(classifyGlabAuthFailure({ code: 1 })).toBe('other');
  });
});

describe('parseGlabAuthStatusText', () => {
  it('reads "not logged in", MEASURED against a real glab 1.119.0 with no config at all', () => {
    const stderr = [
      'gitlab.com',
      '  x gitlab.com: API call failed: GET https://gitlab.com/api/v4/user: 401 {message: 401 Unauthorized}',
      '  ✓ Git operations for gitlab.com configured to use ssh protocol.',
      '  ✓ API calls for gitlab.com are made over https protocol.',
      '  ✓ REST API Endpoint: https://gitlab.com/api/v4/',
      '  ✓ GraphQL Endpoint: https://gitlab.com/api/graphql/',
      '  ! No token found (checked config file, keyring, and environment variables).',
      '',
      '   ERROR  ',
      '',
      '  X could not authenticate to one or more of the configured GitLab instances.',
      '',
    ].join('\n');
    expect(parseGlabAuthStatusText('', stderr, true)).toEqual({ kind: 'logged-out' });
  });

  it('reads the never-authenticated-anywhere message, from glab’s own source text', () => {
    const stderr =
      'Error: no GitLab instances have been authenticated with glab; run `glab auth login` to authenticate';
    expect(parseGlabAuthStatusText('', stderr, true)).toEqual({ kind: 'logged-out' });
  });

  it('reads the logged-in block, built from glab’s own source (status.go, gitlab-org/cli)', () => {
    const stderr = [
      'gitlab.com',
      '  ✓ Logged in to gitlab.com as octocat (keyring)',
      '  ✓ Git operations for gitlab.com configured to use ssh protocol.',
      '  ✓ API calls for gitlab.com are made over https protocol.',
      '  ✓ REST API Endpoint: https://gitlab.com/api/v4/',
      '  ✓ GraphQL Endpoint: https://gitlab.com/api/graphql/',
      '  ✓ Token found in operating system keyring: **************************',
      '',
    ].join('\n');
    const status = parseGlabAuthStatusText('', stderr, false);
    expect(status).toEqual({
      kind: 'logged-in',
      accounts: [{ host: 'gitlab.com', login: 'octocat' }],
    });
  });

  it('reads every host on --all, the active one and the other', () => {
    const stderr = [
      'gitlab.com',
      '  ✓ Logged in to gitlab.com as octocat (keyring)',
      'salsa.debian.org',
      '  ✓ Logged in to salsa.debian.org as octocat-work (keyring)',
      '',
    ].join('\n');
    const status = parseGlabAuthStatusText('', stderr, false);
    if (status.kind !== 'logged-in') throw new Error('expected logged-in');
    expect(status.accounts).toEqual([
      { host: 'gitlab.com', login: 'octocat' },
      { host: 'salsa.debian.org', login: 'octocat-work' },
    ]);
  });

  it('answers unknown for output it does not recognise, never a silent empty list', () => {
    const status = parseGlabAuthStatusText('', 'some future glab output nobody has seen', true);
    expect(status).toEqual({ kind: 'unknown', message: 'some future glab output nobody has seen' });
  });

  it('never renders a token -- glab’s own status line masks it, and this parser reads no token field at all', () => {
    const stderr = [
      'gitlab.com',
      '  ✓ Logged in to gitlab.com as octocat (keyring)',
      '  ✓ Token found in operating system keyring: **************************',
      '',
    ].join('\n');
    const status = parseGlabAuthStatusText('', stderr, false);
    expect(JSON.stringify(status)).not.toMatch(/glpat-/);
    if (status.kind !== 'logged-in') throw new Error('expected logged-in');
    expect(Object.keys(status.accounts[0] ?? {})).toEqual(['host', 'login']);
  });
});
