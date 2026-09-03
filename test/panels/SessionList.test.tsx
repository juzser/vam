// @vitest-environment happy-dom

/**
 * Direct tests for the sidebar's session card row: the three new placeholders
 * are em-dashes that name their own gap, the old status phrase and step count
 * are gone, and the pre-existing progress bar derivation is unchanged.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session, SourceId } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { SessionList, type SessionListProps } from '../../src/renderer/panels/SessionList.js';

function decision(id: string, output: string | null): Decision {
  return { id, label: `label-${id}`, input: 'input', output, commands: [] };
}

function makeSession(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    title: 'alpha-refactor',
    icon: null,
    epic: null,
    status: 'running',
    runningAgents: 2,
    activity: 'Editing 3 files',
    age: '12m',
    decisions: Array.from({ length: 7 }, (_, i) => decision(`d${i}`, null)),
    ...over,
  };
}

function makeProject(over: Partial<Project> = {}, sessions: readonly Session[] = []): Project {
  return {
    id: 'p1',
    name: 'vam',
    source: 'black-smith' as SourceId,
    sessions,
    ...over,
  };
}

function entriesOf(sessions: readonly Session[]): SessionEntry[] {
  const project = makeProject({}, sessions);
  return sessions.map((session) => ({ project, session }));
}

/** Two projects, so "grouped by project" has something to be wrong about. */
function twoProjects(): SessionEntry[] {
  const alpha = makeProject({ id: 'p1', name: 'alpha' }, []);
  const beta = makeProject({ id: 'p2', name: 'beta' }, []);
  return [
    { project: alpha, session: makeSession({ id: 'a1', title: 'alpha one' }) },
    { project: alpha, session: makeSession({ id: 'a2', title: 'alpha two' }) },
    { project: beta, session: makeSession({ id: 'b1', title: 'beta one' }) },
  ];
}

function noop() {}

/**
 * Every prop `SessionList` requires, with inert defaults.
 *
 * Exported as ONE object on purpose. Five call sites in this file each built
 * their own literal, so the eight props the filter popover added in #59 had to
 * be added in five places and were added in none — and `vitest` does not
 * typecheck, so the suite stayed green while `typecheck:test` in CI went red.
 * A new prop now breaks exactly one place, which is the point.
 */
function baseProps(entries: readonly SessionEntry[]): SessionListProps {
  return {
    entries,
    focusedSessionId: null,
    workspace: 'vam',
    // The filter popover's props, added with it in #59. They live in the
    // shared helper rather than at each call site so that the next prop this
    // component grows is added in ONE place — which is what made these eight
    // go missing for a whole PR: `vitest` does not typecheck, so nothing here
    // went red while `typecheck:test` in CI did.
    statusFilter: 'all',
    onStatusFilter: noop,
    statusTally: { all: entries.length, running: 0, waiting: 0, done: 0, failed: 0 },
    filterMenuOpen: false,
    onFilterMenuToggle: noop,
    originFilters: { hideAgentStarted: false, onlyPrompted: false },
    onOriginFilters: noop,
    hiddenCounts: { agent: 0, unprompted: 0 },
    filter: '',
    filtering: false,
    onFilterChange: noop,
    onFilterCommit: noop,
    onFilterCancel: noop,
    onOpenFilter: noop,
    renamingId: null,
    renameDraft: '',
    onRenameChange: noop,
    onRenameCommit: noop,
    onRenameCancel: noop,
    onPick: noop,
    onClose: noop,
    onAdd: noop,
    onAddInProject: noop,
    onPickIcon: noop,
    onSettings: noop,
    theme: 'dark',
    onToggleTheme: noop,
    width: 264,
    resizeHandle: null,
  };
}

function mount(entries: readonly SessionEntry[]) {
  return render(<SessionList {...baseProps(entries)} />);
}

afterEach(() => {
  cleanup();
});

