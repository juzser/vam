// @vitest-environment happy-dom

/**
 * The four reusable building blocks the settings cards restructure introduces:
 * `SettingsCard` (a collapsible section), `SettingsRow` (one setting, label
 * left, control right -- `Block`'s replacement), `SettingsSubgroup` (a
 * sub-heading over a run of indented rows) and `AdvancedDisclosure` (the
 * chevron-plus-"Advanced" fold at a card's own bottom).
 *
 * Follow-up PRs build their own rows on these, so what is asserted here is the
 * CONTRACT: a card starts open and remembers a fold across a remount (the
 * dialog's own relaunch), Advanced starts closed and remembers the opposite,
 * and both wear the accessible names/states the operator's own screen reader
 * would announce -- `aria-expanded` on a real button, never a `div` wearing a
 * click handler.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Palette } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAdvancedOpen, isCardCollapsed } from '../../src/renderer/settings/card-collapse.js';
import {
  AdvancedDisclosure,
  SettingsCard,
  SettingsRow,
  SettingsSubgroup,
} from '../../src/renderer/settings/primitives.js';

afterEach(cleanup);

describe('SettingsCard', () => {
  it('opens by default -- an untouched dialog shows every row', () => {
    render(
      <SettingsCard id="interface" label="Interface" Icon={Palette} hint="theme and colour">
        <p>row content</p>
      </SettingsCard>,
    );
    expect(document.querySelector('[data-settings-rows]')?.closest('[hidden]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Interface' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('folds shut on a click of its own header, and the header is a real button', () => {
    render(
      <SettingsCard id="interface" label="Interface" Icon={Palette} hint="theme and colour">
        <p>row content</p>
      </SettingsCard>,
    );
    const header = screen.getByRole('button', { name: 'Interface' });
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-settings-rows]')?.closest('[hidden]')).not.toBeNull();
  });

  it('remembers a fold across a remount, and a fresh mount honours the store', () => {
    localStorage.setItem('vam.settings.cardCollapsed', JSON.stringify({ interface: true }));
    render(
      <SettingsCard id="interface" label="Interface" Icon={Palette} hint="theme and colour">
        <p>row content</p>
      </SettingsCard>,
    );
    expect(screen.getByRole('button', { name: 'Interface' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('writes the fold back to storage so the NEXT mount sees it too', () => {
    render(
      <SettingsCard id="interface" label="Interface" Icon={Palette} hint="theme and colour">
        <p>row content</p>
      </SettingsCard>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Interface' }));
    expect(isCardCollapsed('interface')).toBe(true);
  });

  it('reports its open state to an optional listener, on mount and on every toggle', () => {
    const onOpenChange = vi.fn();
    render(
      <SettingsCard
        id="integrations"
        label="Integrations"
        Icon={Palette}
        hint="GitHub"
        onOpenChange={onOpenChange}
      >
        <p>row content</p>
      </SettingsCard>,
    );
    expect(onOpenChange).toHaveBeenCalledWith(true);
    onOpenChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Integrations' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('carries the panel and rows hooks a guard finds it by', () => {
    render(
      <SettingsCard id="terminal" label="Terminal" Icon={Palette} hint="the terminal's own paint">
        <p>row content</p>
      </SettingsCard>,
    );
    expect(document.querySelector('[data-settings-panel="terminal"]')).not.toBeNull();
    expect(document.querySelector('[data-settings-heading]')?.textContent).toBe('Terminal');
    expect(document.querySelector('[data-settings-panel-hint]')?.textContent).toBe(
      "the terminal's own paint",
    );
  });
});

describe('SettingsRow', () => {
  it('associates its label with its row by id/aria-labelledby', () => {
    render(
      <SettingsRow label="out text" hint="how big a response reads">
        <input aria-label="out text size" />
      </SettingsRow>,
    );
    const group = screen.getByRole('group', { name: 'out text' });
    expect(group.querySelector('input')).not.toBeNull();
  });
});

describe('SettingsSubgroup', () => {
  it('titles a run of rows and keeps them inside its own heading', () => {
    render(
      <SettingsSubgroup title="Terminal Typography">
        <SettingsRow label="terminal text" hint="glyph size">
          <input aria-label="terminal text size" />
        </SettingsRow>
      </SettingsSubgroup>,
    );
    expect(screen.getByText('Terminal Typography')).not.toBeNull();
    expect(screen.getByLabelText('terminal text size')).not.toBeNull();
  });
});

describe('AdvancedDisclosure', () => {
  it('starts closed -- the opposite default from the card around it', () => {
    render(
      <AdvancedDisclosure id="terminal">
        <p data-testid="rare-row">rare row</p>
      </AdvancedDisclosure>,
    );
    const toggle = screen.getByRole('button', { name: 'Advanced' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-testid="rare-row"]')?.closest('[hidden]')).not.toBeNull();
    // The hook a test that cannot use `getByRole` (the content is hidden, so
    // testing-library's own accessibility filter excludes it) finds the
    // toggle by instead.
    expect(document.querySelector('[data-settings-advanced="terminal"]')).toBe(toggle);
  });

  it('opens on a click, and remembers it across a remount', () => {
    render(
      <AdvancedDisclosure id="terminal">
        <p data-testid="rare-row">rare row</p>
      </AdvancedDisclosure>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(document.querySelector('[data-testid="rare-row"]')?.closest('[hidden]')).toBeNull();
    expect(isAdvancedOpen('terminal')).toBe(true);
  });

  it('one section’s own Advanced never opens a sibling’s', () => {
    localStorage.setItem('vam.settings.advancedOpen', JSON.stringify({ terminal: true }));
    render(
      <AdvancedDisclosure id="interface">
        <p>rare row</p>
      </AdvancedDisclosure>,
    );
    expect(screen.getByRole('button', { name: 'Advanced' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });
});
