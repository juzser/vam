// @vitest-environment happy-dom

/**
 * The sidebar draws no icon for a session -- and still draws one per project.
 *
 * This file used to assert the opposite: that the row drew whatever the shared
 * resolver resolved, checked against `resolveSessionGlyph` rather than against
 * a repeated literal. The operator removed that display ("bo icon o truoc
 * session name trong sidebar, chi de o project"), so the subject here is now
 * its absence, on both row shapes -- the ordinary row and the rename editor,
 * which drew the same slot. The chain itself did not go away; it is pinned in
 * isolation at `test/panels/session-icon.test.ts` and live at the tab strip
 * (`test/canvas/Canvas.tab-strip.test.tsx`), the surface that draws it since
 * the 0.2 migration retired the canvas root node.
 *
 * The project heading's icon is a different control with its own picker and
 * its own placeholder, and it is asserted here so that "the sidebar shows no
 * icon" can never be satisfied by removing both.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Group, Project, Session, SourceId } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import {
  HEADING_GLYPH_PX,
  HEADING_SLOT_PX,
  SessionList,
} from '../../src/renderer/panels/SessionList.js';
import { MARK_LANE_PX } from '../../src/renderer/panels/status-mark.js';
import { baseProps } from './session-list-props.js';

afterEach(cleanup);

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    title: 'alpha-refactor',
    icon: null,
    epic: null,
    branch: 'work',
    status: 'running',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
    ...over,
  };
}

function project(over: Partial<Project> = {}): Project {
  return { id: 'p1', name: 'vam', source: 'factory' as SourceId, sessions: [], ...over };
}

function mount(entries: readonly SessionEntry[], over: Record<string, unknown> = {}) {
  return render(<SessionList {...baseProps(entries)} {...over} />);
}

describe('a session row carries no icon', () => {
  it('draws no icon slot, and no glyph either end of the chain would have given it', () => {
    const owned: SessionEntry = {
      project: project({ icon: '📦' }),
      session: session({ id: 'own', icon: '🦀' }),
    };
    const inherited: SessionEntry = {
      project: project({ icon: '📦' }),
      session: session({ id: 'inherited' }),
    };
    const { container } = mount([owned, inherited]);
    expect(container.querySelector('[data-row-icon]')).toBe(null);
    for (const id of ['own', 'inherited']) {
      const row = container.querySelector(`[data-session-row="${id}"]`);
      expect(row, `no row for ${id}; the assertion below would be vacuous`).not.toBe(null);
      expect(row?.textContent).not.toContain('🦀');
      expect(row?.textContent).not.toContain('📦');
      // The empty end of the chain used to draw a lucide placeholder in the
      // row. The row still has svg of its own (the branch glyph), so this is
      // asserted on the placeholder's own marker rather than on `svg`.
      expect(row?.querySelector('[data-session-icon-placeholder]')).toBe(null);
    }
  });

  it('draws no icon slot in the rename editor either', () => {
    const entry: SessionEntry = { project: project({ icon: '📦' }), session: session() };
    const { container } = mount([entry], { renamingId: 's1' });
    const input = container.querySelector('input[aria-label="rename session"]');
    expect(input, 'the rename editor did not open; the assertion below would be vacuous').not.toBe(
      null,
    );
    // The rename row's slot never carried `data-row-icon`, so it is asserted
    // by what it drew: the project glyph this session inherits, and the
    // placeholder the empty chain would have drawn instead.
    const editor = input?.parentElement as HTMLElement;
    expect(editor.textContent).not.toContain('📦');
    expect(editor.querySelector('[data-session-icon-placeholder]')).toBe(null);
  });
});

describe('the project heading keeps its own icon', () => {
  it('draws the project glyph, and its placeholder when nobody picked one', () => {
    const { container } = mount([{ project: project({ icon: '📦' }), session: session() }]);
    expect(container.querySelector('[data-project-icon="p1"]')?.textContent).toBe('📦');
    cleanup();
    const bare = mount([{ project: project(), session: session() }]);
    expect(bare.container.querySelector('[data-project-icon-placeholder]')).not.toBe(null);
  });

  /**
   * THE SAME SLOT, THE OTHER KIND OF ICON. The heading has drawn an emoji
   * since it existed, so what needs holding is that a lucide value lands in
   * the SAME control -- same `data-project-icon`, same slot, same picker
   * behind it -- rather than in a second slot beside it. An icon that moved
   * when you coloured it would be two controls wearing one name.
   */
  it('draws a named glyph in its tone in the same slot an emoji uses', () => {
    const { container } = mount([
      { project: project({ icon: 'lucide:rocket:teal' }), session: session() },
    ]);
    const slot = container.querySelector('[data-project-icon="p1"]');
    const glyph = slot?.querySelector('[data-icon-glyph]');
    expect(glyph?.getAttribute('data-icon-glyph')).toBe('rocket');
    expect(glyph?.getAttribute('data-icon-tone')).toBe('teal');
    expect(glyph?.getAttribute('class')).toContain('text-icon-teal');
    // The placeholder is what "no icon" looks like, and a drawn icon is not
    // that: both at once would be the slot drawing two answers.
    expect(slot?.querySelector('[data-project-icon-placeholder]')).toBe(null);
  });

  it('falls back to the placeholder for a glyph name this build does not have', () => {
    const { container } = mount([
      { project: project({ icon: 'lucide:nonesuch' }), session: session() },
    ]);
    expect(container.querySelector('[data-project-icon-placeholder]')).not.toBe(null);
    expect(container.querySelector('[data-project-icon="p1"]')?.textContent).not.toContain(
      'lucide',
    );
  });
});

