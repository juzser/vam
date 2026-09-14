/**
 * THE PHONE'S HALF OF PAIRING: where the token lives, and who sends it.
 *
 * Operator, holding the phone: "I still don't see anywhere to enter the
 * pairing code."
 *
 * They were right, and the gap was larger than a missing input. Serving the
 * app shell without a token (#334) opened the door; nothing was behind it.
 * Measured across the whole repository: NOTHING posts to `/api/pair`, and
 * `http-factory.ts` sends no `authorization` header on any request. So the
 * browser build asked `/api/describe`, was refused, and drew the refusal as a
 * failure banner over an empty canvas -- zero inputs on the page, reproduced
 * by rendering it against a 401 origin.
 *
 * This module is the first of the two missing halves: somewhere to keep the
 * token, and a request path that sends it.
 *
 * ── WHY localStorage, STATED RATHER THAN ASSUMED ──────────────────────────
 * It is a bearer credential in a web origin, so script running on that origin
 * can read it. What runs there is vam's own bundle and nothing else: the
 * server serves `index.html` and `/assets/<one segment>` and refuses every
 * other path, and the origin is a tailnet name behind `tailscale serve` with
 * `funnel` refused by name -- there is no third-party script and no upload
 * path to become one.
 *
 * `sessionStorage` would be narrower and would also make the phone re-pair on
 * every tab, which is the opposite of what a phone by the bed is for. The
 * grant is revocable from the desktop at any time, one device or all, and
 * revocation reaches inside open streams -- so the recovery from a stolen
 * token is a control the operator already has.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearRemoteToken,
  readRemoteToken,
  writeRemoteToken,
} from '../../src/renderer/sources/remote-token.js';

afterEach(() => {
  clearRemoteToken();
  vi.unstubAllGlobals();
});

describe('the token store', () => {
  it('gives back what was put in', () => {
    writeRemoteToken('a-token-the-desktop-minted');
    expect(readRemoteToken()).toBe('a-token-the-desktop-minted');
  });

  it('answers null before anything is paired', () => {
    expect(readRemoteToken()).toBeNull();
  });

  it('forgets on clear, which is what an unpaired device must look like', () => {
    writeRemoteToken('t');
    clearRemoteToken();
    expect(readRemoteToken()).toBeNull();
  });

  /**
   * AN EMPTY STRING IS NOT A TOKEN. `Bearer ` with nothing after it is a
   * malformed credential the server counts as a failure, so storing one would
   * turn "not paired yet" into "paired, wrongly, forever".
   */
  it('refuses to store an empty token', () => {
    writeRemoteToken('');
    expect(readRemoteToken()).toBeNull();
  });

  /**
   * A BROWSER THAT REFUSES STORAGE MUST NOT TAKE THE APP DOWN. Safari in
   * private mode throws from `setItem`, and iOS Safari is exactly the browser
   * this is for. The phone pairs for the session and is asked again next time,
   * which is a worse experience and not a broken one.
   */
  it('survives a storage that throws, rather than taking the page with it', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => writeRemoteToken('t')).not.toThrow();
    expect(readRemoteToken()).toBeNull();
    expect(() => clearRemoteToken()).not.toThrow();
  });
});
