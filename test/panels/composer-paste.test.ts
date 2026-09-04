/**
 * Pasting into the composer.
 *
 * The terminal shortens a pasted image to a placeholder, and the operator
 * asked for the same here: a screenshot pasted into the prompt box must not
 * unfold into whatever the clipboard's text flavour happened to be. The
 * numbering is per composition, so `[image #2]` means the second image in
 * THIS prompt and nothing else.
 *
 * The other half is what the placeholder must not imply. vam's write to a
 * session is text -- the tmux pane is typed into and the CLI takes a `-p`
 * string -- so the image itself goes nowhere. It is kept beside the draft so
 * the composer can show it and a later delivery path could use it, and the
 * box says plainly that only the text is sent.
 */

import { describe, expect, it } from 'vitest';
import {
  type ClipboardLike,
  readPastedImages,
  spliceDraft,
} from '../../src/renderer/panels/composer-paste.js';

/** A `DataTransfer` as the paste event hands it over, minus the DOM. */
function clipboard(...items: { kind: string; type: string; file: unknown }[]): ClipboardLike {
  return {
    items: items.map((item) => ({
      kind: item.kind,
      type: item.type,
      getAsFile: () => item.file as File | null,
    })),
  };
}

const png = (name: string) => ({ kind: 'file', type: 'image/png', file: { name } });

describe('readPastedImages', () => {
  it('leaves a paste that carries no image entirely alone', () => {
    const outcome = readPastedImages(
      clipboard({ kind: 'string', type: 'text/plain', file: null }),
      1,
    );
    expect(outcome.kind).toBe('text');
  });

  it('shortens one image to `[image #1]` and keeps the file', () => {
    const outcome = readPastedImages(clipboard(png('shot.png')), 1);
    if (outcome.kind !== 'images') throw new Error('expected images');
    expect(outcome.text).toBe('[image #1]');
    expect(outcome.images).toHaveLength(1);
    expect(outcome.images[0]?.placeholder).toBe('[image #1]');
    // The image is HELD, not dropped: the placeholder stands for something.
    const held = outcome.images[0];
    if (held === undefined) throw new Error('expected the image to be kept');
    expect((held.file as unknown as { name: string }).name).toBe('shot.png');
  });

  it('numbers the next image after the ones already in the composition', () => {
    const outcome = readPastedImages(clipboard(png('b.png')), 2);
    if (outcome.kind !== 'images') throw new Error('expected images');
    expect(outcome.text).toBe('[image #2]');
  });

  it('numbers two images pasted at once in order', () => {
    const outcome = readPastedImages(clipboard(png('a.png'), png('b.png')), 1);
    if (outcome.kind !== 'images') throw new Error('expected images');
    expect(outcome.text).toBe('[image #1] [image #2]');
    expect(outcome.images.map((image) => image.placeholder)).toEqual(['[image #1]', '[image #2]']);
  });

  it('ignores a file the clipboard offers but cannot hand over', () => {
    const outcome = readPastedImages(clipboard({ kind: 'file', type: 'image/png', file: null }), 1);
    expect(outcome.kind).toBe('text');
  });

  it('treats a non-image file as text, so nothing is silently swallowed', () => {
    const outcome = readPastedImages(
      clipboard({ kind: 'file', type: 'application/pdf', file: { name: 'p.pdf' } }),
      1,
    );
    expect(outcome.kind).toBe('text');
  });
});

describe('spliceDraft', () => {
  it('drops the placeholder in at the cursor', () => {
    expect(spliceDraft('see  please', 4, 4, '[image #1]')).toBe('see [image #1] please');
  });

  it('replaces a selection', () => {
    expect(spliceDraft('see THIS please', 4, 8, '[image #1]')).toBe('see [image #1] please');
  });
});
