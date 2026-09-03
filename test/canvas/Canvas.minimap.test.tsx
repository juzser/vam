// @vitest-environment happy-dom

/**
 * The minimap, measured against the ADE mockup.
 *
 * The mockup draws it as a chip per session cell, each carrying its status
 * colour, over a panel the same greys as the canvas — and it does NOT dim the
 * world outside the viewport. The viewport is an OUTLINE: a hairline in the
 * ink colour around the part you are looking at, with the rest left legible.
 * A dark mask (xyflow's default, and what vam shipped) turns the one control
 * that answers "where am I in this canvas" into the one control that hides
 * most of the answer.
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

  it('outlines the viewport instead of dimming everything around it', () => {
    render(<Canvas model={MODEL} />);
    const map = document.querySelector<HTMLElement>('.react-flow__minimap');
    expect(map).toBeTruthy();
    const style = map?.getAttribute('style') ?? '';
    expect(style).toContain('--xy-minimap-mask-background-color-props: transparent');
    expect(style).toContain('--xy-minimap-mask-stroke-color-props: var(--color-ink)');
  });
});