describe('SessionList placeholder row', () => {
  it('renders all three placeholders as an em-dash, never a number or a fabricated name', () => {
    const session = makeSession();
    const { container } = mount(entriesOf([session]));

    const worktree = container.querySelector('[data-placeholder="worktree"]');
    const verb = container.querySelector('[data-placeholder="step-verb"]');
    const duration = container.querySelector('[data-placeholder="step-duration"]');

    expect(worktree).not.toBeNull();
    expect(verb).not.toBeNull();
    expect(duration).not.toBeNull();

    expect(worktree?.textContent).toBe('—');
    expect(verb?.textContent).toBe('—');
    expect(duration?.textContent).toBe('—');
  });

  it('names the gap on each placeholder and gives the verb pill a status channel', () => {
    const running = makeSession({ id: 's1', status: 'running' });
    const waiting = makeSession({ id: 's2', status: 'waiting' });
    const { container } = mount(entriesOf([running, waiting]));

    const worktree = container.querySelector('[data-placeholder="worktree"]');
    const duration = container.querySelector('[data-placeholder="step-duration"]');
    const verb1 = container.querySelector('[data-session-row="s1"] [data-placeholder="step-verb"]');
    const verb2 = container.querySelector('[data-session-row="s2"] [data-placeholder="step-verb"]');

    expect(worktree).not.toBeNull();
    expect(duration).not.toBeNull();
    expect(verb1).not.toBeNull();
    expect(verb2).not.toBeNull();

    expect(worktree?.getAttribute('title')).toBe('black-smith reports no worktree per session');
    expect(duration?.getAttribute('title')).toBe('black-smith times a session rather than a step');

    const title1 = verb1?.getAttribute('title') ?? '';
    const title2 = verb2?.getAttribute('title') ?? '';
    expect(title1.length).toBeGreaterThan(0);
    expect(title2.length).toBeGreaterThan(0);
    expect(title1).toMatch(/event kind/);
    expect(title2).toMatch(/event kind/);
    expect(title1).toMatch(/\brunning\b/);
    expect(title2).toMatch(/\bwaiting\b/);
    expect(title1).not.toBe(title2);
  });

  it('leaves the progress bar derivation untouched — not the visible-ratio shortcut', () => {
    // 2 of 6 decisions have a non-null output: 2/6 (33%), never the
    // visible-ratio shortcut 3/6 (50%), since VISIBLE_DECISION_COUNT caps at 3.
    const partial = makeSession({
      id: 's1',
      decisions: [
        decision('a', 'out-a'),
        decision('b', 'out-b'),
        decision('c', null),
        decision('d', null),
        decision('e', null),
        decision('f', null),
      ],
    });
    const { container } = mount(entriesOf([partial]));
    const bar = container.querySelector('[data-session-row="s1"] span[style]');
    expect(bar).not.toBeNull();
    const width = (bar as HTMLElement).style.width;
    expect(width).toBe(`${Math.round((2 / 6) * 100)}%`);
    expect(width).not.toBe('50%');

    cleanup();
    const done = makeSession({ id: 's1', status: 'done', decisions: [decision('a', null)] });
    const { container: doneContainer } = mount(entriesOf([done]));
    const doneBar = doneContainer.querySelector('[data-session-row="s1"] span[style]');
    expect((doneBar as HTMLElement).style.width).toBe('100%');
  });

  /**
   * Mockup 1a's card is gone (operator request, sidebar-flat): the project
   * heading is a caption, not a container. A card's guarantee was
   * CONTAINMENT — each row physically inside its own project's box, checked
   * via `.closest('[data-project-group]')`. There is no such box any more, so
   * the property worth keeping is the one containment was a proxy for: each
   * project's rows are the RIGHT rows, in the RIGHT order, directly under the
   * RIGHT heading, with no card-shaped DOM to lean on.
   */
  it("lists each project's own rows, in order, directly under that project's heading — no group wrapper", () => {
    const { container } = mount(twoProjects());

    // No card left to find: the attribute that used to mark one is gone.
    expect(container.querySelectorAll('[data-project-group]')).toHaveLength(0);

    // Document order is the whole test: walk every heading and row as they
    // actually render, and the boundary between "alpha's rows" and "beta's
    // rows" must fall exactly at the second heading.
    const markers = [...container.querySelectorAll('[data-project-heading], [data-session-row]')];
    const shape = markers.map((el) =>
      el.hasAttribute('data-project-heading')
        ? `heading:${el.textContent?.match(/alpha|beta/)?.[0] ?? '?'}`
        : `row:${el.getAttribute('data-session-row')}`,
    );
    expect(shape).toEqual(['heading:alpha', 'row:a1', 'row:a2', 'heading:beta', 'row:b1']);
  });

  it('puts exactly one heading per project, and no heading doubles as a session row', () => {
    const { container } = mount(twoProjects());
    const headings = [...container.querySelectorAll('[data-project-heading]')];
    expect(headings).toHaveLength(2);
    for (const heading of headings) {
      expect(heading.hasAttribute('data-session-row')).toBe(false);
      expect(heading.tagName).toBe('DIV');
    }
  });

  it("renders each project's stored icon before its name in the heading, and a placeholder when there is none", () => {
    const alpha = makeProject({ id: 'p1', name: 'alpha', icon: '📦' }, []);
    const beta = makeProject({ id: 'p2', name: 'beta' }, []);
    const entries = [
      { project: alpha, session: makeSession({ id: 'a1' }) },
      { project: beta, session: makeSession({ id: 'b1' }) },
    ];
    const { container } = mount(entries);

    const alphaIcon = container.querySelector('[data-project-icon="p1"]');
    const betaIcon = container.querySelector('[data-project-icon="p2"]');
    expect(alphaIcon?.textContent).toBe('📦');
    expect(betaIcon?.textContent).toBe('·');

    // The icon sits before the name in the heading, not after.
    const heading = container.querySelector('[data-project-heading]');
    const icon = heading?.querySelector('[data-project-icon]');
    const name = screen.getAllByText('alpha')[0];
    expect(icon?.compareDocumentPosition(name as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('clicking a project icon reports which project it was for', () => {
    const seen: string[] = [];
    const entries = twoProjects();
    render(
      <SessionList
        {...({
          ...baseProps(entries),
          filter: '',
          filtering: false,
          onFilterChange: noop,
          onFilterCommit: noop,
          onFilterCancel: noop,
          onOpenFilter: noop,
          renamingId: null,
          renameDraft: '',
          onRenameChange: noop,
          onRenameCommit: noop,
          onRenameCancel: noop,
          onPick: noop,
          onClose: noop,
          onAdd: noop,
          onAddInProject: noop,
          onPickIcon: (project: Project) => seen.push(project.name),
          onSettings: noop,
          theme: 'dark',
          onToggleTheme: noop,
          width: 264,
          resizeHandle: null,
        } satisfies SessionListProps)}
      />,
    );
    document.querySelector<HTMLButtonElement>('[data-project-icon="p2"]')?.click();
    expect(seen).toEqual(['beta']);
  });

  /**
   * The mockup's title line ends at the title: status dot, icon chip, title at
   * `flex:1`. vam had a live-agent count pinned right of it with `ml-auto`,
   * standing in for a CC/CX badge that artboard 1a does not have either.
   */
  /**
   * The `+` in a project heading was an `aria-hidden` span: no pointer, no
   * hover, unclickable — while the full-width "New session" button below it,
   * which equally cannot create a session, is a real button that answers on
   * the status bar. Two controls that refuse for the same reason should refuse
   * the same way.
   */
  it('makes the per-project add a real button that names its own project', () => {
    const { container } = mount(twoProjects());
    const adds = container.querySelectorAll('[data-placeholder="new-session-in-project"]');
    expect(adds).toHaveLength(2);
    for (const add of adds) {
      expect(add.tagName).toBe('BUTTON');
      // Unclickable to assistive tech is what `aria-hidden` meant; it is a
      // control now, so it must be reachable and it must say which project.
      expect(add.getAttribute('aria-hidden')).toBeNull();
      expect(add.className).toContain('cursor-pointer');
      expect(add.className).toMatch(/hover:/);
    }
    expect(adds[0]?.getAttribute('aria-label')).toBe('new session in alpha');
    expect(adds[1]?.getAttribute('aria-label')).toBe('new session in beta');
  });

  it('reports which project the add was for', () => {
    const seen: string[] = [];
    const entries = twoProjects();
    render(
      <SessionList
        {...({
          ...baseProps(entries),
          filter: '',
          filtering: false,
          onFilterChange: noop,
          onFilterCommit: noop,
          onFilterCancel: noop,
          onOpenFilter: noop,
          renamingId: null,
          renameDraft: '',
          onRenameChange: noop,
          onRenameCommit: noop,
          onRenameCancel: noop,
          onPick: noop,
          onClose: noop,
          onAdd: noop,
          onAddInProject: (project: Project) => seen.push(project.name),
          onPickIcon: noop,
          onSettings: noop,
          theme: 'dark',
          onToggleTheme: noop,
          width: 264,
          resizeHandle: null,
        } satisfies SessionListProps)}
      />,
    );
    const adds = document.querySelectorAll<HTMLButtonElement>(
      '[data-placeholder="new-session-in-project"]',
    );
    adds[1]?.click();
    expect(seen).toEqual(['beta']);
  });

  it('puts nothing after the session title', () => {
    const { container } = mount(entriesOf([makeSession({ id: 's1', runningAgents: 2 })]));
    const row = container.querySelector('[data-session-row="s1"]');
    const title = screen.getByText('alpha-refactor');

    // The old tag rendered `●2` for a session with agents running.
    expect(row?.textContent).not.toContain('●');
    // Nothing at all sits between the title and the end of its line.
    const line = title.parentElement;
    expect(line?.lastElementChild).toBe(title);
  });

  it('drops the status phrase and the N-steps count, drawing the placeholder row inside the session card', () => {
    const session = makeSession({ id: 's1' });
    mount(entriesOf([session]));

    const title = screen.getByText('alpha-refactor'); // (A)
    const card = title.closest('[data-session-row="s1"]');
    expect(card).not.toBeNull(); // (B)
    expect(card?.querySelectorAll('[data-placeholder]')).toHaveLength(3); // (C)
    expect(card?.textContent).not.toMatch(/\b\d+\s+steps\b/); // (D)
    expect(card?.textContent).not.toContain('Editing 3 files'); // (E)
  });
});

describe('SessionList footer', () => {
  it('shows only the workspace avatar, not the workspace name, beside two 26x26 icon buttons', () => {
    mount(entriesOf([]));

    const settings = screen.getByLabelText('settings');
    const theme = screen.getByLabelText('switch to light theme');
    const footer = settings.closest('footer');
    expect(footer).not.toBeNull();

    // The mockup's footer has an avatar circle and two icon buttons, but no
    // workspace name text — that text moved out with this change.
    expect(footer?.textContent).not.toContain('vam');

    for (const button of [settings, theme]) {
      expect(button.className).toContain('h-[26px]');
      expect(button.className).toContain('w-[26px]');
    }
  });
});

/**
 * The close button belongs to its own row.
 *
 * `group-hover:` matches ANY ancestor carrying `group`, and `OverlayScroll`
 * wraps this whole list in one — so an unnamed `group` on the row meant
 * hovering anywhere in the sidebar revealed every row's close button at once.
 * The class was there precisely to stop that, and it was doing the opposite.
 *
 * happy-dom applies no stylesheet and simulates no `:hover`, so the visual
 * effect is not testable here. What IS testable, and is exactly the defect, is
 * the scope: the button must react to a NAMED group, and the row must declare
 * that name. An unnamed `group-hover:` on this button is the bug itself.
 */
describe('the close button reveals with its own row, not with the whole list', () => {
  it('uses a named group so a sibling row cannot reveal it', () => {
    const { container } = mount(twoProjects());
    const closers = [...container.querySelectorAll('[aria-label^="close "]')];
    expect(closers.length, 'no close buttons rendered — the test proves nothing').toBeGreaterThan(
      0,
    );
    for (const el of closers) {
      const cls = el.className;
      expect(cls, 'close button is hidden at rest').toContain('opacity-0');
      expect(cls, 'reveal must be scoped to the row').toContain('group-hover/row:opacity-100');
      // The unnamed form is the defect: it would also fire from OverlayScroll's
      // wrapper, which is an ancestor of every row.
      expect(cls).not.toMatch(/(^|\s)group-hover:opacity-100/);
    }
  });

  it('declares that named group on the row wrapper', () => {
    const { container } = mount(twoProjects());
    const closer = container.querySelector('[aria-label^="close "]');
    const row = closer?.parentElement;
    expect(row, 'close button has no wrapper').not.toBeNull();
    expect(row?.className).toContain('group/row');
  });
});
