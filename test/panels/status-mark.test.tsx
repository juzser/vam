// @vitest-environment happy-dom

/**
 * The five status marks, held to the two things a dot never had to promise:
 * that each status is a distinct SHAPE, and that the lane they share never
 * changes size when one becomes another.
 *
 * The status list is READ FROM THE TABLE, never retyped here. A second copy of
 * `'running' | 'waiting' | 'idle' | 'done' | 'failed'` in a test file is a list
 * that drifts silently: `vitest` does not typecheck, so a sixth status added
 * to the union and to the component would leave this file green while proving
 * nothing about it. `SESSION_STATUSES` is `Object.keys` of the one table the
 * component renders from, and that table is a `Record<SessionStatus, …>` — so
 * a new member fails to compile until it has a mark, and arrives here by
 * itself the moment it does.
 *
 * Three of the assertions below read `styles.css` rather than the DOM. That is
 * not laziness: `prefers-reduced-motion` and an animation's iteration count
 * are decided in the stylesheet, happy-dom resolves no media query and runs no
 * animation, and a component test that asserted the CLASS would prove only
 * that the class was typed. The real paint is measured in
 * `e2e/sidebar-tree-shots.mjs`, which drives a real Chromium with reduced
 * motion emulated; these hold the rule's text so that a deletion is caught in
 * the fast gate too.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MARK_LANE_PX,
  SESSION_STATUSES,
  SPIN_PERIOD_MS,
  StatusMark,
  spinPhaseMs,
} from '../../src/renderer/panels/status-mark.js';

const CSS = readFileSync(resolve(__dirname, '../../src/renderer/styles.css'), 'utf8');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function markFor(status: string): HTMLElement {
  const { container } = render(<StatusMark status={status as never} />);
  const mark = container.querySelector<HTMLElement>(`[data-status-mark="${status}"]`);
  expect(mark, `no mark drawn for ${status}`).not.toBeNull();
  return mark as HTMLElement;
}

/** The lucide glyph inside a mark, by the vendor's own name for it — the one
 *  thing in the DOM that tells two icons apart once both are paths. */
function glyphs(mark: Element): string[] {
  return [...mark.querySelectorAll('svg')].flatMap((svg) =>
    [...svg.classList].filter((name) => name.startsWith('lucide-')),
  );
}

describe('the status mark', () => {
  it('covers every status the model has, derived from the table and not retyped', () => {
    // The guard against the two lists drifting: six is what the union spells
    // today -- `unstarted` is the sixth, an open pane with nothing in it
    // (`model.ts`) -- and the moment it spells seven this fails until a mark
    // exists.
    expect([...SESSION_STATUSES].sort()).toEqual(
      ['done', 'failed', 'idle', 'running', 'unstarted', 'waiting'].sort(),
    );
    for (const status of SESSION_STATUSES) {
      expect(markFor(status)).not.toBeNull();
      cleanup();
    }
  });

  it('draws every status in the same fixed lane, so nothing reflows when one becomes another', () => {
    // A status changes under the operator's eyes. If the mark sized itself,
    // the title beside it would shift every time an agent asked a question.
    const lanes = new Set<string>();
    for (const status of SESSION_STATUSES) {
      const mark = markFor(status);
      // A style rather than an `h-[14px]` class, and asserted as one: a class
      // built from a constant is invisible to Tailwind's scanner, so the rule
      // would never be generated and this box would collapse to its content.
      expect(mark.style.width).toBe(`${MARK_LANE_PX}px`);
      expect(mark.style.height).toBe(`${MARK_LANE_PX}px`);
      expect(mark.className).toContain('flex-none');
      lanes.add(`${mark.className}|${mark.style.cssText}`);
      cleanup();
    }
    // Not merely "each declares the size" -- the whole lane is one string for
    // all five, so no status can buy itself a different box.
    expect(lanes.size).toBe(1);
  });

  it('gives each status its own glyph, and keeps the dot for idle alone', () => {
    expect(glyphs(markFor('running'))).toContain('lucide-loader-circle');
    cleanup();
    expect(glyphs(markFor('waiting'))).toEqual(['lucide-bell']);
    cleanup();
    expect(glyphs(markFor('failed'))).toEqual(['lucide-triangle-alert']);
    cleanup();

    // `Check`, NOT `CircleCheck`: the circled one draws a second ring into a
    // column that already has one turning in it, and the row is not a badge.
    const done = markFor('done');
    expect(glyphs(done)).toEqual(['lucide-check']);
    expect(done.querySelector('circle')).toBeNull();
    cleanup();

    // Idle is the one status that means "nothing is happening", and a drawn
    // glyph for nothing-happening would be the loudest mark in a column of
    // rows that are mostly idle. It keeps the 7px dot it always had.
    const idle = markFor('idle');
    expect(glyphs(idle)).toEqual([]);
    expect(idle.innerHTML).toContain('h-[7px]');
    expect(idle.innerHTML).toContain('bg-idle');
  });

  it('draws at a caller’s own lane and glyph, with the row’s sizes as the defaults', () => {
    // The tab strip's line is 16px under a 12px title, not the row's 20 under
    // 13, so it asks for a 12px lane with the glyph filling it
    // (`TAB_MARK_LANE_PX` in `Canvas.tsx` carries the argument). Both numbers
    // reach the DOM: the lane as the box's inline size, the glyph as the
    // `<svg>`'s own width -- and the glyph is the SAME glyph, so the two
    // surfaces cannot come to draw two bells.
    const { container } = render(<StatusMark status="waiting" lane={12} glyph={10} />);
    const mark = container.querySelector<HTMLElement>('[data-status-mark]');
    expect(mark?.style.width).toBe('12px');
    expect(mark?.style.height).toBe('12px');
    const svg = mark?.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('10');
    expect(svg?.getAttribute('height')).toBe('10');
    expect(glyphs(mark as Element)).toEqual(['lucide-bell']);
    cleanup();
    // And the defaults are the row's, unchanged: an existing caller that
    // passes nothing draws exactly what it drew.
    const row = markFor('waiting');
    expect(row.style.width).toBe(`${MARK_LANE_PX}px`);
    expect(row.querySelector('svg')?.getAttribute('width')).toBe('12');
  });

  it('names the status aloud, once, for a reader who cannot see a shape at all', () => {
    const mark = markFor('waiting');
    expect(mark.textContent).toBe('waiting');
    expect(mark.querySelector('.sr-only')?.textContent).toBe('waiting');
  });

  it('can be silenced where the row already prints the word', () => {
    // The phone row draws `needs you · 12m · branch` a few pixels below. A
    // second, invisible copy would simply be read twice.
    const { container } = render(<StatusMark status="waiting" announce={false} />);
    expect(container.querySelector('[data-status-mark]')?.textContent).toBe('');
  });
});

