// @vitest-environment happy-dom

/**
 * A session with no glyph anywhere must still show something you can see.
 *
 * The chain used to end in a middot drawn at 11px in a dim colour, which is
 * indistinguishable from an empty slot -- the operator reported it as "no
 * icon for sessions in the sidebar", and the icon was there the whole time.
 * The answer was a real glyph, the same one the project heading draws.
 *
 * This file was written when TWO surfaces drew a session icon: it rendered one
 * entry into the sidebar row and into the canvas root node and compared the
 * two icon slots to each other, so drift failed rather than passing twice.
 * The sidebar's display has since been removed at the operator's request, so
 * the comparison has one side left and the agreement cases below assert what
 * the remaining surface draws for each link of the chain -- same four inputs,
 * same four expectations, one reader instead of two. The sidebar's side is not
 * unasserted: `test/panels/SessionList.icon.test.tsx` now pins its absence.
 */

import { cleanup, render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionInfoNode } from '../../src/renderer/canvas/SessionInfoNode.js';
import type { Project, Session, SourceId } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';

afterEach(cleanup);

const SOURCE = 'black-smith' as SourceId;

function entryOf(sessionIcon: string | null, projectIcon: string | null): SessionEntry {
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
    icon: projectIcon,
  };
  return { project, session };
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

/** The canvas root node's icon control, for one entry rendered alone. */
function nodeSlot(entry: SessionEntry): HTMLElement {
  const { container } = render(
    <ReactFlowProvider>
      <SessionInfoNode
        id="info"
        data={{ entry, focused: false, jumpLabel: null, onPickIcon: () => undefined }}
        {...FLOW_PROPS}
      />
    </ReactFlowProvider>,
  );
  const slot = container.querySelector<HTMLElement>('[data-session-icon]');
  expect(slot, 'the root node drew no icon control; every assertion here is vacuous').not.toBe(
    null,
  );
  return slot as HTMLElement;
}

/** What the slot draws: a resolved glyph, or the drawn placeholder. */
function drawn(slot: HTMLElement): string {
  const placeholder = slot.querySelector('[data-session-icon-placeholder]');
  return placeholder === null ? `glyph:${slot.textContent}` : 'placeholder';
}

describe('a session with no glyph anywhere', () => {
  it('draws a visible placeholder on the canvas root node, not an invisible mark', () => {
    const slot = nodeSlot(entryOf(null, null));
    expect(slot.querySelector('svg'), 'the root node drew no placeholder glyph').not.toBe(null);
    expect(slot.textContent).toBe('');
  });
});

describe('the canvas root node answers every link of the chain', () => {
  const cases: ReadonlyArray<readonly [string, SessionEntry, string]> = [
    ['neither the session nor its project has one', entryOf(null, null), 'placeholder'],
    ['the session has its own', entryOf('🦀', null), 'glyph:🦀'],
    ['only the project has one', entryOf(null, '📦'), 'glyph:📦'],
    ['both do, and the session wins', entryOf('🦀', '📦'), 'glyph:🦀'],
  ];

  for (const [label, entry, expected] of cases) {
    it(`draws ${expected} when ${label}`, () => {
      expect(drawn(nodeSlot(entry))).toBe(expected);
    });
  }
});
