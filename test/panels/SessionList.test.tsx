// @vitest-environment happy-dom

/**
 * Direct tests for the sidebar's session card row.
 *
 * The row is deliberately quiet: under the title there is a branch and a time,
 * and nothing else. The step-verb pill and the progress bar were both removed
 * at the operator's request -- both were placeholders drawing a status channel
 * over data no source supplies, and a row at rest should be a name, not a
 * dashboard. What remains must still name its own gaps rather than invent
 * values, which is what these tests hold.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session, SourceId } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import {
  DEFAULT_SESSION_FILTERS,
  type SessionFilters,
} from '../../src/renderer/domain/session-filter.js';
import {
  FILTER_POPOVER_WIDTH,
  SessionList,
  type SessionListProps,
} from '../../src/renderer/panels/SessionList.js';
import { SIDEBAR_MIN } from '../../src/renderer/prefs/panes.js';

function decision(id: string, output: string | null): Decision {
  return { id, label: `label-${id}`, input: 'input', output, commands: [] };
}

function makeSession(over: Partial<Session> = {}): Session {
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

/** Same defaults, with a few props overridden -- focus, mostly. */
function mountWith(entries: readonly SessionEntry[], over: Partial<SessionListProps>) {
  return render(<SessionList {...baseProps(entries)} {...over} />);
}

function addButtons(root: ParentNode) {
  return [...root.querySelectorAll('[data-new-session-in-project]')];
}

afterEach(() => {
  cleanup();
});

