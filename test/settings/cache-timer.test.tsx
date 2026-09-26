// @vitest-environment happy-dom

/**
 * THE CACHE-TIMER SWITCH, at the surface the operator touches.
 *
 * One row, one switch, in Sessions (`Bot`'s own section: what a session
 * starts as and how it is driven) -- the Anthropic-caching countdown is a
 * fact about a Claude Code session's own state, the same family as the
 * default provider and the send key already living there. `domain/cache-
 * timer.test.ts` and `SessionList.cache-timer.test.tsx` hold what the switch
 * actually gates; this file holds only that the control exists, where, what
 * it writes, and what it tells the operator -- the same split
 * `notify-waiting.test.tsx` already draws for its own switch.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import { PHONE_SECTIONS } from '../../src/renderer/settings/sections.js';

beforeAll(() => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: (() => {
      const map = new Map<string, string>();
      return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
        key: () => null,
        get length() {
          return map.size;
        },
      };
    })() as unknown as Storage,
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  render(<SettingsOverlay prefs={prefs} theme="dark" onChange={onChange} onClose={vi.fn()} />);
  return { onChange };
}

const toggle = () => document.querySelector<HTMLElement>('[data-switch="cache-timer"]');

function changed(onChange: { mock: { calls: unknown[][] } }, index = 0): Prefs {
  const call = onChange.mock.calls[index];
  expect(call, `onChange was not called ${index + 1} time(s)`).toBeDefined();
  return (call ?? [])[0] as Prefs;
}

describe('the control', () => {
  it('is a switch in the Sessions panel', () => {
    open();
    expect(
      document.querySelector('[data-settings-panel="sessions"] [data-switch="cache-timer"]'),
    ).not.toBeNull();
  });

  it('is a switch, named for what it controls, ON by default, and says which way it is thrown', () => {
    open();
    expect(toggle()?.getAttribute('role')).toBe('switch');
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');
    expect(toggle()?.textContent).toBe('on');
    const label = toggle()?.getAttribute('aria-label') ?? '';
    cleanup();
    open({ ...EMPTY_PREFS, cacheTimer: false });
    expect(toggle()?.getAttribute('aria-label')).toBe(label);
    expect(toggle()?.getAttribute('aria-checked')).toBe('false');
    expect(toggle()?.textContent).toBe('off');
  });

  it('writes the choice, disturbing no neighbour', () => {
    const { onChange } = open({ ...EMPTY_PREFS, focusView: true, outFontSize: 15 });
    fireEvent.click(toggle() as HTMLElement);
    const next = changed(onChange, 0);
    expect(next.cacheTimer).toBe(false);
    expect(next.focusView).toBe(true);
    expect(next.outFontSize).toBe(15);
  });

  it('writes it back on', () => {
    const { onChange } = open({ ...EMPTY_PREFS, cacheTimer: false });
    fireEvent.click(toggle() as HTMLElement);
    expect(changed(onChange, 0).cacheTimer).toBe(true);
  });
});

describe('what the operator is told', () => {
  it('names the countdown and what happens once it lapses', () => {
    open();
    const note =
      document.querySelector('[data-cache-timer-note]')?.textContent?.toLowerCase() ?? '';
    expect(note).toContain('cache');
    expect(note).toMatch(/expir|resend/);
  });
});

describe('not on the phone', () => {
  it('Sessions stays off PHONE_SECTIONS -- prefs read and write this browser’s storage', () => {
    expect(PHONE_SECTIONS).toEqual(['remote']);
  });
});
