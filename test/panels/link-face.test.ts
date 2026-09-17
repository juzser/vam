/**
 * WHAT A LINK PILL PRINTS, decided as data before anything is drawn.
 *
 * `OutLink` in `out-markdown.tsx` used to print a link's text and then the
 * whole parsed address after it, in mono, in brackets -- the reading eye got
 * the URL twice whenever the text WAS the URL, and a "Sources:" list of three
 * was three lines of 250px. The pill draws the text and the HOST instead, and
 * the three questions that decide what those two strings are live in
 * `link-face.ts` as pure functions so they can be pinned here without a DOM:
 *
 *   1. `linkParts` -- the host and the rest of a parsed address, which is what
 *      a pill prints when the link's own text is nothing but its address;
 *   2. `textIsAddress` -- whether that is the case, allowing for the ways the
 *      same address gets spelled twice (`https://github.com` beside the
 *      `https://github.com/` `new URL` answers, a gfm autolink's bare
 *      `www.example.com` beside the `http://` remark prepends);
 *   3. `foldMiddle` -- how a long path is shortened, in the MIDDLE, so both
 *      the start and the end of it survive -- the end is where `/pull/383` and
 *      `?tab=readme` live, and a tail-ellipsis loses exactly the part that
 *      tells two links to one host apart.
 *
 * And `linkWhere`, the quiet half of a NAMED link: the host when there is one,
 * the scheme vam refused when there is not, the raw text when nothing parsed.
 */

import { describe, expect, it } from 'vitest';
import {
  FOLD_LIMIT,
  foldMiddle,
  linkParts,
  linkWhere,
  textIsAddress,
} from '../../src/renderer/panels/link-face.js';

describe('foldMiddle -- a long path, shortened where the reader loses least', () => {
  it('leaves a path at or under the limit exactly as it was', () => {
    expect(foldMiddle('/juzser/vam/pull/383')).toBe('/juzser/vam/pull/383');
    expect(foldMiddle('x'.repeat(FOLD_LIMIT))).toBe('x'.repeat(FOLD_LIMIT));
  });

  it('folds a longer one to exactly the limit, with one ellipsis in the middle', () => {
    const long = '/a/very/long/path/that/goes/on/and/on?with=query';
    const folded = foldMiddle(long);
    expect([...folded]).toHaveLength(FOLD_LIMIT);
    expect(folded.split('…')).toHaveLength(2);
    // BOTH ENDS SURVIVE: the head says where it starts, the tail is the part
    // that tells two links to one host apart.
    expect(folded.startsWith('/a/very/long')).toBe(true);
    expect(folded.endsWith('with=query')).toBe(true);
  });

  it('counts code points, not UTF-16 units, so an astral character is not cut in half', () => {
    const folded = foldMiddle('𝒜'.repeat(40), 9);
    expect([...folded]).toHaveLength(9);
    expect(folded).toBe('𝒜𝒜𝒜𝒜…𝒜𝒜𝒜𝒜');
    expect(folded.includes('�')).toBe(false);
  });

  it('keeps a character at each end even at a tiny limit', () => {
    expect(foldMiddle('abcdef', 3)).toBe('a…f');
  });
});

describe('linkParts -- the host and the rest of a parsed address', () => {
  it('splits an https address at its host', () => {
    expect(linkParts('https://github.com/juzser/vam/pull/383')).toEqual({
      host: 'github.com',
      rest: '/juzser/vam/pull/383',
    });
  });

  it('drops the lone slash new URL adds to a bare host', () => {
    expect(linkParts('https://github.com')).toEqual({ host: 'github.com', rest: '' });
    expect(linkParts('https://github.com/')).toEqual({ host: 'github.com', rest: '' });
  });

  it('keeps a port in the host and a query and fragment in the rest', () => {
    expect(linkParts('https://example.test:8443/a?b=1#c')).toEqual({
      host: 'example.test:8443',
      rest: '/a?b=1#c',
    });
  });

  it('answers the punycode host a browser would resolve, never the typed one', () => {
    expect(linkParts('https://exämple.test/x')?.host).toBe('xn--exmple-cua.test');
  });

  it('has no host for a scheme without one, and nothing at all for text that is not an address', () => {
    expect(linkParts('javascript:alert(1)')).toEqual({ host: '', rest: 'alert(1)' });
    expect(linkParts('not a url')).toBeNull();
  });
});

describe('textIsAddress -- is the link text nothing but its own destination', () => {
  it('is, when the two are spelled identically', () => {
    const url = 'https://github.com/juzser/vam/pull/383';
    expect(textIsAddress(url, url)).toBe(true);
  });

  it('is, across the trailing slash new URL adds and the whitespace markdown keeps', () => {
    expect(textIsAddress('https://github.com', 'https://github.com/')).toBe(true);
    expect(textIsAddress('  https://a.test/x ', 'https://a.test/x')).toBe(true);
  });

  it("is, for a gfm autolink whose text has no scheme and whose href got remark's", () => {
    expect(textIsAddress('www.example.com', 'http://www.example.com')).toBe(true);
    expect(textIsAddress('example.com/a', 'https://example.com/a')).toBe(true);
  });

  it('is not, for a named link', () => {
    expect(textIsAddress('runbook', 'https://example.test/runbook')).toBe(false);
  });

  /**
   * THE LYING TEXT IS THE CASE THIS MUST GET RIGHT. `[https://github.com/x]
   * (https://evil.test/phish)` LOOKS like a self-named link, and treating it
   * as one would print `github.com/x` as the destination -- the exact
   * homograph the address hint exists to expose.
   */
  it('is not, when the text is an address other than the destination', () => {
    expect(textIsAddress('https://github.com/juzser/vam', 'https://evil.test/phish')).toBe(false);
    expect(textIsAddress('https://github.com/a', 'https://github.com/b')).toBe(false);
  });
});

describe('linkWhere -- the quiet half of a named link', () => {
  it('is the host of an address vam would open', () => {
    expect(linkWhere('https://example.test/runbook')).toBe('example.test');
    expect(linkWhere('https://exämple.test/x')).toBe('xn--exmple-cua.test');
  });

  it('is the scheme, when the address has no host to show', () => {
    expect(linkWhere('javascript:alert(1)')).toBe('javascript:');
    expect(linkWhere('mailto:someone@example.test')).toBe('mailto:');
  });

  it('is the raw text, folded, when nothing parsed -- and nothing when there is no text', () => {
    expect(linkWhere('not a url')).toBe('not a url');
    expect([...(linkWhere('x'.repeat(60)) ?? '')]).toHaveLength(FOLD_LIMIT);
    expect(linkWhere('')).toBeNull();
    expect(linkWhere('   ')).toBeNull();
  });
});
