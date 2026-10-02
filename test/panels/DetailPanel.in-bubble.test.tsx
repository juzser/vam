// @vitest-environment happy-dom

/**
 * THE IN BUBBLE (operator events 67 and 68): the prompt as typed, right-aligned,
 * at most 90% of the Response column. `PhoneShell` mounts the same
 * `DetailPanel`, so this is the phone's Response view too.
 */
import { cleanup, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { DetailPanel } from '../../src/renderer/panels/DetailPanel.js';

const INPUT = 'Fix these:\n- first\n- second\n• third';
const noop = () => {};
type Props = ComponentProps<typeof DetailPanel>;

function draw(input: string, over: Partial<Props> = {}) {
  const decision = { id: 'a', label: 'turn-a', input, output: 'done a', commands: [] };
  const built = { id: 's1', title: 'T', status: 'running', activity: null, decisions: [decision] };
  const entry = { project: { id: 'p1', name: 'atlas', sessions: [built] }, session: built };
  const rest = { composing: false, active: false, actionIndex: 0, resizeHandle: null, width: 408 };
  const props = { ...rest, entry, decision, draft: '', onDraftChange: noop, onSubmit: noop };
  render(
    <DetailPanel
      {...({ ...props, onCompose: noop, onStopComposing: noop, ...over } as unknown as Props)}
    />,
  );
}

const find = (sel: string) => document.querySelector<HTMLElement>(sel) as HTMLElement;
const bubble = () => find('[data-detail-scroll="in"]');
const classesOf = (el: HTMLElement) => el.className.split(/\s+/);

afterEach(cleanup);

describe('the In bubble shows the prompt as typed', () => {
  it('draws four newline-separated lines with their markers, and no markdown', () => {
    draw(INPUT);
    const paragraph = bubble().querySelector('p') as HTMLElement;
    // The reserved corner is an empty float, so the text is the input exactly.
    expect(paragraph.textContent).toBe(INPUT);
    expect(paragraph.textContent?.split('\n')).toHaveLength(4);
    expect(paragraph.className).toContain('whitespace-pre-wrap');
    expect(paragraph.className).toContain('break-words');
    expect(paragraph.querySelector('ul, ol, li, strong, em, code')).toBeNull();
  });
});

describe('the In bubble is right-aligned and shrinks to its prompt', () => {
  it('carries self-end and max-w-[90%], not w-full, and keeps its ground and corners', () => {
    draw(INPUT);
    const classes = classesOf(bubble());
    expect(classes).toContain('self-end');
    expect(classes).toContain('max-w-[90%]');
    expect(classes).not.toContain('w-full');
    expect(classes).toContain('bg-in-bubble');
    expect(classes).toContain('rounded-[10px]');
  });

  it('sits in a flex column, so the percentage resolves against the Response column', () => {
    draw(INPUT);
    const block = bubble().closest('[data-detail-block="in"]') as HTMLElement;
    expect(classesOf(block)).toEqual(expect.arrayContaining(['flex', 'flex-col']));
  });

  it('keeps the corner reserve as the paragraph’s first child in a focused pane', () => {
    draw(INPUT, { paneFocused: true });
    const paragraph = bubble().querySelector('p') as HTMLElement;
    const reserve = paragraph.querySelector('[data-detail-corner-reserve]');
    expect(reserve).not.toBeNull();
    expect(paragraph.firstElementChild).toBe(reserve);
    // The first NODE too: an element-only query would not see text drawn before it.
    expect(paragraph.firstChild).toBe(reserve);
  });

  it('draws no corner reserve in an unfocused pane, where no pill is drawn', () => {
    draw(INPUT, { paneFocused: false });
    expect(document.querySelector('[data-detail-corner-reserve]')).toBeNull();
  });

  it('leaves the output block as it was', () => {
    draw(INPUT);
    const out = find('[data-detail-scroll="out"]');
    expect(out.className).toBe('flex flex-col gap-2 text-[length:var(--vam-out-font-size,12px)]');
  });
});

describe('on a phone the jump pill clears the pinned prompt', () => {
  it('reserves 16px of right padding inside the paragraph, and nothing on the band', () => {
    draw(INPUT, { phone: true });
    const paragraph = bubble().querySelector('p') as HTMLElement;
    expect(paragraph.hasAttribute('data-detail-pill-reserve')).toBe(true);
    expect(classesOf(paragraph)).toContain('pr-4');
    expect(classesOf(bubble().closest('[data-detail-block="in"]') as HTMLElement)).toContain(
      'pr-3.5',
    );
    expect(paragraph.textContent).toBe(INPUT);
  });

  it('draws no pill reserve on the desktop', () => {
    draw(INPUT);
    const paragraph = bubble().querySelector('p') as HTMLElement;
    expect(paragraph.hasAttribute('data-detail-pill-reserve')).toBe(false);
    expect(classesOf(paragraph)).not.toContain('pr-4');
  });
});
