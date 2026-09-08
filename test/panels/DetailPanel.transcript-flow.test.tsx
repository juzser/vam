// @vitest-environment happy-dom

/**
 * The transcript reads as one flow: no band headers, progress condensed.
 *
 * The pane used to draw three labelled rules -- `IN`, `PROGRESS`, `OUT` --
 * each an icon, a hairline and a meta slot. The operator asked for all three
 * to go, for the content to run out full, and for progress to condense into
 * one compact expandable line, the way the Claude Code plugin for VSCode
 * collapses a turn's intermediate work.
 *
 * Removing a separator is not removing what it carried, and that is the whole
 * of what these tests pin. Three things rode in those meta slots and every
 * one of them has a new home:
 *  - the turn's own label and `you` (the `in` rule's meta) -> the identity
 *    line, which was already on screen directly above it;
 *  - the turns-read count and the jump control (the `progress` rule's meta)
 *    -> the condensed progress line;
 *  - the session's current activity and the two scroll-to-edge buttons (the
 *    `out` rule's meta) -> the condensed progress line as well, which is the
 *    one row of chrome the column has left.
 *
 * The words `in`, `progress` and `out` survive as screen-reader-only region
 * names. A sighted reader has the boxes, the spacing and the prose to tell
 * the prompt from the answer; a screen-reader user had only those three
 * words, and deleting them outright would be this repo's own dominant defect
 * -- a UI that knows something and says nothing.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

const turn = (id: string): Decision => ({
  id,
  label: `step ${id}`,
  input: `ask ${id}`,
  output: `answer ${id}`,
  commands: [],
});

/** Newest first, the ordering `model.ts` promises. */
const TURNS: readonly Decision[] = ['d7', 'd6', 'd5', 'd4', 'd3', 'd2', 'd1'].map(turn);

const SESSION: Session = {
  vamControlled: true,
  id: 's1',
  title: 'Colour study',
  icon: null,
  epic: 'epic-4',
  branch: null,
  status: 'running',
  runningAgents: 0,
  activity: 'reading files',
  age: '12m',
  decisions: TURNS,
};

const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };

function draw(over: Partial<DetailPanelProps> = {}) {
  const entry: SessionEntry = { project: PROJECT, session: SESSION };
  render(
    <DetailPanel
      entry={entry}
      decision={TURNS[0] as Decision}
      draft=""
      onDraftChange={() => {}}
      onSubmit={() => {}}
      composing={false}
      onCompose={() => {}}
      onStopComposing={() => {}}
      active={false}
      actionIndex={0}
      width={408}
      resizeHandle={null}
      delivers
      {...over}
    />,
  );
}

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const block = (name: string) => q<HTMLElement>(`[data-detail-block="${name}"]`);
const column = () => q<HTMLElement>('[data-detail-column]');
const BLOCKS = ['in', 'progress', 'out'] as const;

afterEach(cleanup);

describe('the three band separators are gone', () => {
  it('draws no hairline rule and no band glyph in any of the three regions', () => {
    draw();
    for (const name of BLOCKS) {
      const region = block(name);
      expect(region, name).not.toBeNull();
      // The separator itself: `<span className="h-px flex-1 bg-line" />`, the
      // rule's own hairline. Class-shaped because a 1px line IS a class here.
      const hairlines = [...(region?.querySelectorAll('span') ?? [])].filter((el) => {
        const cls = el.getAttribute('class') ?? '';
        return cls.includes('h-px') && cls.includes('bg-line');
      });
      expect(hairlines, `${name} draws no hairline`).toHaveLength(0);
      // The band's icon. Every other `role="img"` in this pane belongs to a
      // status or a control, not to a region heading, and none of those is
      // inside these three sections.
      expect(region?.querySelector('[role="img"]'), `${name} draws no band glyph`).toBeNull();
    }
    // The meta slot the rule carried is gone with it; nothing may still be
    // rendering a rule under a different name.
    expect(all('[data-rule-meta]')).toHaveLength(0);
  });

  it('keeps each region named for a screen reader, and only for one', () => {
    draw();
    for (const name of BLOCKS) {
      const named = [...(block(name)?.querySelectorAll('span') ?? [])].filter(
        (el) => el.textContent === name,
      );
      expect(named.length, `${name} is still named`).toBeGreaterThan(0);
      // Named, not shown: a visible word here is the band header again.
      for (const el of named)
        expect(el.getAttribute('class') ?? '', `${name} is announced only`).toContain('sr-only');
    }
  });
});

