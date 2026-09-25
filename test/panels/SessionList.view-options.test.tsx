// @vitest-environment happy-dom

/**
 * ORCA'S "Group by" AND "Sort by", in vam's own popover.
 *
 * `Group by: Project` is the untouched tree `SessionList.tree.test.tsx`
 * already covers -- these tests are about the two modes that bypass it
 * (`Status`, `None`) and the two controls themselves. `PR` and `Project
 * order` are not offered; see `docs/design/workspace-options.md`.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyViewOrder,
  DEFAULT_VIEW_OPTIONS,
  type SessionEntry,
} from '../../src/renderer/domain/selectors.js';
import { SessionList, type SessionListProps } from '../../src/renderer/panels/SessionList.js';
import { baseProps, makeProject, makeSession } from './session-list-props.js';

afterEach(cleanup);

const alpha = makeProject({ id: 'p1', name: 'alpha' }, []);
const beta = makeProject({ id: 'p2', name: 'beta' }, []);

function entries(): SessionEntry[] {
  return [
    { project: alpha, session: makeSession({ id: 'a1', title: 'Zebra', status: 'waiting' }) },
    { project: alpha, session: makeSession({ id: 'a2', title: 'Apple', status: 'done' }) },
    { project: beta, session: makeSession({ id: 'b1', title: 'Mango', status: 'running' }) },
  ];
}

/**
 * `SessionList` never re-sorts or re-buckets its own `entries` prop -- it
 * trusts the order it is handed, the same way it always trusted `entries`
 * arriving project-major from `orderedSessions`. `Canvas.tsx` is what runs
 * `applyViewOrder` before this pane ever sees the array (`entries.view-order
 * .test.ts` covers that function in isolation), so a unit test mounting this
 * pane directly has to do the same folding, or it is testing a shape
 * `SessionList` was never promised to receive.
 */
function mount(over: Partial<SessionListProps> = {}) {
  const viewOptions = over.viewOptions ?? DEFAULT_VIEW_OPTIONS;
  const props: SessionListProps = {
    ...baseProps(applyViewOrder(entries(), viewOptions)),
    filterMenuOpen: true,
    ...over,
    viewOptions,
  };
  return render(<SessionList {...props} />);
}

describe('Group by: Project (the default)', () => {
  it('draws the ordinary project tree — unchanged from before this feature', () => {
    const { container } = mount();
    expect(container.querySelectorAll('[data-project-heading]').length).toBe(2);
    expect(container.querySelectorAll('[data-status-heading]').length).toBe(0);
  });
});

describe('Group by: Status', () => {
  it('draws one heading per status bucket that actually has a session, no project headings', () => {
    const { container } = mount({
      viewOptions: { ...DEFAULT_VIEW_OPTIONS, groupBy: 'status' },
    });
    expect(container.querySelectorAll('[data-project-heading]').length).toBe(0);
    const headings = [...container.querySelectorAll('[data-status-heading]')].map((el) =>
      el.getAttribute('data-status-heading'),
    );
    // a1 waiting, b1 running, a2 done — three buckets, "sleeping" absent.
    expect(headings).toEqual(['needs-you', 'running', 'done']);
  });

  it('puts every session under its own bucket, mixing projects freely', () => {
    const { container } = mount({
      viewOptions: { ...DEFAULT_VIEW_OPTIONS, groupBy: 'status' },
    });
    const needsYou = container.querySelector('[data-status-rows="needs-you"]');
    expect(needsYou?.querySelector('[data-session-row="a1"]')).not.toBeNull();
    const running = container.querySelector('[data-status-rows="running"]');
    expect(running?.querySelector('[data-session-row="b1"]')).not.toBeNull();
    const done = container.querySelector('[data-status-rows="done"]');
    expect(done?.querySelector('[data-session-row="a2"]')).not.toBeNull();
  });

  it('still gives every row a real, working close/pick — the row itself is unchanged', () => {
    const onPick = vi.fn();
    const { container } = mount({
      viewOptions: { ...DEFAULT_VIEW_OPTIONS, groupBy: 'status' },
      onPick,
    });
    fireEvent.click(container.querySelector('[data-session-row="a1"]') as Element);
    expect(onPick).toHaveBeenCalledWith('a1');
  });
});

describe('Group by: None', () => {
  it('draws every row flat, no project or status heading at all', () => {
    const { container } = mount({ viewOptions: { ...DEFAULT_VIEW_OPTIONS, groupBy: 'none' } });
    expect(container.querySelectorAll('[data-project-heading]').length).toBe(0);
    expect(container.querySelectorAll('[data-status-heading]').length).toBe(0);
    const rows = container.querySelectorAll('[data-flat-rows] [data-session-row]');
    expect(rows.length).toBe(3);
  });
});

describe('Sort by: name', () => {
  it('reorders the rows within Group by: Project — the sidebar really changes', () => {
    const { container } = mount({ viewOptions: { groupBy: 'project', sortBy: 'name' } });
    const titles = [...container.querySelectorAll('[data-project-rows="p1"] [data-row-title]')].map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(['Apple', 'Zebra']);
  });
});

describe('Sort by: created (the shipped default)', () => {
  it('orders a project’s rows oldest-created first, ignoring status entirely', () => {
    const project = makeProject({ id: 'p1', name: 'alpha' }, []);
    const raw: SessionEntry[] = [
      {
        project,
        session: makeSession({
          id: 'a1',
          title: 'newer',
          status: 'waiting',
          createdAt: '2026-02-02T00:00:00.000Z',
        }),
      },
      {
        project,
        session: makeSession({
          id: 'a2',
          title: 'older',
          status: 'done',
          createdAt: '2026-02-01T00:00:00.000Z',
        }),
      },
    ];
    const { container } = render(
      <SessionList {...baseProps(applyViewOrder(raw, DEFAULT_VIEW_OPTIONS))} />,
    );
    const titles = [...container.querySelectorAll('[data-project-rows="p1"] [data-row-title]')].map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(['older', 'newer']);
  });
});

