// @vitest-environment happy-dom

/** EC-44a, operator event #33: the icon picker header reads "Icon for <name>". */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { IconPicker } from '../../src/renderer/panels/IconPicker.js';

afterEach(cleanup);

describe('the icon picker header', () => {
  function heading() {
    render(<IconPicker title="demo" value="" onPick={() => {}} onClose={() => {}} />);
    return document.querySelector('[data-icon-picker-heading]') as HTMLElement;
  }

  it('reads "Icon for" before the name, which keeps its own mono span', () => {
    const row = heading();
    expect(row).not.toBeNull();
    const [label, name] = [...row.querySelectorAll('span')];
    expect(label?.textContent).toBe('Icon for');
    expect(label?.className).toContain('text-meta');
    expect(name?.textContent).toBe('demo');
    expect(name?.className).toContain('font-mono');
  });

  it('reads "Icon for demo" once clear icon is left out', () => {
    const row = heading();
    const button = row.querySelector('button') as HTMLElement;
    const text = [...row.childNodes]
      .filter((node) => node !== button)
      .map((node) => node.textContent)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    expect(text).toBe('Icon for demo');
    expect(button.textContent).toBe('clear icon');
  });
});
