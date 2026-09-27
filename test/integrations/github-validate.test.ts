/**
 * The one gate every operator-typed or search-typed string crosses before it
 * reaches `gh` argv for the Integrations section: an owner (a GitHub user or
 * organisation login), and a whole `owner/name`.
 *
 * ALLOWLISTED, NOT SANITISED -- `pr-actions.ts`'s own rule for `checkBranchName`,
 * reused here for the reason that file states: the interesting inputs are the
 * ones nobody thought of, so a small allowlist of what a login IS beats a list
 * of characters somebody remembered to forbid.
 */
import { describe, expect, it } from 'vitest';
import { checkOwnerName, checkRepoFullName } from '../../src/main/integrations/github-validate.js';

describe('checkOwnerName', () => {
  it('accepts an ordinary login', () => {
    const result = checkOwnerName('juzser');
    expect(result.ok).toBe(true);
  });

  it('accepts a hyphenated org login', () => {
    expect(checkOwnerName('ownego-ai').ok).toBe(true);
  });

  it('refuses a value that looks like a flag', () => {
    for (const bad of ['-x', '--paginate', '--repo=evil/evil']) {
      const result = checkOwnerName(bad);
      expect(result.ok, bad).toBe(false);
    }
  });

  it('refuses a path traversal attempt', () => {
    expect(checkOwnerName('../../etc').ok).toBe(false);
  });

  it('refuses whitespace and newlines', () => {
    for (const bad of ['juz ser', 'juzser\n', 'juz\tser', 'juzser ']) {
      expect(checkOwnerName(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('refuses an empty or non-string value', () => {
    for (const bad of ['', null, undefined, 7, {}]) {
      expect(checkOwnerName(bad as unknown as string).ok).toBe(false);
    }
  });

  it('refuses a leading or trailing hyphen', () => {
    expect(checkOwnerName('-juzser').ok).toBe(false);
    expect(checkOwnerName('juzser-').ok).toBe(false);
  });

  it('refuses one longer than GitHub logins ever are', () => {
    expect(checkOwnerName('a'.repeat(40)).ok).toBe(false);
    expect(checkOwnerName('a'.repeat(39)).ok).toBe(true);
  });
});

describe('checkRepoFullName', () => {
  it('accepts an ordinary owner/name', () => {
    expect(checkRepoFullName('juzser/vam').ok).toBe(true);
  });

  it('accepts a name with dots, dashes and underscores', () => {
    expect(checkRepoFullName('juzser/claude-status-bar.macos_v2').ok).toBe(true);
  });

  it('refuses anything without exactly one slash', () => {
    for (const bad of ['juzser', 'juzser/vam/extra', 'juzser//vam']) {
      expect(checkRepoFullName(bad).ok, bad).toBe(false);
    }
  });

  it('refuses a name that starts with a hyphen', () => {
    expect(checkRepoFullName('juzser/-evil').ok).toBe(false);
  });

  it('refuses `..` anywhere, which git forbids in a ref anyway', () => {
    expect(checkRepoFullName('juzser/..').ok).toBe(false);
    expect(checkRepoFullName('../etc/vam').ok).toBe(false);
  });

  it('refuses whitespace, newlines and control characters', () => {
    for (const bad of ['juzser/vam ', 'juzser/va m', 'juzser/vam\n', 'ju zser/vam']) {
      expect(checkRepoFullName(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('refuses a non-string value', () => {
    for (const bad of [null, undefined, 7, {}, []]) {
      expect(checkRepoFullName(bad as unknown as string).ok).toBe(false);
    }
  });
});
