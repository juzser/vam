// @vitest-environment happy-dom

/**
 * The root node's icon: one fallback chain, one picker.
 *
 * The chain is session glyph -> project glyph -> a drawn placeholder, and it
 * lives in one module because it states what a session's glyph IS. It was
 * adopted by two call sites; the sidebar's was removed at the operator's
 * request, so this node is the only surface that draws it and these tests are
 * the only place the drawn end of the chain is asserted. They pin the chain
 * itself, the two ways a session's own choice can go away (cleared by hand,
 * pruned by the TTL), and the fact that the node's icon is a control that
 * opens the picker the `s` chord opens.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionInfoNode } from '../../src/renderer/canvas/SessionInfoNode.js';
import { resolveSessionGlyph } from '../../src/renderer/canvas/session-icon.js';
import type { CanvasModel, Project, Session, SourceId } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import {
  applyIcons,
  readPrefs,
  type StorageLike,
  setIcon,
  setProjectIcon,
} from '../../src/renderer/prefs/prefs.js';

afterEach(cleanup);

const SOURCE = 'black-smith' as SourceId;

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

const FLOW_PROPS = {
  selected: false,
  dragging: false,
  draggable: false,
  selectable: false,
  deletable: false,
  type: 'info',
  zIndex: 0,
  isConnectable: false,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
} as const;

function renderNode(entry: SessionEntry, onPickIcon: (entry: SessionEntry) => void) {
  const { container } = render(
    <ReactFlowProvider>
      <SessionInfoNode
        id="info"
        data={{ entry, focused: false, jumpLabel: null, onPickIcon }}
        {...FLOW_PROPS}
      />
    </ReactFlowProvider>,
  );
  const button = container.querySelector<HTMLButtonElement>('[data-session-icon]');
  expect(
    button,
    'the root node drew no icon control; every assertion below would be vacuous',
  ).not.toBe(null);
  return { container, button: button as HTMLButtonElement };
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

describe('the root node draws the icon before the title, and it opens the picker', () => {
  it('draws the resolved glyph ahead of the session title', () => {
    const { container, button } = renderNode(entryOf(null, '🏭'), () => undefined);
    expect(button.textContent).toBe('🏭');
    const title = container.querySelector('.vam-clamp-2') as HTMLElement;
    expect(
      button.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
  });

  it('hands the whole entry to the one picker route when clicked', () => {
    const onPickIcon = vi.fn();
    const entry = entryOf(null, '🏭');
    const { button } = renderNode(entry, onPickIcon);
    fireEvent.click(button);
    expect(onPickIcon).toHaveBeenCalledWith(entry);
  });
});
