// @vitest-environment happy-dom

/**
 * The sidebar as a TREE: three levels that have to look like three levels.
 *
 * The operator's report was that the column reads cluttered, and that its
 * levels read the same as each other. Both halves are measurable, and this
 * file measures them:
 *
 *  - the INDENT was not a ladder. A grouped project stepped 8px in from its
 *    group and its own rows stepped 6px in from it -- a tree whose steps get
 *    SMALLER with depth, which is why the levels did not read as nested. One
 *    named unit now, and each level at a whole multiple of it.
 *  - the TYPE was the same at two levels. A project heading shouted in
 *    letter-spaced upper case directly under a group heading doing the same,
 *    so the eye had nothing to sort them by.
 *
 * What these tests CANNOT see is the paint: happy-dom does no layout, so a
 * padding here is a declaration rather than a position. `e2e/sidebar-tree-
 * shots.mjs` measures the three left edges in a real browser; this file holds
 * the arithmetic that decides them.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Group, Project } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { SessionList, SIDEBAR_STEP } from '../../src/renderer/panels/SessionList.js';
import { baseProps, makeProject, makeSession } from './session-list-props.js';

afterEach(cleanup);

const alpha = makeProject({ id: 'p1', name: 'alpha' }, []);
const beta = makeProject({ id: 'p2', name: 'beta' }, []);
const gamma = makeProject({ id: 'p3', name: 'gamma' }, []);

const GROUP: Group = { id: 'group:1', name: 'the-monorepo', icon: null, projects: [alpha, beta] };
const OTHER: Group = { id: 'group:2', name: 'the-notes', icon: null, projects: [gamma] };

/** alpha in a group, gamma in a second one: two groups, so the rule that
 *  separates them has something to separate. */
function twoGroups(): SessionEntry[] {
  return [
    { project: alpha, session: makeSession({ id: 'a1', title: 'alpha one' }), group: GROUP },
    { project: gamma, session: makeSession({ id: 'g1', title: 'gamma one' }), group: OTHER },
  ];
}

/** One grouped project and one that belongs to no group. */
function mixed(): SessionEntry[] {
  return [
    { project: alpha, session: makeSession({ id: 'a1', title: 'alpha one' }), group: GROUP },
    { project: gamma, session: makeSession({ id: 'g1', title: 'gamma one' }), group: null },
  ];
}

function mount(entries: SessionEntry[], groups: Group[]) {
  return render(<SessionList {...baseProps(entries)} groups={groups} collapsedGroups={[]} />);
}

/** The px a box is indented by, as a number -- 0 for one that declares none. */
function indentOf(el: Element | null | undefined): number {
  expect(el, 'no element to measure').not.toBeNull();
  return Number.parseFloat((el as HTMLElement).style.paddingLeft || '0');
}

