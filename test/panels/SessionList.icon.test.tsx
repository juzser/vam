// @vitest-environment happy-dom

/**
 * The sidebar draws no icon for a session -- and still draws one per project.
 *
 * This file used to assert the opposite: that the row drew whatever the shared
 * resolver resolved, checked against `resolveSessionGlyph` rather than against
 * a repeated literal. The operator removed that display ("bo icon o truoc
 * session name trong sidebar, chi de o project"), so the subject here is now
 * its absence, on both row shapes -- the ordinary row and the rename editor,
 * which drew the same slot. The chain itself did not go away; it is pinned
 * beside the canvas root node, the one surface that still draws it.
 *
 * The project heading's icon is a different control with its own picker and
 * its own placeholder, and it is asserted here so that "the sidebar shows no
 * icon" can never be satisfied by removing both.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project, Session, SourceId } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { SessionList } from '../../src/renderer/panels/SessionList.js';
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
  return { id: 'p1', name: 'vam', source: 'black-smith' as SourceId, sessions: [], ...over };
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
});
