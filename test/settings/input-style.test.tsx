// @vitest-environment happy-dom

/**
 * Operator event #42: every text-like Settings field takes the theme/template
 * button style -- a faint border and a faint ground (EC-50). The old field
 * style (`border-ink-faint bg-well`) lived in three places in
 * SettingsOverlay.tsx; it is one named constant now.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EMPTY_PREFS } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import type { SectionId } from '../../src/renderer/settings/sections.js';

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

afterEach(cleanup);

const DIR = join(__dirname, '../../src/renderer/settings');

describe('source guard', () => {
  it('no class string in src/renderer/settings holds both border-ink-faint and bg-well', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(DIR).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))) {
      const src = readFileSync(join(DIR, file), 'utf8');
      for (const m of src.matchAll(/(["'`])((?:(?!\1)[^\n])*)\1/g)) {
        const s = m[2] ?? '';
        if (s.includes('border-ink-faint') && s.includes('bg-well'))
          offenders.push(`${file}: ${s}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

function mount(section: SectionId) {
  return render(
    <SettingsOverlay
      prefs={EMPTY_PREFS}
      theme="dark"
      onChange={vi.fn()}
      onClose={vi.fn()}
      initialSection={section}
    />,
  );
}

const SECTIONS: readonly SectionId[] = ['interface', 'terminal', 'window', 'behaviour', 'agents'];

function fields() {
  const hex: HTMLElement[] = [];
  const selects: HTMLElement[] = [];
  const steppers: HTMLElement[] = [];
  for (const id of SECTIONS) {
    const { container, unmount } = mount(id);
    // Collect class lists, then unmount: only the strings matter.
    for (const el of container.querySelectorAll<HTMLElement>('[data-terminal-hex]'))
      hex.push(el.cloneNode() as HTMLElement);
    for (const el of container.querySelectorAll<HTMLElement>('[data-font-family-select]'))
      selects.push(el.cloneNode() as HTMLElement);
    for (const el of container.querySelectorAll<HTMLInputElement>('input[type="number"]')) {
      const wrap = el.parentElement;
      if (wrap) steppers.push(wrap.cloneNode() as HTMLElement);
    }
    unmount();
  }
  return { hex, selects, steppers };
}

const has = (el: HTMLElement, cls: string) => el.classList.contains(cls);

describe('render', () => {
  const { hex, selects, steppers } = fields();

  it('finds every kind of field', () => {
    expect(hex.length).toBeGreaterThan(0);
    expect(selects.length).toBe(2);
    expect(steppers.length).toBeGreaterThan(0);
  });

  it.each([
    ['hex inputs', hex],
    ['font selects', selects],
    ['stepper wrappers', steppers],
  ] as const)('%s carry border-line and bg-raised, not the old style', (_n, els) => {
    for (const el of els) {
      expect(has(el, 'border-line')).toBe(true);
      expect(has(el, 'bg-raised')).toBe(true);
      expect(has(el, 'border-ink-faint')).toBe(false);
      expect(has(el, 'bg-well')).toBe(false);
    }
  });

  it('keeps each control height and width', () => {
    for (const el of hex) {
      expect(has(el, 'h-[24px]')).toBe(true);
      expect(has(el, 'w-[72px]')).toBe(true);
    }
    for (const el of selects) {
      expect(has(el, 'h-[28px]')).toBe(true);
      expect(has(el, 'max-w-[280px]')).toBe(true);
    }
    for (const el of steppers) expect(has(el, 'h-[30px]')).toBe(true);
  });
});

describe('pins', () => {
  it('hex input keeps its focus ring class', () => {
    const { container } = mount('terminal');
    const input = container.querySelector<HTMLElement>('[data-terminal-hex]');
    expect(input).not.toBeNull();
    fireEvent.focus(input as HTMLElement);
    expect(input?.className).toContain('focus-visible:outline-2');
  });

  it('stepper wrapper keeps its focus-visible outline', () => {
    const { container } = mount('interface');
    const wrap = container.querySelector('input[type="number"]')?.parentElement;
    expect(wrap?.className).toContain('has-[:focus-visible]:outline-2');
  });

  it('theme Choice buttons keep their base classes', () => {
    const { container } = mount('interface');
    const btn = container.querySelector<HTMLElement>(
      '[data-palette-template], [data-theme-choice]',
    );
    if (btn) expect(btn.className).toContain('border-line');
  });
});