describe('the sidebar indents by one unit per level', () => {
  it('steps a grouped project in by exactly one unit, and its rows by one more', () => {
    const { container } = mount(twoGroups(), [GROUP, OTHER]);
    // The group heading is the datum: it sits at the list's own edge, because
    // there is no level above it to be indented from.
    const heading = container.querySelector('[data-group-heading]')?.closest('li');
    expect(indentOf(heading)).toBe(0);

    const project = container.querySelector('[data-project-heading][data-project-id="p1"]');
    const li = project?.closest('li');
    expect(indentOf(li)).toBe(SIDEBAR_STEP);

    // The rows' own container, which is where the indent lives -- never on the
    // rows themselves, or a row that missed it would sit a few pixels out of
    // line with its neighbours' hover and focus backgrounds.
    const rows = container.querySelector('[data-project-rows="p1"]');
    expect(indentOf(rows)).toBe(SIDEBAR_STEP);

    // The ladder, stated as the thing that was actually wrong: the second step
    // must not be smaller than the first. It was 8 then 6.
    const first = indentOf(li) - indentOf(heading);
    const second = indentOf(rows);
    expect(second).toBe(first);
    expect(first).toBeGreaterThan(0);
  });

  it('leaves a project that belongs to no group at the top level', () => {
    const { container } = mount(mixed(), [GROUP]);
    const lone = container
      .querySelector('[data-project-heading][data-project-id="p3"]')
      ?.closest('li');
    // Depth is what a level IS. A project with no group above it has nothing
    // to be indented from, and indenting it anyway would spend width on a
    // hierarchy that is not on screen.
    expect(indentOf(lone)).toBe(0);
    // Its rows still step in from it, so a session is always one unit inside
    // the project that owns it whatever depth that project sits at.
    expect(indentOf(container.querySelector('[data-project-rows="p3"]'))).toBe(SIDEBAR_STEP);
  });

  it('keeps the unit big enough to see and small enough for a 200px column', () => {
    // The sidebar's minimum is 200px and the rows carry 10px of their own
    // padding inside that. A unit under 6px is not a step anybody reads; one
    // over 16px spends a quarter of the narrowest legal column on whitespace.
    expect(SIDEBAR_STEP).toBeGreaterThanOrEqual(6);
    expect(SIDEBAR_STEP).toBeLessThanOrEqual(16);
  });
});

describe('the three levels read as three levels', () => {
  it('stops the project heading shouting, and leaves the group heading to it', () => {
    const { container } = mount(twoGroups(), [GROUP, OTHER]);
    const nameIn = (root: Element | null, name: string) =>
      [...(root?.querySelectorAll('span') ?? [])].find((span) => span.textContent === name);

    const project = nameIn(container.querySelector('[data-project-heading]'), 'alpha');
    expect(project, 'no project name span').not.toBeUndefined();
    // Upper case plus letter-spacing is a heading's loudest register. Spent on
    // BOTH captions it stopped being a distinction and became the reason the
    // operator called the column samey.
    expect(project?.className).not.toContain('uppercase');
    expect(project?.className).not.toContain('tracking-');

    // The group keeps it, and that is what makes it the level above.
    const group = nameIn(container.querySelector('[data-group-heading]'), 'the-monorepo');
    expect(group?.className).toContain('uppercase');
    expect(group?.className).toContain('tracking-');
  });

  it('draws a rule above a group, but not above the first thing in the list', () => {
    const { container } = mount(twoGroups(), [GROUP, OTHER]);
    const headings = [...container.querySelectorAll('[data-group-heading]')];
    expect(headings).toHaveLength(2);

    const first = headings[0]?.closest('li');
    const second = headings[1]?.closest('li');
    // A rule at the very top of the list would sit a few pixels under the
    // border the search chrome already draws, and read as a double line.
    expect(first?.className).not.toContain('border-t');
    expect(second?.className).toContain('border-t');
    // Space with it, or the rule is a line drawn through the heading's chin.
    expect(second?.className).toMatch(/\bpt-/);
  });
});

describe('the session row after the tidy-up', () => {
  it('draws the status mark instead of the old dot', () => {
    const entries = [
      {
        project: alpha,
        session: makeSession({ id: 'a1', status: 'running' as const }),
        group: null,
      },
      { project: alpha, session: makeSession({ id: 'a2', status: 'done' as const }), group: null },
    ];
    const { container } = mount(entries, []);
    expect(
      container.querySelector('[data-session-row="a1"] [data-status-mark="running"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-session-row="a2"] [data-status-mark="done"]'),
    ).not.toBeNull();
    // The dot that was every status's whole appearance: gone from the row
    // except where `idle` still draws one inside the mark's own lane.
    const dots = container.querySelectorAll('[data-session-row] .rounded-full');
    expect(dots).toHaveLength(0);
  });

  it('drops the branch glyph and the dash where there is no branch, keeping the sentence', () => {
    const { container } = mount(
      [{ project: alpha, session: makeSession({ id: 'a1', branch: null }), group: null }],
      [],
    );
    const row = container.querySelector('[data-session-row="a1"]');
    const branch = row?.querySelector('[data-session-branch]');
    expect(branch, 'no branch cell').not.toBeNull();
    // An em-dash beside a branch glyph is a row reporting that it has nothing
    // to report. The meta line is quieter without it, and nothing is lost --
    // there was no name to print either way.
    expect(branch?.textContent).not.toContain('—');
    expect(row?.querySelector('.lucide-git-branch')).toBeNull();
    // The sentence is still in the row's accessible name, which is the only
    // place it ever existed for a keyboard or a screen reader.
    expect(row?.textContent).toContain('cannot say which branch');
  });

  it('keeps the glyph and the name where there IS a branch', () => {
    const { container } = mount(
      [{ project: alpha, session: makeSession({ id: 'a1', branch: 'work' }), group: null }],
      [],
    );
    const row = container.querySelector('[data-session-row="a1"]');
    expect(row?.querySelector('.lucide-git-branch')).not.toBeNull();
    expect(row?.querySelector('[data-session-branch]')?.textContent).toBe('work');
  });
});

