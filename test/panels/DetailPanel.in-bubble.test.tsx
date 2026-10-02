// @vitest-environment happy-dom

/**
 * THE IN BUBBLE (operator events 67 and 68): the prompt as typed, right-aligned,
 * at most 90% of the Response column. `PhoneShell` mounts the same
 * `DetailPanel`, so this is the phone's Response view too.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel } from '../../src/renderer/panels/DetailPanel.js';

function turn(id: string, over: Partial<Decision> = {}): Decision {
  return {
    id,
    label: `turn-${id}`,
    input: `ask ${id}`,
    output: `done ${id}`,
    commands: [],
    ...over,
  };
}

function draw(decisions: readonly Decision[]) {
  const built: Session = {
    id: 's1',
    title: 'Provider survey',
    epic: null,
    branch: null,
    status: 'running',
    runningAgents: 0,
    activity: null,
    age: '3m',
    decisions,
  };
  const project: Project = { id: 'p1', name: 'atlas', sessions: [built] };
  const entry: SessionEntry = { project, session: built };
  render(
    <DetailPanel
      entry={entry}
      decision={decisions[0] ?? null}
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
    />,
  );
}

const INPUT = 'Fix these:\n- first\n- second\n• third';
const bubble = () =>
  document.querySelector<HTMLElement>('[data-detail-scroll="in"]') as HTMLElement;
const classesOf = (el: HTMLElement) => el.className.split(/\s+/);

afterEach(cleanup);

describe('the In bubble shows the prompt as typed', () => {
  it('draws four newline-separated lines with their markers, and no markdown', () => {
    draw([turn('a', { input: INPUT })]);
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
    draw([turn('a', { input: INPUT })]);
    const classes = classesOf(bubble());
    expect(classes).toContain('self-end');
    expect(classes).toContain('max-w-[90%]');
    expect(classes).not.toContain('w-full');
    expect(classes).toContain('bg-in-bubble');
    expect(classes).toContain('rounded-[10px]');
  });

  it('sits in a flex column, so the percentage resolves against the Response column', () => {
    draw([turn('a', { input: INPUT })]);
    const block = bubble().closest('[data-detail-block="in"]') as HTMLElement;
    expect(classesOf(block)).toEqual(expect.arrayContaining(['flex', 'flex-col']));
  });

  it('keeps the corner reserve as the paragraph’s first child when a pill is drawn', () => {
    draw([turn('a', { input: INPUT })]);
    const paragraph = bubble().querySelector('p') as HTMLElement;
    const reserve = paragraph.querySelector('[data-detail-corner-reserve]');
    // Absent when no pill is drawn (an unfocused pane); when present it leads.
    if (reserve !== null) expect(paragraph.firstElementChild).toBe(reserve);
  });

  it('leaves the output block as it was', () => {
    draw([turn('a', { input: INPUT })]);
    const out = document.querySelector<HTMLElement>('[data-detail-scroll="out"]') as HTMLElement;
    expect(classesOf(out)).not.toContain('self-end');
    expect(classesOf(out)).not.toContain('max-w-[90%]');
  });
});
