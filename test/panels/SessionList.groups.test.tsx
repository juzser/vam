// @vitest-environment happy-dom

/**
 * The group heading -- UI "project", one level above the code's `Project`
 * (see the vocabulary table in `domain/model.ts`).
 *
 * The property every test here defends is the one that makes the layer safe
 * to ship: WITH NO GROUPS THE SIDEBAR IS WHAT IT WAS. Every store in
 * existence has an empty bucket, so that is the path the operator is on until
 * they make one, and it must not cost them a pixel or a keystroke.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Group } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { SessionList } from '../../src/renderer/panels/SessionList.js';
import { baseProps, makeProject, makeSession, noop } from './session-list-props.js';

afterEach(cleanup);

const alpha = makeProject({ id: 'p1', name: 'alpha' }, []);
const beta = makeProject({ id: 'p2', name: 'beta' }, []);
const gamma = makeProject({ id: 'p3', name: 'gamma' }, []);

const GROUP: Group = { id: 'group:1', name: 'the-monorepo', icon: null, projects: [alpha, beta] };

/** alpha and beta inside the group, gamma at the top level. */
function grouped(): SessionEntry[] {
  return [
    { project: alpha, session: makeSession({ id: 'a1', title: 'alpha one' }), group: GROUP },
    { project: alpha, session: makeSession({ id: 'a2', title: 'alpha two' }), group: GROUP },
    { project: beta, session: makeSession({ id: 'b1', title: 'beta one' }), group: GROUP },
    { project: gamma, session: makeSession({ id: 'g1', title: 'gamma one' }), group: null },
  ];
}

function ungrouped(): SessionEntry[] {
  return grouped().map((entry) => ({ ...entry, group: null }));
}

describe('the sidebar with no groups', () => {
  it('draws no group heading at all', () => {
    const { container } = render(
      <SessionList {...baseProps(ungrouped())} groups={[]} collapsedGroups={[]} />,
    );
    expect(container.querySelectorAll('[data-group-heading]')).toHaveLength(0);
    // Every project heading is still exactly where it was.
    expect(
      [...container.querySelectorAll('[data-project-id]')].map((el) => el.textContent),
    ).toEqual(expect.arrayContaining([expect.stringContaining('alpha')]));
    expect(container.querySelectorAll('[data-project-heading]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-session-row]')).toHaveLength(4);
  });
});

