// @vitest-environment happy-dom

/**
 * A phone cannot run a terminal: the remote server serves no pane
 * (`UNSERVED.terminal`). `visibleTabs` withdrew Terminal only on its
 * `terminal` argument, and its callers pass `terminal !== false`, so an
 * undefined or true capability leaked the tab onto the phone. The rule is now
 * decided inside `visibleTabs`, beside the `PRs` rule.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import { visibleTabs } from '../../src/renderer/panels/tabs.js';
import { installPhoneGlobals, MODEL, phoneSource, rows } from './harness.js';

beforeAll(installPhoneGlobals);
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('visibleTabs on a phone', () => {
  it('never contains Terminal when phone is true', () => {
    expect(visibleTabs(true, false, true)).not.toContain('Terminal');
    expect(visibleTabs(true, true, true)).not.toContain('Terminal');
  });

  it('still contains Terminal on the desktop', () => {
    expect(visibleTabs(true, false, false)).toContain('Terminal');
    expect(visibleTabs(true, true, false)).toContain('Terminal');
  });
});

describe('the phone view row', () => {
  function viewNames(terminal: boolean | undefined): (string | null)[] {
    render(
      <Canvas
        model={MODEL}
        source={phoneSource({
          capabilities: { terminal } as unknown as Record<string, boolean>,
        })}
      />,
    );
    const row = rows()[0];
    if (row === undefined) throw new Error('no session row');
    act(() => {
      fireEvent.click(row);
    });
    return [...document.querySelectorAll('[data-phone-view]')].map((b) =>
      b.getAttribute('data-phone-view'),
    );
  }

  it('offers no Terminal when the source declares a terminal', () => {
    const names = viewNames(true);
    expect(names.length).toBeGreaterThan(0);
    expect(names).not.toContain('terminal');
  });

  it('offers no Terminal when the terminal capability is undefined', () => {
    const names = viewNames(undefined);
    expect(names.length).toBeGreaterThan(0);
    expect(names).not.toContain('terminal');
  });
});
