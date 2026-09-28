/**
 * Which section Settings reopens on: the last one the operator actually
 * looked at, not always `interface` -- the settings-views restructure
 * (item C): "Settings reopens on the last viewed section (prefs or
 * localStorage in try/catch), falling back to the first."
 *
 * DIRECT `localStorage`, WRAPPED IN TRY/CATCH, `card-collapse.ts`'s own
 * shape reused rather than reinvented: this is chrome about the DIALOG (which
 * card an operator was last looking at), never a setting `o` or a session
 * ever reads, so it does not belong in the big `Prefs` blob either.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLastSection, writeLastSection } from '../../src/renderer/settings/last-section.js';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('readLastSection / writeLastSection', () => {
  it('is null for an operator who has never opened the dialog', () => {
    expect(readLastSection()).toBeNull();
  });

  it('remembers the last section written, across a fresh read (a relaunch)', () => {
    writeLastSection('terminal');
    expect(readLastSection()).toBe('terminal');
    expect(readLastSection()).toBe('terminal');
  });

  it('the newest write wins over an older one', () => {
    writeLastSection('terminal');
    writeLastSection('remote');
    expect(readLastSection()).toBe('remote');
  });

  it('rejects a section id this build no longer knows, rather than handing back stale garbage', () => {
    localStorage.setItem('vam.settings.lastSection', JSON.stringify('not-a-real-section'));
    expect(readLastSection()).toBeNull();
  });

  it('treats a corrupt value already in storage as "never opened", rather than throwing', () => {
    localStorage.setItem('vam.settings.lastSection', 'not json{{{');
    expect(() => readLastSection()).not.toThrow();
    expect(readLastSection()).toBeNull();
  });

  it('survives a storage that throws, rather than taking the dialog down with it', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => writeLastSection('terminal')).not.toThrow();
    expect(readLastSection()).toBeNull();
  });

  it('survives localStorage being entirely absent', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => writeLastSection('terminal')).not.toThrow();
    expect(readLastSection()).toBeNull();
  });
});
