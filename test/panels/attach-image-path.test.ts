/**
 * The path-reference helper for a desktop image attach.
 *
 * Deliberately NOT `attachIntoDraft`'s block markers (`--- attached: … ---`):
 * that convention inlines a file's own decoded TEXT and refuses on a
 * replacement character, which any binary content would trip
 * (`state/artifacts/vam-image-attach/findings.md`). The measured mechanism
 * needs only a bare path as its own line -- Claude Code's own agent reads the
 * bytes -- so this is a smaller, second representation, one line rather than
 * a fenced block.
 */

import { describe, expect, it } from 'vitest';
import {
  appendImagePath,
  readImagePath,
  removeImagePath,
} from '../../src/renderer/panels/attach-image-path.js';

describe('appendImagePath', () => {
  it('appends the path as its own line to an empty draft', () => {
    expect(appendImagePath('', '/work/session/pic.png')).toBe('/work/session/pic.png');
  });

  it('appends the path on a new line after existing text', () => {
    expect(appendImagePath('take a look', '/work/session/pic.png')).toBe(
      'take a look\n/work/session/pic.png',
    );
  });

  it('strips a newline out of the path so it cannot smuggle a second line', () => {
    expect(appendImagePath('', '/work/session/pic\n.png')).toBe('/work/session/pic.png');
  });
});

describe('readImagePath', () => {
  it('finds the path this module appended', () => {
    const draft = appendImagePath('hello', '/work/session/pic.png');
    expect(readImagePath(draft)).toBe('/work/session/pic.png');
  });

  it('answers null when no image path was appended', () => {
    expect(readImagePath('just some words')).toBeNull();
  });
});

describe('removeImagePath', () => {
  it('removes exactly the appended line, leaving the rest of the draft', () => {
    const draft = appendImagePath('take a look', '/work/session/pic.png');
    expect(removeImagePath(draft, '/work/session/pic.png')).toBe('take a look');
  });

  it('removes the line even when it is the only content', () => {
    const draft = appendImagePath('', '/work/session/pic.png');
    expect(removeImagePath(draft, '/work/session/pic.png')).toBe('');
  });

  it('leaves the draft untouched when the named path is not present', () => {
    expect(removeImagePath('take a look', '/work/session/pic.png')).toBe('take a look');
  });
});
