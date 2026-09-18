/**
 * The one decision about a URL an agent printed: will vam hand it to a
 * browser, and if not, what does it say instead.
 *
 * THE POPULATION IS THE WHOLE POINT. Every address reaching `checkLink` was
 * typed by a model into an answer -- the same threat model `terminal-ansi.ts`
 * states for a captured pane. So the tests below are not "does it parse a
 * URL"; they are the list of things a model can emit that must NOT become a
 * click: `javascript:`, `data:`, a custom app scheme, an address whose host
 * hides behind credentials, and a unicode host that reads as one domain and
 * resolves to another.
 *
 * THE ALLOWED SET IS DERIVED, NEVER RETYPED. `OPENABLE_PROTOCOLS` is imported
 * and the expectations are built from it, because a test carrying its own copy
 * of the list would go on passing after the source's list grew a scheme --
 * which is the exact drift this whole check exists to prevent.
 */

import { describe, expect, it } from 'vitest';
import { checkLink, MAX_LINK_LENGTH, OPENABLE_PROTOCOLS } from '../../src/shared/link.js';

/** Built from the source's own list: see this file's header. */
const refusedProtocols = ['javascript:', 'data:', 'file:', 'vscode:', 'mailto:', 'ftp:'].filter(
  (protocol) => !(OPENABLE_PROTOCOLS as readonly string[]).includes(protocol),
);

describe('checkLink -- what vam will open', () => {
  it('opens an https address, and answers with the PARSED form of it', () => {
    expect(checkLink('https://example.test/runbook')).toEqual({
      ok: true,
      url: 'https://example.test/runbook',
    });
  });

  it('opens plain http too -- both members of the allowed set, read off the set', () => {
    for (const protocol of OPENABLE_PROTOCOLS) {
      expect(checkLink(`${protocol}//example.test/x`)).toMatchObject({ ok: true });
    }
  });

  it('is case-insensitive about the scheme, because the URL parser is', () => {
    expect(checkLink('HTTPS://Example.test/Runbook')).toMatchObject({
      ok: true,
      url: 'https://example.test/Runbook',
    });
  });

  /**
   * THE ONE THAT MATTERS. `javascript:` in a markdown link is the oldest
   * trick there is, and an agent's answer is exactly the surface that can
   * carry it.
   */
  it('refuses javascript: and says what it refused', () => {
    const outcome = checkLink('javascript:alert(1)');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('javascript');
    expect(outcome.reason).toContain('http');
  });

  it('refuses every scheme outside the allowed set', () => {
    for (const protocol of refusedProtocols) {
      const outcome = checkLink(`${protocol}//host/x`);
      expect(outcome.ok, protocol).toBe(false);
    }
    expect(checkLink('data:text/html;base64,PHNjcmlwdD4=').ok).toBe(false);
    expect(checkLink('file:///etc/passwd').ok).toBe(false);
  });

  /**
   * A SCHEME IS NOT A PREFIX. `https:` is on the list and `https-evil:` is
   * not, and a check written with `startsWith` cannot tell them apart.
   */
  it('refuses a scheme that merely begins like an allowed one', () => {
    expect(checkLink('httpsx://example.test/').ok).toBe(false);
    expect(checkLink('javascript:https://example.test').ok).toBe(false);
  });

  /**
   * THE HOST IS THE DESTINATION, AND CREDENTIALS HIDE IT.
   * `https://github.com@evil.test/` goes to `evil.test`; the part an operator
   * reads first is the part that lies.
   */
  it('refuses an address that hides its host behind credentials', () => {
    const outcome = checkLink('https://github.com@evil.test/login');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('evil.test');
  });

  /**
   * A UNICODE HOST IS ANSWERED IN PUNYCODE, not refused -- the address vam
   * hands back is the one a browser would really resolve, so a homograph
   * stops being invisible the moment it is drawn.
   */
  it('answers a unicode host in the punycode a browser would actually resolve', () => {
    const outcome = checkLink('https://exämple.test/');
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) return;
    expect(outcome.url).toContain('xn--');
    expect(outcome.url).not.toContain('ä');
  });

  it('refuses text that is not an address at all', () => {
    for (const text of ['', '   ', 'not a url', '//evil.test/x', './relative/path.ts']) {
      expect(checkLink(text).ok, text).toBe(false);
    }
  });

  it('refuses anything that is not a string -- the caller is the renderer', () => {
    for (const value of [undefined, null, 42, {}, ['https://example.test']]) {
      expect(checkLink(value).ok).toBe(false);
    }
  });

  it('refuses an address longer than main will carry', () => {
    const long = `https://example.test/${'a'.repeat(MAX_LINK_LENGTH)}`;
    expect(checkLink(long).ok).toBe(false);
    expect(checkLink(`https://example.test/${'a'.repeat(10)}`).ok).toBe(true);
  });

  /**
   * A REFUSAL IS SHOWN TO A PERSON, and what it quotes is a model's own text.
   * It is React text, never markup -- but an unbounded quote would still make
   * a whole answer out of an error line, so it is clipped.
   */
  it('clips the text it quotes back', () => {
    const outcome = checkLink(`zzz:${'x'.repeat(5_000)}`);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason.length).toBeLessThan(400);
  });
});
