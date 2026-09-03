// @vitest-environment happy-dom

/**
 * The right-hand detail pane: what it collapses, what it colours, and what it
 * refuses to claim.
 *
 * Every assertion here is one of five operator requests read off the ADE
 * mockup's right pane (artboards 1a/1b, the `width:408px` column). The one that
 * is NOT a fidelity question is the composer's button: the mockup draws a send
 * arrow, black-smith has no channel into a running agent session, and the whole
 * point of the tests below is that the button says `record` in every place a
 * reader or a screen reader can find it.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

function decision(id: string, output: string | null = 'answered'): Decision {
  return { id, label: `step ${id}`, input: `ask ${id}`, output, commands: [] };
}

const DECISIONS = [decision('d3', null), decision('d2'), decision('d1')];

const SESSION: Session = {
  id: 's1',
  title: 'Sprint board reorder',
  icon: null,
  epic: 'board',
  status: 'waiting',
  runningAgents: 2,
  activity: 'just now',
  age: '12m',
  decisions: DECISIONS,
};

const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
const ENTRY: SessionEntry = { project: PROJECT, session: SESSION };

function draw(over: Partial<DetailPanelProps> = {}) {
  const props: DetailPanelProps = {
    entry: ENTRY,
    // The newest turn, which is the one the canvas focuses by default.
    decision: DECISIONS[0] as Decision,
    draft: '',
    onDraftChange: () => {},
    onSubmit: () => {},
    onPickCommand: () => {},
    onCopyCommand: () => {},
    composing: false,
    onCompose: () => {},
    onStopComposing: () => {},
    active: false,
    actionIndex: 0,
    width: 408,
    resizeHandle: null,
    ...over,
  };
  render(<DetailPanel {...props} />);
}

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const all = (selector: string) => [...document.querySelectorAll(selector)];
const progress = () => q<HTMLElement>('[data-detail-block="progress"]');
const turns = () => all('[data-progress-turn]');
const toggle = () => q<HTMLButtonElement>('[data-progress-toggle]');

afterEach(cleanup);

describe('the progress region collapses to its newest line', () => {
  it('draws one turn collapsed, every turn expanded, and says which it is', () => {
    draw();
    // Collapsed by default: `progress` is context beside `out`, and three
    // regions competing for the pane's height is what made it unreadable.
    expect(turns()).toHaveLength(1);
    // The LAST line, which this list orders as the NEWEST turn: it runs
    // oldest-first, like the ribbon and like the canvas.
    expect(turns()[0]?.textContent).toContain('step d3');
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');

    act(() => toggle()?.click());
    expect(turns()).toHaveLength(DECISIONS.length);
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');

    act(() => toggle()?.click());
    expect(turns()).toHaveLength(1);
  });

  it('keeps the three-region structure the pane already earned', () => {
    draw();
    // A real <button>, so Enter and Space work with no new global binding and
    // no key stolen from the modal keymap.
    expect(toggle()?.tagName).toBe('BUTTON');
    // Regressions guarded elsewhere, restated here because this change is the
    // one most likely to eat them: still flex-none, still its own scroller.
    expect(progress()?.className).toContain('flex-none');
    expect(progress()?.querySelector('.vam-no-scrollbar')).not.toBeNull();
  });
});

describe('the pane wears the mockup’s own background', () => {
  it('uses the sidebar token, the pane colour measured off both artboards', () => {
    draw();
    // #171717 dark / #f0eeea light in the mockup — exactly `--vam-sidebar`,
    // so this is an existing token rather than a new one.
    const aside = q<HTMLElement>('[data-action-pane]');
    expect(aside?.className).toContain('bg-sidebar');
    expect(aside?.className).not.toContain('bg-sunken');
  });
});

describe('the composer is multiline, and honest about what its button does', () => {
  it('is a textarea with a record button, and no i / I notes', () => {
    draw();
    const box = q<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');
    expect(box).not.toBeNull();
    expect(document.querySelector('input[aria-label="prompt to session"]')).toBeNull();

    // The button exists and never uses the word `send`: black-smith records a
    // prompt into the session log, it cannot hand it to a running agent.
    const button = q<HTMLButtonElement>('[data-prompt-record]');
    expect(button?.tagName).toBe('BUTTON');
    const claims = `${button?.getAttribute('aria-label')} ${button?.getAttribute('title')} ${button?.textContent}`;
    expect(claims.toLowerCase()).toContain('record');
    expect(claims.toLowerCase()).not.toContain('send');

    // The two hint notes the operator asked to lose.
    const footer = q<HTMLElement>('[data-action-pane]')?.textContent ?? '';
    expect(footer).not.toContain('i type · I pane');
    expect(footer).not.toContain('i reason · Enter act');
  });

  it('records on Enter and takes a newline on Shift+Enter', () => {
    let submitted = 0;
    draw({
      composing: true,
      onSubmit: () => {
        submitted += 1;
      },
    });
    const box = q<HTMLTextAreaElement>(
      'textarea[aria-label="prompt to session"]',
    ) as HTMLTextAreaElement;

    act(() => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(submitted).toBe(1);

    // Shift+Enter is the newline the box became multiline to allow, so it must
    // not also be the key that files the prompt.
    act(() => {
      box.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
      );
    });
    expect(submitted).toBe(1);
  });

  it('clicking record files the draft', () => {
    let submitted = 0;
    draw({
      draft: 'do it again',
      onSubmit: () => {
        submitted += 1;
      },
    });
    act(() => q<HTMLButtonElement>('[data-prompt-record]')?.click());
    expect(submitted).toBe(1);
  });
});

describe('the row under the composer is the mockup’s mode row', () => {
  it('replaces the slash tags with mode pills and a shift+Tab tag', () => {
    draw();
    const row = q<HTMLElement>('[data-mode-row]');
    expect(row).not.toBeNull();
    expect(all('[data-mode-pill]').map((el) => el.textContent)).toEqual(['Auto', 'Manual', 'Plan']);
    // The slash tags this row replaced.
    expect(row?.textContent).not.toContain('/diff');
    expect(document.querySelector('[data-placeholder="slash-diff"]')).toBeNull();

    // At the right-hand end of the same row, per the operator's request; the
    // mockup carries a `Tab / cycle mode` tag in the same slot.
    const tag = q<HTMLElement>('[data-mode-cycle]');
    expect(tag).not.toBeNull();
    expect(row?.contains(tag as Node)).toBe(true);
    expect(tag?.textContent).toContain('Tab');
    // A shift glyph is an image, and an aria-label on a bare <span> is dropped
    // in silence — `role="img"` is what makes it announced at all.
    expect(tag?.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('shift');
  });
});

describe('there is a way out of the prompt box without a mouse', () => {
  it('Escape gives the keyboard back, and does not leave DOM focus behind', () => {
    let left = 0;
    draw({
      composing: true,
      onStopComposing: () => {
        left += 1;
      },
    });
    const box = q<HTMLTextAreaElement>(
      'textarea[aria-label="prompt to session"]',
    ) as HTMLTextAreaElement;
    // `composing` focuses the box, which is the state the operator gets stuck
    // in: while it holds DOM focus the window listener returns early on every
    // key, so no navigation key reaches the sidebar at all.
    expect(document.activeElement).toBe(box);

    act(() => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(left).toBe(1);
    // Clearing `composing` alone is not enough: it only makes the box
    // read-only. Until it is blurred the keys still land on it and vanish.
    expect(document.activeElement).not.toBe(box);
  });

  it('says how to get out, in the box, while you are in it', () => {
    draw({ composing: true });
    expect(q<HTMLElement>('[data-prompt-escape]')?.textContent).toContain('Esc');
    expect(q<HTMLElement>('[data-prompt-escape]')?.textContent).toContain('sidebar');
    // Not clutter the rest of the time: the way out only matters once you are
    // in, and this row is already carrying four things at 408px.
    cleanup();
    draw({ composing: false });
    expect(q<HTMLElement>('[data-prompt-escape]')).toBeNull();
  });
});