describe('what the in rule carried survives its removal', () => {
  it('says who and which turn on the identity line, with no per-turn time', () => {
    draw({ decision: TURNS[2] as Decision });
    const identity = q<HTMLElement>('[data-detail-identity]')?.textContent ?? '';
    expect(identity).toContain('atlas');
    expect(identity).toContain('epic-4');
    expect(identity).toContain('you');
    expect(identity).toContain('step d5');
    // `12m` is SESSION.age -- the session's last activity, never this turn's
    // time. The removed rule was careful about that and so is its replacement.
    expect(identity).not.toContain('12m');
  });
});

describe('what the out rule carried survives its removal', () => {
  it('shows the current activity on the turn being worked, and on no other', () => {
    draw();
    expect(q<HTMLElement>('[data-progress-activity]')?.textContent).toContain('reading files');
    cleanup();
    // An older turn: the same line would describe the present while the
    // operator reads the past. Absent, not an em dash under a heading --
    // there is no heading left to leave standing empty.
    draw({ decision: TURNS[2] as Decision });
    expect(q('[data-progress-activity]')).toBeNull();
  });

  it('keeps both scroll-to-edge buttons, in the one row of chrome that is left', () => {
    draw();
    const column = q<HTMLElement>('[data-detail-column]') as HTMLElement;
    // happy-dom lays nothing out, so the metrics `syncJumps` reads are faked
    // here: a tall content resting at the top is "there is more below".
    Object.defineProperty(column, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(column, 'clientHeight', { value: 100, configurable: true });
    column.scrollTop = 0;
    fireEvent.scroll(column);
    expect(q('[data-detail-block="progress"] [data-out-to-bottom]')).not.toBeNull();
    // Only the jump that would actually move: a control that scrolls nowhere
    // is worse than no control, and that rule outlives the rule it sat on.
    expect(q('[data-out-to-top]')).toBeNull();
  });
});

describe('progress condenses into one line you can expand', () => {
  it('starts collapsed: the count, the picker, and no list of turns', () => {
    draw();
    expect(q<HTMLElement>('[data-progress-count]')?.textContent).toBe('7 turns read');
    expect(q('[data-progress-jump]')).not.toBeNull();
    expect(q('[data-progress-turns]')).toBeNull();
    expect(all('[data-progress-turn]')).toHaveLength(0);
    expect(q('[data-progress-expand]')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens into every turn, oldest first, marking the one being read', () => {
    draw();
    fireEvent.click(q('[data-progress-expand]') as HTMLElement);
    expect(q('[data-progress-expand]')?.getAttribute('aria-expanded')).toBe('true');
    const rows = all('[data-progress-turn]');
    expect(rows).toHaveLength(7);
    expect(rows[0]?.textContent).toContain('step d1');
    expect(rows[6]?.textContent).toContain('step d7');
    // The turn on screen is marked in the list, or the list cannot be read as
    // a position in history.
    expect(rows[6]?.getAttribute('aria-current')).toBe('true');
    expect(rows[0]?.getAttribute('aria-current')).toBeNull();
    // One picker at a time: the collapsed line's `<select>` and the open list
    // do the same job, and two controls for one job is how they disagree.
    expect(q('[data-progress-jump]')).toBeNull();
  });

  it('draws a turn the canvas never focused when a row is picked', () => {
    draw();
    fireEvent.click(q('[data-progress-expand]') as HTMLElement);
    fireEvent.click(all('[data-progress-turn]')[0] as HTMLElement);
    expect(q<HTMLElement>('[data-detail-scroll="in"]')?.textContent ?? '').toContain('ask d1');
  });

  it('offers nothing to expand when there is only one turn', () => {
    const only = [TURNS[0] as Decision];
    const session: Session = { ...SESSION, decisions: only };
    draw({
      entry: { project: { ...PROJECT, sessions: [session] }, session },
      decision: only[0] as Decision,
    });
    expect(q('[data-progress-expand]')).toBeNull();
    expect(q('[data-progress-jump]')).toBeNull();
    expect(q<HTMLElement>('[data-progress-count]')?.textContent).toBe('1 turns read');
  });
});

/**
 * The operator's follow-up: with the labels gone the three regions still READ
 * as three separated blocks. A caption is not the seam -- the bordered box
 * around the prompt, its own height cap and its own scrollbar are, and those
 * are what make `in` look like a panel stacked on top of another panel.
 *
 * So the turn is one continuous column: the prompt, the condensed progress
 * line and the answer flow together, ONE scroll container owns all of it, and
 * `in` stays readable while you scroll by sticking to the top of that
 * container rather than by reserving two lines of height forever.
 *
 * `position: sticky` itself cannot be tested here -- happy-dom lays nothing
 * out and computes no scroll parent -- so what is pinned below is the DOM
 * shape that makes it possible (one scroller, no ancestor scroller between it
 * and `in`), and the paint is asserted in a real browser by
 * `e2e/transcript-flow-shots.mjs`, which scrolls the column and measures
 * where `in` actually is.
 */
describe('the turn reads straight through, as one scrolling column', () => {
  it('gives `in` no box, no height cap and no scrollbar of its own', () => {
    draw();
    const box = q<HTMLElement>('[data-detail-scroll="in"]') as HTMLElement;
    expect(box).not.toBeNull();
    // The cap was two lines of body text plus the box's padding. Gone: the
    // prompt runs out in full and the column scrolls it with everything else.
    expect(box.style.maxHeight).toBe('');
    expect(box.className).not.toContain('overflow-y-auto');
    expect(box.className).not.toContain('max-h');
    // The bordered panel was the seam the operator could still see.
    expect(box.className).not.toContain('border');
    expect(box.className).not.toContain('bg-panel');
  });

  it('keeps exactly one scroller for the turn, and it is the column', () => {
    draw();
    const column = q<HTMLElement>('[data-detail-column]') as HTMLElement;
    expect(column.className).toContain('overflow-y-auto');
    // Neither transcript region may own a scroller: that is what made them
    // read as separate panels. The opened turn list is a control, not a
    // region of the transcript, and is allowed its own cap -- it is closed
    // here, so nothing inside the three regions scrolls at all.
    for (const name of ['in', 'out']) {
      const region = q<HTMLElement>(`[data-detail-scroll="${name}"]`);
      expect(region?.className ?? '', name).not.toContain('overflow-y-auto');
    }
    const scrollers = [...column.querySelectorAll('*')].filter((el) =>
      (el.getAttribute('class') ?? '').includes('overflow-y-auto'),
    );
    expect(scrollers).toHaveLength(0);
  });

  it('sticks `in` to the top of that column, with nothing scrollable between', () => {
    draw();
    const inBlock = block('in') as HTMLElement;
    expect(inBlock.className).toContain('sticky');
    expect(inBlock.className).toContain('top-0');
    // Opaque, or the answer scrolling underneath shows through the prompt.
    expect(inBlock.className).toContain('bg-sidebar');
    // Sticky is resolved against the nearest scrolling ancestor. If anything
    // between `in` and the column scrolled, `in` would stick to THAT and go
    // off screen with it -- the exact failure a class-name-only assertion
    // cannot see, so the chain itself is walked here.
    let node = inBlock.parentElement;
    while (node !== null && node !== column()) {
      expect(
        node.getAttribute('class') ?? '',
        'no scroller between in and the column',
      ).not.toContain('overflow-y-auto');
      node = node.parentElement;
    }
    expect(node).toBe(column());
  });
});
