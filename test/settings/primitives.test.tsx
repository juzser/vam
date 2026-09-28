// @vitest-environment happy-dom

/**
 * The reusable building blocks the settings views are made of: `SettingsCard`
 * (one section's plain titled view -- icon, title, description, its rows
 * beneath), `SettingsRow` (one setting, label left, control right --
 * `Block`'s replacement), `SettingsSubgroup` (a sub-heading over a run of
 * indented rows) and `AdvancedDisclosure` (the chevron-plus-"Advanced" fold
 * for a section's rarely-touched rows).
 *
 * Follow-up PRs build their own rows on these, so what is asserted here is
 * the CONTRACT: `SettingsCard` draws a section unconditionally (the
 * single-section-view restructure, item C, retired its own top-level
 * fold -- `SettingsOverlay.tsx`'s nav is what decides whether a section is
 * even mounted now), Advanced still starts closed and remembers the
 * opposite, and both wear the accessible names/states the operator's own
 * screen reader would announce -- `aria-expanded` on Advanced's real button,
 * never a `div` wearing a click handler.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Palette } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import { isAdvancedOpen } from '../../src/renderer/settings/card-collapse.js';
import {
  AdvancedDisclosure,
  SettingsCard,
  SettingsRow,
  SettingsSubgroup,
} from '../../src/renderer/settings/primitives.js';

afterEach(cleanup);

describe('SettingsCard', () => {
  it('draws its rows unconditionally -- there is no fold left to hide them behind', () => {
    render(
      <SettingsCard id="interface" label="Interface" Icon={Palette} hint="theme and colour">
        <p>row content</p>
      </SettingsCard>,
    );
    expect(document.querySelector('[data-settings-rows]')?.closest('[hidden]')).toBeNull();
    expect(screen.getByText('row content')).not.toBeNull();
  });

  it('draws the heading as a plain heading, not a button -- there is nothing left for it to toggle', () => {
    render(
      <SettingsCard id="interface" label="Interface" Icon={Palette} hint="theme and colour">
        <p>row content</p>
      </SettingsCard>,
    );
    expect(screen.queryByRole('button', { name: 'Interface' })).toBeNull();
    expect(document.querySelector('[data-settings-heading]')?.getAttribute('aria-expanded')).toBe(
      null,
    );
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

  it('keeps a 16px gap under the heading rule before the rows start (#532)', () => {
    render(
      <SettingsCard id="terminal" label="Terminal" Icon={Palette} hint="the terminal's own paint">
        <p>row content</p>
      </SettingsCard>,
    );
    // A CLASS NAME IS A FACT ABOUT THE MARKUP, NOT ABOUT THE PAINT -- the same
    // split `SettingsRow`'s own `data-settings-row-layout` test below draws:
    // `settings-chrome-shots.mjs`'s own heading-gap check (ITEM 8) measures
    // the real painted gap in a browser; this is the contract a `py-4` class
    // literally reads as 16px in this codebase's spacing scale.
    expect(document.querySelector('[data-settings-card-body]')?.className).toMatch(/\bpy-4\b/);
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

  it('defaults to layout="inline" -- label and description left, control right, on one line', () => {
    render(
      <SettingsRow label="theme" hint="system follows the OS">
        <input aria-label="theme choice" />
      </SettingsRow>,
    );
    // A CLASS NAME IS A FACT ABOUT THE MARKUP, NOT ABOUT THE PAINT --
    // `settings-chrome-shots.mjs`'s own row-geometry checks measure the
    // real split in a browser; what this asserts is the CONTRACT a guard
    // reads off `data-settings-row-layout` to know which measurement to
    // make, the same "attribute states the fact, e2e proves it painted"
    // split this codebase already draws elsewhere.
    expect(
      screen.getByRole('group', { name: 'theme' }).getAttribute('data-settings-row-layout'),
    ).toBe('inline');
  });

  it('layout="stacked" keeps a wide control (a grid, a chip list) under the label, and says so', () => {
    render(
      <SettingsRow label="templates" hint="a whole palette in one press" layout="stacked">
        <div data-testid="template-grid">grid of chips</div>
      </SettingsRow>,
    );
    const group = screen.getByRole('group', { name: 'templates' });
    expect(group.getAttribute('data-settings-row-layout')).toBe('stacked');
    expect(group.querySelector('[data-testid="template-grid"]')).not.toBeNull();
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
