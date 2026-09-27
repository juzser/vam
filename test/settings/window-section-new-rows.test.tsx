// @vitest-environment happy-dom

/**
 * Window & Sidebar's second PR: sidebar appearance, and the three status-bar
 * toggles (`sections.ts`'s own header on `window` already named these as
 * "a later PR adds"). `view-width.test.tsx` holds the section's first row;
 * this file holds the rest, in the same idiom.
 */

import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';

afterEach(() => {
  document.body.innerHTML = '';
});

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  render(<SettingsOverlay prefs={prefs} theme="dark" onChange={onChange} onClose={() => {}} />);
  return { onChange };
}

function changed(onChange: { mock: { calls: unknown[][] } }, index = 0): Prefs {
  const call = onChange.mock.calls[index];
  expect(call, `onChange was not called ${index + 1} time(s)`).toBeDefined();
  return (call ?? [])[0] as Prefs;
}

describe('sidebar appearance', () => {
  const option = (choice: string) =>
    document.querySelector<HTMLButtonElement>(`[data-sidebar-appearance-option="${choice}"]`);

  it('offers the three choices, default pressed by default', () => {
    open();
    expect(option('default')?.getAttribute('aria-pressed')).toBe('true');
    expect(option('match-terminal')?.getAttribute('aria-pressed')).toBe('false');
    expect(option('tinted')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('writes the choice, disturbing no neighbour', () => {
    const { onChange } = open({ ...EMPTY_PREFS, outFontSize: 15 });
    fireEvent.click(option('tinted') as HTMLElement);
    const next = changed(onChange, 0);
    expect(next.sidebarAppearance).toBe('tinted');
    expect(next.outFontSize).toBe(15);
  });
});

describe('status bar: usage display mode', () => {
  const option = (choice: string) =>
    document.querySelector<HTMLButtonElement>(`[data-usage-display-mode-option="${choice}"]`);

  it('defaults to used', () => {
    open();
    expect(option('used')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('writes remaining', () => {
    const { onChange } = open();
    fireEvent.click(option('remaining') as HTMLElement);
    expect(changed(onChange, 0).statusBarUsageMode).toBe('remaining');
  });
});

describe('status bar: show Claude usage', () => {
  const toggle = () => document.querySelector<HTMLButtonElement>('[data-switch="claude-usage"]');

  it('defaults on', () => {
    open();
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');
  });

  it('writes off', () => {
    const { onChange } = open();
    fireEvent.click(toggle() as HTMLElement);
    expect(changed(onChange, 0).statusBarShowClaudeUsage).toBe(false);
  });
});

describe('status bar: show Codex usage', () => {
  const toggle = () => document.querySelector<HTMLButtonElement>('[data-switch="codex-usage"]');

  it('defaults off -- a brand-new cell must not appear uninvited', () => {
    open();
    expect(toggle()?.getAttribute('aria-checked')).toBe('false');
  });

  it('writes on', () => {
    const { onChange } = open();
    fireEvent.click(toggle() as HTMLElement);
    expect(changed(onChange, 0).statusBarShowCodexUsage).toBe(true);
  });
});
