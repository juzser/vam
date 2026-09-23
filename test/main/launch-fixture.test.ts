/**
 * The launch smoke test's own fixture, unit-tested directly.
 *
 * `src/main/launch-fixture.ts`'s own header explains why this file exists at
 * all: `src/main/index.ts` runs `app.whenReady()` at module scope and cannot
 * be imported outside a real Electron process, so the ONLY thing that had
 * ever exercised this fixture's session was `test/electron/launch.test.ts`
 * -- a slow, real-process suite excluded from the default `vitest run`
 * (`vitest.app.config.ts` only, CI's `pnpm run test:app`). That is exactly
 * how a `vamControlled: false` on this one session shipped unnoticed on this
 * branch: Stage 1's `hideForeign` default (`session-filter.ts`) started
 * reading it as "vam did not start this" and hid the only row this fixture
 * draws -- taking the composer AC-13's "denies its own microphone, and
 * therefore draws no button to use it" assertion needs on screen with it.
 * `test/electron/launch.test.ts` is what caught it for real; this is the
 * fast, unit-level guard against it recurring.
 */

import { describe, expect, it } from 'vitest';
import { LAUNCH_FIXTURE_PROJECTS } from '../../src/main/launch-fixture.js';
import {
  DEFAULT_SESSION_FILTERS,
  isHiddenByForeignFilter,
} from '../../src/renderer/domain/session-filter.js';
import { DEMO_MODEL } from '../../src/renderer/fixtures/demo.js';

function theOneSession() {
  const session = LAUNCH_FIXTURE_PROJECTS[0]?.sessions[0];
  if (session === undefined) throw new Error('the launch fixture has no session to test');
  return session;
}

describe("the launch fixture's own session", () => {
  it('exists, one project and one session', () => {
    expect(LAUNCH_FIXTURE_PROJECTS).toHaveLength(1);
    expect(LAUNCH_FIXTURE_PROJECTS[0]?.sessions).toHaveLength(1);
  });

  /**
   * THE REAL CAUSE, pinned directly and fast. `session-filter.foreign.
   * test.ts` proves `isHiddenByForeignFilter` itself; this proves the ONE
   * session AC-13 needs on screen survives it under the exact filters the
   * app ships with, not an invented set.
   */
  it('survives the shipped default filters -- AC-13 needs its composer on screen', () => {
    expect(isHiddenByForeignFilter(theOneSession(), DEFAULT_SESSION_FILTERS)).toBe(false);
  });

  // The pre-existing guarantee `test/electron/launch.test.ts`'s own
  // "resolves to at least the Project/Session shape" test makes over a real
  // launch -- provable here too, fast, without one.
  it('still carries every key the shape assertion reads off DEMO_MODEL', () => {
    const demoProject = DEMO_MODEL.projects[0];
    const demoSession = demoProject?.sessions[0];
    expect(Object.keys(LAUNCH_FIXTURE_PROJECTS[0] ?? {})).toEqual(
      expect.arrayContaining(Object.keys(demoProject ?? {})),
    );
    expect(Object.keys(theOneSession())).toEqual(
      expect.arrayContaining(Object.keys(demoSession ?? {})),
    );
  });
});
