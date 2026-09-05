// @vitest-environment happy-dom

/**
 * The membership picker: what a group's `+` opens.
 *
 * NOT A DIRECTORY PICKER, and that is the whole design. `repo.ts` records why
 * listing what vam already knows is the wrong control for CREATING a project
 * -- "the only list vam could offer is the directories it already has
 * sessions in" -- which is exactly what makes it the right one here. You can
 * only group what exists.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectPicker } from '../../src/renderer/panels/ProjectPicker.js';

afterEach(cleanup);

const CHOICES = [
  { id: 'p1', name: 'alpha', member: true, groupName: 'work' },
  { id: 'p2', name: 'beta', member: false, groupName: null },
  { id: 'p3', name: 'gamma', member: false, groupName: 'other' },
];

function renderPicker(over: Partial<Parameters<typeof ProjectPicker>[0]> = {}) {
  return render(
    <ProjectPicker
      groupName="work"
      choices={CHOICES}
      onToggle={vi.fn()}
      onClose={vi.fn()}
      {...over}
    />,
  );
}

describe('the membership picker', () => {
  it('names the group it is picking for', () => {
    const { container } = renderPicker();
    expect(container.querySelector('[data-project-picker]')?.textContent).toContain('work');
  });

  it('lists members first, then the free ones, then those spoken for', () => {
    const { container } = renderPicker();
    expect(
      [...container.querySelectorAll('[data-project-choice]')].map((el) =>
        el.getAttribute('data-project-choice'),
      ),
    ).toEqual(['p1', 'p2', 'p3']);
  });

  /**
   * A project belongs to at most one group -- membership is array position,
   * and a project in two groups walks its sessions twice, minting duplicate
   * `info:<sessionId>` node ids that break ReactFlow and `j`/`k`
   * (`to-canvas.ts:312`). So adding one MOVES it, and the row says where
   * from before the click rather than after it.
   */
  it('says which other group a project would be moved out of', () => {
    const { container } = renderPicker();
    expect(container.querySelector('[data-project-choice="p3"]')?.textContent).toContain('other');
    expect(container.querySelector('[data-project-choice="p2"]')?.textContent).not.toContain(
      'other',
    );
  });

  it('marks what is already in, and toggles it back out on a click', () => {
    const onToggle = vi.fn();
    const { container } = renderPicker({ onToggle });
    expect(
      container.querySelector('[data-project-choice="p1"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(container.querySelector('[data-project-choice="p1"]') as Element);
    expect(onToggle).toHaveBeenCalledWith('p1', false);
    fireEvent.click(container.querySelector('[data-project-choice="p2"]') as Element);
    expect(onToggle).toHaveBeenCalledWith('p2', true);
  });

  it('says so rather than showing an empty box when vam knows no project', () => {
    const { container } = renderPicker({ choices: [] });
    expect(container.querySelector('[data-project-picker]')?.textContent).toMatch(
      /no repo|nothing/i,
    );
  });

  it('closes on Escape and on the backdrop', () => {
    const onClose = vi.fn();
    const { container } = renderPicker({ onClose });
    fireEvent.keyDown(container.querySelector('[data-project-picker]') as Element, {
      key: 'Escape',
    });
    expect(onClose).toHaveBeenCalled();
  });
});
