// @vitest-environment happy-dom

/**
 * THE CONCISE-OUTPUT SWITCH, AND THE CROSSING IT DEPENDS ON.
 *
 * The same bargain every other preference here holds -- a stored value read
 * back, normalised on both sides, surviving a neighbour's write -- plus one
 * thing none of the others but `prRepos` needs: THIS PREFERENCE IS NEVER READ
 * IN THE RENDERER. Nothing on screen changes when it is thrown. The decision
 * it governs is made in main, at the seam where a prompt becomes keystrokes
 * (`main/terminal/concise.ts`), so a value that is stored perfectly and never
 * pushed is a switch that does nothing at all -- and every assertion about the
 * store would still be green.
 *
 * So the push is the load-bearing assertion in this file.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONCISE_OUTPUT,
  readConciseOutput,
} from '../../src/renderer/prefs/concise-output.js';
import {
  activatePrefs,
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setConciseOutput,
  setFocusView,
} from '../../src/renderer/prefs/prefs.js';

function fake(initial: string | null): StorageLike {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
  };
}

const stored = (payload: Record<string, unknown>) => readPrefs(fake(JSON.stringify(payload)));

afterEach(() => {
  Reflect.deleteProperty(window, 'api');
  vi.restoreAllMocks();
});

describe('the default is off, because the rules cost the operator tokens', () => {
  it('ships off, and an absent key reads as off', () => {
    // NOT A TASTE. Turning this on puts a paragraph vam wrote into the first
    // prompt of every session -- somebody else's context window and somebody
    // else's bill. A default of `true` would spend both without being asked.
    expect(DEFAULT_CONCISE_OUTPUT).toBe(false);
    expect(EMPTY_PREFS.conciseOutput).toBe(false);
    expect(stored({}).conciseOutput).toBe(false);
  });

  it('reads back a stored choice, and only a literal true is on', () => {
    expect(stored({ conciseOutput: true }).conciseOutput).toBe(true);
    for (const raw of ['true', 1, {}, null, [], 'on']) {
      expect(readConciseOutput(raw), JSON.stringify(raw)).toBe(false);
      expect(stored({ conciseOutput: raw }).conciseOutput, JSON.stringify(raw)).toBe(false);
    }
  });

  it('is normalised on the way in as well as on the way out', () => {
    expect(setConciseOutput(EMPTY_PREFS, 'yes').conciseOutput).toBe(false);
    expect(setConciseOutput(EMPTY_PREFS, true).conciseOutput).toBe(true);
  });

  it('disturbs no neighbour', () => {
    const next = setConciseOutput({ ...EMPTY_PREFS, focusView: true, outFontSize: 15 }, true);
    expect(next.focusView).toBe(true);
    expect(next.outFontSize).toBe(15);
  });
});

describe('the value crosses into main, where the only reader is', () => {
  /** The desktop bridge, stubbed down to the one member this preference uses. */
  function bridge() {
    const setConcise = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { prefs: { setConciseOutput: setConcise } },
    });
    return setConcise;
  }

  it('is pushed on every activation, not only when the row is clicked', () => {
    // THE SAME ARGUMENT `prRepos` MAKES. `activatePrefs` runs on every read AND
    // every write, so a reload arms main as surely as a click does. Wired to
    // the control alone, main would hold `false` until the operator happened
    // to open settings -- and the session started at launch would be answered
    // at full length by a vam whose switch was on.
    const push = bridge();
    activatePrefs({ ...EMPTY_PREFS, conciseOutput: true });
    expect(push).toHaveBeenCalledWith(true);
    // A neighbouring write re-pushes the same value rather than going quiet.
    activatePrefs(setFocusView({ ...EMPTY_PREFS, conciseOutput: true }, true));
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('pushes the off state too, so turning it off reaches main', () => {
    // Half a crossing is worse than none: an operator who turns this off and
    // sees vam keep priming new sessions has a switch that lies.
    const push = bridge();
    activatePrefs({ ...EMPTY_PREFS, conciseOutput: false });
    expect(push).toHaveBeenCalledWith(false);
  });

  it('survives a build with no bridge at all', () => {
    // `window.api` does not exist in the browser build a paired phone loads.
    // The push must simply not happen there rather than throw on every prefs
    // read -- which would take the whole surface down.
    Reflect.deleteProperty(window, 'api');
    expect(() => activatePrefs({ ...EMPTY_PREFS, conciseOutput: true })).not.toThrow();
  });

  it('swallows a rejected push rather than failing a prefs write', () => {
    const rejecting = vi.fn(() => Promise.reject(new Error('no such channel')));
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { prefs: { setConciseOutput: rejecting } },
    });
    expect(() => activatePrefs({ ...EMPTY_PREFS, conciseOutput: true })).not.toThrow();
  });
});
