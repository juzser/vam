/**
 * The sidebar's test fixtures, in one place.
 *
 * They were local to `SessionList.test.tsx` until a second file needed a row
 * to look at. Shared rather than copied for the reason the props object below
 * already records: a component this wide grows props, and a duplicate literal
 * is a duplicate that goes stale silently -- `vitest` does not typecheck.
 */

import type { Decision, Project, Session, SourceId } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import type { SessionListProps } from '../../src/renderer/panels/SessionList.js';

export function decision(id: string, output: string | null): Decision {
  return { id, label: `label-${id}`, input: 'input', output, commands: [] };
}

export function makeSession(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    title: 'alpha-refactor',
    icon: null,
    epic: null,
    branch: 'work',
    status: 'running',
    runningAgents: 2,
    activity: 'Editing 3 files',
    age: '12m',
    decisions: Array.from({ length: 7 }, (_, i) => decision(`d${i}`, null)),
    ...over,
  };
}

export function makeProject(
  over: Partial<Project> = {},
  sessions: readonly Session[] = [],
): Project {
  return {
    id: 'p1',
    name: 'vam',
    source: 'black-smith' as SourceId,
    sessions,
    ...over,
  };
}

export function entriesOf(sessions: readonly Session[]): SessionEntry[] {
  const project = makeProject({}, sessions);
  return sessions.map((session) => ({ project, session }));
}

/** Two projects, so "grouped by project" has something to be wrong about. */
export function twoProjects(): SessionEntry[] {
  const alpha = makeProject({ id: 'p1', name: 'alpha' }, []);
  const beta = makeProject({ id: 'p2', name: 'beta' }, []);
  return [
    { project: alpha, session: makeSession({ id: 'a1', title: 'alpha one' }) },
    { project: alpha, session: makeSession({ id: 'a2', title: 'alpha two' }) },
    { project: beta, session: makeSession({ id: 'b1', title: 'beta one' }) },
  ];
}

export function noop() {}

/**
 * Every prop `SessionList` requires, with inert defaults.
 *
 * Exported as ONE object on purpose. Five call sites in this file each built
 * their own literal, so the eight props the filter popover added in #59 had to
 * be added in five places and were added in none — and `vitest` does not
 * typecheck, so the suite stayed green while `typecheck:test` in CI went red.
 * A new prop now breaks exactly one place, which is the point.
 */
export function baseProps(entries: readonly SessionEntry[]): SessionListProps {
  return {
    entries,
    focusedSessionId: null,
    pendingAction: null,
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
    onNewProject: noop,
    newSessionDecline: null,
    onPickIcon: noop,
    // Required, not optional -- see the props. A test that wants to observe a
    // removal overrides these; a test that does not still has to pass them,
    // which is the whole point of their being required.
    hiddenProjects: [],
    onHideProject: noop,
    onRemoveProject: noop,
    onSettings: noop,
    theme: 'dark',
    onToggleTheme: noop,
    width: 264,
    resizeHandle: null,
  };
}
