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
import { baseProps, makeProject, makeSession } from './session-list-props.js';

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
