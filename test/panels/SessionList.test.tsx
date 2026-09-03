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

function mount(entries: readonly SessionEntry[]) {
  const props: SessionListProps = {
    entries,
    focusedSessionId: null,
    workspace: 'vam',
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
    onSettings: noop,
    theme: 'dark',
    onToggleTheme: noop,
    width: 264,
    resizeHandle: null,
  };
  return render(<SessionList {...props} />);
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
   * Mockup 1a groups sessions into a CARD per project, not a flat list under a
   * caption. The distinction is not cosmetic: a caption is something you have
   * to read to know where a row belongs, and a card makes it structural. So
   * the assertion is CONTAINMENT — each row inside its own project's card —
   * rather than a class list, which a flat list could satisfy while still
   * being flat.
   */
  it("nests each project's rows inside that project's own group card", () => {
    const { container } = mount(twoProjects());

    const groups = container.querySelectorAll('[data-project-group]');
    expect(groups).toHaveLength(2);

    const alpha = container.querySelector('[data-project-group="p1"]');
    const beta = container.querySelector('[data-project-group="p2"]');
    expect(alpha?.querySelectorAll('[data-session-row]')).toHaveLength(2);
    expect(beta?.querySelectorAll('[data-session-row]')).toHaveLength(1);
    // And not merely "two rows somewhere" — the RIGHT rows.
    expect(alpha?.querySelector('[data-session-row="b1"]')).toBeNull();
    expect(beta?.querySelector('[data-session-row="b1"]')).not.toBeNull();
  });

  it('puts every heading inside a group card, and exactly one per card', () => {
    const { container } = mount(twoProjects());
    const headings = [...container.querySelectorAll('[data-project-heading]')];
    const groups = [...container.querySelectorAll('[data-project-group]')];

    // Assert the corpus BEFORE looping over it. The first draft of this test
    // only iterated the groups and counted headings, so against the old flat
    // list it looped over zero elements and still counted two headings — it
    // passed on exactly the code it was written to reject. A sweep has to
    // prove it found something to sweep.
    expect(groups.length).toBe(2);
    expect(headings.length).toBe(2);

    // The load-bearing claim: no heading is loose in the list.
    expect(headings.every((h) => h.closest('[data-project-group]') !== null)).toBe(true);
    for (const group of groups) {
      expect(group.querySelectorAll('[data-project-heading]')).toHaveLength(1);
    }
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
          entries,
          focusedSessionId: null,
          workspace: 'vam',
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
