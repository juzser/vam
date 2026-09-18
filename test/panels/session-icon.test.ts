/**
 * The fallback chain, in isolation: session icon -> project icon -> null.
 *
 * Relocated from `test/canvas/root-node-icon.test.tsx` (0.2 migration step
 * 2): `resolveSessionIcon` never rendered anything and never depended on the
 * graph — only the two tests that rendered `SessionInfoNode` through it died
 * with that node. The chain's own drawn end (`SessionIcon`'s `Monitor`
 * placeholder) is exercised where it is actually mounted now: the tab strip,
 * in `test/canvas/Canvas.tab-strip.test.tsx`.
 *
 * SINCE AN ICON CAN CARRY A COLOUR, this file answers a second question with
 * the same tests: which chain the COLOUR comes down. The answer is "this one,
 * because there is only one" — the tone is a field of the value the chain
 * resolves, not a parallel lookup — and the last two `describe`s hold it to
 * that. A second chain would be able to produce a session drawing its
 * project's emoji in its own stored tone, a state nobody chose and one that
 * cannot be painted at all.
 */

import { describe, expect, it } from 'vitest';
import type { CanvasModel, Project, Session, SourceId } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import type { IconValue } from '../../src/renderer/panels/icon-value.js';
import { resolveSessionIcon } from '../../src/renderer/panels/session-icon.js';
import {
  applyIcons,
  readPrefs,
  type StorageLike,
  setIcon,
  setProjectIcon,
} from '../../src/renderer/prefs/prefs.js';

const SOURCE = 'factory' as SourceId;

/** What the chain resolves an old-shaped value to, spelled once. */
const emoji = (char: string): IconValue => ({ kind: 'emoji', emoji: char });

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
    expect(resolveSessionIcon(entryOf('🦊', '🏭'))).toEqual(emoji('🦊'));
  });

  it('falls back to the project glyph, which is the operator default', () => {
    expect(resolveSessionIcon(entryOf(null, '🏭'))).toEqual(emoji('🏭'));
  });

  it('falls back to the neutral mark when neither has been chosen', () => {
    expect(resolveSessionIcon(entryOf(null, null))).toBe(null);
    expect(resolveSessionIcon(entryOf(null))).toBe(null);
  });
});

describe('clearing a session icon gives the project one back', () => {
  it('resolves to the project glyph after an empty pick clears the choice', () => {
    const now = new Date('2026-09-04T00:00:00.000Z');
    let prefs = setProjectIcon(readPrefs(null, now), SOURCE, 'p1', '🏭', now);
    prefs = setIcon(prefs, SOURCE, 's1', '🦊', now);
    const chosen = entryFrom(applyIcons(modelOf(entryOf(null)), prefs.icons, prefs.projectIcons));
    expect(resolveSessionIcon(chosen)).toEqual(emoji('🦊'));

    prefs = setIcon(prefs, SOURCE, 's1', '', now);
    const cleared = entryFrom(applyIcons(modelOf(entryOf(null)), prefs.icons, prefs.projectIcons));
    expect(resolveSessionIcon(cleared)).toEqual(emoji('🏭'));
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
    expect(resolveSessionIcon(entry)).toEqual(emoji('🏭'));
  });
});

describe('the colour comes down this chain, because there is only one', () => {
  it("inherits the project's tone with the project's glyph", () => {
    // The session has chosen nothing, so it shows the project's icon — and a
    // tone is part of that icon rather than a second thing to look up, so it
    // arrives with it. This is the whole reason the tone lives inside the
    // stored value: nothing here had to know that colours exist.
    expect(resolveSessionIcon(entryOf(null, 'lucide:rocket:teal'))).toEqual({
      kind: 'glyph',
      glyph: 'rocket',
      tone: 'teal',
    });
  });

  it('gives a glyph stored with no tone the default one', () => {
    expect(resolveSessionIcon(entryOf('lucide:bug'))).toEqual({
      kind: 'glyph',
      glyph: 'bug',
      tone: 'neutral',
    });
  });

  it('lets a session own emoji win outright over the project coloured glyph', () => {
    // NOT "the session's emoji in the project's teal". An emoji takes no tone
    // at all, and the chain stops at the first link that answers.
    expect(resolveSessionIcon(entryOf('🦊', 'lucide:rocket:teal'))).toEqual(emoji('🦊'));
  });

  it('lets a session own tone override the project one for the same glyph', () => {
    expect(resolveSessionIcon(entryOf('lucide:rocket:pink', 'lucide:rocket:teal'))).toEqual({
      kind: 'glyph',
      glyph: 'rocket',
      tone: 'pink',
    });
  });
});

describe('a value this build cannot draw falls through the chain', () => {
  it('shows the project icon when the session names a glyph that is not here', () => {
    // What a NEWER vam's icon looks like to this one. The alternative is a tab
    // reading `lucide:nonesuch`, which is vam printing its storage format at
    // the operator.
    expect(resolveSessionIcon(entryOf('lucide:nonesuch', '🏭'))).toEqual(emoji('🏭'));
  });

  it('ends at the placeholder when nothing in the chain can be drawn', () => {
    expect(resolveSessionIcon(entryOf('lucide:nonesuch', 'lucide:alsonot'))).toBe(null);
  });
});