describe('the group heading', () => {
  it('draws one heading per group, named, above its members', () => {
    const { container } = render(
      <SessionList {...baseProps(grouped())} groups={[GROUP]} collapsedGroups={[]} />,
    );
    const headings = container.querySelectorAll('[data-group-heading]');
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toContain('the-monorepo');
    // Reading order: the group, then its two members, then the ungrouped one.
    const order = [...container.querySelectorAll('[data-group-id], [data-project-id]')].map(
      (el) => el.getAttribute('data-group-id') ?? el.getAttribute('data-project-id'),
    );
    expect(order).toEqual(['group:1', 'p1', 'p2', 'p3']);
  });

  it('counts the sessions of every member, not of one', () => {
    const { container } = render(
      <SessionList {...baseProps(grouped())} groups={[GROUP]} collapsedGroups={[]} />,
    );
    expect(container.querySelector('[data-group-count="group:1"]')?.textContent).toBe('3');
  });

  it('draws the icon the operator picked', () => {
    const iconed: Group = { ...GROUP, icon: '🌿' };
    const { container } = render(
      <SessionList
        {...baseProps(grouped().map((e) => (e.group === null ? e : { ...e, group: iconed })))}
        groups={[iconed]}
        collapsedGroups={[]}
      />,
    );
    expect(container.querySelector('[data-group-icon="group:1"]')?.textContent).toBe('🌿');
  });

  it('draws a group nobody has put a project in yet', () => {
    const empty: Group = { id: 'group:2', name: 'nothing-yet', icon: null, projects: [] };
    const { container } = render(
      <SessionList {...baseProps(ungrouped())} groups={[empty]} collapsedGroups={[]} />,
    );
    expect(container.querySelector('[data-group-heading]')?.textContent).toContain('nothing-yet');
    expect(container.querySelector('[data-group-count="group:2"]')?.textContent).toBe('0');
  });

  it('folds its members away, and asks the caller to remember it', () => {
    const onToggleGroupCollapse = vi.fn();
    const { container, rerender } = render(
      <SessionList
        {...baseProps(grouped())}
        groups={[GROUP]}
        collapsedGroups={[]}
        onToggleGroupCollapse={onToggleGroupCollapse}
      />,
    );
    fireEvent.click(container.querySelector('[data-group-collapse="group:1"]') as Element);
    expect(onToggleGroupCollapse).toHaveBeenCalledWith(GROUP);

    rerender(
      <SessionList
        {...baseProps(grouped())}
        groups={[GROUP]}
        collapsedGroups={['group:1']}
        onToggleGroupCollapse={onToggleGroupCollapse}
      />,
    );
    // The members go; the ungrouped project stays, and so does the heading.
    expect(container.querySelectorAll('[data-group-heading]')).toHaveLength(1);
    expect(
      [...container.querySelectorAll('[data-project-id]')].map((el) =>
        el.getAttribute('data-project-id'),
      ),
    ).toEqual(['p3']);
    expect(container.querySelectorAll('[data-session-row]')).toHaveLength(1);
  });

  it('folds with no caller to remember it, so the control is never inert', () => {
    const { container } = render(<SessionList {...baseProps(grouped())} groups={[GROUP]} />);
    expect(container.querySelectorAll('[data-session-row]')).toHaveLength(4);
    fireEvent.click(container.querySelector('[data-group-collapse="group:1"]') as Element);
    expect(container.querySelectorAll('[data-session-row]')).toHaveLength(1);
  });

  it('indents a grouped project and leaves an ungrouped one where it was', () => {
    const { container } = render(
      <SessionList {...baseProps(grouped())} groups={[GROUP]} collapsedGroups={[]} />,
    );
    const li = (id: string) =>
      container.querySelector(`[data-project-id="${id}"]`)?.closest('li') as HTMLElement;
    expect(li('p1').getAttribute('data-in-group')).toBe('group:1');
    expect(li('p3').getAttribute('data-in-group')).toBe(null);
  });
});

