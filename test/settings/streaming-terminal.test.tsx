// @vitest-environment happy-dom

/**
 * THE STREAMING TERMINAL SWITCH, at the surface the operator touches. A
 * shape `test/settings/concise-output.test.tsx` already holds at length; this
 * file only asserts that the row exists, is off by default and writes its
 * choice.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';

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

const toggle = () => document.querySelector<HTMLElement>('[data-switch="streaming-terminal"]');

describe('the streaming terminal switch', () => {
  it('is off by default', () => {
    open();
    expect(toggle()?.getAttribute('aria-checked')).toBe('false');
    expect(toggle()?.textContent).toBe('off');
  });

  it('writes the choice, disturbing no neighbour', () => {
    const { onChange } = open({ ...EMPTY_PREFS, conciseOutput: true });
    fireEvent.click(toggle() as HTMLElement);
    const next = onChange.mock.calls[0]?.[0] as Prefs;
    expect(next.streamingTerminal).toBe(true);
    expect(next.conciseOutput).toBe(true);
  });
});
