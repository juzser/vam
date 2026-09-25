/**
 * `isPaneKey`'s own guard over the `paste` kind -- the renderer is the least
 * trusted process in the app, so a bridge value is checked against
 * `MAX_PASTE_TEXT`, not trusted to have been truncated on the way
 * (`terminal-paste.ts`'s own `preparePastedText` truncates before a legitimate
 * paste ever gets this far; this file is about what a compromised or buggy
 * renderer could still hand over).
 */

import { describe, expect, it } from 'vitest';
import { isPaneKey, MAX_PASTE_TEXT } from '../../src/shared/terminal.js';

describe('isPaneKey — the paste kind', () => {
  it('accepts an ordinary paste', () => {
    expect(isPaneKey({ kind: 'paste', text: 'hello\rworld' })).toBe(true);
  });

  it('refuses an empty paste, exactly like an empty text key', () => {
    expect(isPaneKey({ kind: 'paste', text: '' })).toBe(false);
  });

  it('accepts a paste right at the bound', () => {
    expect(isPaneKey({ kind: 'paste', text: 'x'.repeat(MAX_PASTE_TEXT) })).toBe(true);
  });

  it('refuses a paste one code unit over the bound', () => {
    expect(isPaneKey({ kind: 'paste', text: 'x'.repeat(MAX_PASTE_TEXT + 1) })).toBe(false);
  });

  it('refuses a non-string text field', () => {
    expect(isPaneKey({ kind: 'paste', text: 123 })).toBe(false);
  });

  it('is far more generous than MAX_KEY_TEXT, on purpose: a paste is not a keystroke', () => {
    const longerThanAKeystroke = 'y'.repeat(1000);
    expect(isPaneKey({ kind: 'paste', text: longerThanAKeystroke })).toBe(true);
  });
});
