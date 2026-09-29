// @vitest-environment happy-dom

/**
 * The phone list header, collapsed to Orca's one-row shape (follow-up to
 * pull request 527).
 *
 * Before this file: the phone list screen opened on THREE rows above the
 * first session -- the avatar bar (account, the connectivity dot, the phone
 * icon, the theme toggle), a full-width "Search sessions" box, and the
 * "PROJECTS" row (folder, `+`, filter). `docs/images/phone-orca/phone-
 * controls-list-*-after.png` (on main) is that shape.
 *
 * After: at most one status row (the avatar bar, now carrying only the
 * connectivity dot) and exactly one toolbar row (`data-projects-header`,
 * which doubles as `data-phone-toolbar` on a phone) holding everything else --
 * the filter pill, a grouping control, the two project-create buttons,
 * account, search (collapsed to an icon that expands in place), and a "more"
 * button that opens Remote and the theme toggle behind one more tap (the row
 * overflowed at 390px with both drawn bare -- the operator's own suggested
 * fix for exactly that). Desktop is untouched: every assertion here either
 * renders `phone` explicitly or is paired with a companion assertion (or an
 * existing test elsewhere in this directory) that the same query rendered
 * WITHOUT `phone` still finds the pre-existing desktop shape.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionList, type SessionListProps } from '../../src/renderer/panels/SessionList.js';
import { baseProps, entriesOf } from './session-list-props.js';

afterEach(cleanup);

function mountPhone(over: Partial<SessionListProps> = {}) {
  return render(<SessionList {...baseProps(entriesOf([]))} phone width={undefined} {...over} />);
}

describe('the phone toolbar row (Orca one-row pass)', () => {
  it('draws no full-width search box and no separate PROJECTS heading on a phone', () => {
    const { container } = mountPhone();

    // The desktop's own placeholder text is gone -- search is an icon now.
    expect(container.textContent).not.toContain('Search sessions');
    expect(container.textContent).not.toContain('Projects');

    // Still exactly one filter-sessions BUTTON (the funnel) -- not two, which
    // is what the desktop's shared aria-label with the search INPUT would
    // give if the full-width box survived alongside it.
    expect(container.querySelectorAll('button[aria-label="filter sessions"]')).toHaveLength(1);
  });

  it('holds every control in one row, and none of it in the avatar bar', () => {
    mountPhone();

    const toolbar = document.querySelector('[data-phone-toolbar]');
    expect(toolbar).not.toBeNull();
    expect(toolbar).toBe(document.querySelector('[data-projects-header]'));
    expect(document.querySelector('[data-avatar-bar]')).toBeNull();

    for (const label of ['remote access', 'switch to light theme', 'search sessions']) {
      const control = screen.getByLabelText(label);
      expect(control.closest('[data-phone-toolbar]'), `${label} is in the toolbar`).not.toBeNull();
    }
  });

  it('has no account icon, no 3-dots toggle and no more-menu on a phone', () => {
    mountPhone();
    expect(document.querySelector('[data-usage-toggle]')).toBeNull();
    expect(document.querySelector('[data-more-toggle]')).toBeNull();
    expect(document.querySelector('[data-more-menu]')).toBeNull();
    expect(screen.queryByLabelText('more actions')).toBeNull();
  });

  it('ends with Remote, Theme, Search, right-aligned behind a spacer', () => {
    mountPhone();
    const toolbar = document.querySelector('[data-phone-toolbar]') as HTMLElement;
    const kids = [...toolbar.children];
    const last3 = kids.slice(-3);
    expect(
      last3[0]?.getAttribute('aria-label') ??
        last3[0]?.querySelector('button')?.getAttribute('aria-label'),
    ).toBe('remote access');
    expect(
      last3[1]?.getAttribute('aria-label') ??
        last3[1]?.querySelector('button')?.getAttribute('aria-label'),
    ).toBe('switch to light theme');
    expect(
      last3[2]?.getAttribute('aria-label') ??
        last3[2]?.querySelector('button')?.getAttribute('aria-label'),
    ).toBe('search sessions');
    const spacer = kids[kids.length - 4];
    expect(spacer?.tagName).toBe('SPAN');
    expect(spacer?.className).toContain('flex-1');
    expect(spacer?.children).toHaveLength(0);
  });

  it('renders no menu inside the scrolling toolbar row for it to clip', () => {
    mountPhone();
    const scroller = document.querySelector('.overflow-x-auto');
    expect(scroller?.querySelector('[role="menu"]') ?? null).toBeNull();
  });

  it('keeps the new-group and new-project controls reachable, unmoved', () => {
    const onCreateGroup = vi.fn();
    mountPhone({ onCreateGroup });

    const toolbar = document.querySelector('[data-phone-toolbar]');
    expect(toolbar?.querySelector('[data-new-group]')).not.toBeNull();
    expect(toolbar?.querySelector('[data-new-project]')).not.toBeNull();
  });

  it('shows the grouping control with the current Group-by choice, truncated', () => {
    mountPhone();
    // `DEFAULT_VIEW_OPTIONS.groupBy` is `'project'` (`domain/selectors.ts`).
    const group = screen.getByLabelText('group by Project');
    expect(group.getAttribute('data-group-toggle')).toBe('true');
  });

  it('opens the same popover from the grouping control as from the filter pill', () => {
    const onFilterMenuToggle = vi.fn();
    mountPhone({ onFilterMenuToggle });

    fireEvent.click(screen.getByLabelText('group by Project'));
    expect(onFilterMenuToggle).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByLabelText('filter sessions'));
    expect(onFilterMenuToggle).toHaveBeenCalledWith(true);
    expect(onFilterMenuToggle).toHaveBeenCalledTimes(2);
  });

  it('shows the same active-filter count the desktop badge already computes', () => {
    mountPhone({ statusFilter: 'waiting' });
    const badge = document.querySelector('[data-filter-badge]');
    expect(badge?.textContent).toBe('1');
  });

  it('calls onRemote / onToggleTheme once each from the direct buttons, not onSettings', () => {
    const onRemote = vi.fn();
    const onToggleTheme = vi.fn();
    const onSettings = vi.fn();
    mountPhone({ onRemote, onToggleTheme, onSettings });

    fireEvent.click(screen.getByLabelText('remote access'));
    fireEvent.click(screen.getByLabelText('switch to light theme'));

    expect(onRemote).toHaveBeenCalledTimes(1);
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
    expect(onSettings).not.toHaveBeenCalled();
  });
});

describe('the phone search icon expands in place', () => {
  it('opens the filter input, focused, on the icon tap', () => {
    const onOpenFilter = vi.fn();
    mountPhone({ onOpenFilter });

    fireEvent.click(screen.getByLabelText('search sessions'));
    expect(onOpenFilter).toHaveBeenCalledTimes(1);
  });

  it('renders a focused input in the toolbar while filtering, matching the desktop’s own contract', () => {
    mountPhone({ filtering: true, filter: 'abc' });

    // Two elements share the accessible name "filter sessions" here, the same
    // way they already do on the desktop: this input, and the funnel button
    // (`data-filter-toggle`) that opens a different popover entirely --
    // `e2e/phone-shell.pw.ts`'s own search-route test disambiguates the same
    // pair by tag (`input[aria-label="filter sessions"]`), which is what the
    // `selector` option below asks `getByLabelText` to do too.
    const input = screen.getByLabelText('filter sessions', {
      selector: 'input',
    }) as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.closest('[data-phone-toolbar]')).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('collapses on Escape via onFilterCancel, the same handler the clear button calls', () => {
    const onFilterCancel = vi.fn();
    mountPhone({ filtering: true, filter: 'abc', onFilterCancel });

    const input = screen.getByLabelText('filter sessions', { selector: 'input' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onFilterCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('cancel search'));
    expect(onFilterCancel).toHaveBeenCalledTimes(2);
  });

  it('narrows the list as the operator types, the same onFilterChange the desktop box calls', () => {
    const onFilterChange = vi.fn();
    mountPhone({ filtering: true, onFilterChange });

    const input = screen.getByLabelText('filter sessions', { selector: 'input' });
    fireEvent.change(input, { target: { value: 'vam' } });
    expect(onFilterChange).toHaveBeenCalledWith('vam');
  });

  it('closes an open filter popover before opening, so the two never show at once', () => {
    const onFilterMenuToggle = vi.fn();
    mountPhone({ filterMenuOpen: true, onFilterMenuToggle });

    fireEvent.click(screen.getByLabelText('search sessions'));
    expect(onFilterMenuToggle).toHaveBeenCalledWith(false);
  });

  it('closes an open search box before the filter pill opens its popover', () => {
    const onFilterCancel = vi.fn();
    const onFilterMenuToggle = vi.fn();
    mountPhone({ filtering: true, onFilterCancel, onFilterMenuToggle });

    fireEvent.click(screen.getByLabelText('filter sessions', { selector: 'button' }));
    expect(onFilterCancel).toHaveBeenCalledTimes(1);
    expect(onFilterMenuToggle).toHaveBeenCalledWith(true);
  });
});

describe('desktop is unchanged', () => {
  it('keeps the full-width search box and the PROJECTS heading without `phone`', () => {
    const { container } = render(<SessionList {...baseProps(entriesOf([]))} />);
    expect(container.textContent).toContain('Search sessions');
    expect(container.textContent).toContain('Projects');
    expect(document.querySelector('[data-phone-toolbar]')).toBeNull();
  });

  it('keeps account, remote and theme in the avatar bar without `phone`', () => {
    render(<SessionList {...baseProps(entriesOf([]))} />);
    const bar = screen.getByLabelText('usage').closest('[data-avatar-bar]');
    expect(bar).not.toBeNull();
    expect(screen.getByLabelText('remote access').closest('[data-avatar-bar]')).toBe(bar);
    expect(screen.getByLabelText('switch to light theme').closest('[data-avatar-bar]')).toBe(bar);
  });

  it('draws no grouping control at all on the desktop', () => {
    render(<SessionList {...baseProps(entriesOf([]))} />);
    expect(document.querySelector('[data-group-toggle]')).toBeNull();
  });
});
