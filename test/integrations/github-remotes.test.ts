/**
 * A project's OWN git remotes, read as the picker's first suggestions --
 * "include the project's own git remotes as the first suggestions."
 *
 * Read-only, and never a security boundary the way `checkOwnerName` is: this
 * runs `git remote -v` in a directory vam already knows about (a live
 * session's own `cwd`, resolved the same way every other per-project reader
 * in this tree resolves one), and only ever DISPLAYS what it finds -- nothing
 * here reaches `gh` argv.
 */
import { describe, expect, it } from 'vitest';
import {
  gitRemotesArgv,
  parseGitRemotes,
  remoteUrlToRepo,
} from '../../src/main/integrations/github-remotes.js';

describe('remoteUrlToRepo', () => {
  it('reads an SSH remote', () => {
    expect(remoteUrlToRepo('git@github.com:juzser/vam.git')).toBe('juzser/vam');
  });

  it('reads an https remote, with and without .git', () => {
    expect(remoteUrlToRepo('https://github.com/juzser/vam.git')).toBe('juzser/vam');
    expect(remoteUrlToRepo('https://github.com/juzser/vam')).toBe('juzser/vam');
  });

  it('reads an ssh:// remote with an explicit port', () => {
    expect(remoteUrlToRepo('ssh://git@github.com:22/juzser/vam.git')).toBe('juzser/vam');
  });

  it('reads a credentialed https remote without leaking the credential', () => {
    expect(remoteUrlToRepo('https://x-access-token:ghp_abc123@github.com/juzser/vam.git')).toBe(
      'juzser/vam',
    );
  });

  it('answers null for a non-GitHub host', () => {
    expect(remoteUrlToRepo('https://gitlab.com/juzser/vam.git')).toBeNull();
    expect(remoteUrlToRepo('git@bitbucket.org:juzser/vam.git')).toBeNull();
  });

  it('answers null for a self-hosted GitHub Enterprise host', () => {
    // Out of scope for the picker (candidates are github.com only, matching
    // `pr-link.ts`'s own https/github.com-only rule) rather than guessed at.
    expect(remoteUrlToRepo('git@ghe.example.com:juzser/vam.git')).toBeNull();
  });

  it('answers null for garbage', () => {
    expect(remoteUrlToRepo('not a url')).toBeNull();
    expect(remoteUrlToRepo('')).toBeNull();
  });
});

describe('gitRemotesArgv', () => {
  it('asks for the URL form, machine-readable', () => {
    expect(gitRemotesArgv()).toEqual(['remote', '-v']);
  });
});

describe('parseGitRemotes', () => {
  it('reads `origin` first, MEASURED shape of `git remote -v`', () => {
    const stdout = [
      'origin\tgit@github.com:juzser/vam.git (fetch)',
      'origin\tgit@github.com:juzser/vam.git (push)',
      'upstream\thttps://github.com/other/vam.git (fetch)',
      'upstream\thttps://github.com/other/vam.git (push)',
      '',
    ].join('\n');
    expect(parseGitRemotes(stdout)).toEqual([
      { name: 'origin', repo: 'juzser/vam' },
      { name: 'upstream', repo: 'other/vam' },
    ]);
  });

  it('puts `origin` first even when git lists it second', () => {
    const stdout = [
      'upstream\thttps://github.com/other/vam.git (fetch)',
      'origin\tgit@github.com:juzser/vam.git (fetch)',
      '',
    ].join('\n');
    expect(parseGitRemotes(stdout).map((r) => r.name)).toEqual(['origin', 'upstream']);
  });

  it('drops a remote that does not resolve to a GitHub repo', () => {
    const stdout = 'origin\thttps://gitlab.com/juzser/vam.git (fetch)\n';
    expect(parseGitRemotes(stdout)).toEqual([]);
  });

  it('de-duplicates fetch and push lines for one remote', () => {
    const stdout = [
      'origin\tgit@github.com:juzser/vam.git (fetch)',
      'origin\tgit@github.com:juzser/vam.git (push)',
      '',
    ].join('\n');
    expect(parseGitRemotes(stdout)).toEqual([{ name: 'origin', repo: 'juzser/vam' }]);
  });

  it('answers an empty list for no remotes, or a directory that is not a repository', () => {
    expect(parseGitRemotes('')).toEqual([]);
    expect(
      parseGitRemotes('fatal: not a git repository (or any of the parent directories): .git'),
    ).toEqual([]);
  });
});
