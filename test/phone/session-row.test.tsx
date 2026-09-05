// @vitest-environment happy-dom

/**
 * The session row, as a phone draws it.
 *
 * WHAT THE DESKTOP ROW SPENDS ITS SECOND LINE ON, measured at 390px before any
 * of this: a branch icon and an em dash. `session.branch` is `null` for every
 * black-smith session -- the worktree line is on `docs/ade-redesign.md`'s
 * placeholder table, waiting on data the factory does not report -- so a whole
 * line of a 63.5px row, on the narrowest screen vam has, said nothing. The
 * same line carried the age in `ink-faint`, which measures 3.27:1 dark and
 * 3.01:1 light and fails AA in both (issue 188); and status was the 7px dot
 * alone, which is colour as the only channel (WCAG 1.4.1, Level A) on the one
 * surface with no canvas beside it repeating the same fact.
 *
 * So on a phone the line says `running · 26m`, in `ink-dim` (6.74/6.77), with
 * the branch appended only when there IS one. A waiting row says `needs you`
 * in the `waiting` token -- which is session state, exactly what that token
 * means, and no other row borrows it -- and carries the open question below.
 *
 * WHAT THIS FILE CAN AND CANNOT ASK. The tokens are Tailwind utilities
 * generated at build time, not rules in `styles.css`, so no cascade in this
 * environment resolves `text-ink-dim` to a colour: the class list on the
 * rendered node is the strongest available statement and is what is asserted.
 * The contrast figures above are `measurements.json`'s, not this file's. What
 * IS measured here is the tree: which elements exist, what they say, and that
 * the desktop's row is unchanged beside them.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { SessionList } from '../../src/renderer/panels/SessionList.js';
import {
  baseProps,
  decision,
  makeProject,
  makeSession,
} from '../panels/session-list-props.js';

const ASKED = 'Does cross-origin EventSource reach the 127.0.0.1 server?';

function entries(): SessionEntry[] {
  const project = makeProject({ id: 'p1', name: 'black-smith' }, []);
  return [
    {
      project,
      session: makeSession({
        id: 'a1',
        title: 'factory-sse-1',
        status: 'waiting',
        branch: null,
        age: '4m',
        decisions: [{ ...decision('d7', 'answered'), input: ASKED }],
      }),
    },
    {
      project,
      session: makeSession({ id: 'a2', title: 'crosscheck-2', status: 'running', branch: null, age: '26m' }),
    },
    {
      project,
      session: makeSession({ id: 'a3', title: 'dogfood-4', status: 'done', branch: 'feat/x', age: '2h' }),
    },
  ];
}

const draw = (phone: boolean) =>
  render(
    <SessionList
      {...baseProps(entries())}
      focusedSessionId="a1"
      {...(phone ? { phone: true, width: undefined } : {})}
    />,
  );

const metas = () => [...document.querySelectorAll('[data-row-meta]')].map((n) => n.textContent);
const row = (id: string) => document.querySelector(`[data-session-row="${id}"]`) as HTMLElement;

afterEach(() => cleanup());

describe('the phone row’s second line', () => {
  it('says the status and the age, and never a dash for a branch nobody reports', () => {
    draw(true);
    // No spaces: each `·` is its own element and the gap between segments is
    // layout, so `textContent` runs them together.
    expect(metas()).toEqual(['needs you·4m', 'running·26m', 'done·2h·feat/x']);
    // The dash line is gone, not restyled: a null branch draws no segment.
    expect(document.querySelectorAll('[data-session-branch]').length).toBe(1);
    expect(document.body.textContent).not.toContain('—');
  });

  it('reads at AA, which ink-faint does not', () => {
    draw(true);
    for (const meta of document.querySelectorAll('[data-row-meta]')) {
      expect(meta.className, meta.textContent ?? '').toContain('text-ink-dim');
      expect(meta.className, meta.textContent ?? '').not.toContain('text-ink-faint');
    }
  });

  it('spends a status token on the waiting row only, because that is what it is', () => {
    draw(true);
    const needsYou = document.querySelector('[data-row-needs-you]');
    expect(needsYou?.textContent).toBe('needs you');
    expect(needsYou?.className).toContain('text-waiting');
    expect(document.querySelectorAll('[data-row-needs-you]').length).toBe(1);
  });
});

describe('the phone row’s other two departures', () => {
  it('gives the waiting row the question it is waiting on, which no pane beside it answers', () => {
    draw(true);
    const asks = [...document.querySelectorAll('[data-row-question]')];
    expect(asks.length, 'only the waiting row').toBe(1);
    expect(asks[0]?.textContent).toBe(ASKED);
  });

  it('draws no cursor bar and no focus ring, for a cursor a phone does not have', () => {
    draw(true);
    // `focusedId` does not move when the session screen closes, so after one
    // round trip the ring marks a session the operator has already left -- and
    // it measures 2.15:1 on the light canvas, under even the 3:1 non-text
    // floor (issue 188).
    expect(row('a1').className).not.toContain('border-line-loud');
    expect(row('a1').querySelector('[data-row-cursor]')).toBeNull();
    // The title stops dimming, because the dimming existed to make ONE row
    // pop out of a column for a keyboard.
    for (const title of document.querySelectorAll('[data-row-title]')) {
      expect(title.className).toContain('text-ink');
      expect(title.className).not.toContain('text-ink-dim');
    }
  });
});

describe('the text the phone list screen is made of', () => {
  /**
   * `ink-faint` measures 3.27:1 dark and 3.01:1 light and fails AA in both
   * (issue 188). 68 sites carry it across the two panels and issue 188 owns
   * that sweep; these are the ones ON SCREEN in the 390px captures, and the
   * empty state is the only thing on screen at all when there are no sessions.
   */
  it('keeps no ink-faint on the search label, the captions or the empty state', () => {
    draw(true);
    // FOUND, then judged. A sweep that asserts "none of these is faint" over a
    // corpus it never located is green having examined nothing, which is how
    // four guards in a sibling repo passed over zero files.
    const named = (text: string) => {
      const hit = [...document.querySelectorAll('span, button')].filter(
        (n) => (n.textContent ?? '').trim() === text,
      );
      expect(hit.length, `no element on this screen reads "${text}"`).toBeGreaterThan(0);
      return hit;
    };
    for (const node of named('Search sessions')) {
      // The control as well as the label: the class sits on the button, and a
      // check that only reached the inner span survived reverting it.
      expect(node.className, 'the search label').not.toContain('text-ink-faint');
      expect(node.closest('button')?.className, 'the search control').not.toContain(
        'text-ink-faint',
      );
    }

    // The filter popover's two captions -- the phone's only text-search route
    // reaches this surface, so they are on the critical path too.
    cleanup();
    render(<SessionList {...baseProps(entries())} phone width={undefined} filterMenuOpen />);
    for (const text of ['Status', 'Origin']) {
      for (const node of named(text)) {
        expect(node.className, text).not.toContain('text-ink-faint');
      }
    }

    cleanup();
    render(<SessionList {...baseProps([])} phone width={undefined} />);
    const empty = document.querySelector('li');
    expect(empty?.textContent?.trim(), 'the empty state').not.toBe('');
    expect(empty?.className).not.toContain('text-ink-faint');
  });
});

describe('the desktop row, which shares this component', () => {
  it('keeps its branch line, its ring and its cursor bar', () => {
    draw(false);
    expect(document.querySelectorAll('[data-row-meta]').length, 'a phone-only line').toBe(0);
    expect(document.querySelectorAll('[data-session-branch]').length).toBe(3);
    expect(document.body.textContent).toContain('—');
    expect(row('a1').className).toContain('border-line-loud');
    expect(row('a1').querySelector('[data-row-cursor]')).not.toBeNull();
  });
});
