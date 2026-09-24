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
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import {
  DEFAULT_SESSION_FILTERS,
  type SessionFilters,
} from '../../src/renderer/domain/session-filter.js';
import {
  BRANCH_TAIL_MAX_CHARS,
  FILTER_POPOVER_WIDTH,
  RESTORE_STRIP_VISIBLE_MS,
  SessionList,
  type SessionListProps,
  SIDEBAR_STEP,
} from '../../src/renderer/panels/SessionList.js';
import { SIDEBAR_MIN } from '../../src/renderer/prefs/panes.js';
import {
  baseProps,
  decision,
  entriesOf,
  makeProject,
  makeSession,
  noop,
  twoProjects,
} from './session-list-props.js';

function mount(entries: readonly SessionEntry[]) {
  return render(<SessionList {...baseProps(entries)} />);
}

/* `openTipOn` lived here: it focused a control and read the Radix tooltip that
   opened, which is how the per-project `+` proved its caption reached a
   keyboard. Both of its callers went with that button -- the caption is the
   menu item's own visible text now -- and a helper with no caller is a helper
   that goes stale unread. `test/keyboard/shortcut-tip.test.tsx` still holds
   the tooltip's behaviour itself. */

function mountWith(entries: readonly SessionEntry[], over: Partial<SessionListProps>) {
  return render(<SessionList {...baseProps(entries)} {...over} />);
}

function addButtons(root: ParentNode) {
  return [...root.querySelectorAll('[data-new-session-in-project]')];
}

