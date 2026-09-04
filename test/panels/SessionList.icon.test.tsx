// @vitest-environment happy-dom

/**
 * The sidebar row and the canvas node answer the icon question the same way.
 *
 * `resolveSessionIcon` states the chain -- session glyph, else project glyph,
 * else the neutral mark -- in one place precisely so two surfaces cannot
 * disagree, and the sidebar inlined its own half of it. The test that matters
 * is therefore not "the row draws an icon" but "the row draws what the shared
 * resolver says", asserted against the resolver rather than against a repeated
 * literal.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NEUTRAL_SESSION_ICON,
  resolveSessionIcon,
} from '../../src/renderer/canvas/session-icon.js';
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

const rowIcon = (id: string) =>
  document.querySelector<HTMLElement>(`[data-row-icon="${id}"]`)?.textContent ?? null;

function mount(entries: readonly SessionEntry[]) {
  return render(<SessionList {...baseProps(entries)} />);
}

describe('the sidebar row reads the shared icon chain', () => {
  it('falls back to the project’s glyph when the session has none', () => {
    const entry: SessionEntry = { project: project({ icon: '📦' }), session: session() };
    mount([entry]);
    expect(rowIcon('s1')).toBe('📦');
    expect(rowIcon('s1')).toBe(resolveSessionIcon(entry));
  });

  it('prefers the session’s own glyph, and never leaves the slot empty', () => {
    const owned: SessionEntry = {
      project: project({ icon: '📦' }),
      session: session({ id: 'own', icon: '🦀' }),
    };
    const bare: SessionEntry = { project: project(), session: session({ id: 'bare' }) };
    mount([owned, bare]);
    expect(rowIcon('own')).toBe('🦀');
    expect(rowIcon('bare')).toBe(NEUTRAL_SESSION_ICON);
    // Both surfaces, one answer -- which is the disagreement this adoption ends.
    expect(rowIcon('own')).toBe(resolveSessionIcon(owned));
    expect(rowIcon('bare')).toBe(resolveSessionIcon(bare));
  });
});
