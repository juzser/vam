// @vitest-environment happy-dom

/**
 * A project heading's fold, its "…" menu and its own `+` are all revealed by
 * `onMouseEnter`/`onMouseLeave` (`revealed` state, `SessionList.tsx`) — a
 * hover a touch pointer never sends. Before this file, a phone could reach
 * none of the three on a project it had not ALREADY collapsed: the fold
 * button only forced itself visible when `isCollapsed` was already true,
 * which cannot be the state that PUTS it there, and the menu ("rename",
 * "icon", "worktree", "collapse") and the per-project `+` had no such
 * fallback at all. `collapsedProjects`/`onToggleCollapse` were already wired
 * end to end (`Canvas.tsx` passes both to the phone shell exactly as it does
 * the desktop column) — the fold was persisted, just unreachable by finger.
 *
 * `jsdom` lays nothing out, so a click always "works" here regardless of
 * `opacity-0`; what a real finger cannot do is find the button to press in
 * the first place. That is a paint fact (`a-44px-floor-does-not-check-the-
 * paint`), so the assertion below is a class scan, on the same rule this
 * repo's own content-scan tests already keep for `styles.css` -- these three
 * classes are literal Tailwind utilities on the element, generated at build
 * time, and the string on the rendered node is the strongest statement this
 * environment can make about them.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionList } from '../../src/renderer/panels/SessionList.js';
import { baseProps, twoProjects } from './session-list-props.js';

afterEach(() => cleanup());

const heading = (projectId: string) =>
  document.querySelector(`[data-project-heading][data-project-id="${projectId}"]`) as HTMLElement;

/** The bare, unprefixed class only -- `focus:opacity-100` is a different
 *  Tailwind utility (it only ever applies on focus) and every one of these
 *  buttons carries it permanently, on both surfaces. */
const classes = (el: Element | null) => (el?.className ?? '').split(/\s+/);

describe('a project heading’s reveal-only controls, on a phone', () => {
  it('paints the fold, the menu and the per-project + without a hover, only on a phone', () => {
    render(<SessionList {...baseProps(twoProjects())} phone width={undefined} />);
    const fold = heading('p1').querySelector('[data-project-collapse="p1"]');
    const menu = heading('p1').querySelector('[data-project-menu="p1"]');
    const add = heading('p1').querySelector('[data-new-session-in-project="p1"]');
    for (const [name, el] of [
      ['fold', fold],
      ['menu', menu],
      ['+', add],
    ] as const) {
      expect(el, name).not.toBeNull();
      expect(classes(el), name).toContain('opacity-100');
      expect(classes(el), name).not.toContain('opacity-0');
    }
  });

  it('keeps them hover-only on the desktop, where a pointer can hover', () => {
    render(<SessionList {...baseProps(twoProjects())} />);
    const fold = heading('p1').querySelector('[data-project-collapse="p1"]');
    const menu = heading('p1').querySelector('[data-project-menu="p1"]');
    const add = heading('p1').querySelector('[data-new-session-in-project="p1"]');
    for (const [name, el] of [
      ['fold', fold],
      ['menu', menu],
      ['+', add],
    ] as const) {
      expect(classes(el), name).toContain('opacity-0');
      expect(classes(el), name).not.toContain('opacity-100');
    }
  });

  it('still asks the caller to fold, and the fold still persists through the same prop pair the desktop uses', () => {
    const asked: string[] = [];
    render(
      <SessionList
        {...baseProps(twoProjects())}
        phone
        width={undefined}
        collapsedProjects={[]}
        onToggleCollapse={(project) => asked.push(project.id)}
      />,
    );
    act(() => {
      fireEvent.click(heading('p1').querySelector('[data-project-collapse="p1"]') as HTMLElement);
    });
    expect(asked).toEqual(['p1']);
  });
});
