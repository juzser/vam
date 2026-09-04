// @vitest-environment happy-dom

/**
 * A session with no glyph anywhere must still show something you can see.
 *
 * The chain used to end in a middot drawn at 11px in a dim colour, which is
 * indistinguishable from an empty slot -- the operator reported it as "no
 * icon for sessions in the sidebar", and the icon was there the whole time.
 * The project heading in the same file had already answered this case with a
 * real glyph, so the session row now answers it the same way.
 *
 * The two surfaces are asserted to agree by construction rather than by two
 * literals that can drift: the same entry is rendered into the sidebar row
 * and into the canvas root node, and the markup of the two icon slots is
 * compared to itself.
 */

import { cleanup, render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionInfoNode } from '../../src/renderer/canvas/SessionInfoNode.js';
import type { Project, Session, SourceId } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { SessionList } from '../../src/renderer/panels/SessionList.js';
import { baseProps } from '../panels/session-list-props.js';

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

/** The sidebar row's icon slot, for one entry rendered alone. */
function rowSlot(entry: SessionEntry): HTMLElement {
  const { container } = render(<SessionList {...baseProps([entry])} />);
  const slot = container.querySelector<HTMLElement>('[data-row-icon="s1"]');
  expect(slot, 'the sidebar drew no icon slot; every assertion here is vacuous').not.toBe(null);
  return slot as HTMLElement;
}

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

/** What the slot draws, normalised so the two surfaces are comparable. */
function drawn(slot: HTMLElement): string {
  const placeholder = slot.querySelector('[data-session-icon-placeholder]');
  return placeholder === null ? `glyph:${slot.textContent}` : 'placeholder';
}

describe('a session with no glyph anywhere', () => {
  const bare = entryOf(null, null);

  it('draws a visible placeholder in the sidebar, not an invisible mark', () => {
    const slot = rowSlot(bare);
    expect(slot.querySelector('svg'), 'the row drew no placeholder glyph').not.toBe(null);
    expect(slot.textContent).toBe('');
  });

  it('draws the same visible placeholder on the canvas root node', () => {
    const slot = nodeSlot(bare);
    expect(slot.querySelector('svg'), 'the root node drew no placeholder glyph').not.toBe(null);
    expect(slot.textContent).toBe('');
  });
});

describe('the two surfaces answer the chain identically', () => {
  const cases: ReadonlyArray<readonly [string, SessionEntry, string]> = [
    ['neither the session nor its project has one', entryOf(null, null), 'placeholder'],
    ['the session has its own', entryOf('🦀', null), 'glyph:🦀'],
    ['only the project has one', entryOf(null, '📦'), 'glyph:📦'],
    ['both do, and the session wins', entryOf('🦀', '📦'), 'glyph:🦀'],
  ];

  for (const [label, entry, expected] of cases) {
    it(`agrees when ${label}`, () => {
      const row = drawn(rowSlot(entry));
      const node = drawn(nodeSlot(entry));
      expect(row).toBe(node);
      expect(row).toBe(expected);
    });
  }
});
