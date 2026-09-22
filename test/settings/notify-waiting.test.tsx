// @vitest-environment happy-dom

/**
 * THE NOTIFICATION SWITCH, at the surface the operator touches.
 *
 * One row, one switch, in Behaviour -- a notification is something vam DOES
 * (`sections.ts`'s rule), not how it looks. What this file can hold: that the
 * control exists, where, what it writes, and what it tells the operator. It
 * cannot hold that a banner appears; that is the OS's, and main's `failed`
 * instrument is what says otherwise (`test/main/notify/notify.test.ts`).
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

const toggle = () => document.querySelector<HTMLElement>('[data-switch="notify-waiting"]');
const note = () =>
  document.querySelector<HTMLElement>('[data-notify-waiting-note]')?.textContent ?? '';

function changed(onChange: { mock: { calls: unknown[][] } }, index = 0): Prefs {
  const call = onChange.mock.calls[index];
  expect(call, `onChange was not called ${index + 1} time(s)`).toBeDefined();
  return (call ?? [])[0] as Prefs;
}

describe('the control', () => {
  it('is a switch in the Behaviour panel', () => {
    open();
    expect(
      document.querySelector('[data-settings-panel="behaviour"] [data-switch="notify-waiting"]'),
    ).not.toBeNull();
  });

  it('is a switch, named for what it controls, on by default, and says which way it is thrown', () => {
    open();
    expect(toggle()?.getAttribute('role')).toBe('switch');
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');
    expect(toggle()?.textContent).toBe('on');
    const label = toggle()?.getAttribute('aria-label') ?? '';
    cleanup();
    open({ ...EMPTY_PREFS, notifyWaiting: false });
    expect(toggle()?.getAttribute('aria-label')).toBe(label);
    expect(toggle()?.getAttribute('aria-checked')).toBe('false');
    expect(toggle()?.textContent).toBe('off');
  });

  it('writes the choice, disturbing no neighbour', () => {
    const { onChange } = open({ ...EMPTY_PREFS, focusView: true, outFontSize: 15 });
    fireEvent.click(toggle() as HTMLElement);
    const next = changed(onChange, 0);
    expect(next.notifyWaiting).toBe(false);
    expect(next.focusView).toBe(true);
    expect(next.outFontSize).toBe(15);
  });

  it('writes it back on', () => {
    const { onChange } = open({ ...EMPTY_PREFS, notifyWaiting: false });
    fireEvent.click(toggle() as HTMLElement);
    expect(changed(onChange, 0).notifyWaiting).toBe(true);
  });
});

describe('what the operator is told', () => {
  it('says it is per device, that it is quiet for the session on screen, and where a failure is read', () => {
    open();
    const text = note().toLowerCase();
    expect(text).toContain('this device');
    expect(text).toContain('looking at');
    // The instrument, disclosed: a banner macOS refuses is a line in the
    // error log, not silence.
    expect(text).toContain('error log');
  });
});

describe('and it is one switch', () => {
  it('offers no per-status pick, no sound, no quiet hours -- the row holds one control', () => {
    // Counted as CONTROLS, not words: the note is allowed to say "sound" in
    // order to say the system owns it.
    open();
    const row = document.querySelector('[data-settings-block="notify-waiting"]');
    expect(row).not.toBeNull();
    const controls = [...(row?.querySelectorAll('button, select, input, [role]') ?? [])];
    expect(controls.map((c) => c.getAttribute('data-switch') ?? c.tagName)).toEqual([
      'notify-waiting',
    ]);
  });

  it('is not on the phone: PHONE_SECTIONS is untouched', () => {
    expect(PHONE_SECTIONS).toEqual(['remote']);
  });
});
