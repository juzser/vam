// @vitest-environment happy-dom

/**
 * THE TEMPLATE ROW, DRIVEN.
 *
 * `test/prefs/palette-templates.test.ts` measures the COLOURS; this measures
 * that the operator can reach them. The two questions are separate and the
 * second one is the one a palette table cannot answer: a template that is
 * perfectly derived and wired to nothing changes no screen.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE: what the discs PAINT. jsdom resolves
 * no custom properties and lays nothing out, so a colour read back here would
 * be the inline style string this file just put there -- a tautology. The
 * painted answer is `e2e/pane-colour-shots.mjs`, which drives a template button
 * in a real browser and re-measures the pane.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PALETTE_TEMPLATES, templatePalette } from '../../src/renderer/prefs/palette-templates.js';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';

// Every sibling settings test does this: without it `screen` queries a body
// that still holds the previous test's overlay, and `getByRole` finds two.
afterEach(cleanup);

function open(prefs: Prefs = EMPTY_PREFS, theme: 'dark' | 'light' = 'dark') {
  const onChange = vi.fn();
  render(<SettingsOverlay prefs={prefs} theme={theme} onChange={onChange} onClose={() => {}} />);
  return { onChange };
}

describe('the colour template row', () => {
  it('offers every shipped template, by name, with an accessible name that says which theme', () => {
    open();
    // The corpus first: a row that rendered nothing would pass a "no wrong
    // buttons" check forever.
    expect(PALETTE_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    for (const template of PALETTE_TEMPLATES) {
      const button = screen.getByRole('button', {
        name: `apply the ${template.label} colour template to dark`,
      });
      expect(button).toBeTruthy();
      expect(button.getAttribute('data-palette-template')).toBe(template.id);
    }
  });

  it('says which theme it will write, because that is the whole ambiguity', () => {
    // The same button in the other theme has to name the other theme, or the
    // operator cannot tell which palette a press is about to replace.
    open(EMPTY_PREFS, 'light');
    const first = PALETTE_TEMPLATES[0];
    expect(
      screen.getByRole('button', {
        name: `apply the ${first?.label} colour template to light`,
      }),
    ).toBeTruthy();
  });

  it('writes the whole template into the theme on screen when pressed', () => {
    const { onChange } = open();
    const template = PALETTE_TEMPLATES[1];
    fireEvent.click(
      screen.getByRole('button', {
        name: `apply the ${template?.label} colour template to dark`,
      }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as Prefs;
    expect(next.palette.dark).toEqual(templatePalette(template?.id as never, 'dark'));
    // And the theme nobody is looking at is untouched -- the same rule the
    // reset button follows.
    expect(next.palette.light).toEqual({});
  });

  it('previews each template with the three surfaces the operator has reported on', () => {
    open();
    const template = PALETTE_TEMPLATES[0];
    const button = screen.getByRole('button', {
      name: `apply the ${template?.label} colour template to dark`,
    });
    const discs = button.querySelectorAll('[data-template-disc]');
    expect([...discs].map((d) => d.getAttribute('data-template-disc'))).toEqual([
      '--vam-pane',
      '--vam-card',
      '--vam-in-bubble',
    ]);
    // A colour is not a label: the discs must stay out of the accessible name,
    // which the assertion above already depends on -- `getByRole` found this
    // button by a name that contains no colour at all.
    for (const disc of discs) {
      expect(disc.getAttribute('aria-hidden')).toBe(null);
    }
    expect(button.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
});
