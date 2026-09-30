// @vitest-environment happy-dom

/**
 * Each project row of the phone's project list carries a '+' at its right
 * edge. It is a SIBLING of the row button and reuses `onPick`.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type SessionCreateChoice,
  SessionCreatePicker,
} from '../../src/renderer/phone/SessionCreatePicker.js';

afterEach(cleanup);

const CHOICES: readonly SessionCreateChoice[] = [
  { id: 'p1', name: 'alpha', icon: null, paneOnly: false },
  { id: 'p2', name: 'beta', icon: null, paneOnly: true },
  { id: 'p3', name: 'gamma', icon: null, paneOnly: false },
];

function draw() {
  const onPick = vi.fn();
  render(<SessionCreatePicker choices={CHOICES} onPick={onPick} onClose={() => {}} />);
  return onPick;
}

describe('the project row +', () => {
  it('sits after the row button in every li, never nested in it', () => {
    draw();
    const items = [...document.querySelectorAll('[data-session-create-picker] li')];
    expect(items).toHaveLength(3);
    for (const [i, li] of items.entries()) {
      const id = CHOICES[i]?.id as string;
      const [row, plus] = [...li.children];
      expect(row?.getAttribute('data-project-choice-create')).toBe(id);
      expect(plus?.getAttribute('data-project-choice-plus')).toBe(id);
      expect(plus?.tagName).toBe('BUTTON');
      expect(li.querySelector('button button')).toBeNull();
    }
  });

  it('is named New session in <project name>', () => {
    draw();
    const labels = [...document.querySelectorAll('[data-project-choice-plus]')].map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['New session in alpha', 'New session in beta', 'New session in gamma']);
  });

  it('calls onPick once with the row id when tapped', () => {
    const onPick = draw();
    fireEvent.click(document.querySelector('[data-project-choice-plus="p2"]') as Element);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('p2');
  });

  it('leaves the row button unchanged: one onPick with the id', () => {
    const onPick = draw();
    fireEvent.click(document.querySelector('[data-project-choice-create="p3"]') as Element);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('p3');
  });
});
