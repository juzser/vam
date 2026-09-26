/**
 * THE WATERMARK BEHIND THE SIDEBAR'S "N sessions hidden" NOTE.
 *
 * The note (`SessionList.tsx`'s own `data-foreign-hidden`) must stay hidden,
 * after an auto-hide or a Dismiss, for the SAME count it was last seen at --
 * across a poll, a re-render, and a relaunch -- and reappear only once
 * `foreignHiddenCount` grows past that value. This module is where that one
 * number is kept: per viewer, in `localStorage`, exactly the pattern
 * `sources/remote-token.ts` already uses for a value that must survive a
 * throwing/absent storage without taking the sidebar down with it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readAcknowledgedForeignHiddenCount,
  writeAcknowledgedForeignHiddenCount,
} from '../../src/renderer/prefs/foreign-hidden-note.js';

afterEach(() => {
  // `test/support/storage.ts` reinstalls a fresh `localStorage` before every
  // test; unstub FIRST, so a test that stubbed it over does not leave that
  // stub's own `.clear`-less shape for the next test's setup to trip on.
  vi.unstubAllGlobals();
});

describe('the acknowledged foreign-hidden count', () => {
  it('answers 0 before anything was ever acknowledged', () => {
    expect(readAcknowledgedForeignHiddenCount()).toBe(0);
  });

  it('gives back what was put in', () => {
    writeAcknowledgedForeignHiddenCount(3);
    expect(readAcknowledgedForeignHiddenCount()).toBe(3);
  });

  it('survives a relaunch -- a fresh read sees the same value', () => {
    writeAcknowledgedForeignHiddenCount(2);
    expect(readAcknowledgedForeignHiddenCount()).toBe(2);
    expect(readAcknowledgedForeignHiddenCount()).toBe(2);
  });

  it("treats a corrupt value (hand-edited, a half-written blob, another key's shape) as 0 rather than throwing", () => {
    localStorage.setItem('vam.foreignHiddenNote.acknowledgedCount', 'not-a-number');
    expect(readAcknowledgedForeignHiddenCount()).toBe(0);
  });

  it('never stores a negative or non-finite count', () => {
    writeAcknowledgedForeignHiddenCount(5);
    writeAcknowledgedForeignHiddenCount(-1);
    expect(readAcknowledgedForeignHiddenCount()).toBe(5);
    writeAcknowledgedForeignHiddenCount(Number.NaN);
    expect(readAcknowledgedForeignHiddenCount()).toBe(5);
  });

  /**
   * A BROWSER THAT REFUSES STORAGE MUST NOT TAKE THE NOTE DOWN WITH IT.
   * Safari in private mode throws from `setItem`/`getItem` -- the same
   * failure `remote-token.test.ts` falsifies for the phone's pairing token.
   */
  it('survives a storage that throws, rather than taking the sidebar with it', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => writeAcknowledgedForeignHiddenCount(1)).not.toThrow();
    expect(readAcknowledgedForeignHiddenCount()).toBe(0);
  });

  it('survives localStorage being entirely absent', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => writeAcknowledgedForeignHiddenCount(1)).not.toThrow();
    expect(readAcknowledgedForeignHiddenCount()).toBe(0);
  });
});