describe('the Group by control', () => {
  it('is a radiogroup with the three offered options checked correctly, PR disabled', () => {
    const { container } = mount();
    const group = container.querySelector('[data-group-by]');
    expect(group?.getAttribute('role')).toBe('radiogroup');
    const project = container.querySelector('[data-group-by-option="project"]');
    const status = container.querySelector('[data-group-by-option="status"]');
    const none = container.querySelector('[data-group-by-option="none"]');
    const pr = container.querySelector('[data-group-by-option="pr"]');
    expect(project?.getAttribute('role')).toBe('radio');
    expect(project?.getAttribute('aria-checked')).toBe('true');
    expect(status?.getAttribute('aria-checked')).toBe('false');
    expect(none?.getAttribute('aria-checked')).toBe('false');
    expect(pr).not.toBeNull();
    expect((pr as HTMLButtonElement).disabled).toBe(true);
  });

  it('writes the pref, keeping sortBy untouched, when the operator picks Status', () => {
    const onViewOptions = vi.fn();
    const { container } = mount({
      onViewOptions,
      viewOptions: { ...DEFAULT_VIEW_OPTIONS, sortBy: 'name' },
    });
    fireEvent.click(container.querySelector('[data-group-by-option="status"]') as Element);
    expect(onViewOptions).toHaveBeenCalledWith({ groupBy: 'status', sortBy: 'name' });
  });

  it('does nothing when the disabled PR pill is clicked', () => {
    const onViewOptions = vi.fn();
    const { container } = mount({ onViewOptions });
    fireEvent.click(container.querySelector('[data-group-by-option="pr"]') as Element);
    expect(onViewOptions).not.toHaveBeenCalled();
  });
});

describe('the Sort by drill-in', () => {
  it('opens a submenu with a back affordance and a radiogroup of the three options, the current one checked', () => {
    const { container } = mount({ viewOptions: { groupBy: 'project', sortBy: 'needs-you' } });
    fireEvent.click(container.querySelector('[data-sort-by-open]') as Element);
    const menu = container.querySelector('[data-sort-by-menu]');
    expect(menu).not.toBeNull();
    expect(container.querySelector('[data-popover-back]')).not.toBeNull();
    const group = container.querySelector('[data-sort-by-menu] [role="radiogroup"]');
    expect(group).not.toBeNull();
    const created = container.querySelector('[data-sort-by-option="created"]');
    const needsYou = container.querySelector('[data-sort-by-option="needs-you"]');
    const name = container.querySelector('[data-sort-by-option="name"]');
    expect(created).not.toBeNull();
    expect(needsYou?.getAttribute('aria-checked')).toBe('true');
    expect(created?.getAttribute('aria-checked')).toBe('false');
    expect(name?.getAttribute('aria-checked')).toBe('false');
  });

  it('shows Created checked at the shipped default', () => {
    const { container } = mount();
    fireEvent.click(container.querySelector('[data-sort-by-open]') as Element);
    expect(
      container.querySelector('[data-sort-by-option="created"]')?.getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('writes the pref, keeping groupBy untouched, and returns to the main view', () => {
    const onViewOptions = vi.fn();
    const { container } = mount({
      onViewOptions,
      viewOptions: { groupBy: 'status', sortBy: 'needs-you' },
    });
    fireEvent.click(container.querySelector('[data-sort-by-open]') as Element);
    fireEvent.click(container.querySelector('[data-sort-by-option="name"]') as Element);
    expect(onViewOptions).toHaveBeenCalledWith({ groupBy: 'status', sortBy: 'name' });
    // Back to the main options view — the drill-in closed itself.
    expect(container.querySelector('[data-sort-by-menu]')).toBeNull();
    expect(container.querySelector('[data-group-by]')).not.toBeNull();
  });

  it('Escape backs out of the submenu without closing the whole popover', () => {
    const onFilterMenuToggle = vi.fn();
    const { container } = mount({ onFilterMenuToggle });
    fireEvent.click(container.querySelector('[data-sort-by-open]') as Element);
    expect(container.querySelector('[data-sort-by-menu]')).not.toBeNull();
    fireEvent.keyDown(container.querySelector('[data-filter-menu]') as Element, { key: 'Escape' });
    expect(container.querySelector('[data-sort-by-menu]')).toBeNull();
    expect(onFilterMenuToggle).not.toHaveBeenCalled();
  });

  it('the back button returns to the main options view', () => {
    const { container } = mount();
    fireEvent.click(container.querySelector('[data-sort-by-open]') as Element);
    fireEvent.click(container.querySelector('[data-popover-back]') as Element);
    expect(container.querySelector('[data-sort-by-menu]')).toBeNull();
    expect(container.querySelector('[data-group-by]')).not.toBeNull();
  });

  it('ArrowDown/ArrowUp move focus between the two radio options', () => {
    const { container } = mount();
    fireEvent.click(container.querySelector('[data-sort-by-open]') as Element);
    const needsYou = container.querySelector('[data-sort-by-option="needs-you"]') as HTMLElement;
    const name = container.querySelector('[data-sort-by-option="name"]') as HTMLElement;
    needsYou.focus();
    fireEvent.keyDown(needsYou, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(name);
    fireEvent.keyDown(name, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(needsYou);
  });
});
