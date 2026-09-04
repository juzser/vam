// @vitest-environment happy-dom

/**
 * The minimap, measured against the ADE mockup.
 *
 * The mockup draws it as a chip per session cell, each carrying its status
 * colour, over a panel the same greys as the canvas, with the viewport as a
 * hairline OUTLINE. vam reproduces the chips and not the outline: xyflow draws
 * that outline as a full rectangle, and at any ordinary zoom the viewport is
 * wider than the content, so its horizontal edges land off the map and only
 * two cut-off vertical rules remain. A light mask outside the viewport says
 * the same thing with no lines — light enough that the map still answers
 * "where am I in this canvas" rather than hiding the answer, which is what
 * xyflow's opaque default mask did.
 *
 * Colours are asserted as token references, never as values: `styles.css` owns
 * both themes, and a test that hard-coded the dark hex would pass while the
 * light theme rendered a chip nobody can see.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

function session(id: string, status: Session['status']): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status,
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
  };
}

/** One session per status, so every colour in the map has to be produced. */
const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'black-smith',
      sessions: [
        session('a1', 'running'),
        session('a2', 'waiting'),
        session('a3', 'done'),
        session('a4', 'failed'),
      ],
    },
  ],
};

const fills = () =>
  [...document.querySelectorAll<SVGRectElement>('.react-flow__minimap-node')].map(
    (el) => el.style.fill,
  );

beforeAll(() => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: (() => {
      const map = new Map<string, string>();
      return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
        key: () => null,
        get length() {
          return map.size;
        },
      };
    })() as unknown as Storage,
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the minimap', () => {
  it('paints one chip per session in that session’s status colour', () => {
    render(<Canvas model={MODEL} />);
    const painted = fills();
    expect(painted.length).toBeGreaterThan(0);
    for (const token of [
      'var(--color-running)',
      'var(--color-waiting)',
      'var(--color-done)',
      'var(--color-failed)',
    ]) {
      expect(painted.filter((f) => f === token)).toHaveLength(1);
    }
  });

  it('leaves the scenery out of it — a fan or a slot is not a session', () => {
    render(<Canvas model={MODEL} />);
    // Four sessions, four coloured chips; everything else is drawn transparent
    // rather than as another grey rectangle competing with them.
    const coloured = fills().filter((f) => f !== 'transparent');
    expect(coloured).toHaveLength(4);
  });

  it('dims outside the viewport rather than outlining it', () => {
    // The outline was replaced deliberately. ReactFlow draws it as a rectangle
    // around the visible area; when that area is wider than the content — the
    // normal case — its top and bottom edges fall outside the map and only the
    // two vertical edges survive, reading as two bright rules down the sides
    // instead of as a spotlight. A dimmed outside says the same thing with no
    // lines, and degrades correctly: with everything visible, nothing dims.
    render(<Canvas model={MODEL} />);
    const map = document.querySelector<HTMLElement>('.react-flow__minimap');
    expect(map).toBeTruthy();
    const style = map?.getAttribute('style') ?? '';
    expect(style).toContain('--xy-minimap-mask-background-color-props: color-mix(');
    expect(style).toContain('var(--color-canvas)');
    // And NOT outlined, in any tone. The outline has now been removed twice:
    // once in the ink colour, once in a line tone, and both times for the same
    // reason — the tone was never the problem, the geometry was. Re-adding it
    // must fail here rather than ship, so this asserts the absence of the
    // property itself and not of one particular colour.
    expect(style).not.toContain('--xy-minimap-mask-stroke-color-props');
    expect(style).not.toContain('--xy-minimap-mask-stroke-width-props');
  });

  it('draws chips wider than the node they stand for, so a session is visible', () => {
    // `nodeStrokeWidth` is in FLOW units and is drawn around the chip, which
    // makes it the only lever that renders a chip larger than its node. Raised
    // to 70 with the map narrowed: a smaller map makes every chip smaller, so
    // the chip has to grow for the sessions to read larger rather than
    // smaller, which is what was actually asked for.
    render(<Canvas model={MODEL} />);
    const map = document.querySelector<HTMLElement>('.react-flow__minimap');
    // ReactFlow writes these through inline style, not attributes — the same
    // way the existing fill assertions read them.
    const strokes = [
      ...(map?.querySelectorAll<SVGRectElement>('.react-flow__minimap-node') ?? []),
    ].map((n) => n.style.strokeWidth || n.getAttribute('stroke-width'));
    expect(strokes.length, 'no minimap chips rendered — the test proves nothing').toBeGreaterThan(
      0,
    );
    expect(strokes.every((w) => Number(w) >= 70)).toBe(true);
  });
});

/**
 * The map's own footprint.
 *
 * Pinned because it is the value that trades against the chips: a narrower map
 * scales every chip down, so the width and `nodeStrokeWidth` have to move
 * together. A future change to one without the other is exactly the regression
 * worth catching, and neither number is visible from the other's test.
 */
describe('the minimap gives its width back to the canvas', () => {
  it('is narrower than the mockup, and keeps its height', () => {
    render(<Canvas model={MODEL} />);
    const map = document.querySelector<HTMLElement>('.react-flow__minimap');
    expect(map).toBeTruthy();
    expect(map?.style.width).toBe('132px');
    expect(map?.style.height).toBe('56px');
  });
});