describe('the per-project add moved into the menu', () => {
  it('leaves no + on the heading at all', () => {
    const { container } = mount(mixed(), [GROUP]);
    // One icon less per heading was the whole point: the heading now carries
    // the fold and the menu, and nothing else the pointer can hit.
    expect(container.querySelectorAll('[data-new-session-in-project]')).toHaveLength(0);
  });

  it('offers it as the first item of the project menu, so the menu opens on it', () => {
    const seen: Project[] = [];
    const { container } = render(
      <SessionList
        {...baseProps(mixed())}
        groups={[GROUP]}
        collapsedGroups={[]}
        onAddInProject={(project) => seen.push(project)}
      />,
    );
    act(() => {
      (container.querySelector('[data-project-menu="p1"]') as HTMLElement).click();
    });
    const items = [
      ...container.querySelectorAll('[data-project-menu-panel="p1"] [role="menuitem"]'),
    ];
    expect(items.map((item) => item.getAttribute('data-project-menu-item'))[0]).toBe('new-session');
    // The menu focuses its first item, so `...` then Enter is the whole
    // gesture -- which is what pays for the click the move costs.
    expect(document.activeElement).toBe(items[0]);

    act(() => {
      (items[0] as HTMLElement).click();
    });
    expect(seen.map((project) => project.id)).toEqual(['p1']);
    // It closes behind itself, like every other item in this menu.
    expect(container.querySelector('[data-project-menu-panel]')).toBeNull();
  });

  it('creates in the project whose menu it was opened from', () => {
    const seen: Project[] = [];
    const { container } = render(
      <SessionList
        {...baseProps(mixed())}
        groups={[GROUP]}
        collapsedGroups={[]}
        onAddInProject={(project) => seen.push(project)}
      />,
    );
    act(() => {
      (container.querySelector('[data-project-menu="p3"]') as HTMLElement).click();
    });
    act(() => {
      (container.querySelector('[data-project-menu-item="new-session"]') as HTMLElement).click();
    });
    expect(seen.map((project) => project.id)).toEqual(['p3']);
  });

  it('still says the refusal when the source cannot create', () => {
    const { container } = render(
      <SessionList
        {...baseProps(mixed())}
        groups={[GROUP]}
        collapsedGroups={[]}
        newSessionDecline="factory has no new-session command"
      />,
    );
    act(() => {
      (container.querySelector('[data-project-menu="p1"]') as HTMLElement).click();
    });
    const item = container.querySelector('[data-project-menu-item="new-session"]');
    // The item is still THERE and still clickable -- refusing on click and
    // saying why is honest, refusing by being unclickable reads as broken.
    // The refusal is VISIBLE text, not a `title` and no longer a tooltip: a
    // menu item has room for a sentence where an icon button had none, which
    // is the one thing this move buys back for the click it costs.
    expect(item?.getAttribute('title')).toBeNull();
    expect(item?.textContent).toContain('factory has no new-session command');
  });
});
