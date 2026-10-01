/**
 * `src/shared/md-file-link.ts`: which markdown hrefs are a file in the
 * session's own project rather than an address. The parser only classifies;
 * resolution and refusal (`..`, symlinks, missing files) are main's job.
 */

import { describe, expect, it } from 'vitest';
import { mdFileLinkHint, mdFileLinkRef, parseMdFileLink } from '../../src/shared/md-file-link.js';

describe('parseMdFileLink: a relative path is a file link', () => {
  it.each([
    ['docs/roadmap.md', { path: 'docs/roadmap.md', line: 1 }],
    ['./docs/roadmap.md', { path: 'docs/roadmap.md', line: 1 }],
    ['../x.md', { path: '../x.md', line: 1 }],
    ['docs/roadmap.md#install', { path: 'docs/roadmap.md', line: 1 }],
    ['src/a.ts#L42', { path: 'src/a.ts', line: 42 }],
    ['src/a.ts:42', { path: 'src/a.ts', line: 42 }],
    ['README.md:12', { path: 'README.md', line: 12 }],
    ['docs/my%20notes.md', { path: 'docs/my notes.md', line: 1 }],
  ])('%s', (href, expected) => {
    expect(parseMdFileLink(href)).toEqual(expected);
  });

  it('decodes a percent-encoded name once, not twice', () => {
    expect(parseMdFileLink('a%2520b.md')).toEqual({ path: 'a%20b.md', line: 1 });
  });
});

describe('parseMdFileLink: everything else keeps today’s behaviour (null)', () => {
  it.each([
    'https://x.dev',
    'mailto:a@b.c',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'vscode://x',
    '//host/x',
    '#section',
    '',
    '/etc/passwd',
    '/docs/roadmap.md',
    'docs\\roadmap.md',
    'a%00b.md',
    'a%5Cb.md',
    'a%3Ab.md',
    'bad%zz.md',
  ])('%j', (href) => {
    expect(parseMdFileLink(href)).toBeNull();
  });

  it('is null for a non-string', () => {
    expect(parseMdFileLink(undefined)).toBeNull();
    expect(parseMdFileLink(42)).toBeNull();
  });
});

describe('mdFileLinkRef: the `path:line` reference main parses', () => {
  it('joins a directory and the path, and the line', () => {
    expect(mdFileLinkRef({ path: 'docs/roadmap.md', line: 1 })).toBe('docs/roadmap.md:1');
    expect(mdFileLinkRef({ path: 'roadmap.md', line: 7 }, 'docs')).toBe('docs/roadmap.md:7');
    expect(mdFileLinkRef({ path: 'roadmap.md', line: 7 }, '')).toBe('roadmap.md:7');
  });
});

describe('mdFileLinkHint', () => {
  it('names the path, and the line only when one was given', () => {
    expect(mdFileLinkHint({ path: 'docs/roadmap.md', line: 1 })).toBe(
      'opens docs/roadmap.md in Files',
    );
    expect(mdFileLinkHint({ path: 'src/a.ts', line: 42 })).toBe(
      'opens src/a.ts in Files at line 42',
    );
  });
});
