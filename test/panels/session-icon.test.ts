/**
 * The fallback chain, in isolation: session glyph -> project glyph -> null.
 *
 * Relocated from `test/canvas/root-node-icon.test.tsx` (0.2 migration step
 * 2): `resolveSessionGlyph` never rendered anything and never depended on the
 * graph — only the two tests that rendered `SessionInfoNode` through it died
 * with that node. The chain's own drawn end (`SessionIcon`'s `Monitor`
 * placeholder) is exercised where it is actually mounted now: the tab strip,
 * in `test/canvas/Canvas.tab-strip.test.tsx`.
 */

import { describe, expect, it } from 'vitest';
import type { CanvasModel, Project, Session, SourceId } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { resolveSessionGlyph } from '../../src/renderer/panels/session-icon.js';
import {
  applyIcons,
  readPrefs,
  type StorageLike,
  setIcon,
  setProjectIcon,
} from '../../src/renderer/prefs/prefs.js';

const SOURCE = 'factory' as SourceId;

function entryOf(sessionIcon: string | null, projectIcon?: string | null): SessionEntry {
  const session: Session = {
    id: 's1',
    title: 'alpha-refactor',
    icon: sessionIcon,
    epic: null,
    branch: null,
    status: 'running',
    runningAgents: 1,
    activity: null,
    age: '12m',
    decisions: [],
  };
  const project: Project = {
    id: 'p1',
    name: 'vam',
    source: SOURCE,
    sessions: [session],
    ...(projectIcon === undefined ? {} : { icon: projectIcon }),
  };
  return { project, session };
}

function modelOf(entry: SessionEntry): CanvasModel {
  return { projects: [{ ...entry.project, sessions: [entry.session] }] };
}

/** The one entry back out of a model `applyIcons` has rewritten. */
function entryFrom(model: CanvasModel): SessionEntry {
  const project = model.projects[0] as Project;
  return { project, session: project.sessions[0] as Session };
}

/** A storage stub holding one payload, enough for `readPrefs` to parse. */
function storageOf(payload: unknown): StorageLike {
  return {
    getItem: () => JSON.stringify(payload),
    setItem: () => undefined,
  };
}

describe('the fallback chain is stated once', () => {
  it('prefers the session own glyph over the project one', () => {
    expect(resolveSessionGlyph(entryOf('🦊', '🏭'))).toBe('🦊');
  });

  it('falls back to the project glyph, which is the operator default', () => {
    expect(resolveSessionGlyph(entryOf(null, '🏭'))).toBe('🏭');
  });

  it('falls back to the neutral mark when neither has been chosen', () => {
    expect(resolveSessionGlyph(entryOf(null, null))).toBe(null);
    expect(resolveSessionGlyph(entryOf(null))).toBe(null);
  });
});

describe('clearing a session icon gives the project one back', () => {
  it('resolves to the project glyph after an empty pick clears the choice', () => {
    const now = new Date('2026-09-04T00:00:00.000Z');
    let prefs = setProjectIcon(readPrefs(null, now), SOURCE, 'p1', '🏭', now);
    prefs = setIcon(prefs, SOURCE, 's1', '🦊', now);
    const chosen = entryFrom(applyIcons(modelOf(entryOf(null)), prefs.icons, prefs.projectIcons));
    expect(resolveSessionGlyph(chosen)).toBe('🦊');

    prefs = setIcon(prefs, SOURCE, 's1', '', now);
    const cleared = entryFrom(applyIcons(modelOf(entryOf(null)), prefs.icons, prefs.projectIcons));
    expect(resolveSessionGlyph(cleared)).toBe('🏭');
  });
});

describe('a pruned session choice falls back rather than going blank', () => {
  it('shows the project glyph when the TTL has pruned the session one', () => {
    // Both buckets share one TTL, so age them apart: the session's choice is
    // older than the window, the project's is inside it.
    const now = new Date('2026-09-04T00:00:00.000Z');
    const prefs = readPrefs(
      storageOf({
        icons: { [SOURCE]: { s1: { icon: '🦊', at: '2026-01-01T00:00:00.000Z' } } },
        projectIcons: { [SOURCE]: { p1: { icon: '🏭', at: '2026-09-01T00:00:00.000Z' } } },
      }),
      now,
    );
    expect(prefs.icons[SOURCE]?.s1).toBeUndefined();
    const entry = entryFrom(applyIcons(modelOf(entryOf(null)), prefs.icons, prefs.projectIcons));
    expect(resolveSessionGlyph(entry)).toBe('🏭');
  });
});
