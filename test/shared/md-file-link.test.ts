/** `src/shared/md-file-link.ts`: which markdown hrefs name a file in the project. */

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
    ['a%2520b.md', { path: 'a%20b.md', line: 1 }],
  ])('%s', (href, expected) => {
    expect(parseMdFileLink(href)).toEqual(expected);
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
});

describe('mdFileLinkRef and mdFileLinkHint', () => {
  it('build the reference main parses, and the hover hint', () => {
    expect(mdFileLinkRef({ path: 'roadmap.md', line: 7 }, 'docs')).toBe('docs/roadmap.md:7');
    expect(mdFileLinkRef({ path: 'roadmap.md', line: 7 }, '')).toBe('roadmap.md:7');
    expect(mdFileLinkHint({ path: 'a.md', line: 1 })).toBe('opens a.md in Files');
    expect(mdFileLinkHint({ path: 'a.ts', line: 42 })).toBe('opens a.ts in Files at line 42');
  });
});
