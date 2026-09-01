// @vitest-environment happy-dom

/**
 * Direct tests for the sidebar's session card row: the three new placeholders
 * are em-dashes that name their own gap, the old status phrase and step count
 * are gone, and the pre-existing progress bar derivation is unchanged.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session, SourceId } from '../../src/domain/model.js';
import type { SessionEntry } from '../../src/domain/selectors.js';
import { SessionList, type SessionListProps } from '../../src/panels/SessionList.js';

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
