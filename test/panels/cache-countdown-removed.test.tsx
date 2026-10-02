// @vitest-environment happy-dom

/**
 * EC-65 (operator event #71): the sidebar's prompt-cache countdown is gone.
 *
 * Part 1 mounts the Canvas, the app-level path that used to pass the
 * `cacheTimer` preference to the list, because a bare list render would pass
 * even with the countdown still wired in.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';

function session(id: string): Session {
  return {
    id,
    title: id,
    epic: null,
    branch: null,
    status: 'idle',
    runningAgents: 0,
    activity: null,
    age: '3m',
    decisions: [],
    source: 'claude-code',
    lastCacheActivityAt: new Date(Date.now() - 60_000).toISOString(),
    cacheTtlMs: 60 * 60 * 1000,
  };
}

const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1'), session('a2')] },
  ],
};

let phone = false;

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: phone && query.includes('max-width'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  phone = false;
  vi.restoreAllMocks();
});

describe('no session row draws a cache countdown', () => {
  const cases: Array<[string, boolean, Record<string, unknown> | null]> = [
    ['desktop rows, default prefs', false, null],
    ['desktop rows, stored cacheTimer: true', false, { cacheTimer: true }],
    ['phone rows, default prefs', true, null],
    ['phone rows, stored cacheTimer: true', true, { cacheTimer: true }],
  ];
  it.each(cases)('%s', (_name, isPhone, stored) => {
    phone = isPhone;
    if (stored) localStorage.setItem('vam.prefs.v1', JSON.stringify(stored));
    render(<Canvas model={MODEL} />);
    const rows = document.querySelectorAll('[data-session-row]');
    expect(rows.length).toBeGreaterThan(0);
    expect(document.querySelector('[data-row-meta], [data-row-meta-line]')).not.toBeNull();
    for (const row of rows) {
      expect(row.querySelector('[data-testid="cache-timer"]')).toBeNull();
      expect(row.querySelector('[data-cache-timer]')).toBeNull();
    }
  });
});

describe('Settings, Agents section', () => {
  it('has no cache-timer control, note or copy', () => {
    const { container } = render(
      <SettingsOverlay
        prefs={EMPTY_PREFS}
        theme="dark"
        onChange={vi.fn()}
        onClose={vi.fn()}
        initialSection="agents"
      />,
    );
    expect(container.querySelector('[data-submit-key-note]')).not.toBeNull();
    expect(container.querySelector('[name="cache-timer"]')).toBeNull();
    expect(container.querySelector('[data-cache-timer-note]')).toBeNull();
    const text = container.textContent ?? '';
    expect(text).not.toContain('cache timer');
    expect(text).not.toContain('prompt cache expires');
    expect(text).not.toContain('uncached price');
  });
});

describe('a stored cacheTimer preference', () => {
  function fake(initial: string | null): StorageLike & { readonly value: () => string | null } {
    let value = initial;
    return {
      getItem: () => value,
      setItem: (_key, next) => {
        value = next;
      },
      value: () => value,
    };
  }

  it.each([true, false, 'yes'])('is ignored on read (%s) and never written back', (raw) => {
    const without = readPrefs(fake(JSON.stringify({})));
    const read = readPrefs(fake(JSON.stringify({ cacheTimer: raw })));
    expect('cacheTimer' in read).toBe(false);
    expect(read).toEqual(without);
    const out = fake(null);
    writePrefs(out, read);
    expect(out.value()).not.toBeNull();
    expect(JSON.parse(out.value() ?? '{}')).not.toHaveProperty('cacheTimer');
  });
});
