// @vitest-environment happy-dom

/**
 * THE OLD CONCISE-OUTPUT SWITCH'S STORED VALUE -- LEGACY, READ ONLY FOR THE
 * MIGRATION NOTE.
 *
 * The switch itself, and the crossing that once pushed this value to main on
 * every read and write (`main/terminal/concise.ts`), are both deleted:
 * `src/shared/adhd-skill.ts`'s header carries what replaced them. What
 * remains is the STORED value alone, read by `AdhdSkillCard.tsx` to show a
 * one-time note to an operator who had it on, and `setConciseOutput`'s one
 * remaining caller, which flips it back to `false` once they have seen that
 * note. This file holds what is left: the default, the normalisation on
 * read and write, and that a neighbour's write disturbs neither.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONCISE_OUTPUT,
  readConciseOutput,
} from '../../src/renderer/prefs/concise-output.js';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setConciseOutput,
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

describe('migration: this value has no reader left in main', () => {
  it('is never pushed by activatePrefs -- there is no bridge member left to push to', async () => {
    // `createPrefsBridge()` (`src/preload/api.ts`) carries exactly one member
    // now, `setPrRepos`; `setConciseOutput` is not one of its keys any more.
    // This is a type-level fact as much as a runtime one -- there is no
    // `window.api.prefs.setConciseOutput` for `activatePrefs` to call, so the
    // only way this could regress is a NEW crossing being added, which this
    // assertion would not survive either.
    const { createPrefsBridge } = await import('../../src/preload/api.js');
    const bridge = createPrefsBridge({ invoke: async () => ({ ok: true, value: undefined }) });
    expect(Object.keys(bridge)).toEqual(['setPrRepos']);
  });
});
