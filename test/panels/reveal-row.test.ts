/**
 * The sidebar's "scroll the focused row into view" rule.
 *
 * The operator's request is "scroll sidebar nếu session focus ở sidebar nằm
 * ngoài viewport của sidebar" — when the focused row lies outside the
 * sidebar's visible area, the sidebar should come to it. The half that is
 * easy to get wrong is the other one: `j`/`k` move focus constantly, and a
 * list that re-scrolls on every move jitters worse than one that never
 * scrolls at all. So the rule is a pure function over four numbers and is
 * tested here, not through the DOM: happy-dom does no layout and reports 0
 * for every rect and scroll metric, so an effect-level test would be
 * asserting the environment's zeroes.
 */

import { describe, expect, it } from 'vitest';
import { revealScrollTop } from '../../src/renderer/panels/reveal-row.js';

/** A 600px viewport parked at the top, unless a case says otherwise. */
const view = { scrollTop: 0, viewportHeight: 600 };

describe('revealScrollTop', () => {
  it('leaves a fully visible row alone', () => {
    expect(revealScrollTop({ rowTop: 100, rowHeight: 60, ...view })).toBeNull();
  });

  it('leaves a row flush with either edge alone', () => {
    expect(revealScrollTop({ rowTop: 0, rowHeight: 60, ...view })).toBeNull();
    expect(revealScrollTop({ rowTop: 540, rowHeight: 60, ...view })).toBeNull();
  });

  it('brings a row above the viewport to the top edge', () => {
    expect(revealScrollTop({ rowTop: 200, rowHeight: 60, scrollTop: 500, viewportHeight: 600 })).toBe(
      200,
    );
  });

  it('brings a row below the viewport to the bottom edge, not to the middle', () => {
    // 1000 + 60 = 1060 must become the bottom of a 600px viewport.
    expect(revealScrollTop({ rowTop: 1000, rowHeight: 60, ...view })).toBe(460);
  });

  it('moves the minimum distance for a row clipped at the bottom edge', () => {
    // Ten pixels hang below the fold; ten pixels is the whole scroll.
    expect(revealScrollTop({ rowTop: 550, rowHeight: 60, ...view })).toBe(10);
  });

  it('moves the minimum distance for a row clipped at the top edge', () => {
    expect(
      revealScrollTop({ rowTop: 490, rowHeight: 60, scrollTop: 500, viewportHeight: 600 }),
    ).toBe(490);
  });

  it('aligns a row taller than the viewport to its top, so it starts where it starts', () => {
    expect(revealScrollTop({ rowTop: 800, rowHeight: 900, ...view })).toBe(800);
  });

  it('never scrolls above the top of the content', () => {
    expect(revealScrollTop({ rowTop: -50, rowHeight: 60, scrollTop: 0, viewportHeight: 600 })).toBe(
      0,
    );
  });

  it('does nothing in an unmeasured viewport, rather than jumping to zero', () => {
    // happy-dom, and any element not laid out yet, report 0 for everything.
    expect(revealScrollTop({ rowTop: 0, rowHeight: 0, scrollTop: 0, viewportHeight: 0 })).toBeNull();
  });
});