describe('the group lifecycle', () => {
  it('offers "New project" to the left of the directory picker, which is untouched', () => {
    const { container } = render(<SessionList {...baseProps(ungrouped())} onCreateGroup={noop} />);
    const header = container.querySelector('[data-projects-header]') as HTMLElement;
    expect(header.querySelector('[data-new-group]')).toBeTruthy();
    // The one accessible name the directory picker has always answered to
    // stays with the directory picker; the new control qualifies its own.
    expect(header.querySelector('[data-new-project]')?.getAttribute('aria-label')).toBe(
      'new project',
    );
    expect(header.querySelector('[data-new-group]')?.getAttribute('aria-label')).not.toBe(
      'new project',
    );
    const controls = [...header.querySelectorAll('button')].map((el) =>
      el.hasAttribute('data-new-group')
        ? 'new-group'
        : el.hasAttribute('data-new-project')
          ? 'new-project'
          : 'other',
    );
    expect(controls.indexOf('new-group')).toBeLessThan(controls.indexOf('new-project'));
    expect(header.querySelector('[data-new-group]')?.getAttribute('title')).toBe('New project');
    // The only route to a repository vam has never seen keeps its own title.
    expect(header.querySelector('[data-new-project]')?.getAttribute('title')).toBe(
      'Choose a directory and start a session in it',
    );
  });

  it('draws no "New project" control for a caller with nowhere to store one', () => {
    const { container } = render(<SessionList {...baseProps(ungrouped())} />);
    expect(container.querySelector('[data-new-group]')).toBeNull();
  });

  it('creates a group from an inline row, not an overlay', () => {
    const onCreateGroup = vi.fn();
    const { container } = render(
      <SessionList {...baseProps(ungrouped())} onCreateGroup={onCreateGroup} />,
    );
    fireEvent.click(container.querySelector('[data-new-group]') as Element);
    const input = container.querySelector('[data-group-draft]') as HTMLInputElement;
    expect(input).toBeTruthy();
    // No overlay: naming a group discloses nothing, so it adds no click.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    fireEvent.change(input, { target: { value: 'the-monorepo' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCreateGroup).toHaveBeenCalledWith('the-monorepo');
    expect(container.querySelector('[data-group-draft]')).toBeNull();
  });

  it('creates nothing from an empty name, and nothing on Escape', () => {
    const onCreateGroup = vi.fn();
    const { container } = render(
      <SessionList {...baseProps(ungrouped())} onCreateGroup={onCreateGroup} />,
    );
    fireEvent.click(container.querySelector('[data-new-group]') as Element);
    fireEvent.keyDown(container.querySelector('[data-group-draft]') as Element, { key: 'Enter' });
    expect(onCreateGroup).not.toHaveBeenCalled();

    fireEvent.click(container.querySelector('[data-new-group]') as Element);
    const input = container.querySelector('[data-group-draft]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abandoned' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCreateGroup).not.toHaveBeenCalled();
    expect(container.querySelector('[data-group-draft]')).toBeNull();
  });

  it('renames a group in place, through the same editor', () => {
    const onRenameGroup = vi.fn();
    const { container } = render(
      <SessionList
        {...baseProps(grouped())}
        groups={[GROUP]}
        collapsedGroups={[]}
        onRenameGroup={onRenameGroup}
      />,
    );
    fireEvent.click(container.querySelector('[data-group-menu="group:1"]') as Element);
    fireEvent.click(container.querySelector('[data-group-menu-item="rename"]') as Element);
    const input = container.querySelector('[data-group-draft]') as HTMLInputElement;
    expect(input.value).toBe('the-monorepo');
    fireEvent.change(input, { target: { value: 'renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRenameGroup).toHaveBeenCalledWith(GROUP, 'renamed');
  });

  it('asks the caller for the icon picker, as the project heading does', () => {
    const onPickGroupIcon = vi.fn();
    const { container } = render(
      <SessionList
        {...baseProps(grouped())}
        groups={[GROUP]}
        collapsedGroups={[]}
        onPickGroupIcon={onPickGroupIcon}
      />,
    );
    fireEvent.click(container.querySelector('[data-group-menu="group:1"]') as Element);
    fireEvent.click(container.querySelector('[data-group-menu-item="icon"]') as Element);
    expect(onPickGroupIcon).toHaveBeenCalledWith(GROUP);
  });

  /**
   * The disclosure test. `ConfirmRemoveProject` exists "to make a disclosure,
   * not to add a click", and its disclosure is two session counts; ungrouping
   * has none, ends nothing, and its whole outcome is on screen the instant it
   * happens. So it is a plain item, and the red is left where the consequence
   * is -- on "Remove project", which is still exactly where it was.
   */
  it('ungroups with no confirm and no red', () => {
    const onUngroup = vi.fn();
    const { container } = render(
      <SessionList
        {...baseProps(grouped())}
        groups={[GROUP]}
        collapsedGroups={[]}
        onUngroup={onUngroup}
      />,
    );
    fireEvent.click(container.querySelector('[data-group-menu="group:1"]') as Element);
    const ungroup = container.querySelector('[data-group-menu-item="ungroup"]') as HTMLElement;
    expect(ungroup.className).not.toContain('danger');
    expect(ungroup.querySelector('svg')).toBeNull();
    fireEvent.click(ungroup);
    expect(onUngroup).toHaveBeenCalledWith(GROUP);
    expect(container.querySelector('[data-confirm-remove]')).toBeNull();

    // And the destructive one is untouched, still red, still on the project.
    fireEvent.click(container.querySelector('[data-project-menu="p1"]') as Element);
    const remove = container.querySelector('[data-project-menu-item="remove"]') as HTMLElement;
    expect(remove.className).toContain('text-danger');
  });
});