describe('the running mark turns on one clock', () => {
  /**
   * WHY THIS IS NOT "the class is there".
   *
   * A CSS animation starts when its element does, so five rows that mounted at
   * five different moments spin at five different angles -- a column of
   * spinners visibly out of step, which is what makes a list look busy rather
   * than working. The fix is a negative `animation-delay` read off the wall
   * clock: an element mounted at `t` starts life `t % period` into the turn,
   * which is the angle every other mark is already at.
   *
   * So the invariant is not the delay's value, it is that mount time plus
   * delay is the SAME instant for every mark -- checked here across a 300ms
   * gap, which is a quarter of a turn and would be unmissable on screen.
   */
  it('starts each spinner where the clock already is, not at zero', () => {
    vi.useFakeTimers();
    const first = 1_700_000_000_123;
    vi.setSystemTime(new Date(first));
    const a = render(<StatusMark status="running" />);
    vi.setSystemTime(new Date(first + 300));
    const b = render(<StatusMark status="running" />);

    const delayOf = (root: ParentNode) => {
      const spin = root.querySelector<HTMLElement>('[data-mark-motion="spin"]');
      expect(spin, 'no spinning mark').not.toBeNull();
      return Number.parseFloat((spin as HTMLElement).style.animationDelay);
    };
    expect(delayOf(a.container)).toBe(-spinPhaseMs(first));
    expect(delayOf(b.container)).toBe(-spinPhaseMs(first + 300));
    // The angle both are drawn at, in ms of one turn: equal, which is the
    // whole claim. A per-component animation start gives 0 for both delays
    // and 300ms of disagreement here.
    const angle = (mount: number, delay: number) => (mount + delay) % SPIN_PERIOD_MS;
    expect(angle(first, delayOf(a.container))).toBe(angle(first + 300, delayOf(b.container)));
  });

  it('measures the turn in the same number the stylesheet does', () => {
    // Two numbers for one period is how a resync becomes a stutter. The
    // stylesheet owns the animation; this constant only has to agree with it.
    const rule = /\.vam-spin\s*\{[^}]*animation:\s*vam-spin\s+([\d.]+)s/.exec(CSS);
    expect(rule, 'no .vam-spin rule in styles.css').not.toBeNull();
    expect(Number((rule as RegExpExecArray)[1]) * 1000).toBe(SPIN_PERIOD_MS);
  });

  it('parks on a whole ring when motion is off, never on a gapped arc', () => {
    // `LoaderCircle` is an arc with a bite out of it. Frozen, it is not a
    // paused spinner -- it is a broken ring, and reads as damage. So the
    // running mark carries two bodies and the stylesheet picks one.
    const running = markFor('running');
    const rest = running.querySelector('[data-mark-motion="rest"]');
    expect(rest, 'no resting body for the running mark').not.toBeNull();
    expect([...(rest as Element).classList]).toContain('lucide-circle');
    expect(rest?.querySelector('circle')).not.toBeNull();

    // Which body shows is a media query, which happy-dom does not resolve --
    // so the rule's existence is held here and its paint in the web guard.
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{/.exec(CSS);
    expect(reduced).not.toBeNull();
    const tail = CSS.slice((reduced as RegExpExecArray).index);
    expect(tail).toMatch(/\[data-mark-motion='spin'\][^{]*\{\s*display:\s*none/);
    expect(CSS).toMatch(/\[data-mark-motion='rest'\][^{]*\{\s*display:\s*none/);
  });
});

describe('the waiting mark swings once and stops', () => {
  it('rings a finite number of times', () => {
    expect(markFor('waiting').querySelector('.vam-swing')).not.toBeNull();
    const rule = /\.vam-swing\s*\{([^}]*)\}/.exec(CSS);
    expect(rule, 'no .vam-swing rule in styles.css').not.toBeNull();
    const body = (rule as RegExpExecArray)[1];
    // A bell that never stops is a smoke alarm. The count is a number, and
    // the only forbidden value is the one CSS defaults to reaching for.
    expect(body).not.toContain('infinite');
    expect(body).toMatch(/animation:\s*vam-swing\s+[\d.]+m?s[^;]*\s\d+\s*;/);
  });

  it('settles upright rather than leaning', () => {
    const frames = /@keyframes vam-swing \{([^@]*?)\n\}/s.exec(CSS);
    expect(frames, 'no vam-swing keyframes').not.toBeNull();
    // The last frame is the resting pose, and it is the pose the bell holds
    // for the rest of the wait -- so it has to be upright.
    expect((frames as RegExpExecArray)[1]).toMatch(/100%\s*\{\s*transform:\s*rotate\(0deg\)/);
  });

  it('stops with the rest of them when motion is off', () => {
    const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.vam-swing');
  });
});