describe('SessionList placeholder row', () => {
  it('draws a branch and a time under the title, and nothing else', () => {
    const session = makeSession();
    const { container } = mount(entriesOf([session]));

    // The branch is real now where a source knows one; this fixture supplies
    // it, so the row shows a name rather than the gap it used to show always.
    const branch = container.querySelector('[data-session-branch]');
    expect(branch?.textContent).toBe('work');

    // The time is real, not a placeholder. `age` is what the source measured.
    const age = container.querySelector('[data-session-age]');
    expect(age?.textContent).toBe('12m');

    // The two the operator asked to be rid of.
    expect(container.querySelector('[data-placeholder="step-verb"]')).toBeNull();
    expect(container.querySelector('[data-session-progress]')).toBeNull();
  });

  it('shows the real branch when the source knows one, with the full name on hover', () => {
    // The visible text truncates -- branch names here run to
    // `smith/specs/vam-seam-plan` -- so the tooltip has to carry the whole
    // thing or the row shows a prefix with no way to read the rest.
    const { container } = mount(entriesOf([makeSession({ branch: 'smith/specs/vam-seam-plan' })]));
    const branch = container.querySelector('[data-session-branch]');
    expect(branch?.textContent).toBe('smith/specs/vam-seam-plan');
    expect(branch?.getAttribute('title')).toContain('smith/specs/vam-seam-plan');
  });

  it('never truncates away the end of a branch name, which is what identifies it', () => {
    // Measured: at the 200px sidebar minimum roughly 23 characters fit, so
    // plain `truncate` renders BOTH `smith/specs/vam-seam-plan` and
    // `smith/specs/vam-canvas-topology` as `smith/specs/vam-...` — identical,
    // and cut at exactly the point that would have told them apart. The
    // leading segments are the shrinkable part; the last one is the name.
    const { container } = mount(
      entriesOf([
        makeSession({ id: 's1', branch: 'smith/specs/vam-seam-plan' }),
        makeSession({ id: 's2', branch: 'smith/specs/vam-canvas-topology' }),
      ]),
    );

    for (const [id, head, tail] of [
      ['s1', 'smith/specs/', 'vam-seam-plan'],
      ['s2', 'smith/specs/', 'vam-canvas-topology'],
    ] as const) {
      const row = container.querySelector(`[data-session-row="${id}"]`);
      // The head may be clipped; the tail must not be, so they are separate
      // elements and only the head carries the truncating class.
      expect(row?.querySelector('[data-branch-head]')?.textContent).toBe(head);
      expect(row?.querySelector('[data-branch-tail]')?.textContent).toBe(tail);
      expect(row?.querySelector('[data-branch-tail]')?.className).not.toContain('truncate');
    }

    // Still one readable whole for anything reading text, and still the full
    // name on hover.
    const branch = container.querySelector('[data-session-row="s1"] [data-session-branch]');
    expect(branch?.textContent).toBe('smith/specs/vam-seam-plan');
    expect(branch?.getAttribute('title')).toBe('smith/specs/vam-seam-plan');
  });

  it('handles a branch with no slash, and one that is all slash', () => {
    const { container } = mount(
      entriesOf([
        makeSession({ id: 's1', branch: 'main' }),
        makeSession({ id: 's2', branch: 'a/' }),
      ]),
    );
    // No slash: nothing to shrink, the whole name is the tail.
    expect(container.querySelector('[data-session-row="s1"] [data-branch-head]')?.textContent).toBe(
      '',
    );
    expect(container.querySelector('[data-session-row="s1"] [data-branch-tail]')?.textContent).toBe(
      'main',
    );
    // Trailing slash: an empty tail is still not a crash, and the text is whole.
    expect(
      container.querySelector('[data-session-row="s2"] [data-session-branch]')?.textContent,
    ).toBe('a/');
  });

  it('shows an em-dash for the branch when the source cannot say, and names the gap', () => {
    const { container } = mount(entriesOf([makeSession({ branch: null })]));
    const branch = container.querySelector('[data-session-branch]');
    expect(branch?.textContent).toBe('—');
    // Not the old claim, which named black-smith on every row including a
    // Claude Code one that simply had no transcript yet.
    expect(branch?.getAttribute('title')).toContain('cannot say');
  });

  it('shows an em-dash for the time when the source cannot say, never a zero', () => {
    // A source with no timestamp must stay distinguishable from one that just
    // reported activity a moment ago; `0m` would read as the second.
    const { container } = mount(entriesOf([makeSession({ age: null })]));
    const age = container.querySelector('[data-session-age]');
    expect(age?.textContent).toBe('—');
    expect(age?.getAttribute('title')).toContain('cannot say');
  });

  it('names the gap on the branch placeholder, and draws no verb pill for any status', () => {
    const running = makeSession({ id: 's1', status: 'running' });
    const waiting = makeSession({ id: 's2', status: 'waiting' });
    const { container } = mount(entriesOf([running, waiting]));

    const branch = container.querySelector('[data-session-branch]');
    expect(branch).not.toBeNull();

    // The pill carried a per-status border colour, so a status-sensitive check:
    // neither of the two statuses may bring it back.
    expect(container.querySelectorAll('[data-placeholder="step-verb"]').length).toBe(0);
    expect(container.querySelectorAll('[data-session-progress]').length).toBe(0);
  });

  it('draws no progress bar for any completion ratio, including a done session', () => {
    // This replaces a test that pinned the bar's derivation (2 of 6 outputs ->
    // 33%, never the visible-ratio 50%). The derivation is not wrong; the bar
    // is simply gone from this row, and a test asserting a width would now be
    // asserting something no longer on screen. What is worth keeping is that
    // no ratio -- not even the one that used to fill the bar completely --
    // brings it back.
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
    expect(container.querySelector('[data-session-row="s1"] span[style]')).toBeNull();

    cleanup();
    const done = makeSession({ id: 's1', status: 'done', decisions: [decision('a', null)] });
    const { container: doneContainer } = mount(entriesOf([done]));
    expect(doneContainer.querySelector('[data-session-row="s1"] span[style]')).toBeNull();
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
    // The placeholder is a glyph, so `textContent` is empty — and an empty
    // string would equally describe an icon slot that rendered NOTHING. Assert
    // the glyph itself, or this passes for the bug it is meant to catch.
    expect(betaIcon?.textContent).toBe('');
    expect(betaIcon?.querySelector('[data-project-icon-placeholder]')).not.toBeNull();
    // And a project that HAS an icon must not also carry the placeholder.
    expect(alphaIcon?.querySelector('[data-project-icon-placeholder]')).toBeNull();

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
    // The button only exists for the project holding focus, so this walks the
    // two projects one focused session at a time rather than expecting both
    // buttons at once.
    for (const [sessionId, name] of [
      ['a1', 'alpha'],
      ['b1', 'beta'],
    ] as const) {
      const { container } = mountWith(twoProjects(), { focusedSessionId: sessionId });
      const adds = addButtons(container);
      expect(adds).toHaveLength(1);
      const add = adds[0];
      expect(add?.tagName).toBe('BUTTON');
      // Unclickable to assistive tech is what `aria-hidden` meant; it is a
      // control now, so it must be reachable and it must say which project.
      expect(add?.getAttribute('aria-hidden')).toBeNull();
      expect(add?.className).toContain('cursor-pointer');
      expect(add?.className).toMatch(/hover:/);
      expect(add?.getAttribute('aria-label')).toBe(`new session in ${name}`);
      cleanup();
    }
  });

  it('reports which project the add was for', () => {
    const seen: string[] = [];
    const entries = twoProjects();
    render(
      <SessionList
        {...({
          ...baseProps(entries),
          // Beta holds focus, so beta is the only project showing an add.
          focusedSessionId: 'b1',
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
          onNewProject: noop,
          newSessionDecline: null,
          onPickIcon: noop,
          onSettings: noop,
          theme: 'dark',
          onToggleTheme: noop,
          width: 264,
          resizeHandle: null,
        } satisfies SessionListProps)}
      />,
    );
    const adds = document.querySelectorAll<HTMLButtonElement>('[data-new-session-in-project]');
    adds[0]?.click();
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
    // No placeholders at all now. `step-verb` and `step-duration` are gone,
    // and the two that remain -- branch and time -- carry real values from the
    // source, falling back to a gap that names itself rather than to a
    // hardcoded dash that named the wrong source.
    expect(card?.querySelectorAll('[data-placeholder]')).toHaveLength(0); // (C)
    expect(card?.textContent).not.toMatch(/\b\d+\s+steps\b/); // (D)
    expect(card?.textContent).not.toContain('Editing 3 files'); // (E)
  });
});