/**
 * THE THIRD LEVEL. A group is the operator's own grouping of projects
 * (`model.ts`), so it has the same two questions the other two levels have and
 * must not answer them differently: the point of the change is that "an icon"
 * means one thing at all three levels rather than three things that happen to
 * look alike.
 */
describe('a group heading takes both kinds too', () => {
  function withGroup(icon: string | null) {
    const p = project({ id: 'p1' });
    const group: Group = { id: 'g1', name: 'build', icon, projects: [p] };
    const entries: SessionEntry[] = [{ project: p, session: session(), group }];
    return mount(entries, { groups: [group], collapsedGroups: [] });
  }

  it('draws a named glyph in its tone', () => {
    const { container } = withGroup('lucide:flask-conical:purple');
    const heading = container.querySelector('[data-group-icon="g1"]');
    expect(heading, 'no group heading rendered; the assertions below would be vacuous').not.toBe(
      null,
    );
    const glyph = heading?.querySelector('[data-icon-glyph]');
    expect(glyph?.getAttribute('data-icon-glyph')).toBe('flask-conical');
    expect(glyph?.getAttribute('class')).toContain('text-icon-purple');
  });

  it('still draws an emoji stored before glyphs existed', () => {
    const { container } = withGroup('🌙');
    expect(container.querySelector('[data-group-icon="g1"]')?.textContent).toBe('🌙');
  });
});

/**
 * HOW BIG A HEADING'S ICON IS — the operator's "icon ở sidebar cần lớn hơn",
 * settled against a number the sidebar already had rather than a preference.
 *
 * `MARK_LANE_PX` is the 14px box every session's status mark is centred in,
 * and its own comment says what the geometry is supposed to mean: the lane
 * sits under the heading's slot, so "a session's mark reads as a smaller
 * relative of the heading's glyph rather than as its equal". THE PAINT SAID
 * THE OPPOSITE. The slot was the larger box (15 over 14), but the GLYPHS
 * inside the two boxes went the other way: a mark drew at 12px and a
 * heading's glyph at 11px, so the level above was the smaller mark on screen
 * — the inversion the operator was looking at.
 *
 * So the heading's glyph is now the lane itself: as tall as the whole box the
 * mark below it is merely centred in, which makes the claim `status-mark.tsx`
 * already makes true for the first time. DERIVED, not copied — the assertion
 * below reads `MARK_LANE_PX`, so moving the lane moves this with it and the
 * two cannot drift into two answers about one relationship.
 *
 * WHAT THIS FILE CANNOT SEE, said plainly: an emoji is text and takes its size
 * from the slot's type class, not from this number, and happy-dom resolves no
 * Tailwind. The two kinds' PAINTED ink is measured in
 * `e2e/sidebar-tree-shots.mjs`, where it turns out an emoji's ink runs three to
 * four pixels past its font-size while a lucide glyph's is exactly its `size`.
 * One number never sized both kinds; this is the half that is a number.
 */
describe('a heading icon is the larger mark, which is what the geometry always claimed', () => {
  const glyphBox = (el: Element | null | undefined) => {
    const svg = el?.querySelector('svg');
    return svg === null || svg === undefined
      ? null
      : { w: svg.getAttribute('width'), h: svg.getAttribute('height') };
  };

  it('draws a project heading glyph at the status lane, so the level above is never the smaller mark', () => {
    const { container } = mount([
      { project: project({ icon: 'lucide:rocket:teal' }), session: session() },
    ]);
    const slot = container.querySelector('[data-project-icon="p1"]');
    expect(slot, 'no project heading icon; the assertion below would be vacuous').not.toBe(null);
    expect(glyphBox(slot)).toEqual({ w: String(HEADING_GLYPH_PX), h: String(HEADING_GLYPH_PX) });
  });

  it('draws the placeholder at the same size, so "none picked" is not a smaller mark either', () => {
    const { container } = mount([{ project: project(), session: session() }]);
    const placeholder = container.querySelector('[data-project-icon-placeholder]');
    expect(placeholder, 'no placeholder rendered; the assertion below would be vacuous').not.toBe(
      null,
    );
    expect(placeholder?.getAttribute('width')).toBe(String(HEADING_GLYPH_PX));
  });

  it('gives a group heading the same number, because a level is not a third kind of icon', () => {
    const p = project({ id: 'p1' });
    const group: Group = {
      id: 'g1',
      name: 'build',
      icon: 'lucide:flask-conical:purple',
      projects: [p],
    };
    const { container } = mount([{ project: p, session: session(), group }], {
      groups: [group],
      collapsedGroups: [],
    });
    const slot = container.querySelector('[data-group-icon="g1"]');
    expect(slot, 'no group heading rendered; the assertion below would be vacuous').not.toBe(null);
    expect(glyphBox(slot)).toEqual({ w: String(HEADING_GLYPH_PX), h: String(HEADING_GLYPH_PX) });
  });

  it('derives the glyph from the slot and keeps it above the lane, so the two headings cannot drift', () => {
    // The relationship, not a repeated literal: the glyph is the heading's
    // slot less four pixels of air, and the slot is the name's own line box
    // (`--text-heading--line-height`, 20). A change to either has to move
    // the heading with it or this fails, which is the whole reason the
    // number is derived rather than typed twice. And it stays ABOVE the
    // status lane: the level above is never the smaller mark, which is the
    // claim this whole file exists for.
    expect(HEADING_GLYPH_PX).toBe(HEADING_SLOT_PX - 4);
    expect(HEADING_GLYPH_PX).toBeGreaterThan(MARK_LANE_PX);
  });
});
