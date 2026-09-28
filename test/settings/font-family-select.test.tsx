// @vitest-environment happy-dom

/**
 * THE FONT PICKERS AS DROPDOWNS (settings-views restructure, item G).
 *
 * Operator: "UI Font and Terminal Font settings become dropdowns using
 * existing select/menu pattern; curated font lists ... desktop shows only
 * installed fonts (extend scan for sans names); browser shows curated
 * macOS lists; each label drawn in its own font; migration for stored
 * free-text values." The free-text `<input>` + chip row this replaces
 * (`FontFamilyField`, `data-monospace-font-option`) is gone; a native
 * `<select>` is the ONE control now, matching `GithubPanel.tsx`'s own
 * `RepoPicker` project `<select>` -- "the existing select/menu pattern" the
 * operator's own words point at.
 *
 * NO `window.api` STUBBED BY DEFAULT, the same convention
 * `appearance.test.tsx` already holds: this harness IS the browser build
 * unless a test installs a bridge, so "offers the curated list" is the
 * baseline every test starts from, and "offers the scanned list instead" is
 * the one that has to ask for a bridge first.
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import type { SectionId } from '../../src/renderer/settings/sections.js';
import { TERMINAL_FONT_CURATED, UI_FONT_CURATED } from '../../src/shared/fonts.js';

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
  vi.unstubAllGlobals();
  // `stubFontsBridge` below MUTATES the real `window` via `Object.assign`
  // rather than swapping in a copy, so `vi.unstubAllGlobals()` restores
  // `globalThis.window` to a reference that is already carrying `.api` --
  // the mutation itself is never undone. Left alone, a stubbed test bleeds
  // its bridge into every test after it in file order (a real bug this
  // suite tripped on: the SECOND `describe` block's own no-bridge case
  // inherited the FIRST block's `.api` and saw the scanned list instead of
  // the curated one). Delete it explicitly so "no bridge" is true again.
  delete (window as unknown as { api?: unknown }).api;
});

function open(prefs: Prefs = EMPTY_PREFS, initialSection?: SectionId) {
  const onChange = vi.fn();
  render(
    <SettingsOverlay
      prefs={prefs}
      theme="dark"
      onChange={onChange}
      onClose={vi.fn()}
      initialSection={initialSection}
    />,
  );
  return { onChange };
}

/** A bridge answering FIXED lists, installed before render -- the same
 *  `vi.stubGlobal` idiom `copy-budget.test.tsx`'s own `SKILLS_BRIDGE_STUB`
 *  uses for a different bridge member. */
function stubFontsBridge(sans: readonly string[], monospace: readonly string[]): void {
  vi.stubGlobal(
    'window',
    Object.assign(globalThis.window, {
      api: {
        fonts: {
          listSans: vi.fn(async () => sans),
          listMonospace: vi.fn(async () => monospace),
        },
      },
    }),
  );
}

const select = (name: string) =>
  document.querySelector<HTMLSelectElement>(`[aria-label="${name}"]`);
const optionValues = (el: HTMLSelectElement) => [...el.options].map((o) => o.value);

describe('the UI font dropdown', () => {
  it('offers "System default" first, then the curated list, in a browser build with no bridge', () => {
    open(EMPTY_PREFS, 'interface');
    const el = select('UI font family');
    expect(el).not.toBeNull();
    const values = optionValues(el as HTMLSelectElement);
    expect(values[0]).toBe('');
    for (const name of UI_FONT_CURATED) {
      expect(values).toContain(name);
    }
  });

  it('offers only the SCANNED list on desktop, not the full curated set', async () => {
    stubFontsBridge(['Futura'], []);
    open(EMPTY_PREFS, 'interface');
    await waitFor(() =>
      expect(optionValues(select('UI font family') as HTMLSelectElement)).toContain('Futura'),
    );
    const values = optionValues(select('UI font family') as HTMLSelectElement);
    // Optima is on the curated list but was not among the fixture's own
    // scan results -- the browser fallback must not leak into a desktop
    // build that DID get a real answer.
    expect(values).not.toContain('Optima');
  });

  it('selecting an option commits it to prefs', () => {
    const { onChange } = open(EMPTY_PREFS, 'interface');
    fireEvent.change(select('UI font family') as HTMLSelectElement, {
      target: { value: 'Futura' },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ uiFontFamily: 'Futura' }));
  });

  it('migrates a stored free-text value into its own option, and keeps it selected', () => {
    open({ ...EMPTY_PREFS, uiFontFamily: 'Operator Custom Sans' }, 'interface');
    const el = select('UI font family') as HTMLSelectElement;
    expect(optionValues(el)).toContain('Operator Custom Sans');
    expect(el.value).toBe('Operator Custom Sans');
  });

  it('draws each option in its own font', () => {
    open(EMPTY_PREFS, 'interface');
    const el = select('UI font family') as HTMLSelectElement;
    const futura = [...el.options].find((o) => o.value === 'Futura');
    expect(futura?.style.fontFamily).toMatch(/Futura/);
  });
});

describe('the Terminal font dropdown', () => {
  it('offers "System default" first, then the curated list, in a browser build with no bridge', () => {
    open(EMPTY_PREFS, 'terminal');
    const el = select('terminal font family');
    expect(el).not.toBeNull();
    const values = optionValues(el as HTMLSelectElement);
    expect(values[0]).toBe('');
    for (const name of TERMINAL_FONT_CURATED) {
      expect(values).toContain(name);
    }
  });

  it('offers only the SCANNED monospace list on desktop', async () => {
    stubFontsBridge([], ['JetBrains Mono']);
    open(EMPTY_PREFS, 'terminal');
    await waitFor(() =>
      expect(optionValues(select('terminal font family') as HTMLSelectElement)).toContain(
        'JetBrains Mono',
      ),
    );
    const values = optionValues(select('terminal font family') as HTMLSelectElement);
    expect(values).not.toContain('Menlo');
  });

  it('selecting an option commits it to prefs, the same channel the old free-text field used', () => {
    const { onChange } = open(EMPTY_PREFS, 'terminal');
    fireEvent.change(select('terminal font family') as HTMLSelectElement, {
      target: { value: 'Menlo' },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ terminalFontFamily: 'Menlo' }));
  });

  it('migrates a stored free-text value into its own option, and keeps it selected', () => {
    open({ ...EMPTY_PREFS, terminalFontFamily: 'Operator Custom Mono' }, 'terminal');
    const el = select('terminal font family') as HTMLSelectElement;
    expect(optionValues(el)).toContain('Operator Custom Mono');
    expect(el.value).toBe('Operator Custom Mono');
  });

  it('draws each option in its own font', () => {
    open(EMPTY_PREFS, 'terminal');
    const el = select('terminal font family') as HTMLSelectElement;
    const menlo = [...el.options].find((o) => o.value === 'Menlo');
    expect(menlo?.style.fontFamily).toMatch(/Menlo/);
  });

  it('leaves no free-text field or chip row behind', () => {
    open(EMPTY_PREFS, 'terminal');
    expect(document.querySelector('[data-font-family-field]')).toBeNull();
    expect(document.querySelector('[data-monospace-font-option]')).toBeNull();
  });
});