describe('SessionList avatar bar', () => {
  it('puts the avatar and its two icon buttons at the TOP, above the search box', () => {
    // The bar moved out of the footer and took the place of the workspace
    // header, which is gone entirely at the operator's request. Asserted by
    // DOM order against the search box rather than by a class name, because
    // "above" is the whole of what was asked for.
    const { container } = mount(entriesOf([]));

    const bar = container.querySelector('[data-avatar-bar]');
    expect(bar).not.toBeNull();
    // At rest the search control is a button, not an input — `/` swaps it.
    const search = screen.getByLabelText('search sessions');
    const position = (bar as Element).compareDocumentPosition(search);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // No footer left to hold it, and no workspace line above it.
    expect(container.querySelector('footer')).toBeNull();
    expect(container.textContent).not.toContain('workspace');
  });

  it('keeps the avatar and both icon buttons, at their mockup size', () => {
    mount(entriesOf([]));

    const settings = screen.getByLabelText('settings');
    const theme = screen.getByLabelText('switch to light theme');
    const bar = settings.closest('[data-avatar-bar]');
    expect(bar).not.toBeNull();
    expect(theme.closest('[data-avatar-bar]')).toBe(bar);

    // The avatar survives as a glyph; the workspace NAME does not come back.
    expect(bar?.textContent).toContain('V');
    expect(bar?.textContent).not.toContain('vam');

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

/**
 * The per-project "new session" button is quiet at rest.
 *
 * It sits once per project heading, so at four projects it was four outlined
 * boxes competing with the session names underneath them — the list read as a
 * row of controls rather than a list of sessions. The border arrives on hover,
 * where it is the thing you are about to press.
 *
 * The box keeps its size in both states: a border that appears from nothing
 * would shift the heading by a pixel on every hover.
 */
describe('the new-session button is dim until hovered', () => {
  it('has no visible border at rest and gains one on hover', () => {
    const { container } = mountWith(twoProjects(), { focusedSessionId: 'a1' });
    const buttons = [...container.querySelectorAll('[aria-label^="new session in "]')];
    expect(buttons.length, 'no new-session buttons rendered').toBeGreaterThan(0);
    for (const el of buttons) {
      expect(el.className, 'transparent at rest').toContain('border-transparent');
      expect(el.className, 'a border on hover').toContain('hover:border-line-strong');
      // Still bordered-box sized, so hover does not move the heading.
      expect(el.className).toMatch(/(^|\s)border(\s|$)/);
    }
  });
});

/**
 * The per-project add follows focus.
 *
 * Four projects meant four `+` boxes standing over the session names at all
 * times, for a control you can only mean for the project you are working in.
 * It now renders for exactly the project whose session is focused, and is
 * absent -- not merely invisible -- everywhere else, so nothing off-screen can
 * be clicked or tabbed into.
 */
describe('the per-project add appears only for the focused project', () => {
  it('shows no add at all while nothing is focused', () => {
    const { container } = mountWith(twoProjects(), { focusedSessionId: null });
    expect(addButtons(container)).toHaveLength(0);
  });

  it("shows exactly one add, on the focused session's own project", () => {
    const { container } = mountWith(twoProjects(), { focusedSessionId: 'a2' });
    const adds = addButtons(container);
    expect(adds).toHaveLength(1);
    expect(adds[0]?.getAttribute('aria-label')).toBe('new session in alpha');
    // And it is inside alpha's heading, not merely somewhere in the list.
    expect(adds[0]?.closest('[data-project-heading]')?.textContent).toContain('alpha');
  });

  it('moves the add when focus moves to a session in another project', () => {
    const { container, rerender } = mountWith(twoProjects(), { focusedSessionId: 'a1' });
    expect(addButtons(container)[0]?.getAttribute('aria-label')).toBe('new session in alpha');

    rerender(<SessionList {...baseProps(twoProjects())} focusedSessionId="b1" />);
    const adds = addButtons(container);
    expect(adds).toHaveLength(1);
    expect(adds[0]?.getAttribute('aria-label')).toBe('new session in beta');
  });

  /**
   * happy-dom does no layout, so "the sidebar must not twitch" is checked the
   * only way it can be: the heading reserves the button's height itself, and
   * everything left of the `flex-1` spacer renders identically either way.
   */
  it('keeps the heading the same height and shape whether or not the add is there', () => {
    const shapes: string[][] = [];
    const heights: (string | undefined)[] = [];

    for (const focused of [null, 'a1'] as const) {
      const { container } = mountWith(twoProjects(), { focusedSessionId: focused });
      const heading = container.querySelector('[data-project-heading]');
      expect(heading, 'no project heading').not.toBeNull();
      heights.push(heading?.className.match(/min-h-\[[^\]]+\]/)?.[0]);
      // Everything up to and including the spacer -- the part the button must
      // not be able to push around.
      const before: string[] = [];
      for (const child of [...(heading?.children ?? [])]) {
        if (child.className.includes('flex-1')) {
          before.push('spacer');
          break;
        }
        before.push(child.textContent ?? '');
      }
      shapes.push(before);
      cleanup();
    }

    expect(shapes[0]).toEqual(shapes[1]);
    // A reserved height, identical in both states -- otherwise the heading is
    // as tall as its tallest child and shrinks the moment the add leaves.
    expect(heights[0], 'heading reserves no height').toBeDefined();
    expect(heights[0]).toBe(heights[1]);
  });
});

/**
 * happy-dom does no layout: it computes no boxes and resolves no Tailwind
 * class into a pixel. So none of these assertions claim a measured offset.
 * What they hold is the STRUCTURAL contract the indent is made of -- the
 * mapped rows live inside one padded container per project, and the heading
 * stays outside it -- which is the part that can silently regress. The actual
 * few-pixel shift is a visual judgement, made once, in the class itself.
 */
describe('the session rows are indented under their project heading', () => {
  it('wraps each project rows in one padded container the heading is outside of', () => {
    const { container } = mount(twoProjects());

    const wrappers = [...container.querySelectorAll('[data-project-rows]')];
    // One per project, not one per row: the indent belongs to the group, so
    // every row keeps its own padding contract and the focused-row
    // background cannot drift out of line with its neighbours.
    expect(wrappers).toHaveLength(2);

    for (const wrapper of wrappers) {
      // A left inset of some kind -- the value is a visual call, the
      // existence of it is the contract.
      expect(wrapper.className).toMatch(/(^|\s)(pl|ps|ml)-/);
      expect(wrapper.querySelector('[data-project-heading]')).toBeNull();
    }

    for (const heading of container.querySelectorAll('[data-project-heading]')) {
      expect(heading.closest('[data-project-rows]')).toBeNull();
    }

    // Every row is inside its OWN project's wrapper, so the indent cannot be
    // there for some rows and missing for others.
    const rows = [...container.querySelectorAll('[data-session-row]')];
    expect(rows).toHaveLength(3);
    expect(
      rows.map((row) => wrappers.indexOf(row.closest('[data-project-rows]') as Element)),
    ).toEqual([0, 0, 1]);
  });

  it('indents the inline rename editor with the rows, not with the heading', () => {
    const { container } = mountWith(twoProjects(), { renamingId: 'a1', renameDraft: 'alpha one' });
    const input = screen.getByLabelText('rename session');
    expect(input.closest('[data-project-rows]')).not.toBeNull();
    // And it replaced a row rather than appearing beside one.
    expect(container.querySelector('[data-session-row="a1"]')).toBeNull();
  });
});

/**
 * The "Projects" header row (operator request, sidebar-projects).
 *
 * A caption between the search box and the list, carrying the filter control
 * that used to sit beside the search box. Orca's shape: search is one block,
 * the projects are another, and the row is the seam between them.
 */
describe('SessionList projects header', () => {
  it('renders a Projects row between the search box and the list', () => {
    const { container } = mount(twoProjects());
    const header = container.querySelector('[data-projects-header]');
    expect(header?.textContent).toContain('Projects');

    // Document order is the layout claim: search, then this row, then the list.
    const search = container.querySelector('[aria-label="search sessions"]');
    const list = container.querySelector('ul');
    expect(search).not.toBeNull();
    expect(list).not.toBeNull();
    expect(
      (search as Element).compareDocumentPosition(header as Element) &
        globalThis.Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      (header as Element).compareDocumentPosition(list as Element) &
        globalThis.Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('moves the filter control into that row, leaving no second one', () => {
    const { container } = mount(twoProjects());
    const toggles = container.querySelectorAll('[data-filter-toggle]');
    expect(toggles).toHaveLength(1);
    expect(container.querySelector('[data-projects-header]')?.contains(toggles[0] as Element)).toBe(
      true,
    );
  });

  it('badges how many filters the OPERATOR applied, and nothing at zero', () => {
    const { container } = mount(twoProjects());
    expect(container.querySelector('[data-filter-badge]')).toBeNull();
    cleanup();

    // `hideAgentStarted` is ON here and still not counted: it is on at its
    // shipped default, and a default is not a rule the operator applied. Only
    // the status choice is theirs, so the badge reads 1.
    const { container: two } = mountWith(twoProjects(), {
      statusFilter: 'waiting',
      originFilters: { hideAgentStarted: true, onlyPrompted: false },
    });
    expect(two.querySelector('[data-filter-badge]')?.textContent).toBe('1');
    cleanup();

    const { container: three } = mountWith(twoProjects(), {
      statusFilter: 'done',
      originFilters: { hideAgentStarted: true, onlyPrompted: true },
    });
    expect(three.querySelector('[data-filter-badge]')?.textContent).toBe('2');
  });
});

/**
 * The filter popover's own geometry, its badge colour, and the one rule the
 * badge must not count.
 */
describe('SessionList filter popover', () => {
  const menu = (root: ParentNode) => root.querySelector('[data-filter-menu]') as HTMLElement;

  it('opens at its roomy width, and never wider than the sidebar holding it', () => {
    // The popover is anchored inside `data-projects-header`, whose padding box
    // is the sidebar minus `px-3` on each side, so a 12px gutter on the free
    // side bounds it at `width - 24`.
    const { container } = mountWith(twoProjects(), { filterMenuOpen: true, width: 480 });
    expect(menu(container).style.width).toBe(`${FILTER_POPOVER_WIDTH}px`);
    cleanup();

    const { container: narrow } = mountWith(twoProjects(), {
      filterMenuOpen: true,
      width: SIDEBAR_MIN,
    });
    const drawn = Number.parseInt(menu(narrow).style.width, 10);
    expect(drawn).toBe(SIDEBAR_MIN - 24);
    // Inside the sidebar, therefore inside the window: the sidebar starts at
    // the window's left edge.
    expect(drawn + 24).toBeLessThanOrEqual(SIDEBAR_MIN);
    expect(drawn).toBeLessThan(FILTER_POPOVER_WIDTH);
    cleanup();

    // Roomier than the 212px it replaced, at the default sidebar width.
    const { container: normal } = mountWith(twoProjects(), { filterMenuOpen: true, width: 264 });
    expect(Number.parseInt(menu(normal).style.width, 10)).toBeGreaterThan(212);
  });

  it('draws the badge in the filter badge yellow, not in a status colour', () => {
    const { container } = mountWith(twoProjects(), { statusFilter: 'waiting' });
    const badge = container.querySelector('[data-filter-badge]') as HTMLElement;
    expect(badge.className).toContain('bg-filter-badge');
    expect(badge.className).not.toContain('bg-waiting');
  });

  it('leaves the default hide-agent rule out of the badge, and counts applied rules', () => {
    // The default is not a rule the operator applied, so it is not one of the
    // rules the badge counts -- even though it does narrow the list.
    const { container } = mountWith(twoProjects(), {
      originFilters: DEFAULT_SESSION_FILTERS,
      hiddenCounts: { agent: 3, unprompted: 0 },
    });
    expect(container.querySelector('[data-filter-badge]')).toBeNull();
    cleanup();

    // An operator-applied rule does count, and the default still does not.
    const { container: one } = mountWith(twoProjects(), {
      statusFilter: 'waiting',
      originFilters: DEFAULT_SESSION_FILTERS,
    });
    expect(one.querySelector('[data-filter-badge]')?.textContent).toBe('1');
    cleanup();

    const { container: two } = mountWith(twoProjects(), {
      statusFilter: 'waiting',
      originFilters: { hideAgentStarted: true, onlyPrompted: true },
    });
    expect(two.querySelector('[data-filter-badge]')?.textContent).toBe('2');
  });

  it('says in the popover that the default is in force, with what it hides', () => {
    // Uncounted must not mean invisible: a hidden session that is neither
    // shown nor counted is indistinguishable from one that does not exist.
    const { container } = mountWith(twoProjects(), {
      filterMenuOpen: true,
      originFilters: DEFAULT_SESSION_FILTERS,
      hiddenCounts: { agent: 3, unprompted: 0 },
    });
    const row = container.querySelector('[data-origin-toggle="agent"]') as HTMLElement;
    expect(row.getAttribute('aria-pressed')).toBe('true');
    expect(row.querySelector('[data-filter-default]')?.textContent).toBe('default');
    expect(row.textContent).toContain('3');
    // And it is still the control that turns the default off.
    const seen: SessionFilters[] = [];
    cleanup();
    const { container: live } = mountWith(twoProjects(), {
      filterMenuOpen: true,
      originFilters: DEFAULT_SESSION_FILTERS,
      onOriginFilters: (next) => seen.push(next),
    });
    act(() => {
      fireEvent.click(live.querySelector('[data-origin-toggle="agent"]') as Element);
    });
    expect(seen).toEqual([{ hideAgentStarted: false, onlyPrompted: false }]);
  });

  it('drops the default tag from a rule the operator applied', () => {
    const { container } = mountWith(twoProjects(), {
      filterMenuOpen: true,
      originFilters: { hideAgentStarted: true, onlyPrompted: true },
    });
    const prompted = container.querySelector('[data-origin-toggle="prompted"]') as HTMLElement;
    expect(prompted.querySelector('[data-filter-default]')).toBeNull();
  });
});

describe('the filter badge yellow, in styles.css', () => {
  const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
  const block = (selector: string) => {
    const start = CSS.indexOf(`${selector} {`);
    expect(start, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
    return CSS.slice(start, CSS.indexOf('\n}', start));
  };
  const read = (b: string, name: string) =>
    b.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();

  it('carries waiting’s value under its own name, in both themes', () => {
    for (const selector of [':root', 'html.light']) {
      const b = block(selector);
      expect(read(b, 'vam-filter-badge'), `no badge yellow in ${selector}`).toBeDefined();
      expect(read(b, 'vam-filter-badge')).toBe(read(b, 'vam-waiting'));
    }
    // Its own name, mapped as its own colour -- the `--vam-cursor-ring`
    // precedent. Borrowing `--color-waiting` for decoration is what would
    // stop the status amber meaning "this session is waiting".
    expect(CSS).toMatch(/--color-filter-badge:\s*var\(--vam-filter-badge\);/);
  });
});

/**
 * A project heading's own controls: a fold, and a menu.
 *
 * Revealed on hover the way orca reveals them, and revealed by `p` as well,
 * because a control that only exists under a pointer does not exist at all
 * for a keyboard-first app. Both routes set the same state, so there is one
 * answer to "is this heading showing its controls" rather than two.
 */
function heading(root: ParentNode, projectId: string) {
  return root.querySelector(
    `[data-project-heading][data-project-id="${projectId}"]`,
  ) as HTMLElement;
}

function pressKey(key: string, target: Element = document.body) {
  act(() => {
    fireEvent.keyDown(target, { key });
  });
}

describe('SessionList project controls', () => {
  it('reveals the fold and the menu on hover, and hides them again', () => {
    const { container } = mount(twoProjects());
    const alpha = heading(container, 'p1');
    expect(alpha.getAttribute('data-project-revealed')).toBeNull();

    act(() => {
      fireEvent.mouseEnter(alpha);
    });
    expect(alpha.getAttribute('data-project-revealed')).toBe('true');
    expect(alpha.querySelector('[data-project-collapse="p1"]')).not.toBeNull();
    expect(alpha.querySelector('[data-project-menu="p1"]')).not.toBeNull();

    act(() => {
      fireEvent.mouseLeave(alpha);
    });
    expect(alpha.getAttribute('data-project-revealed')).toBeNull();
  });

  it('keeps both controls in the DOM unrevealed, so Tab can still reach them', () => {
    // The close button on a row is removed from the DOM until hover; these are
    // not, because the fold is the only route to a fold and Tab has to have
    // one. Unrevealed means transparent, not absent -- and focus reveals it.
    const { container } = mount(twoProjects());
    const fold = container.querySelector('[data-project-collapse="p1"]') as HTMLElement;
    expect(fold).not.toBeNull();
    expect(fold.className).toContain('focus:opacity-100');
    expect(fold.tabIndex).toBe(0);
  });

  it('reveals the focused session project on p, and puts focus on its fold', () => {
    const { container } = mountWith(twoProjects(), { focusedSessionId: 'b1' });
    pressKey('p');
    expect(heading(container, 'p2').getAttribute('data-project-revealed')).toBe('true');
    expect(heading(container, 'p1').getAttribute('data-project-revealed')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('[data-project-collapse="p2"]'));
  });

  it('leaves p alone while text is being typed', () => {
    const { container } = mountWith(twoProjects(), { focusedSessionId: 'b1', filtering: true });
    const input = container.querySelector('[aria-label="filter sessions"]') as HTMLInputElement;
    pressKey('p', input);
    expect(heading(container, 'p2').getAttribute('data-project-revealed')).toBeNull();
  });

  it('does nothing on p when no session is focused', () => {
    const { container } = mountWith(twoProjects(), { focusedSessionId: null });
    pressKey('p');
    expect(container.querySelector('[data-project-revealed]')).toBeNull();
  });

  it('hides a collapsed project rows and keeps its heading', () => {
    const { container } = mountWith(twoProjects(), { collapsedProjects: ['p1'] });
    expect(heading(container, 'p1')).not.toBeNull();
    expect(container.querySelector('[data-project-rows="p1"]')).toBeNull();
    expect(container.querySelector('[data-session-row="a1"]')).toBeNull();
    // The other project is untouched.
    expect(container.querySelector('[data-session-row="b1"]')).not.toBeNull();
    expect(
      heading(container, 'p1')
        .querySelector('[data-project-collapse="p1"]')
        ?.getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('asks the caller to fold when the chevron is pressed', () => {
    const asked: string[] = [];
    const { container } = mountWith(twoProjects(), {
      onToggleCollapse: (project) => asked.push(project.id),
    });
    act(() => {
      (container.querySelector('[data-project-collapse="p1"]') as HTMLElement).click();
    });
    expect(asked).toEqual(['p1']);
  });

  it('folds on its own when the caller does not own the state', () => {
    // No `collapsedProjects` prop: the component keeps the fold itself, so it
    // works today rather than waiting for a caller to be wired.
    const { container } = mount(twoProjects());
    act(() => {
      (container.querySelector('[data-project-collapse="p1"]') as HTMLElement).click();
    });
    expect(container.querySelector('[data-session-row="a1"]')).toBeNull();
    act(() => {
      (container.querySelector('[data-project-collapse="p1"]') as HTMLElement).click();
    });
    expect(container.querySelector('[data-session-row="a1"]')).not.toBeNull();
  });
});

describe('SessionList project menu', () => {
  function openMenu(container: ParentNode, projectId = 'p1') {
    act(() => {
      (container.querySelector(`[data-project-menu="${projectId}"]`) as HTMLElement).click();
    });
  }

  it('opens on the ... button and focuses its first item', () => {
    const { container } = mount(twoProjects());
    expect(container.querySelector('[data-project-menu-panel]')).toBeNull();
    openMenu(container);
    const panel = container.querySelector('[data-project-menu-panel="p1"]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('role')).toBe('menu');
    expect(container.querySelector('[data-project-menu="p1"]')?.getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(document.activeElement).toBe(panel.querySelector('[role="menuitem"]'));
  });

  it('offers only items that do something, and never a settings item', () => {
    const { container } = mount(twoProjects());
    openMenu(container);
    const items = [
      ...(container.querySelectorAll('[data-project-menu-panel="p1"] [role="menuitem"]') ?? []),
    ];
    expect(items.map((i) => i.getAttribute('data-project-menu-item'))).toEqual([
      'collapse',
      'icon',
    ]);
    expect(container.textContent).not.toContain('Project settings');
    expect(container.textContent).not.toContain('Remove project');
  });

  it('closes on Escape and puts focus back on the button that opened it', () => {
    const { container } = mount(twoProjects());
    openMenu(container);
    const panel = container.querySelector('[data-project-menu-panel="p1"]') as HTMLElement;
    pressKey('Escape', panel);
    expect(container.querySelector('[data-project-menu-panel]')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('[data-project-menu="p1"]'));
  });

  it('folds the project from its menu item, then says Expand', () => {
    const { container } = mount(twoProjects());
    openMenu(container);
    act(() => {
      (container.querySelector('[data-project-menu-item="collapse"]') as HTMLElement).click();
    });
    expect(container.querySelector('[data-session-row="a1"]')).toBeNull();
    expect(container.querySelector('[data-project-menu-panel]')).toBeNull();
    openMenu(container);
    expect(container.querySelector('[data-project-menu-item="collapse"]')?.textContent).toContain(
      'Expand',
    );
  });

  it('opens the icon picker from its menu item', () => {
    const picked: string[] = [];
    const { container } = mountWith(twoProjects(), {
      onPickIcon: (project) => picked.push(project.id),
    });
    openMenu(container, 'p2');
    act(() => {
      (container.querySelector('[data-project-menu-item="icon"]') as HTMLElement).click();
    });
    expect(picked).toEqual(['p2']);
    expect(container.querySelector('[data-project-menu-panel]')).toBeNull();
  });
});

/**
 * The Projects header's `+`, and the per-project `+`'s caption.
 *
 * Both are about the same sentence: what does this control actually do. The
 * per-project one shipped a title reading "Sessions are created from the CLI"
 * long after `createSession` started really creating them, and a
 * `data-placeholder` attribute on a control that was no longer a placeholder.
 */
describe('SessionList new-project control', () => {
  it('renders a `+` in the Projects header, beside the filter control', () => {
    const { container } = mount(twoProjects());
    const header = container.querySelector('[data-projects-header]');
    expect(header).not.toBeNull();
    const add = header?.querySelector<HTMLButtonElement>('[data-new-project]');
    expect(add).not.toBeNull();
    expect(add?.getAttribute('aria-label')).toBe('new project');
  });

  it('calls onNewProject when the header `+` is clicked', () => {
    let clicks = 0;
    const { container } = mountWith(twoProjects(), {
      onNewProject: () => {
        clicks += 1;
      },
    });
    container.querySelector<HTMLButtonElement>('[data-new-project]')?.click();
    expect(clicks).toBe(1);
  });

  it('captions the header `+` with the refusal when the source cannot create', () => {
    const { container } = mountWith(twoProjects(), {
      newSessionDecline: 'black-smith has no new-session command',
    });
    const add = container.querySelector<HTMLButtonElement>('[data-new-project]');
    expect(add?.getAttribute('title')).toBe('black-smith has no new-session command');
  });

  it('captions the per-project `+` with what it does, and no longer calls it a placeholder', () => {
    const entries = twoProjects();
    const { container } = mountWith(entries, { focusedSessionId: 'b1' });
    expect(container.querySelector('[data-placeholder="new-session-in-project"]')).toBeNull();
    const add = container.querySelector<HTMLButtonElement>('[data-new-session-in-project]');
    expect(add?.getAttribute('title')).toBe('New session in beta');
  });

  it('captions the per-project `+` with the refusal when the source cannot create', () => {
    const { container } = mountWith(twoProjects(), {
      focusedSessionId: 'b1',
      newSessionDecline: 'black-smith has no new-session command',
    });
    const add = container.querySelector<HTMLButtonElement>('[data-new-session-in-project]');
    expect(add?.getAttribute('title')).toBe('black-smith has no new-session command');
  });
});
