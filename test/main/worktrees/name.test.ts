/**
 * `sanitizeWorktreeName` is pure: no filesystem, no git, no process. Every
 * case here is a string in, a string (or `null`) out.
 */

import { describe, expect, it } from 'vitest';
import { sanitizeWorktreeName } from '../../../src/main/worktrees/name.js';

describe('sanitizeWorktreeName', () => {
  it('keeps an already-clean name unchanged', () => {
    expect(sanitizeWorktreeName('feature-x')).toBe('feature-x');
  });

  it('collapses whitespace and punctuation runs to a single hyphen', () => {
    expect(sanitizeWorktreeName('My Feature!!')).toBe('My-Feature');
  });

  it('collapses a `/` the same as any other disallowed character', () => {
    // Never a path separator in the result -- the caller joins this
    // directly onto a directory with no further checking of its shape.
    expect(sanitizeWorktreeName('feature/foo bar')).toBe('feature-foo-bar');
  });

  it('collapses `..` wherever it appears, however it got there', () => {
    expect(sanitizeWorktreeName('..')).toBeNull();
    expect(sanitizeWorktreeName('../../etc/passwd')).toBe('etc-passwd');
    expect(sanitizeWorktreeName('a..b')).toBe('a-b');
    // Punctuation collapsing alone could reconstitute a `..` from two
    // neighbouring dots either side of a stripped character (`a. .b` ->
    // `a..b` under a naive single-pass collapse) -- assert the real
    // adversarial case rather than trusting a single pass.
    expect(sanitizeWorktreeName('a. .b')).not.toContain('..');
  });

  it('strips leading and trailing separators left by the collapse', () => {
    expect(sanitizeWorktreeName('-leading')).toBe('leading');
    expect(sanitizeWorktreeName('trailing-')).toBe('trailing');
    expect(sanitizeWorktreeName('...dots...')).toBe('dots');
  });

  it('rejects a name that sanitises to nothing', () => {
    expect(sanitizeWorktreeName('')).toBeNull();
    expect(sanitizeWorktreeName('   ')).toBeNull();
    expect(sanitizeWorktreeName('///')).toBeNull();
    expect(sanitizeWorktreeName('...')).toBeNull();
  });

  it('rejects the reserved name HEAD, case-insensitively', () => {
    expect(sanitizeWorktreeName('HEAD')).toBeNull();
    expect(sanitizeWorktreeName('head')).toBeNull();
    expect(sanitizeWorktreeName('HeAd')).toBeNull();
  });

  it('keeps Unicode letters rather than flattening every non-ASCII name to nothing', () => {
    expect(sanitizeWorktreeName('café')).toBe('café');
  });

  it('bounds the result length rather than handing git an unbounded path segment', () => {
    const long = 'a'.repeat(300);
    const result = sanitizeWorktreeName(long);
    expect(result).not.toBeNull();
    expect((result as string).length).toBeLessThanOrEqual(100);
  });

  it('never returns a string containing a path separator', () => {
    const result = sanitizeWorktreeName('a/b\\c');
    expect(result).not.toContain('/');
    expect(result).not.toContain('\\');
  });
});
