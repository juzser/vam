// Node, not happy-dom: this file reads bytes, and happy-dom leaves
// `import.meta.url` in a scheme `readFileSync` will not take.

/**
 * Two rules that live in `styles.css` and are therefore read as content.
 *
 * jsdom lays nothing out and applies no stylesheet, so neither of these can be
 * asserted from a rendered tree — a real hit box needs the Playwright pass the
 * spec asks for at 390px. What a content scan CAN keep true is that the rules
 * exist and stay narrow, and both of them earned that: one was a repo-wide
 * `[data-phone-shell] button` that burst a 21px heading row, and the other is
 * the reason a tap meant to open a session cannot close it instead.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(
  fileURLToPath(new URL('../../src/renderer/styles.css', import.meta.url)),
  'utf8',
);

describe('the phone shell’s hit areas', () => {
  it('names the controls it sizes, rather than every button in the tree', () => {
    expect(CSS).toContain('[data-phone-shell] [data-step-chip]');
    expect(CSS).toContain('[data-phone-shell] [data-prompt-record]');
    // The form that reached the hosted 15px project-icon button and inflated
    // it to 44 inside a 21px row.
    expect(CSS).not.toMatch(/\[data-phone-shell\]\s+button\s*[,{]/);
  });

  it('removes the hover-revealed close control rather than leaving it invisible', () => {
    // `opacity: 0` removes no pointer events: revealed only by
    // `group-hover/row`, which a coarse pointer can never satisfy, that button
    // was an unreachable-but-hittable 44px target over the row's own tap area.
    expect(CSS).toMatch(
      /\[data-phone-shell\] \[data-session-row\] button\[aria-label\^='close '\] \{\s*display: none;/,
    );
  });

  it('sets 16px on every box you type in, which is the iOS zoom threshold', () => {
    expect(CSS).toMatch(
      /\[data-phone-shell\] input,\s*\[data-phone-shell\] textarea \{\s*font-size: 16px;/,
    );
  });
});