/** The route to everything a project heading used to wear as an icon. */
function openProjectMenu(root: ParentNode, projectId: string) {
  act(() => {
    (root.querySelector(`[data-project-menu="${projectId}"]`) as HTMLElement).click();
  });
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

  /**
   * The half of `splitBranch`'s promise that had no ceiling: the tail is
   * `flex-none`, so nothing capped it once the head had already shrunk to
   * nothing. At `SIDEBAR_MIN`, with a long final segment or no slash at all
   * (100% tail), an uncapped tail grows straight through `data-session-age`
   * — the operator's report, "the branch overlaps the timer". The age must
   * stay whole and in place regardless; a test that only checked the tail
   * for a `truncate` class would pass without proving that.
   */
  it('caps a long final segment so it cannot grow into the age, at the sidebar floor', () => {
    const longTail = `vam-${'x'.repeat(BRANCH_TAIL_MAX_CHARS)}-topology`;
    const { container } = mountWith(
      entriesOf([makeSession({ branch: `smith/specs/${longTail}` })]),
      {
        width: SIDEBAR_MIN,
      },
    );
    const tail = container.querySelector('[data-branch-tail]');
    expect(tail?.textContent).toBe(longTail);
    expect(tail?.className).toContain('truncate');
    // The age is a wholly separate element the cap never touches — full
    // text, still there, still last in the row.
    const age = container.querySelector('[data-session-age]');
    expect(age?.textContent).toBe('12m');
    expect(age?.className).toContain('flex-none');
  });

  it('caps a no-slash branch the same way — 100% tail is the worst case, and an ordinary one', () => {
    const longBranch = `release-${'x'.repeat(BRANCH_TAIL_MAX_CHARS)}`;
    const { container } = mountWith(entriesOf([makeSession({ branch: longBranch })]), {
      width: SIDEBAR_MIN,
    });
    expect(container.querySelector('[data-branch-head]')?.textContent).toBe('');
    const tail = container.querySelector('[data-branch-tail]');
    expect(tail?.textContent).toBe(longBranch);
    expect(tail?.className).toContain('truncate');
    expect(container.querySelector('[data-session-age]')?.textContent).toBe('12m');
  });

  it('draws the exact character budget as the line: one under is whole, one over is capped', () => {
    const atBudget = `x`.repeat(BRANCH_TAIL_MAX_CHARS);
    const overBudget = `x`.repeat(BRANCH_TAIL_MAX_CHARS + 1);
    const { container } = mount(
      entriesOf([
        makeSession({ id: 's1', branch: atBudget }),
        makeSession({ id: 's2', branch: overBudget }),
      ]),
    );
    expect(
      container.querySelector('[data-session-row="s1"] [data-branch-tail]')?.className,
    ).not.toContain('truncate');
    expect(
      container.querySelector('[data-session-row="s2"] [data-branch-tail]')?.className,
    ).toContain('truncate');
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

  /**
   * Audit item 7 (S3). Both sentences said something found nowhere else on
   * screen -- an em-dash names a gap but not whose gap it is -- and both said
   * it in a `title`, which opens on hover and on nothing else. Nine of these
   * were still live at 390px, where there is no hover at all, and mobile is a
   * real target (Tailscale Serve).
   *
   * A tab stop is NOT the fix here, and that is the whole reason these two
   * differ from the status bar's notes: every one of these spans is inside the
   * session row's own `<button>` (one element, ~250 lines of it), so a
   * focusable child would be a nested interactive control. The row button is
   * already a tab stop and already has an accessible name computed from its
   * contents -- so the sentence goes into that name as `sr-only` text. The
   * em-dash stays exactly as drawn: this is a row at rest, and the design of
   * the quiet row is not what was broken.
   */
  /**
   * THE DASH IS GONE AND THE SENTENCE IS NOT -- the half of the paragraph
   * above that has since expired.
   *
   * "The design of the quiet row is not what was broken" was true of the dash
   * read as a placeholder. What the operator reported afterwards is that the
   * row draws a branch GLYPH beside it, so an absence was spending two marks
   * on every row of every source that cannot report a branch -- which is most
   * of them. Nothing is lost by drawing neither: there was no name to print
   * either way, and the `sr-only` sentence was always the only copy of the
   * information. The age cell keeps ITS dash, and that difference is
   * deliberate: it holds a column open on the right edge that a number lands
   * in, where this one held nothing open at all.
   */
  it('draws neither glyph nor dash for a branch the source cannot say, and still names the gap aloud', () => {
    const { container } = mount(entriesOf([makeSession({ branch: null })]));
    const branch = container.querySelector('[data-session-branch]');
    expect(branch?.textContent).not.toContain('—');
    expect(container.querySelector('[data-session-row] .lucide-git-branch')).toBeNull();
    // Not the old claim, which named factory on every row including a
    // Claude Code one that simply had no transcript yet.
    expect(branch?.getAttribute('title')).toBeNull();
    const row = container.querySelector('[data-session-row]');
    expect(row?.textContent).toContain('cannot say which branch');
  });

  it('shows an em-dash for the time when the source cannot say, never a zero', () => {
    // A source with no timestamp must stay distinguishable from one that just
    // reported activity a moment ago; `0m` would read as the second.
    const { container } = mount(entriesOf([makeSession({ age: null })]));
    const age = container.querySelector('[data-session-age]');
    expect(age?.textContent).toContain('—');
    expect(age?.getAttribute('title')).toBeNull();
    const row = container.querySelector('[data-session-row]');
    expect(row?.textContent).toContain('cannot say when the session last did anything');
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
    // A BAR IS A WIDTH, and that is what this looks for. It used to look for
    // any `span[style]` at all, which was a safe proxy while nothing in the
    // row carried an inline style -- until the status mark took one for its
    // lane (`status-mark.tsx`: a class built from a constant is invisible to
    // Tailwind's scanner, so the size has to be a style). A proxy that now
    // matches a span with no width in it is not the assertion this test is
    // named after; a percentage width is.
    const percentWidth = (root: ParentNode) =>
      [...root.querySelectorAll<HTMLElement>('[data-session-row="s1"] span[style]')].filter((el) =>
        el.style.width.includes('%'),
      );
    const { container } = mount(entriesOf([partial]));
    expect(percentWidth(container)).toEqual([]);

    cleanup();
    const done = makeSession({ id: 's1', status: 'done', decisions: [decision('a', null)] });
    const { container: doneContainer } = mount(entriesOf([done]));
    expect(percentWidth(doneContainer)).toEqual([]);
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
   *
   * IT IS NO LONGER A `+` IN THE HEADING AT ALL -- it is the first item of
   * that project's own menu, one icon less per heading at the operator's
   * request. What this pair still holds is everything the fix above won: a
   * real button, reachable, that names the project it will create in and
   * reports that project when pressed. Where it says which project has moved
   * from an `aria-label` to the panel the item lives in, whose own label is
   * `<project> actions` -- which is why the assertion is on containment.
   */
  it('offers the per-project add as a real button inside that project’s own menu', () => {
    const { container } = mountWith(twoProjects(), { focusedSessionId: 'a1' });
    // No `+` left on any heading: the count is the point of the move.
    expect(addButtons(container)).toHaveLength(0);
    for (const [projectId, name] of [
      ['p1', 'alpha'],
      ['p2', 'beta'],
    ] as const) {
      openProjectMenu(container, projectId);
      const panel = container.querySelector(`[data-project-menu-panel="${projectId}"]`);
      expect(panel?.getAttribute('aria-label')).toBe(`${name} actions`);
      const add = panel?.querySelector<HTMLElement>('[data-project-menu-item="new-session"]');
      expect(add?.tagName).toBe('BUTTON');
      expect(add?.getAttribute('role')).toBe('menuitem');
      expect(add?.getAttribute('aria-hidden')).toBeNull();
      expect(add?.className).toContain('cursor-pointer');
      expect(add?.className).toMatch(/hover:/);
      expect(add?.textContent).toContain('New session');
    }
  });

  it('reports which project the add was for', () => {
    const seen: string[] = [];
    const { container } = mountWith(twoProjects(), {
      focusedSessionId: 'b1',
      onAddInProject: (project: Project) => seen.push(project.name),
    });
    openProjectMenu(container, 'p2');
    act(() => {
      (container.querySelector('[data-project-menu-item="new-session"]') as HTMLElement).click();
    });
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
 * THE PER-PROJECT ADD NO LONGER STANDS IN THE HEADING AT ALL.
 *
 * Two describes used to live here, and both were about the same argument at
 * two stages of the same retreat. The first ("quiet at rest") made the button
 * borderless until hover, because at four projects it was four outlined boxes
 * competing with the session names underneath them. The second ("by reveal,
 * not by existing") made every heading carry one and lit only the focused
 * project's, because cutting it from the others had read as the button having
 * vanished.
 *
 * The operator's verdict on the result was that the column still read as
 * cluttered, and the resolution is the one neither stage reached for: the
 * control is in the project's own menu, and the heading carries no box to be
 * quiet about. So what is held here now is the ABSENCE -- which is a claim
 * about every project, focused or not -- plus the thing the reveal was
 * protecting, which is that the route exists for a project you are not
 * currently in.
 */
describe('the per-project add is in the menu, not on the heading', () => {
  it('draws no add control on any heading, whichever project holds focus', () => {
    for (const focused of [null, 'a1', 'b1'] as const) {
      const { container } = mountWith(twoProjects(), { focusedSessionId: focused });
      expect(addButtons(container), `focused: ${focused}`).toHaveLength(0);
      // And nothing else crept in to replace it: fold and menu, and that is
      // the whole of the heading's controls.
      for (const heading of container.querySelectorAll('[data-project-heading]')) {
        expect([...heading.querySelectorAll('button')].length).toBe(3);
      }
      cleanup();
    }
  });

  it('offers the route for a project that does not hold focus', () => {
    // The defect the reveal was fixing, restated against the menu: with beta
    // focused, alpha must still have a way in. It does, and it is the same
    // gesture for both -- no opacity, no hover, no focus to match.
    const { container } = mountWith(twoProjects(), { focusedSessionId: 'b1' });
    openProjectMenu(container, 'p1');
    expect(
      container.querySelector(
        '[data-project-menu-panel="p1"] [data-project-menu-item="new-session"]',
      ),
    ).not.toBeNull();
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
      // A left inset of exactly one unit. It used to be "of some kind, the
      // value is a visual call" -- the value is a named constant now
      // (`SIDEBAR_STEP`), because the call it was left to made this level step
      // 6px where the level above it stepped 8, and a ladder whose rungs close
      // up as it descends is why the tree read flat. The unit's own size is
      // still a visual judgement; that it is ONE unit here is not.
      expect((wrapper as HTMLElement).style.paddingLeft).toBe(`${SIDEBAR_STEP}px`);
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
      originFilters: {
        hideAgentStarted: true,
        onlyPrompted: false,
        hideEnded: false,
        hideForeign: true,
      },
    });
    expect(two.querySelector('[data-filter-badge]')?.textContent).toBe('1');
    cleanup();

    const { container: three } = mountWith(twoProjects(), {
      statusFilter: 'done',
      originFilters: {
        hideAgentStarted: true,
        onlyPrompted: true,
        hideEnded: false,
        hideForeign: true,
      },
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

  /**
   * THE THIRD ROW, which is the operator's own proposal: "the filter should
   * get a toggle to show/hide those recent sessions". It ships ON, so the
   * count beside it is the whole of what keeps a hidden session from being
   * indistinguishable from one that does not exist.
   */
  it('offers a row for ended sessions, on by default and saying how many it holds back', () => {
    const { container } = mountWith(twoProjects(), {
      filterMenuOpen: true,
      originFilters: DEFAULT_SESSION_FILTERS,
      hiddenCounts: { agent: 0, unprompted: 0, ended: 11, foreign: 0 },
    });
    const row = container.querySelector('[data-origin-toggle="ended"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.getAttribute('aria-pressed')).toBe('true');
    expect(row.querySelector('[data-filter-default]')?.textContent).toBe('default');
    expect(row.textContent).toContain('11');
  });

  it('turns the ended rule off without disturbing the other two', () => {
    const seen: SessionFilters[] = [];
    const { container } = mountWith(twoProjects(), {
      filterMenuOpen: true,
      originFilters: DEFAULT_SESSION_FILTERS,
      onOriginFilters: (next) => seen.push(next),
    });
    act(() => {
      fireEvent.click(container.querySelector('[data-origin-toggle="ended"]') as Element);
    });
    expect(seen).toEqual([
      { hideAgentStarted: true, onlyPrompted: false, hideEnded: false, hideForeign: true },
    ]);
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
      hiddenCounts: { agent: 3, unprompted: 0, ended: 0, foreign: 0 },
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
      originFilters: {
        hideAgentStarted: true,
        onlyPrompted: true,
        hideEnded: false,
        hideForeign: true,
      },
    });
    expect(two.querySelector('[data-filter-badge]')?.textContent).toBe('2');
  });

  it('says in the popover that the default is in force, with what it hides', () => {
    // Uncounted must not mean invisible: a hidden session that is neither
    // shown nor counted is indistinguishable from one that does not exist.
    const { container } = mountWith(twoProjects(), {
      filterMenuOpen: true,
      originFilters: DEFAULT_SESSION_FILTERS,
      hiddenCounts: { agent: 3, unprompted: 0, ended: 0, foreign: 0 },
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
    expect(seen).toEqual([
      { hideAgentStarted: false, onlyPrompted: false, hideEnded: true, hideForeign: true },
    ]);
  });

  it('drops the default tag from a rule the operator applied', () => {
    const { container } = mountWith(twoProjects(), {
      filterMenuOpen: true,
      originFilters: {
        hideAgentStarted: true,
        onlyPrompted: true,
        hideEnded: false,
        hideForeign: true,
      },
    });
    const prompted = container.querySelector('[data-origin-toggle="prompted"]') as HTMLElement;
    expect(prompted.querySelector('[data-filter-default]')).toBeNull();
  });

  /**
   * THE FOURTH ROW -- `docs/design/vam-owns-the-session.md`'s own Stage 1
   * acceptance line, the popover half of it.
   */
  it('offers a row for foreign sessions, on by default and saying how many it holds back', () => {
    const { container } = mountWith(twoProjects(), {
      filterMenuOpen: true,
      originFilters: DEFAULT_SESSION_FILTERS,
      hiddenCounts: { agent: 0, unprompted: 0, ended: 0, foreign: 11 },
    });
    const row = container.querySelector('[data-origin-toggle="foreign"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.getAttribute('aria-pressed')).toBe('true');
    expect(row.querySelector('[data-filter-default]')?.textContent).toBe('default');
    expect(row.textContent).toContain('11');
  });

  it('turns the foreign rule off without disturbing the other three', () => {
    const seen: SessionFilters[] = [];
    const { container } = mountWith(twoProjects(), {
      filterMenuOpen: true,
      originFilters: DEFAULT_SESSION_FILTERS,
      onOriginFilters: (next) => seen.push(next),
    });
    act(() => {
      fireEvent.click(container.querySelector('[data-origin-toggle="foreign"]') as Element);
    });
    expect(seen).toEqual([
      { hideAgentStarted: true, onlyPrompted: false, hideEnded: true, hideForeign: false },
    ]);
  });

  /**
   * THE REASON, ON SCREEN -- `docs/design/vam-owns-the-session.md`'s own
   * trap: "an unreadable tmux listing must not empty the sidebar." The
   * popover is where an operator would otherwise read a toggle that stopped
   * narrowing as simply broken.
   */
  it('says nothing extra when there is no listing gap', () => {
    const { container } = mountWith(twoProjects(), { filterMenuOpen: true });
    expect(container.querySelector('[data-vam-listing-gap]')).toBeNull();
  });

  it('shows the reason on screen while vam cannot read its own tmux spine', () => {
    const { container } = mountWith(twoProjects(), {
      filterMenuOpen: true,
      vamListingGap: 'no tmux server is running, so there is nothing to reach',
    });
    const gap = container.querySelector('[data-vam-listing-gap]');
    expect(gap?.textContent).toContain('no tmux server is running');
  });
});

/**
 * THE SIDEBAR'S OWN QUIET LINE, distinct from `vamListingGap` above: that one
 * covers a listing vam could not READ, this one covers a listing vam read
 * perfectly and found nothing of its own in -- `listVamSessions` answering
 * `ok, []`, the ordinary state after every reboot before vam starts its
 * first session. Not a failure, so `vamListingGap` stays null and ownership
 * really is zero -- but `hideForeign` (on by default) can still take every
 * Claude Code row with it, leaving a wordless empty sidebar an operator
 * cannot tell apart from "vam is broken".
 *
 * `foreignHiddenCount` ARRIVES AS A PROP, computed by `Canvas.tsx` off
 * `countHiddenByForeignFilter` (`session-filter.foreign.test.ts` proves that
 * function). This pane never recomputes it from `allEntries` itself: the
 * count has to agree with `entries`'s own `vamListingGap`/`?demo=1`
 * exemptions, which only `Canvas.tsx` knows about, so these tests exercise
 * the RENDERING of a given count and the `Show` route, not the arithmetic.
 */
describe('the foreign-hidden quiet line', () => {
  it('says nothing when the count is zero', () => {
    const { container } = mountWith(twoProjects(), { foreignHiddenCount: 0 });
    expect(container.querySelector('[data-foreign-hidden]')).toBeNull();
  });

  /**
   * THE BUG ITSELF: `hideForeign` takes every row, `vamListingGap` is null
   * (the listing succeeded), and the plain "No sessions yet" empty state
   * would say nothing true but misleading in its silence. This is the state
   * the coordinator's own report named: no tmux server yet, so every Claude
   * Code row reads `vamControlled: false`.
   */
  it('replaces the silent empty state when the count is not zero', () => {
    const { container } = mountWith([], { foreignHiddenCount: 3 });
    const notice = container.querySelector('[data-foreign-hidden-count]');
    expect(notice?.textContent).toContain('3 sessions hidden');
    expect(notice?.textContent).toContain('vam did not start them');
    // Not BOTH messages -- the strip already says why the list is empty, and
    // "No sessions yet" beside it would read as contradicting it.
    expect(container.textContent).not.toContain('No sessions yet');
  });

  it('says ONE session, singular, when the count is exactly one', () => {
    const { container } = mountWith([], { foreignHiddenCount: 1 });
    const notice = container.querySelector('[data-foreign-hidden-count]');
    expect(notice?.textContent).toContain('1 session hidden');
    expect(notice?.textContent).toContain('vam did not start it');
  });

  /**
   * THE NON-EMPTY CASE: a small count so a hidden row is never
   * invisible-and-unmentioned just because it was not the ONLY row.
   */
  it('still names a hidden session when the rest of the list is not empty', () => {
    const { container } = mountWith(entriesOf([makeSession({ id: 's1' })]), {
      foreignHiddenCount: 2,
    });
    expect(container.querySelector('[data-session-row="s1"]')).not.toBeNull();
    expect(container.querySelector('[data-foreign-hidden-count]')?.textContent).toContain(
      '2 sessions hidden',
    );
  });

  it('Show flips the same pref the popover row does, without opening the popover', () => {
    const seen: SessionFilters[] = [];
    const { container } = mountWith([], {
      foreignHiddenCount: 2,
      originFilters: { ...DEFAULT_SESSION_FILTERS, hideForeign: true },
      onOriginFilters: (next) => seen.push(next),
    });
    act(() => {
      fireEvent.click(container.querySelector('[data-foreign-hidden-show]') as Element);
    });
    expect(seen).toEqual([{ ...DEFAULT_SESSION_FILTERS, hideForeign: false }]);
    expect(container.querySelector('[data-filter-menu]')).toBeNull();
  });

  /**
   * ONE COPY OF THE SENTENCE ON A PHONE, NOT TWO. `GettingStarted.tsx`
   * (drawn below the list when `phone && entries.length === 0`, see the
   * getting-started describe block) carries its OWN copy of this exact
   * line, fed the identical `foreignHiddenCount`. Drawing both put "1
   * session hidden — vam did not start it · Show" on the 390px screen
   * twice -- once above an otherwise-empty list, once inside the screen
   * that replaced it. The desktop never withdraws this strip: its own
   * getting-started screen lives in the detail pane, a different piece of
   * chrome the sidebar never draws.
   */
  it('withdraws on a phone once the getting-started screen owns this line', () => {
    const { container } = mountWith([], { foreignHiddenCount: 1, phone: true });
    expect(container.querySelector('[data-foreign-hidden]')).toBeNull();
    expect(container.querySelector('[data-getting-started-hidden]')).not.toBeNull();
  });

  it('stays on the desktop, where the getting-started screen is a different pane entirely', () => {
    const { container } = mountWith([], { foreignHiddenCount: 1, phone: false });
    expect(container.querySelector('[data-foreign-hidden]')).not.toBeNull();
  });
});

/**
 * TWO THINGS A PHONE'S OWN GETTING-STARTED SCREEN GETS WRONG IF IT JUST
 * COPIES THE DESKTOP'S: a shortcut list naming keys nothing on a touch
 * screen can press, and a "the browser build has no picker" sentence that
 * is true of EVERY phone (a phone is a browser build, always) and points
 * nowhere an operator holding one can act. Both were caught by eye on the
 * committed screenshot (`docs/ui/getting-started-phone.png`) before being
 * pinned here.
 */
describe('the phone’s own getting-started screen', () => {
  it('withdraws the shortcut rows -- a touch screen cannot press a chord', () => {
    const { container } = mountWith([], { phone: true, hasDirectoryPicker: true });
    expect(container.querySelector('[data-getting-started]')).not.toBeNull();
    expect(container.querySelector('[data-getting-started-shortcuts]')).toBeNull();
  });

  it('says the phone-accurate sentence when there is no picker, not the desktop’s "browser build" one', () => {
    const { container } = mountWith([], { phone: true, hasDirectoryPicker: false });
    const decline = container.querySelector('[data-getting-started-decline]');
    expect(decline?.textContent).toContain('desktop app');
    expect(decline?.textContent).not.toContain('browser build');
  });

  /**
   * ITEM 1 OF "start-polish": `entries` empty is not the whole story on a
   * phone either -- `hasOwnSession` (`Canvas.tsx`'s own fact, off the
   * UNFILTERED model) is what tells this list a session vam started is
   * merely hidden by dismiss or a filter, not gone. Without this the phone
   * showed the exact "you have never used vam" screen the desktop no longer
   * does in the identical state.
   */
  it('withdraws once vam has a session of its own, even though entries is empty', () => {
    const { container } = mountWith([], { phone: true, hasOwnSession: true });
    expect(container.querySelector('[data-getting-started]')).toBeNull();
  });

  it('shows once entries is empty and vam truly owns nothing, the default', () => {
    const { container } = mountWith([], { phone: true, hasOwnSession: false });
    expect(container.querySelector('[data-getting-started]')).not.toBeNull();
  });
});

/**
 * THE PLAIN "No sessions yet" LINE gets the identical guard, for the
 * identical reason -- see `hasOwnSession`'s own header on `SessionList.tsx`.
 */
describe('the plain "No sessions yet" line', () => {
  it('stays off once vam has a session of its own, even though entries is empty', () => {
    const { container } = mountWith([], { hasOwnSession: true });
    expect(container.textContent).not.toContain('No sessions yet');
  });

  it('shows once entries is empty and vam truly owns nothing, the default', () => {
    const { container } = mountWith([], { hasOwnSession: false });
    expect(container.textContent).toContain('No sessions yet');
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

  // `p` itself is no longer this component's key: it is `revealProject` in the
  // chord table, resolved by the one window listener in Canvas.tsx, which is
  // what gets it into the generated key sheet and under the overlay guard.
  // What is left here is the effect the ask produces, and the two ways an ask
  // can be empty. The keystroke end to end is in Canvas.tab-chord.test.tsx.
  it('reveals the asked-for project, and puts focus on its fold', () => {
    const { container } = mountWith(twoProjects(), {
      focusedSessionId: 'b1',
      revealRequest: { projectId: 'p2' },
    });
    expect(heading(container, 'p2').getAttribute('data-project-revealed')).toBe('true');
    expect(heading(container, 'p1').getAttribute('data-project-revealed')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('[data-project-collapse="p2"]'));
  });

  it('reveals nothing when no ask has been made, not even on a bare p', () => {
    const { container } = mountWith(twoProjects(), { focusedSessionId: 'b1' });
    pressKey('p');
    expect(container.querySelector('[data-project-revealed]')).toBeNull();
  });

  it('ignores an ask for a project it is not showing', () => {
    const { container } = mountWith(twoProjects(), {
      focusedSessionId: 'b1',
      revealRequest: { projectId: 'gone' },
    });
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

  /**
   * THE `+` USED TO BE THE LAST CONTROL IN THIS ROW, and three tests here held
   * its position: after the fold and the menu in document order (which is tab
   * order), at the far right of the spacer, and lit only for the focused
   * project. All three are about a control the heading no longer draws.
   *
   * The property that survives the move is the one they were all protecting:
   * the heading is a caption with the SMALLEST set of controls that works, and
   * every one of them is reachable by tab in a stated order. It is two now,
   * and the add is the first item of the menu (`SessionList.tree.test.tsx`).
   */
  it('leaves the heading exactly two controls, fold then menu, and ends on the menu', () => {
    const { container } = mountWith(twoProjects(), { focusedSessionId: 'b1' });
    for (const projectId of ['p1', 'p2'] as const) {
      const row = heading(container, projectId);
      const controls = [...row.querySelectorAll('button')].map((node) =>
        node.getAttribute('data-project-icon') !== null
          ? 'icon'
          : node.getAttribute('data-project-collapse') !== null
            ? 'fold'
            : node.getAttribute('data-project-menu') !== null
              ? 'menu'
              : 'other',
      );
      expect(controls).toEqual(['icon', 'fold', 'menu']);
      // Far right is the spacer's doing, not a margin: everything after the
      // `flex-1` span is pushed to the end of the row, and the menu is now the
      // last of them -- so a stray control appended after it fails here.
      const children = [...row.children];
      const spacer = children.find((node) => node.className.includes('flex-1')) as HTMLElement;
      expect(spacer).not.toBeUndefined();
      expect(children.at(-1)).toBe(row.querySelector(`[data-project-menu="${projectId}"]`));
    }
  });

  it('creates in the project whose menu was opened, focused or not', () => {
    // Argument value, in click order: an untested argument order on this exact
    // call was a review finding once, and the away project is the new path.
    const seen: string[] = [];
    const { container } = mountWith(twoProjects(), {
      focusedSessionId: 'b1',
      onAddInProject: (project: Project) => seen.push(project.name),
    });
    for (const projectId of ['p1', 'p2'] as const) {
      openProjectMenu(container, projectId);
      act(() => {
        (
          container.querySelector(
            `[data-project-menu-panel="${projectId}"] [data-project-menu-item="new-session"]`,
          ) as HTMLElement
        ).click();
      });
    }
    expect(seen).toEqual(['alpha', 'beta']);
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
    // `remove` is LAST, and the destructive item being last is the point of
    // the order rather than an artefact of when it was added. It used to be
    // absent from this list along with `Project settings`, on the reasoning
    // that a derived project has nothing to remove -- see the note at the
    // menu itself for which half of that expired and which half did not.
    expect(items.map((i) => i.getAttribute('data-project-menu-item'))).toEqual([
      // FIRST, and first on purpose: it is the only item here that makes
      // something, and the panel focuses its first item -- so `...`+Enter is
      // the gesture that pays for the click the move off the heading cost.
      'new-session',
      'collapse',
      'icon',
      'remove',
    ]);
    expect(container.textContent).not.toContain('Project settings');
  });

  it('closes on Escape and puts focus back on the button that opened it', () => {
    const { container } = mount(twoProjects());
    openMenu(container);
    const panel = container.querySelector('[data-project-menu-panel="p1"]') as HTMLElement;
    pressKey('Escape', panel);
    expect(container.querySelector('[data-project-menu-panel]')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('[data-project-menu="p1"]'));
  });

  it('closes on a press outside it, without also activating what was under the press', () => {
    const { container } = mount(twoProjects());
    openMenu(container);
    const outside = container.querySelector('[data-project-id="p2"]') as HTMLElement;
    act(() => {
      fireEvent.pointerDown(outside);
    });
    expect(container.querySelector('[data-project-menu-panel]')).toBeNull();
    // Focus returns to the toggle -- same contract as Escape, just a
    // different way in.
    expect(document.activeElement).toBe(container.querySelector('[data-project-menu="p1"]'));
  });

  it('does not close-then-reopen when the outside press IS the toggle button itself', () => {
    const { container } = mount(twoProjects());
    openMenu(container);
    const toggle = container.querySelector('[data-project-menu="p1"]') as HTMLElement;
    act(() => {
      fireEvent.pointerDown(toggle);
    });
    // The dismiss listener must not have closed it out from under the
    // button's own click handler, which fires next and would reopen it --
    // reading as a dead button on the first real press.
    expect(container.querySelector('[data-project-menu-panel="p1"]')).not.toBeNull();
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
      newSessionDecline: 'factory has no new-session command',
    });
    const add = container.querySelector<HTMLButtonElement>('[data-new-project]');
    // No native `title` any more — the refusal now surfaces through the
    // Radix ShortcutTip, asserted in shortcut-tip.test.tsx, so it opens on
    // keyboard focus too.
    expect(add?.getAttribute('title')).toBeNull();
  });

  it('names the per-project add for what it does, and no longer calls it a placeholder', () => {
    const entries = twoProjects();
    const { container } = mountWith(entries, { focusedSessionId: 'b1' });
    expect(container.querySelector('[data-placeholder="new-session-in-project"]')).toBeNull();
    openProjectMenu(container, 'p2');
    const add = container.querySelector<HTMLButtonElement>(
      '[data-project-menu-panel="p2"] [data-project-menu-item="new-session"]',
    );
    // No native `title`, for the reason the header `+` lost its own: a caption
    // that opens on hover and nothing else is unreachable from a keyboard. It
    // needs no tooltip either -- the item is a word, and the project it means
    // is the panel it is inside (`<project> actions`).
    expect(add?.getAttribute('title')).toBeNull();
    expect(add?.textContent).toBe('New session');
  });

  /**
   * Audit item 1 (S2). This is the assertion that had to move surfaces --
   * TWICE. The refusal used to be a `title` while `aria-label` promised a new
   * session unconditionally, so a keyboard user pressed the button, got
   * silence, and had no route to the reason; the tooltip was that route.
   *
   * It does not need to be a tooltip any more. The reason it was one is that
   * an icon button has nowhere to put a sentence -- and this control is a menu
   * item now, which has. Visible text is the surface that needs no hover, no
   * focus and no assistive technology to reach.
   */
  it('prints the refusal on the item itself when the source cannot create', () => {
    const { container } = mountWith(twoProjects(), {
      focusedSessionId: 'b1',
      newSessionDecline: 'factory has no new-session command',
    });
    openProjectMenu(container, 'p1');
    const add = container.querySelector<HTMLButtonElement>(
      '[data-project-menu-item="new-session"]',
    );
    expect(add?.getAttribute('title')).toBeNull();
    expect(add?.textContent).toContain('factory has no new-session command');
    // Still pressable: refusing on click and saying why is honest, while a
    // control that cannot be pressed just reads as broken.
    expect(add?.disabled).toBe(false);
  });
});

/**
 * The wiring half of `reveal-row.ts`: does focus moving actually hand the
 * scroller what the rule computed?
 *
 * happy-dom does no layout, so every rect and `clientHeight` here is stubbed —
 * which is exactly why the arithmetic is not tested through this seam. What is
 * worth holding here, and only here, is that the component reads the row and
 * the scroller (not the window), passes the numbers through, and stays still
 * when the rule says `null`. An assertion that `scrollTo` was called would
 * prove none of that.
 */
describe('SessionList reveals the focused row', () => {
  /** The element OverlayScroll actually scrolls, with a fake 600px window. */
  function stubScroller(container: HTMLElement) {
    const scroller = container.querySelector('.vam-no-scrollbar') as HTMLElement;
    Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });
    scroller.getBoundingClientRect = () => new DOMRect(0, 0, 264, 600);
    scroller.scrollTop = 0;
    const calls: { top?: number; behavior?: string }[] = [];
    scroller.scrollTo = (options?: unknown) => {
      calls.push(options as { top?: number; behavior?: string });
    };
    return calls;
  }

  /** Put a row's box wherever the case needs it, in viewport coordinates. */
  function stubRow(container: HTMLElement, id: string, top: number) {
    const row = container.querySelector(`[data-session-row="${id}"]`) as HTMLElement;
    row.getBoundingClientRect = () => new DOMRect(0, top, 244, 60);
  }

  it('scrolls the minimum distance to a row below the fold', () => {
    const entries = twoProjects();
    const props = baseProps(entries);
    const { container, rerender } = render(<SessionList {...props} />);
    const calls = stubScroller(container);
    // 1000px down a 600px viewport parked at 0: its bottom edge is 460.
    stubRow(container, 'a2', 1000);

    act(() => {
      rerender(<SessionList {...props} focusedSessionId="a2" />);
    });

    expect(calls).toEqual([{ top: 460, behavior: 'smooth' }]);
  });

  it('does not move for a row that is already in view', () => {
    const entries = twoProjects();
    const props = baseProps(entries);
    const { container, rerender } = render(<SessionList {...props} />);
    const calls = stubScroller(container);
    stubRow(container, 'a2', 100);

    act(() => {
      rerender(<SessionList {...props} focusedSessionId="a2" />);
    });

    expect(calls).toEqual([]);
  });

  it('jumps instead of gliding under prefers-reduced-motion', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      // `addEventListener`/`removeEventListener`, unlike the narrower stub
      // this used to be: `usePhoneViewport` (`SessionList.tsx` now imports
      // it, for the filter popover's own keyboard-safe cap) calls both on
      // whatever `matchMedia` returns, the same shape every other test file
      // that stubs `matchMedia` already provides (`Canvas.demo-foreign.test.tsx`).
      value: (query: string) => ({
        matches: query.includes('reduced-motion'),
        addEventListener() {},
        removeEventListener() {},
      }),
    });
    try {
      const entries = twoProjects();
      const props = baseProps(entries);
      const { container, rerender } = render(<SessionList {...props} />);
      const calls = stubScroller(container);
      stubRow(container, 'a2', 1000);

      act(() => {
        rerender(<SessionList {...props} focusedSessionId="a2" />);
      });

      expect(calls).toEqual([{ top: 460, behavior: 'auto' }]);
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(window, 'matchMedia');
      } else {
        Object.defineProperty(window, 'matchMedia', original);
      }
    }
  });
});

/**
 * Removing a project: what it ends, what it merely hides, and what it says
 * before doing either.
 *
 * The item exists BECAUSE a project is derived from live sessions, not in
 * spite of it. Ending every session vam started leaves the project on screen
 * -- some other terminal is still running in that directory -- so removal is
 * an end AND a hide, and the confirm has to say which sessions get which,
 * with the real counts rather than a general warning. `removalPlan` owns that
 * split and is tested apart; these hold the surface over it.
 *
 * The destructive path is asserted BY VALUE in both directions: cancelling
 * closes nothing at all, and confirming closes exactly the ids vam controls.
 */
describe('removing a project', () => {
  /** One project vam started half of: `a1` is vam's, `a2` is somebody's terminal. */
  function mixed(): SessionEntry[] {
    const alpha = makeProject({ id: 'p1', name: 'alpha' }, []);
    return [
      { project: alpha, session: makeSession({ id: 'a1', title: 'one', vamControlled: true }) },
      { project: alpha, session: makeSession({ id: 'a2', title: 'two', vamControlled: false }) },
    ];
  }

  function openMenu(container: HTMLElement) {
    fireEvent.click(container.querySelector('[data-project-menu="p1"]') as HTMLElement);
  }

  function openConfirm(container: HTMLElement) {
    openMenu(container);
    fireEvent.click(container.querySelector('[data-project-menu-item="remove"]') as HTMLElement);
  }

  it('offers the item in red, with a trash icon at its left', () => {
    const { container } = mount(mixed());
    openMenu(container);
    const item = container.querySelector('[data-project-menu-item="remove"]') as HTMLElement;
    expect(item.textContent).toContain('Remove project');
    // Its own token, never `failed`: `--vam-failed` means a session failed,
    // and a menu item wearing it would read as a status.
    expect(item.className).toContain('text-danger');
    const icon = item.querySelector('svg');
    expect(icon?.getAttribute('class')).toContain('lucide-trash');
    // Left of the label, which is DOM order here -- the row is a flex row.
    expect(item.firstElementChild).toBe(icon);
  });

  it('opens a confirm instead of acting', () => {
    const onClose = vi.fn();
    const { container } = render(<SessionList {...baseProps(mixed())} onClose={onClose} />);
    openConfirm(container);
    expect(container.querySelector('[data-confirm-remove]')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    // Still on screen: nothing has been removed yet.
    expect(container.querySelector('[data-project-id="p1"]')).not.toBeNull();
  });

  it('counts what it will end and what it will only hide, from the real sessions', () => {
    const { container } = mount(mixed());
    openConfirm(container);
    expect(container.querySelector('[data-confirm-end-count]')?.textContent).toBe('1');
    expect(container.querySelector('[data-confirm-hide-count]')?.textContent).toBe('1');
  });

  it('does not put the destructive button under the keyboard', () => {
    const { container } = mount(mixed());
    openConfirm(container);
    expect(document.activeElement).toBe(container.querySelector('[data-confirm-cancel]'));
  });

  it('ASKS FOR NOTHING when cancelled', () => {
    const onRemoveProject = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <SessionList {...baseProps(mixed())} onClose={onClose} onRemoveProject={onRemoveProject} />,
    );
    openConfirm(container);
    fireEvent.click(container.querySelector('[data-confirm-cancel]') as HTMLElement);
    expect(onRemoveProject).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('[data-confirm-remove]')).toBeNull();
    expect(container.querySelector('[data-project-id="p1"]')).not.toBeNull();
  });

  it('cancels on Escape too, and keeps the key to itself', () => {
    const onClose = vi.fn();
    const seen: string[] = [];
    const listener = (event: KeyboardEvent) => seen.push(event.key);
    window.addEventListener('keydown', listener);
    try {
      const { container } = render(<SessionList {...baseProps(mixed())} onClose={onClose} />);
      openConfirm(container);
      const shell = container.querySelector('[data-confirm-remove]') as HTMLElement;
      fireEvent.keyDown(shell, { key: 'j' });
      fireEvent.keyDown(shell, { key: 'Escape' });
      expect(container.querySelector('[data-confirm-remove]')).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      // An open overlay owns the keyboard: neither key reached the window.
      expect(seen).toEqual([]);
    } finally {
      window.removeEventListener('keydown', listener);
    }
  });

  it('hands the caller the EXACT plan it disclosed, and ends nothing itself', () => {
    const onRemoveProject = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <SessionList {...baseProps(mixed())} onClose={onClose} onRemoveProject={onRemoveProject} />,
    );
    openConfirm(container);
    fireEvent.click(container.querySelector('[data-confirm-remove-go]') as HTMLElement);
    // The same two sets the dialog counted, by value. The component performs
    // none of it: the caller ends, hides and reports, because only it can
    // refuse -- see the props.
    expect(onRemoveProject.mock.calls).toEqual([
      [expect.objectContaining({ id: 'p1' }), { end: ['a1'], hide: ['a2'] }],
    ]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes a project vam cannot end a single session of', () => {
    const alpha = makeProject({ id: 'p1', name: 'alpha' }, []);
    const onClose = vi.fn();
    const entries = [{ project: alpha, session: makeSession({ id: 'a1', title: 'one' }) }];
    const onRemoveProject = vi.fn();
    const { container } = render(
      <SessionList {...baseProps(entries)} onClose={onClose} onRemoveProject={onRemoveProject} />,
    );
    openConfirm(container);
    expect(container.querySelector('[data-confirm-end-count]')?.textContent).toBe('0');
    fireEvent.click(container.querySelector('[data-confirm-remove-go]') as HTMLElement);
    // Nothing to end, and the removal is still asked for: the sessions keep
    // running and the project stops being drawn. That IS the removal for a
    // project vam did not start.
    expect(onRemoveProject.mock.calls).toEqual([
      [expect.objectContaining({ id: 'p1' }), { end: [], hide: ['a1'] }],
    ]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks for a removed project to be brought back', () => {
    const onHideProject = vi.fn();
    const { container } = render(
      <SessionList {...baseProps(mixed())} hiddenProjects={['p1']} onHideProject={onHideProject} />,
    );
    const restore = container.querySelector('[data-restore-project="p1"]') as HTMLElement;
    expect(restore.textContent).toContain('alpha');
    fireEvent.click(restore);
    expect(onHideProject.mock.calls).toEqual([[expect.objectContaining({ id: 'p1' }), false]]);
  });

  it('draws a hidden project the caller passed in as hidden', () => {
    const { container } = render(
      <SessionList {...baseProps(mixed())} hiddenProjects={['p1']} onHideProject={noop} />,
    );
    expect(container.querySelector('[data-project-id="p1"]')).toBeNull();
    expect(container.querySelector('[data-restore-project="p1"]')).not.toBeNull();
  });
});

/**
 * The confirm counts the PROJECT, not the page.
 *
 * `Canvas` narrows `entries` by search, status and the two origin rules --
 * `hideAgentStarted` DEFAULTS TO TRUE -- and then hides the whole project. A
 * plan computed over the narrowed list therefore understates both numbers: it
 * promises to end one session, ends one, and hides four, leaving three
 * vam-started sessions running with no row to reach them by. The direction is
 * under-kill, so nothing unowned dies -- but a confirm that misstates what it
 * is about to do is the thing that teaches an operator to click through it.
 *
 * So the plan and the restore strip read `allEntries`, which is the set before
 * any filter.
 */
describe('removing a project, under a filter', () => {
  const alpha = makeProject({ id: 'p1', name: 'alpha' }, []);
  const beta = makeProject({ id: 'p2', name: 'beta' }, []);
  const all: SessionEntry[] = [
    { project: alpha, session: makeSession({ id: 'a1', title: 'one', vamControlled: true }) },
    { project: alpha, session: makeSession({ id: 'a2', title: 'two', vamControlled: true }) },
    { project: alpha, session: makeSession({ id: 'a3', title: 'three' }) },
    { project: beta, session: makeSession({ id: 'b1', title: 'beta one' }) },
  ];
  /** What a default `hideAgentStarted` leaves of alpha: one row of three. */
  const narrowed = [all[0] as SessionEntry];

  it('counts every session in the project, not the ones a filter left', () => {
    const { container } = render(<SessionList {...baseProps(narrowed)} allEntries={all} />);
    fireEvent.click(container.querySelector('[data-project-menu="p1"]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-project-menu-item="remove"]') as HTMLElement);
    expect(container.querySelector('[data-confirm-end-count]')?.textContent).toBe('2');
    expect(container.querySelector('[data-confirm-hide-count]')?.textContent).toBe('1');
  });

  it('plans every vam-controlled session in the project, including filtered-out rows', () => {
    const onRemoveProject = vi.fn();
    const { container } = render(
      <SessionList {...baseProps(narrowed)} allEntries={all} onRemoveProject={onRemoveProject} />,
    );
    fireEvent.click(container.querySelector('[data-project-menu="p1"]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-project-menu-item="remove"]') as HTMLElement);
    fireEvent.click(container.querySelector('[data-confirm-remove-go]') as HTMLElement);
    // `a2` has no row on screen. Hiding the project while leaving it running
    // would strand it.
    expect(onRemoveProject.mock.calls).toEqual([
      [expect.objectContaining({ id: 'p1' }), { end: ['a1', 'a2'], hide: ['a3'] }],
    ]);
  });

  it('keeps the restore control when a search matches only another project', () => {
    // p1 is removed, and the operator searches for something only beta
    // matches: the removed project has no entry left in `entries`, and its
    // only way back must not vanish with it.
    const { container } = render(
      <SessionList
        {...baseProps([all[3] as SessionEntry])}
        allEntries={all}
        hiddenProjects={['p1']}
      />,
    );
    expect(container.querySelector('[data-restore-project="p1"]')?.textContent).toContain('alpha');
  });
});

/**
 * A15.3: the restore strip is a momentary receipt for a momentary action, not
 * a standing cost. It shows the moment a project is hidden, then lets itself
 * go — and because it is now the OWN reason a hidden project's only route
 * back could vanish, the filter menu grows a permanent "Hidden projects"
 * section that never times out, so restoring stays reachable long after the
 * strip has gone.
 */
describe('A15.3: the restore strip shows for a while, then goes — reachably', () => {
  const alpha = makeProject({ id: 'p1', name: 'alpha' }, []);
  const beta = makeProject({ id: 'p2', name: 'beta' }, []);
  const entries: SessionEntry[] = [
    { project: alpha, session: makeSession({ id: 'a1', title: 'one' }) },
    { project: beta, session: makeSession({ id: 'b1', title: 'two' }) },
  ];

  it('shows the strip right away, then lets it go on its own — without un-hiding the project', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <SessionList {...baseProps(entries)} hiddenProjects={['p1']} onHideProject={noop} />,
      );
      expect(
        container.querySelector('[data-restore-strip] [data-restore-project="p1"]'),
      ).not.toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(RESTORE_STRIP_VISIBLE_MS + 100);
      });
      expect(container.querySelector('[data-restore-strip]')).toBeNull();
      // Gone from the strip, not un-hidden: the project is still absent from
      // the live list, and `onHideProject` was never called by a timer.
      expect(container.querySelector('[data-project-id="p1"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives the strip a fresh window when another project is hidden mid-countdown', async () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <SessionList {...baseProps(entries)} hiddenProjects={['p1']} onHideProject={noop} />,
      );
      await act(async () => {
        vi.advanceTimersByTime(RESTORE_STRIP_VISIBLE_MS - 500);
      });
      expect(container.querySelector('[data-restore-strip]'), 'not yet expired').not.toBeNull();
      // A second project is hidden with the first countdown almost done.
      rerender(
        <SessionList {...baseProps(entries)} hiddenProjects={['p1', 'p2']} onHideProject={noop} />,
      );
      // Past the FIRST countdown's original deadline -- still showing, both
      // named, because the second hide reset the clock rather than letting
      // the first one expire underneath it.
      await act(async () => {
        vi.advanceTimersByTime(600);
      });
      const strip = container.querySelector('[data-restore-strip]');
      expect(strip, 'reset by the second hide').not.toBeNull();
      expect(strip?.querySelector('[data-restore-project="p1"]')).not.toBeNull();
      expect(strip?.querySelector('[data-restore-project="p2"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides the strip immediately once every hidden project is restored, never waiting out the timer', async () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <SessionList {...baseProps(entries)} hiddenProjects={['p1']} onHideProject={noop} />,
      );
      rerender(<SessionList {...baseProps(entries)} hiddenProjects={[]} onHideProject={noop} />);
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      expect(container.querySelector('[data-restore-strip]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries its own shortcut to the filter menu on the SAME row as the chips, right-aligned', () => {
    const onFilterMenuToggle = vi.fn();
    const { container } = render(
      <SessionList
        {...baseProps(entries)}
        hiddenProjects={['p1']}
        onHideProject={noop}
        onFilterMenuToggle={onFilterMenuToggle}
      />,
    );
    const strip = container.querySelector('[data-restore-strip]');
    const chip = strip?.querySelector('[data-restore-project="p1"]');
    const shortcut = strip?.querySelector('[data-restore-strip-more]');
    expect(shortcut, 'the shortcut hint').not.toBeNull();
    // SAME ROW: siblings under the same parent, not a second line stacked
    // below the chips in a wrapper of its own.
    expect(shortcut?.parentElement).toBe(chip?.parentElement);
    fireEvent.click(shortcut as HTMLElement);
    expect(onFilterMenuToggle).toHaveBeenCalledWith(true);
  });

  it('lists hidden projects in the filter menu too — the route that survives the strip going away', async () => {
    vi.useFakeTimers();
    try {
      const onHideProject = vi.fn();
      const { container } = render(
        <SessionList
          {...baseProps(entries)}
          hiddenProjects={['p1']}
          onHideProject={onHideProject}
          filterMenuOpen
        />,
      );
      // Let the strip itself expire.
      await act(async () => {
        vi.advanceTimersByTime(RESTORE_STRIP_VISIBLE_MS + 100);
      });
      expect(container.querySelector('[data-restore-strip]')).toBeNull();
      // The filter menu's own copy is untimed and still there.
      const inMenu = container.querySelector('[data-filter-menu] [data-restore-project="p1"]');
      expect(inMenu, 'the surviving route').not.toBeNull();
      fireEvent.click(inMenu as HTMLElement);
      expect(onHideProject.mock.calls).toEqual([[expect.objectContaining({ id: 'p1' }), false]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says nothing about hidden projects in the filter menu when nothing is hidden', () => {
    const { container } = render(
      <SessionList {...baseProps(entries)} hiddenProjects={[]} filterMenuOpen />,
    );
    expect(container.querySelector('[data-filter-hidden-projects]')).toBeNull();
  });
});
